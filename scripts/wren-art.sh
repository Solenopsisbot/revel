#!/usr/bin/env bash
#
# design/wren/*.png  →  apps/web/static/wren/*.webp
#
# The art arrives as full-resolution PNGs with a real alpha channel, and the app
# serves small webp. That conversion happened by hand the first time and left no
# record, so the next drop of art meant re-deriving the crops by measuring the
# files that were already shipped. This is that derivation, written down.
#
# Two families, because they hang differently (`docs/09`, `Moment.svelte`):
#
#   * **Portraits** are square and the subject already fills the frame, so they
#     are only resized. Each also produces a `face-` crop crop for the chrome —
#     the notice popup, the command bar, the header — where there is no room for
#     shoulders and the head has to fill 26 to 52 pixels.
#   * **Full-body** poses are trimmed to their alpha bounding box first. The
#     source has a wide transparent margin and the layout positions her by her
#     own edges, so shipping the margin would push her off the screen by an
#     amount nobody could see in the file.
#
#   ./scripts/wren-art.sh
#
# Idempotent, and it overwrites. Needs ImageMagick (`brew install imagemagick`).
set -euo pipefail

cd "$(dirname "$0")/.."
src=design/wren
out=apps/web/static/wren
mkdir -p "$out"

need() { [ -f "$1" ] || { echo "missing source: $1" >&2; exit 1; }; }

# The head crop, in source pixels on a 1024x1024 portrait. Derived by matching
# the framing of the first hand-made set rather than chosen — the avatars are
# recognisable at 26px only because the head fills them.
FACE_CROP=740x740+142+0

portrait() { # <source> <name>
  need "$1"
  magick "$1" -resize 512x512 -define webp:alpha-quality=100 -quality 88 "$out/$2.webp"
  magick "$1" -resize 128x128 -define webp:alpha-quality=100 -quality 88 "$out/$2-sm.webp"
  magick "$1" -crop "$FACE_CROP" +repage -resize 256x256 \
    -define webp:alpha-quality=100 -quality 88 "$out/face-$2.webp"
}

body() { # <source> <name> <height>
  need "$1"
  # `-trim` then `+repage`: without the repage the canvas geometry survives in
  # the output and the trim is decorative.
  magick "$1" -trim +repage -resize "x$3" \
    -define webp:alpha-quality=100 -quality 88 "$out/$2.webp"
}

portrait "$src/avatar_warm_knowing_1787887165943.png" warm
portrait "$src/avatar_serious_1787887196047.png"      serious
portrait "$src/avatar_alert_1787887256765.png"        alert

body "$src/full_body_character_1787886666513.png" standing 1240
body "$src/leaning_waiting_1787887582897.png"     leaning  1240
body "$src/seated_waiting_1787887330188.png"      seated   1000

echo
printf '%s\n' "$out:"
ls -la "$out" | tail -n +2 | awk '{printf "  %7s  %s\n", $5, $9}'
