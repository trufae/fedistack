#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
source_icon="$script_dir/../public/assets/favicon.svg"
output_dir=${1:-"$script_dir/../public/assets"}

if [ "$#" -gt 1 ]; then
  echo "Usage: $0 [output-directory]" >&2
  exit 1
fi
if ! command -v rsvg-convert >/dev/null 2>&1; then
  echo "Missing rsvg-convert. Install librsvg; see doc/icons.md." >&2
  exit 1
fi
if command -v magick >/dev/null 2>&1; then
  imagemagick=magick
elif command -v convert >/dev/null 2>&1; then
  imagemagick=convert
else
  echo "Missing ImageMagick. Install magick or convert; see doc/icons.md." >&2
  exit 1
fi

mkdir -p -- "$output_dir"
# Use an absolute path so ImageMagick does not interpret a leading dash as an option.
output_dir=$(CDPATH= cd -- "$output_dir" && pwd)
for size in 16 32 48 64 128 180 192 256 512; do
  rsvg-convert --width "$size" --height "$size" \
    --output "$output_dir/icon-$size.png" "$source_icon"
done
# iOS supplies the rounded mask; fill the source's transparent corners.
rsvg-convert --width 180 --height 180 --background-color '#c9512c' \
  --output "$output_dir/apple-touch-icon.png" "$source_icon"
"$imagemagick" "$output_dir/icon-16.png" "$output_dir/icon-32.png" \
  "$output_dir/icon-48.png" "$output_dir/favicon.ico"

echo "Generated PNG and ICO icons in $output_dir"
