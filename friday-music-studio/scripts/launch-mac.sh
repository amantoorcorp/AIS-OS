#!/bin/zsh
# One-click launcher for Friday Music Studio on macOS. The Desktop app calls this.
# - Brings the app forward if it is already running (no second copy).
# - Otherwise builds and starts it. FFmpeg is found by the app itself, so no PATH setup is needed.

APP_DIR="${0:A:h:h}"
LOG="$HOME/Library/Logs/friday-music-studio-launch.log"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

if pgrep -f "$APP_DIR/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" >/dev/null; then
  osascript -e 'tell application "Electron" to activate' >/dev/null 2>&1
  exit 0
fi

cd "$APP_DIR" || { echo "Cannot open $APP_DIR" >>"$LOG"; exit 1; }
{
  echo "=== $(date) starting Friday Music Studio ==="
  [ -d node_modules ] || npm install
  nohup npm start &
} >>"$LOG" 2>&1
