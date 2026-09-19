#!/usr/bin/env bash
# Force the physical 7" WaveShare panel viewport to 1024x600, mark it primary,
# map the touchscreen to that output, and keep Chromium true full-screen.
#
# Symptom this fixes: touch lands elsewhere because X was running 1024x768
# while the panel is physically 1024x600.
#
# On Bookworm + vc4-kms-v3d the panel EDID often only advertises 1024x768, so
# a custom modeline cannot be added. We fall back to:
#   xrandr --output <HDMI> --mode 1024x768 --scale-from 1024x600
# which yields a 1024x600 logical desktop (and correct touch mapping).
set -euo pipefail

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-/home/rle/.Xauthority}"

TARGET_W=1024
TARGET_H=600
MODE_NAME="1024x600_60.00"
TOUCH_NAME="${TOUCH_NAME:-WaveShare WS170120}"

log() { echo "kiosk_force_display: $*" >&2; }

pick_output() {
  command -v xrandr >/dev/null 2>&1 || return 1
  local out=""
  out="$(xrandr --query 2>/dev/null | awk '
    / connected/{
      o=$1; has=0; line=$0
      while (getline > 0) {
        if ($0 ~ / connected|disconnected/) break
        if ($1 == "1024x600" || $1 ~ /^1024x600_/) has=1
      }
      if (has) { print o; exit }
      if (line ~ / connected/ && !pref) pref=o
    }
    END { if (pref != "") print pref }
  ')"
  if [[ -z "$out" ]]; then
    out="$(xrandr --query 2>/dev/null | awk '/ connected/{print $1; exit}')"
  fi
  printf '%s' "$out"
}

current_geometry() {
  xrandr --query 2>/dev/null | awk '/ connected/{
    for (i = 1; i <= NF; i++) if ($i ~ /^[0-9]+x[0-9]+\+/) { print $i; exit }
  }'
}

try_native_1024x600() {
  local out="$1"
  # If EDID already has 1024x600, use it
  if xrandr --query 2>/dev/null | awk -v o="$out" '
    $0 ~ "^"o" " {p=1; next}
    p && / connected|disconnected/ {exit}
    p && ($1 == "1024x600" || $1 ~ /^1024x600_/) { print $1; exit }
  ' | grep -q .; then
    local mode
    mode="$(xrandr --query 2>/dev/null | awk -v o="$out" '
      $0 ~ "^"o" " {p=1; next}
      p && / connected|disconnected/ {exit}
      p && ($1 == "1024x600" || $1 ~ /^1024x600_/) { print $1; exit }
    ')"
    xrandr --output "$out" --primary --mode "$mode" --pos 0x0 --filter bilinear \
      --transform none --scale 1x1 >/dev/null 2>&1 && return 0
  fi

  # Try creating a CVT modeline (often rejected by vc4-kms — OK if it fails)
  local modeline name
  if command -v cvt >/dev/null 2>&1; then
    modeline="$(cvt "$TARGET_W" "$TARGET_H" 60 | awk '/Modeline/{ $1=""; sub(/^ /,""); print }')"
  else
    modeline="\"${MODE_NAME}\" 49.00 1024 1064 1168 1312 600 603 613 624 -hsync +vsync"
  fi
  name="$(awk '{print $1}' <<<"$modeline" | tr -d '"')"
  xrandr --newmode $modeline >/dev/null 2>&1 || true
  if xrandr --addmode "$out" "$name" >/dev/null 2>&1; then
    xrandr --output "$out" --primary --mode "$name" --pos 0x0 >/dev/null 2>&1 && return 0
  fi
  return 1
}

set_scale_from_1024x600() {
  local out="$1"
  # Base CRTC mode must exist; use preferred/current 1024x768 then scale-from.
  local base="1024x768"
  if ! xrandr --query 2>/dev/null | awk -v o="$out" -v m="$base" '
    $0 ~ "^"o" " {p=1; next}
    p && / connected|disconnected/ {exit}
    p && $1 == m { found=1 }
    END { exit(found ? 0 : 1) }
  '; then
    base="$(xrandr --query 2>/dev/null | awk -v o="$out" '
      $0 ~ "^"o" " {p=1; next}
      p && / connected|disconnected/ {exit}
      p && $1 ~ /^[0-9]+x[0-9]+/ { print $1; exit }
    ')"
  fi
  [[ -n "$base" ]] || return 1
  log "using --scale-from ${TARGET_W}x${TARGET_H} (base mode $base)"
  xrandr --output "$out" --primary --mode "$base" --scale-from "${TARGET_W}x${TARGET_H}" --pos 0x0
}

map_touch() {
  local out="$1"
  command -v xinput >/dev/null 2>&1 || return 0
  if xinput list --name-only 2>/dev/null | grep -Fxq "$TOUCH_NAME"; then
    xinput map-to-output "$TOUCH_NAME" "$out" >/dev/null 2>&1 || true
    log "mapped touch '$TOUCH_NAME' -> $out"
    return 0
  fi
  local tid
  tid="$(xinput list 2>/dev/null | awk -F'[=]' '/WaveShare/ && /slave  pointer/{
    gsub(/[^0-9].*/,"",$2); print $2; exit
  }')"
  if [[ -n "${tid:-}" ]]; then
    xinput map-to-output "$tid" "$out" >/dev/null 2>&1 || true
    log "mapped touch id $tid -> $out"
  fi
}

disable_other_outputs() {
  local keep="$1" other
  while read -r other; do
    [[ "$other" == "$keep" ]] && continue
    xrandr --output "$other" --off >/dev/null 2>&1 || true
  done < <(xrandr --query 2>/dev/null | awk '/ connected/{print $1}')
}

resize_chromium() {
  command -v xdotool >/dev/null 2>&1 || return 0
  local id
  while read -r id; do
    [[ -n "$id" ]] || continue
    xdotool windowmove "$id" 0 0 >/dev/null 2>&1 || true
    xdotool windowsize "$id" "$TARGET_W" "$TARGET_H" >/dev/null 2>&1 || true
  done < <(
    { xdotool search --class chromium 2>/dev/null || true
      xdotool search --class Chromium 2>/dev/null || true
      xdotool search --name Chromium 2>/dev/null || true
    } | sort -u
  )
}

# --- main ---
for _try in 1 2 3 4 5 6 7 8 9 10; do
  xrandr --query >/dev/null 2>&1 && break
  sleep 0.3
done

OUT="$(pick_output || true)"
if [[ -z "${OUT:-}" ]]; then
  log "no connected output"
  exit 0
fi

geo="$(current_geometry || true)"
if [[ "$geo" == "${TARGET_W}x${TARGET_H}+0+0" ]]; then
  log "already ${TARGET_W}x${TARGET_H} on $OUT"
  map_touch "$OUT"
  resize_chromium
  exit 0
fi

if try_native_1024x600 "$OUT"; then
  log "native ${TARGET_W}x${TARGET_H} mode applied on $OUT"
else
  set_scale_from_1024x600 "$OUT" || log "WARN: failed to set ${TARGET_W}x${TARGET_H} on $OUT"
fi

disable_other_outputs "$OUT"
map_touch "$OUT"
resize_chromium

geo="$(current_geometry || true)"
log "current: ${OUT} ${geo:-unknown} (want ${TARGET_W}x${TARGET_H}+0+0)"
exit 0
