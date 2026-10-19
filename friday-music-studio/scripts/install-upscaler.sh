#!/bin/zsh
# Installs the optional AI picture upscaler (Real-ESRGAN, ncnn/Vulkan build) for the studio.
# Source: github.com/xinntao/Real-ESRGAN releases v0.2.5.0 (about 52 MB). Code is MIT; the bundled
# realesrgan-x4plus model is BSD-3-Clause. It runs locally; nothing is uploaded.

set -e
URL="https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-macos.zip"
SHA256="e0ad05580abfeb25f8d8fb55aaf7bedf552c375b5b4d9bd3c8d59764d2cc333a"
DEST="$HOME/Library/Application Support/friday-music-studio/tools/realesrgan"

if [ -x "$DEST/realesrgan-ncnn-vulkan" ] && [ -f "$DEST/models/realesrgan-x4plus.bin" ]; then
  echo "Already installed: $DEST"; exit 0
fi

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
echo "Downloading about 52 MB..."
curl -fL --progress-bar -o "$TMP/r.zip" "$URL"
echo "$SHA256  $TMP/r.zip" | shasum -a 256 -c - || { echo "Checksum mismatch, not installing."; exit 1; }
unzip -q "$TMP/r.zip" -d "$TMP/x"
mkdir -p "$DEST/models"
cp "$TMP/x/realesrgan-ncnn-vulkan" "$DEST/"
cp "$TMP/x/models/realesrgan-x4plus."* "$DEST/models/"
chmod +x "$DEST/realesrgan-ncnn-vulkan"
echo "Installed: $DEST"
