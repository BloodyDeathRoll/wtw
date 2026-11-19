#!/bin/sh
# Renders mock.html at 2x with headless Chrome → 1-delete-sheet-states.png (v3 Y3).
cd "$(dirname "$0")"
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=2 --window-size=1269,1010 --virtual-time-budget=4000 --screenshot=1-delete-sheet-states.png "file://$PWD/mock.html"
