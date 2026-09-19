#!/usr/bin/env bash
# Ensure kiosk scripts stay executable (survives folder replace / git checkout).
set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/kiosk}"
chmod +x \
  "$APP_ROOT/run_kiosk_app.sh" \
  "$APP_ROOT/run_hardness_bridge.sh" \
  "$APP_ROOT/start_kiosk.sh" \
  "$APP_ROOT/scripts/"*.sh \
  "$APP_ROOT/scripts/mount-internal-usb" \
  "$APP_ROOT/scripts/make-production-image.sh" 2>/dev/null || true

# Keep system PATH wrapper current when present
if [ -d /usr/local/sbin ] && [ -x "$APP_ROOT/scripts/mount-internal-usb" ]; then
  install -m 0755 "$APP_ROOT/scripts/mount-internal-usb" /usr/local/sbin/mount-internal-usb 2>/dev/null || true
fi
