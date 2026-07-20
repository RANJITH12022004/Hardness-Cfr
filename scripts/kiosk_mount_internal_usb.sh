#!/usr/bin/env bash
# Ensure internal pendrive (sda1) is mounted at /media/usb_internal and project dirs exist.
set -euo pipefail

INTERNAL_USB_PATH="${INTERNAL_USB_PATH:-/media/usb_internal}"
STORAGE_DIR="${STORAGE_DIR:-$INTERNAL_USB_PATH/storage}"
REPORTS_DIR="${REPORTS_DIR:-$INTERNAL_USB_PATH/reports}"
AUDIT_DB_DIR="${AUDIT_DB_DIR:-$INTERNAL_USB_PATH/db}"

_ensure_usb_writable() {
  # After unclean power-off, vfat often remounts read-only (errors=remount-ro).
  # Session clear / factory settings then fail and stale login state can stick.
  if ! mountpoint -q "$INTERNAL_USB_PATH" 2>/dev/null; then
    return 1
  fi
  if touch "$INTERNAL_USB_PATH/.kiosk_write_test" 2>/dev/null; then
    rm -f "$INTERNAL_USB_PATH/.kiosk_write_test" 2>/dev/null || true
    return 0
  fi
  echo "kiosk_mount_internal_usb: storage is read-only — attempting remount,rw" >&2
  mount -o remount,rw "$INTERNAL_USB_PATH" 2>/dev/null || true
  if touch "$INTERNAL_USB_PATH/.kiosk_write_test" 2>/dev/null; then
    rm -f "$INTERNAL_USB_PATH/.kiosk_write_test" 2>/dev/null || true
    return 0
  fi
  echo "kiosk_mount_internal_usb: WARN still read-only after remount" >&2
  return 1
}

if mountpoint -q "$INTERNAL_USB_PATH" 2>/dev/null; then
  _ensure_usb_writable || true
  mkdir -p "$STORAGE_DIR" "$REPORTS_DIR" "$AUDIT_DB_DIR" 2>/dev/null || true
  exit 0
fi

# fstab entry should mount this during local-fs.target; retry briefly if udev is still settling.
if command -v mount >/dev/null 2>&1; then
  mount "$INTERNAL_USB_PATH" 2>/dev/null || true
fi

for _i in $(seq 1 5); do
  if mountpoint -q "$INTERNAL_USB_PATH" 2>/dev/null; then
    _ensure_usb_writable || true
    mkdir -p "$STORAGE_DIR" "$REPORTS_DIR" "$AUDIT_DB_DIR" 2>/dev/null || true
    exit 0
  fi
  sleep 0.4
done

echo "kiosk_mount_internal_usb: WARN $INTERNAL_USB_PATH not mounted — using SD-card fallback until USB is available" >&2
exit 0
