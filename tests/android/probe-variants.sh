#!/usr/bin/env bash
# TẠM (nhánh dò lỗi): build vài biến thể APK để tìm vì sao canvas không hiện trên máy ảo Android 7-9.
#   soft      WebView vẽ bằng phần mềm (LAYER_TYPE_SOFTWARE)
#   small     canvas nhỏ (<=240x250: Chromium cũ không tăng tốc GPU cho canvas nhỏ)
#   readback  gọi getImageData mỗi khung hình (Chromium cũ sẽ bỏ tăng tốc GPU của canvas)
#   nobg      bỏ nền CSS của canvas và bo góc/overflow của khung
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${1:?thiếu thư mục kết quả}"
for v in plain; do
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
elif v == 'plain':
    # trang tối giản: MỘT canvas lớn (được tăng tốc GPU trên Chromium cũ) vẽ lại mỗi khung hình, không có mã của game
    open(root + '/privacy.html', 'w', encoding='utf-8').write('''<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;background:#000;color:#555}p{font-size:10px;height:14px;overflow:hidden}canvas{display:block}</style></head><body>
<p>Chính sách quyền riêng tư</p>
<canvas id="c" width="320" height="560"></canvas>
<script>
var c=document.getElementById('c'),x=c.getContext('2d'),n=0;
function f(){ x.clearRect(0,0,320,560); x.fillStyle='#fff';
  for(var i=0;i<8;i++) x.fillRect(20+i*36,100+((n+i*20)%300),24,24);
  x.strokeStyle='#0f0'; x.lineWidth=6; x.beginPath(); x.moveTo(10,10); x.lineTo(310,550); x.stroke();
  n++; requestAnimationFrame(f); }
f();
</script></body></html>
''')
elif v == 'nobg':
    sub('index.html', 'background:#0a1424;background:linear-gradient(180deg,#070d18 0%,#0a1424 50%,#05090f 100%)}', '}')
    sub('index.html', 'overflow:hidden;border-radius:18px;box-shadow:0 20px 60px rgba(0,0,0,.6);', '')
PY
  mkdir -p "$OUT/probe-$v"
  DIST="$OUT/probe-$v" bash "$T/android/build.sh" >/dev/null
  ls -la "$OUT/probe-$v"
  rm -rf "$T"
done
