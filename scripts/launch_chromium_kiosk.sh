#!/bin/bash
# Full-screen Chromium for the Tablet Hardness Tester kiosk (called from ~/.xinitrc or start_kiosk.sh).
set -euo pipefail

KIOSK_URL="${KIOSK_URL:-http://127.0.0.1:5000/}"
KIOSK_URL="${KIOSK_URL%/}/"

# Prefer the Chromium binary directly — NOT /usr/bin/chromium.
# The Debian/RPi wrapper sources /etc/chromium.d/* which forces
#   --enable-remote-extensions
# and then SKIPS --disable-background-networking. Offline that makes Chromium
# hammer Google GCM/MCS (net error -2/-105) and can surface top-of-window
# component/extension failures. The kiosk must run fully offline.
if [[ -x /usr/lib/chromium/chromium ]]; then
  CHROME_BIN="/usr/lib/chromium/chromium"
elif command -v chromium >/dev/null 2>&1; then
  CHROME_BIN="$(command -v chromium)"
elif command -v chromium-browser >/dev/null 2>&1; then
  CHROME_BIN="$(command -v chromium-browser)"
else
  echo "chromium not found" >&2
  exit 1
fi

# Wait until HTML, health, AND styles.css are actually servable.
# Waiting only for GET / caused intermittent unstyled launches: Chromium opened as soon as
# index.html responded while styles.css was still unavailable (single-threaded Flask busy /
# service still warming), and --incognito does not recover a failed stylesheet fetch.
kiosk_assets_ready() {
  curl -sf --connect-timeout 1 "${KIOSK_URL}" >/dev/null 2>&1 || return 1
  curl -sf --connect-timeout 1 "${KIOSK_URL}api/health" >/dev/null 2>&1 || return 1
  # Require real CSS bytes (not an empty/error body)
  local css
  css="$(curl -sf --connect-timeout 2 "${KIOSK_URL}styles.css" 2>/dev/null || true)"
  [[ -n "$css" && ${#css} -gt 1000 ]]
}

for _ in $(seq 1 90); do
  if kiosk_assets_ready; then
    break
  fi
  sleep 1
done

# Avoid opening a stack of kiosk windows if the desktop autostart runs twice.
if pgrep -f -- "${CHROME_BIN}.*--app=${KIOSK_URL%/}" >/dev/null 2>&1; then
  exit 0
fi

# kiosk-display.service runs X11 via startx — not Wayland. Chromium 144+ defaults to
# Wayland/ozone and exits immediately if no Wayland compositor is present (blank screen
# after power-on). Force X11 unless an operator explicitly overrides CHROMIUM_OZONE_PLATFORM.
export DISPLAY="${DISPLAY:-:0}"
if [[ -z "${XDG_RUNTIME_DIR:-}" || ! -d "${XDG_RUNTIME_DIR}" ]]; then
  export XDG_RUNTIME_DIR="/run/user/$(id -u)"
  mkdir -p "${XDG_RUNTIME_DIR}" 2>/dev/null || true
fi
OZONE_PLATFORM="${CHROMIUM_OZONE_PLATFORM:-x11}"

# Do not inherit Debian wrapper flags that enable remote extensions / background net.
unset CHROMIUM_FLAGS || true

exec "$CHROME_BIN" \
  --start-fullscreen \
  --noerrdialogs \
  --disable-infobars \
  --disable-pinch \
  --overscroll-history-navigation=0 \
  --force-device-scale-factor=1 \
  --kiosk \
  --incognito \
  --no-first-run \
  --disable-session-crashed-bubble \
  --disable-background-networking \
  --disable-sync \
  --disable-component-update \
  --disable-client-side-phishing-detection \
  --disable-default-apps \
  --disable-extensions \
  --disable-component-extensions-with-background-pages \
  --disable-features=TranslateUI,AutofillServerCommunication,MediaRouter,OptimizationHints \
  --ozone-platform="${OZONE_PLATFORM}" \
  --ozone-platform-hint=x11 \
  --use-angle=gles \
  --disable-dev-shm-usage \
  --window-size=1024,600 \
  --app="${KIOSK_URL%/}"
