#!/usr/bin/env bash
# Create a shrunk Hardness CFR production OS image (.img.gz) from the live SD.
#
# Copies only allocated partitions (through end of rootfs), offline-shrinks the
# root filesystem to used + margin, then gzip-compresses with pv progress/ETA.
#
# Default export stick: /dev/sda mounted at /media/os_export (ext4 OS_EXPORT).
# NEVER writes to /dev/sdb (internal USB) or /dev/mmcblk0.
#
# Usage:
#   sudo /opt/kiosk/scripts/make-production-image.sh
#   sudo /opt/kiosk/scripts/make-production-image.sh --no-stop   # keep kiosk running
#   sudo /opt/kiosk/scripts/make-production-image.sh --keep-img  # keep uncompressed .img
set -euo pipefail

SOURCE_DISK="${SOURCE_DISK:-/dev/mmcblk0}"
EXPORT_DISK="${EXPORT_DISK:-/dev/sda}"
EXPORT_PART="${EXPORT_PART:-/dev/sda1}"
EXPORT_MOUNT="${EXPORT_MOUNT:-/media/os_export}"
INTERNAL_MOUNT="${INTERNAL_MOUNT:-/media/usb_internal}"
MARGIN_BYTES="${MARGIN_BYTES:-$((3 * 1024 * 1024 * 1024))}"  # 3 GiB free after shrink
STOP_KIOSK=1
KEEP_IMG=0
PIGZ_LEVEL="${PIGZ_LEVEL:-1}"

log() { echo "[make-production-image] $*" >&2; }
die() { log "ERROR: $*"; exit 1; }

usage() {
  cat <<'EOF'
Usage: sudo make-production-image.sh [options]

Options:
  --no-stop     Do not stop kiosk-bridge during imaging
  --keep-img    Keep the uncompressed .img after creating .img.gz
  -h, --help    Show help

Environment overrides:
  SOURCE_DISK EXPORT_DISK EXPORT_PART EXPORT_MOUNT MARGIN_BYTES PIGZ_LEVEL
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-stop) STOP_KIOSK=0; shift ;;
    --keep-img) KEEP_IMG=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
done

[[ "$(id -u)" -eq 0 ]] || die "run as root: sudo $0"

command -v pv >/dev/null || die "pv not installed (apt install pv)"
command -v pigz >/dev/null || die "pigz not installed (apt install pigz)"
command -v parted >/dev/null || die "parted not installed"
command -v resize2fs >/dev/null || die "resize2fs not installed"
command -v losetup >/dev/null || die "losetup not installed"

# --- safety ---
[[ -b "$SOURCE_DISK" ]] || die "source missing: $SOURCE_DISK"
[[ -b "$EXPORT_DISK" ]] || die "export disk missing: $EXPORT_DISK"
[[ "$EXPORT_DISK" == "/dev/sda" ]] || die "refusing export disk '$EXPORT_DISK' (must be /dev/sda)"
[[ "$EXPORT_PART" == /dev/sda* ]] || die "refusing export part '$EXPORT_PART'"
[[ "$SOURCE_DISK" != "$EXPORT_DISK" ]] || die "source and export are the same device"
[[ "$EXPORT_DISK" != /dev/sdb && "$EXPORT_DISK" != /dev/sdb* ]] || die "refusing to write internal USB"
[[ "$EXPORT_PART" != /dev/sdb && "$EXPORT_PART" != /dev/sdb* ]] || die "refusing to write internal USB"

INTERNAL_SRC="$(findmnt -n -o SOURCE "$INTERNAL_MOUNT" 2>/dev/null || true)"
if [[ -n "$INTERNAL_SRC" ]]; then
  case "$INTERNAL_SRC" in
    /dev/sdb|/dev/sdb1) ;;
    *) die "internal mount is not sdb ($INTERNAL_SRC) — aborting for safety" ;;
  esac
  [[ "$INTERNAL_SRC" != "$EXPORT_PART" ]] || die "export part is internal mount"
fi

if ! findmnt -n "$EXPORT_MOUNT" >/dev/null 2>&1; then
  die "export mount missing: $EXPORT_MOUNT (mount $EXPORT_PART there first)"
fi
MOUNTED_SRC="$(findmnt -n -o SOURCE "$EXPORT_MOUNT")"
[[ "$MOUNTED_SRC" == "$EXPORT_PART" ]] || die "$EXPORT_MOUNT is $MOUNTED_SRC, expected $EXPORT_PART"

# Last partition end sector on source (allocated only) via sysfs
DISK_BASE="$(basename "$SOURCE_DISK")"
END_SECTOR=0
for part_sys in /sys/class/block/"${DISK_BASE}"p*; do
  [[ -e "$part_sys" ]] || continue
  p_start="$(cat "$part_sys/start")"
  p_size="$(cat "$part_sys/size")"
  p_end=$((p_start + p_size - 1))
  if (( p_end > END_SECTOR )); then
    END_SECTOR=$p_end
  fi
