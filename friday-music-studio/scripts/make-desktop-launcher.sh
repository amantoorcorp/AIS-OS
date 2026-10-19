#!/bin/zsh
# Creates "Friday Music Studio.app" on the Desktop. Double-click it to start the studio.
# Re-run this script if you move the project folder.

APP_DIR="${0:A:h:h}"
OUT="${1:-$HOME/Desktop}/Friday Music Studio.app"
TMP="$(mktemp -d)"

cat >"$TMP/launch.applescript" <<APPLESCRIPT
do shell script "/bin/zsh '$APP_DIR/scripts/launch-mac.sh' >/dev/null 2>&1 &"
APPLESCRIPT

rm -rf "$OUT"
osacompile -o "$OUT" "$TMP/launch.applescript" || exit 1

# Icon: sunset gradient with a brush "F" (bundled Permanent Marker font), if ffmpeg can draw text.
FONT="$APP_DIR/src/renderer/public/fonts/PermanentMarker-Regular.ttf"
FF="/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg"; [ -x "$FF" ] || FF="$(command -v ffmpeg)"
if [ -x "$FF" ]; then
  "$FF" -y -loglevel error -f lavfi -i "gradients=s=1024x1024:c0=0xff9a3c:c1=0x5b2a86:x0=512:y0=0:x1=512:y1=1024:n=2" \
    -vf "format=rgba,drawtext=fontfile='$FONT':text='F':fontsize=720:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2+40:shadowcolor=black@0.35:shadowx=10:shadowy=10" \
    -frames:v 1 "$TMP/icon.png" 2>/dev/null
  if [ -f "$TMP/icon.png" ]; then
    SET="$TMP/icon.iconset"; mkdir -p "$SET"
    for s in 16 32 128 256 512; do
      sips -z $s $s "$TMP/icon.png" --out "$SET/icon_${s}x${s}.png" >/dev/null
      sips -z $((s*2)) $((s*2)) "$TMP/icon.png" --out "$SET/icon_${s}x${s}@2x.png" >/dev/null
    done
    iconutil -c icns "$SET" -o "$OUT/Contents/Resources/applet.icns" && touch "$OUT"
  fi
fi
rm -rf "$TMP"
echo "Created: $OUT"
