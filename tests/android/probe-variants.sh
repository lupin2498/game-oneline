#!/usr/bin/env bash
# TẠM (nhánh dò lỗi): build vài biến thể APK để tìm vì sao canvas không hiện trên máy ảo Android 7-9.
#   soft      WebView vẽ bằng phần mềm (LAYER_TYPE_SOFTWARE)
#   small     canvas nhỏ (<=240x250: Chromium cũ không tăng tốc GPU cho canvas nhỏ)
#   readback  gọi getImageData mỗi khung hình (Chromium cũ sẽ bỏ tăng tốc GPU của canvas)
#   nobg      bỏ nền CSS của canvas và bo góc/overflow của khung
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${1:?thiếu thư mục kết quả}"
for v in soft small readback nobg; do
  T="$(mktemp -d)"
  ( cd "$ROOT" && tar cf - --exclude=./out --exclude=./.git --exclude=./node_modules --exclude=./android/.build . ) | ( cd "$T" && tar xf - )
  python3 - "$T" "$v" <<'PY'
import sys
root, v = sys.argv[1], sys.argv[2]
def sub(path, a, b):
    p = root + '/' + path
    s = open(p, encoding='utf-8').read()
    assert a in s, (path, a)
    open(p, 'w', encoding='utf-8').write(s.replace(a, b, 1))
if v == 'soft':
    sub('android/src/vn/lupin/oneline/MainActivity.java', 'web = new WebView(this);',
        'web = new WebView(this); web.setLayerType(View.LAYER_TYPE_SOFTWARE, null);')
elif v == 'small':
    sub('index.html', 'cv.width=Math.max(1,Math.round(w*dpr));', 'cv.width=Math.min(240,Math.max(1,Math.round(w*dpr)));')
    sub('index.html', 'cv.height=Math.max(1,Math.round(h*dpr));', 'cv.height=Math.min(250,Math.max(1,Math.round(h*dpr)));')
elif v == 'readback':
    sub('index.html', '  requestAnimationFrame(loop);\n}', '  try{ ctx.getImageData(0,0,1,1); }catch(e){}\n  requestAnimationFrame(loop);\n}')
elif v == 'nobg':
    sub('index.html', 'background:#0a1424;background:linear-gradient(180deg,#070d18 0%,#0a1424 50%,#05090f 100%)}', '}')
    sub('index.html', 'overflow:hidden;border-radius:18px;box-shadow:0 20px 60px rgba(0,0,0,.6);', '')
PY
  mkdir -p "$OUT/probe-$v"
  DIST="$OUT/probe-$v" bash "$T/android/build.sh" >/dev/null
  ls -la "$OUT/probe-$v"
  rm -rf "$T"
done
