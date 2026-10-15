#!/usr/bin/env bash
# Lightweight health check: storage RW, API, display.
# Recovers VFAT remount-ro after power interruption, then restarts services if needed.
set -uo pipefail

API_URL="${KIOSK_URL:-http://127.0.0.1:5000/}"
INTERNAL_USB_PATH="${INTERNAL_USB_PATH:-/media/usb_internal}"
STORAGE_DIR="${STORAGE_DIR:-$INTERNAL_USB_PATH/storage}"
REPAIR_SCRIPT="${REPAIR_SCRIPT:-/opt/kiosk/scripts/kiosk_repair_internal_usb.sh}"
LOG_TAG="kiosk-watchdog"

log() { echo "$LOG_TAG: $*" >&2; }

_run_root() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  else
    sudo -n "$@" 2>/dev/null || return 1
  fi
}

storage_ok() {
  mountpoint -q "$INTERNAL_USB_PATH" 2>/dev/null || return 1
  touch "$STORAGE_DIR/.kiosk_watchdog_write" 2>/dev/null || return 1
  rm -f "$STORAGE_DIR/.kiosk_watchdog_write" 2>/dev/null || true
  return 0
}

api_ok() {
  curl -sf --connect-timeout 2 --max-time 4 "$API_URL" >/dev/null 2>&1
}

display_ok() {
  pgrep -f '/usr/lib/xorg/Xorg :0' >/dev/null 2>&1 \
    && pgrep -f '/usr/lib/chromium/chromium.*--app=' >/dev/null 2>&1
}

# Never allow the legacy duplicate bridge unit to come back.
if systemctl is-enabled bridge.service >/dev/null 2>&1; then
  log "legacy bridge.service enabled — masking"
  _run_root systemctl disable --now bridge.service 2>/dev/null || true
  _run_root systemctl mask bridge.service 2>/dev/null || true
fi

storage_repaired=0
if ! storage_ok; then
  log "storage missing/RO — repairing internal USB"
  if [[ -x "$REPAIR_SCRIPT" ]]; then
    _run_root bash "$REPAIR_SCRIPT" || bash "$REPAIR_SCRIPT" || true
  fi
  storage_repaired=1
  if ! storage_ok; then
    log "WARN storage still not writable after repair"
  else
    log "storage writable after repair"
  fi
fi

# After a storage repair, bounce the API so sessions/factory sync can rewrite cleanly.
if [[ "$storage_repaired" -eq 1 ]] && storage_ok; then
  log "restarting kiosk-bridge after storage repair"
  _run_root systemctl restart kiosk-bridge.service || true
  sleep 3
elif ! api_ok; then
  log "API down — restarting kiosk-bridge.service"
  # Pre-repair helps when API crash-loops on EROFS during init
  if ! storage_ok && [[ -x "$REPAIR_SCRIPT" ]]; then
    _run_root bash "$REPAIR_SCRIPT" || bash "$REPAIR_SCRIPT" || true
  fi
  _run_root systemctl restart kiosk-bridge.service || true
  sleep 3
fi

if ! display_ok; then
  log "Display down — restarting kiosk-display.service"
  _run_root systemctl restart kiosk-display.service || true
fi

exit 0
