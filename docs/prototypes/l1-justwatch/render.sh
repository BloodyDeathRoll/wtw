#!/bin/sh
# Renders mock.html at 2x with headless Chrome → 1-credit.png (v3 L1).
cd "$(dirname "$0")"
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=2 --window-size=860,905 --virtual-time-budget=4000 --screenshot=1-credit.png "file://$PWD/mock.html"
