#!/usr/bin/env bash
# Start X on tty1 and keep the kiosk UI running (Chromium full-screen).
set -euo pipefail

export DISPLAY=:0
export XAUTHORITY="${XAUTHORITY:-/home/rle/.Xauthority}"
# Ensure Chromium (launched from .xinitrc) has a valid runtime dir under X11.
if [[ -z "${XDG_RUNTIME_DIR:-}" || ! -d "${XDG_RUNTIME_DIR}" ]]; then
  export XDG_RUNTIME_DIR="/run/user/$(id -u)"
  mkdir -p "${XDG_RUNTIME_DIR}" 2>/dev/null || true
fi
# Match launch_chromium_kiosk.sh: this stack is X11, not Wayland.
export CHROMIUM_OZONE_PLATFORM="${CHROMIUM_OZONE_PLATFORM:-x11}"

for _ in $(seq 1 30); do
  if curl -sf --connect-timeout 1 "http://127.0.0.1:5000/" >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done

exec /usr/bin/startx /home/rle/.xinitrc -- :0 vt1 -keeptty
