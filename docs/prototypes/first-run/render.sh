#!/bin/zsh
# Render each mock at 375x812 (inside an iframe, since headless Chrome won't go below 500px wide) + its caption strip -> JPEG.
cd "${0:A:h}"; W=${W:-375}; H=${H:-812}; SUF=${SUF:-}; CH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"; TMP=${TMPDIR:-/tmp}/fr-render; mkdir -p $TMP
for f in ${@:-*.html}; do k=${f%.html}; [[ $k == shot ]] && continue
  cap=$(cat $k.cap 2>/dev/null)
  cat > $TMP/shot.html <<H
<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap"><style>
html,body{margin:0;background:#000;width:${W}px;height:$((H+88))px;overflow:hidden}iframe{position:absolute;left:0;top:0;width:${W}px;height:${H}px;border:0}
.cap{position:absolute;left:0;top:${H}px;width:${W}px;height:88px;box-sizing:border-box;padding:9px 14px;background:#f4f1ea;color:#1b1b1b;font:500 12.5px/1.35 Inter,system-ui,sans-serif;border-top:3px solid #D49B3A}.cap b{color:#8a5a00}
</style></head><body><iframe src="file://$PWD/$f$( [[ -n $HASH ]] && echo "#$HASH")"></iframe><div class="cap">$cap</div></body></html>
H
  "$CH" --headless=new --disable-gpu --hide-scrollbars --user-data-dir=$TMP/prof --window-size=$W,$((H+88)) --force-device-scale-factor=2 \
    --allow-file-access-from-files --virtual-time-budget=8000 --screenshot=$TMP/$k$SUF.png "file://$TMP/shot.html" 2>/dev/null
  sips -s format jpeg -s formatOptions 88 $TMP/$k$SUF.png --out $k$SUF.jpg >/dev/null && echo "$k$SUF.jpg"
done
