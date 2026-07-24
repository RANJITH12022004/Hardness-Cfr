#!/usr/bin/env bash
# Force the physical 7" panel to 1024x600, mark it primary, and keep the
# Chromium kiosk window true full-screen. RealVNC/status UI windows that sit
# on top of the panel are unmapped so they cannot clip the UI to a partial
# rectangle (intermittent "top half only" display).
set -euo pipefail

export DISPLAY="${DISPLAY:-:0}"

fix_output_mode() {
  command -v xrandr >/dev/null 2>&1 || return 0
  local out mode
  # Prefer the connected HDMI that actually has a 1024x600 mode (panel is HDMI-2
  # on this hardware). Never leave a disconnected output as PRIMARY.
  out="$(xrandr --query 2>/dev/null | awk '/ connected/{print $1; exit}')"
  [[ -n "${out:-}" ]] || return 0
  if xrandr --query 2>/dev/null | awk -v o="$out" '
    $1==o {p=1; next}
    p && /^[[:space:]]+[0-9]/ { if ($1=="1024x600") found=1 }
    p && /^[^[:space:]]/ { exit }
    END { exit found?0:1 }
  '; then
    mode=1024x600
  else
    mode="$(xrandr --query 2>/dev/null | awk -v o="$out" '
      $1==o {p=1; next}
      p && /^[[:space:]]+[0-9]/ { print $1; exit }
    ')"
  fi
  [[ -n "${mode:-}" ]] || return 0
  xrandr --output "$out" --primary --mode "$mode" --pos 0x0 >/dev/null 2>&1 || true
  # Turn off other connected clones that can create a taller virtual desktop.
  while read -r other; do
    [[ -n "$other" && "$other" != "$out" ]] || continue
    xrandr --output "$other" --off >/dev/null 2>&1 || true
  done < <(xrandr --query 2>/dev/null | awk '/ connected/{print $1}')
}

unmap_overlay_windows() {
  command -v xdotool >/dev/null 2>&1 || return 0
  local id name
  while read -r id; do
    [[ -n "$id" ]] || continue
    name="$(xdotool getwindowname "$id" 2>/dev/null || true)"
    case "$name" in
      *RealVNC*|*VNC*|*wayvnc*|*statusicon*)
        xdotool windowunmap "$id" >/dev/null 2>&1 || true
        ;;
    esac
  done < <(xdotool search --onlyvisible --name '.*' 2>/dev/null || true)
}

force_chromium_fullscreen() {
  command -v xdotool >/dev/null 2>&1 || return 0
  local id
  while read -r id; do
    [[ -n "$id" ]] || continue
    xdotool windowmove "$id" 0 0 >/dev/null 2>&1 || true
    xdotool windowsize "$id" 1024 600 >/dev/null 2>&1 || true
    xdotool windowactivate "$id" >/dev/null 2>&1 || true
  done < <(
    xdotool search --onlyvisible --name 'Hardness|Raise Lab|chromium|Chromium' 2>/dev/null || true
  )
}

fix_output_mode
unmap_overlay_windows
force_chromium_fullscreen