done
if (( END_SECTOR <= 0 )); then
  die "could not read partitions on $SOURCE_DISK"
fi
ALLOC_SECTORS=$((END_SECTOR + 1))
ALLOC_BYTES=$((ALLOC_SECTORS * 512))
log "source=$SOURCE_DISK allocated through sector $END_SECTOR ($ALLOC_BYTES bytes / $(numfmt --to=iec-i --suffix=B "$ALLOC_BYTES" 2>/dev/null || echo "$ALLOC_BYTES"))"

EXPORT_FREE="$(df -B1 --output=avail "$EXPORT_MOUNT" | tail -1 | tr -d ' ')"
# Sparse copy of a mostly-empty rootfs typically needs ~used+margin, not full ALLOC.
# Require at least 16 GiB free (used ~12 GiB + headroom); refuse if under 14 GiB.
MIN_FREE=$((14 * 1024 * 1024 * 1024))
(( EXPORT_FREE >= MIN_FREE )) || die "not enough free space on $EXPORT_MOUNT (have $EXPORT_FREE need >= $MIN_FREE for sparse image)"
log "export free=$(numfmt --to=iec-i --suffix=B "$EXPORT_FREE" 2>/dev/null || echo "$EXPORT_FREE")"

STAMP="$(date +%Y%m%d-%H%M%S)"
IMG="$EXPORT_MOUNT/Hardness-Cfr-${STAMP}.img"
GZ="${IMG}.gz"
SHA="${GZ}.sha256"
LOOP=""

cleanup() {
  local rc=$?
  if [[ -n "$LOOP" ]]; then
    # best-effort detach
    sync || true
    losetup -d "$LOOP" 2>/dev/null || true
  fi
  if [[ "$STOP_KIOSK" -eq 1 ]]; then
    systemctl start kiosk-bridge.service 2>/dev/null || true
  fi
  exit "$rc"
}
trap cleanup EXIT

if [[ "$STOP_KIOSK" -eq 1 ]]; then
  log "stopping kiosk-bridge for consistent image"
  systemctl stop kiosk-bridge.service || true
  sleep 2
fi
sync

# --- phase 1: allocated dd with progress (sparse so empty ext4 zeros don't fill the stick) ---
log "phase 1/3: copying allocated partitions (sparse) -> $IMG"
rm -f "$IMG" "$GZ" "$SHA"
# Exact sector copy; pv shows %, ETA, rate. conv=sparse punches holes for zero blocks.
dd if="$SOURCE_DISK" bs=512 count="$ALLOC_SECTORS" status=none \
  | pv -s "$ALLOC_BYTES" -p -t -e -r -b \
  | dd of="$IMG" bs=4M conv=sparse status=none
sync
ACTUAL="$(stat -c%s "$IMG")"
[[ "$ACTUAL" -eq "$ALLOC_BYTES" ]] || die "image size mismatch: got $ACTUAL expected $ALLOC_BYTES"
DISK_USAGE="$(du -B1 "$IMG" | awk '{print $1}')"
log "raw image logical=$(numfmt --to=iec-i --suffix=B "$ACTUAL" 2>/dev/null || echo "$ACTUAL") on-disk=$(numfmt --to=iec-i --suffix=B "$DISK_USAGE" 2>/dev/null || echo "$DISK_USAGE")"

# --- phase 2: offline shrink rootfs + truncate ---
log "phase 2/3: shrinking root filesystem (+$(numfmt --to=iec-i --suffix=B "$MARGIN_BYTES" 2>/dev/null || echo "$MARGIN_BYTES") margin)"
LOOP="$(losetup -Pf --show "$IMG")"
log "loop device: $LOOP"
# Wait for partition nodes
for _i in $(seq 1 30); do
  [[ -b "${LOOP}p2" ]] && break
  sleep 0.2
done
[[ -b "${LOOP}p1" && -b "${LOOP}p2" ]] || die "loop partitions not found under $LOOP"

ROOT_PART="${LOOP}p2"

# e2fsck: 0=clean, 1=errors corrected — both OK under set -e
_e2fsck() {
  local rc=0
  set +e
  e2fsck -f -y "$1"
  rc=$?
  set -e
  if (( rc > 1 )); then
    die "e2fsck failed on $1 (exit $rc)"
  fi
}

_e2fsck "$ROOT_PART"

# Shrink to minimum, then grow by margin for production headroom
resize2fs -M "$ROOT_PART"
BLOCK_SIZE="$(tune2fs -l "$ROOT_PART" | awk -F: '/Block size:/ {gsub(/ /,"",$2); print $2}')"
BLOCK_COUNT="$(tune2fs -l "$ROOT_PART" | awk -F: '/Block count:/ {gsub(/ /,"",$2); print $2}')"
MIN_BYTES=$((BLOCK_COUNT * BLOCK_SIZE))
TARGET_FS_BYTES=$((MIN_BYTES + MARGIN_BYTES))
# resize2fs accepts size in K/M/G
TARGET_FS_K=$(( (TARGET_FS_BYTES + 1023) / 1024 ))
log "min fs=${MIN_BYTES} bytes; growing to ${TARGET_FS_K}K"
resize2fs "$ROOT_PART" "${TARGET_FS_K}K"
_e2fsck "$ROOT_PART"

BLOCK_COUNT="$(tune2fs -l "$ROOT_PART" | awk -F: '/Block count:/ {gsub(/ /,"",$2); print $2}')"
BLOCK_SIZE="$(tune2fs -l "$ROOT_PART" | awk -F: '/Block size:/ {gsub(/ /,"",$2); print $2}')"
FS_BYTES=$((BLOCK_COUNT * BLOCK_SIZE))

# Partition 2 start (sectors)
P2_START="$(cat /sys/class/block/"$(basename "$ROOT_PART")"/start)"
# New partition size in sectors (align up to 2048-sector / 1MiB boundary)
FS_SECTORS=$(( (FS_BYTES + 511) / 512 ))
ALIGN=2048
P2_SECTORS=$(( (FS_SECTORS + ALIGN - 1) / ALIGN * ALIGN ))
P2_END_SECTOR=$((P2_START + P2_SECTORS - 1))
# parted wants end as byte or MiB; use sectors notation
log "resizing partition 2: start=$P2_START end_sector=$P2_END_SECTOR"
parted -s "$LOOP" unit s resizepart 2 "${P2_END_SECTOR}s"

# Tell kernel to refresh; re-check
partprobe "$LOOP" 2>/dev/null || true
sleep 1
_e2fsck "$ROOT_PART"

NEW_IMG_BYTES=$(( (P2_END_SECTOR + 1) * 512 ))
# Small padding past partition table end (1 MiB)
NEW_IMG_BYTES=$((NEW_IMG_BYTES + 1024 * 1024))

sync
losetup -d "$LOOP"
LOOP=""
truncate -s "$NEW_IMG_BYTES" "$IMG"
sync

SHRUNK_SIZE="$(stat -c%s "$IMG")"
MAX_RAW=$((28 * 1024 * 1024 * 1024))
log "shrunk image: $(numfmt --to=iec-i --suffix=B "$SHRUNK_SIZE" 2>/dev/null || echo "$SHRUNK_SIZE")"
(( SHRUNK_SIZE < MAX_RAW )) || die "shrunk image still >= 28 GiB ($SHRUNK_SIZE)"

# --- phase 3: gzip with progress ---
log "phase 3/3: compressing -> $GZ (pigz -$PIGZ_LEVEL)"
# pv reads the img and feeds pigz; size known for % / ETA
pv -p -t -e -r -b -s "$SHRUNK_SIZE" "$IMG" | pigz -"$PIGZ_LEVEL" -c > "$GZ"
sync

gzip -t "$GZ" || die "gzip integrity check failed"
sha256sum "$GZ" | tee "$SHA"
GZ_SIZE="$(stat -c%s "$GZ")"

if [[ "$KEEP_IMG" -eq 0 ]]; then
  log "removing uncompressed image to free space"
  rm -f "$IMG"
fi

chown -R rle:rle "$EXPORT_MOUNT" 2>/dev/null || true

log "======== DONE ========"
log "img.gz : $GZ"
log "size   : $(numfmt --to=iec-i --suffix=B "$GZ_SIZE" 2>/dev/null || echo "$GZ_SIZE") ($GZ_SIZE bytes)"
log "sha256 : $(awk '{print $1}' "$SHA")"
log "raw was: $(numfmt --to=iec-i --suffix=B "$SHRUNK_SIZE" 2>/dev/null || echo "$SHRUNK_SIZE") (allocated source was $(numfmt --to=iec-i --suffix=B "$ALLOC_BYTES" 2>/dev/null || echo "$ALLOC_BYTES"))"
log "Flash  : Raspberry Pi Imager -> choose this .img.gz -> 32GB+ SD card"
log "   or  : sudo pigz -dc \"$GZ\" | sudo dd of=/dev/sdX bs=4M status=progress"
echo "IMAGE_GZ=$GZ"
echo "IMAGE_SHA256=$(awk '{print $1}' "$SHA")"
echo "IMAGE_GZ_BYTES=$GZ_SIZE"
echo "IMAGE_RAW_BYTES=$SHRUNK_SIZE"

# trap will restart kiosk
exit 0
