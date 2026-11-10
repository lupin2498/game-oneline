#!/usr/bin/env bash
# Test APK trên máy ảo / điện thoại Android thật đang nối adb:
# cài, mở, chụp màn hình, GIỮ và KÉO bằng thao tác cảm ứng thật (adb input), nút Back, deep link, ẩn app.
# Game ghi các mốc "[oneline] ..." ra logcat (console của WebView) nên đọc được kết quả từng thao tác.
#
#   bash tests/android/smoke.sh dist/OneLine-1.5.apk [thư-mục-kết-quả]
set -uo pipefail
APK="${1:?thiếu đường dẫn APK}"
OUT="${2:-tests/.out/android}"
PKG=vn.lupin.oneline
mkdir -p "$OUT"
fail=0
ok(){ if [ "$2" = "1" ]; then echo "PASS  $1${3:+  — $3}"; else echo "FAIL  $1${3:+  — $3}"; fail=1; fi; }
shot(){ adb exec-out screencap -p > "$OUT/$1.png" 2>/dev/null || true; }
# logcat được ghi liên tục ra tệp (bộ đệm trên máy ảo có thể xoay vòng làm mất dòng cũ)
lines(){ grep -a -F "[oneline]" "$OUT/logcat.txt" 2>/dev/null | sed 's/.*\[oneline\] /[oneline] /; s/", source:.*//' ; }
count(){ lines | grep -c -- "$1" || true; }
last(){ lines | grep -- "$1" | tail -1; }
# wait_log <mẫu> <số lần phải có> <giây>
wait_log(){ local i=0; while [ "$i" -lt "$(( $3 * 2 ))" ]; do [ "$(count "$1")" -ge "$2" ] && return 0; sleep 0.5; i=$((i+1)); done; return 1; }

API="$(adb shell getprop ro.build.version.sdk | tr -d '\r')"
REL="$(adb shell getprop ro.build.version.release | tr -d '\r')"
WV="$(adb shell dumpsys webviewupdate 2>/dev/null | grep -i -m1 'Current WebView package' | sed 's/.*: *//' | tr -d '\r')"
echo "Thiết bị: Android $REL (API $API) · WebView ${WV:-không rõ}"

# ---------- cài đặt ----------
adb uninstall "$PKG" >/dev/null 2>&1 || true
INST="$(adb install -r "$APK" 2>&1 | tr -d '\r' | tail -3)"
ok "A01 Cài APK trên Android $REL (API $API)" "$(grep -q Success <<<"$INST" && echo 1 || echo 0)" "$(tail -1 <<<"$INST")"
[ "$fail" = 0 ] || { echo "==> Android API $API: không cài được, dừng"; exit 1; }

# ---------- mở app ----------
adb logcat -c || true
adb logcat -v threadtime > "$OUT/logcat.txt" 2>/dev/null &
LOGPID=$!
trap 'kill $LOGPID 2>/dev/null || true' EXIT
adb shell am start -W -n "$PKG/.MainActivity" >/dev/null 2>&1
wait_log "boot v" 1 120; booted=$?
BOOT="$(last 'boot v')"
ok "A02 Mở app: trang game khởi động trong WebView" "$([ $booted = 0 ] && echo 1 || echo 0)" "$BOOT"
sleep 2; shot 01-start
if [ $booted != 0 ]; then
  grep -a -E "AndroidRuntime|chromium|$PKG" "$OUT/logcat.txt" | tail -40
  echo "==> Android API $API: app không khởi động"; exit 1
fi

# ---------- toạ độ: khung chơi 480x760 nằm giữa WebView ----------
adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb pull /sdcard/ui.xml "$OUT/ui-start.xml" >/dev/null 2>&1 || true
GEO="$(python3 - "$OUT/ui-start.xml" "$(adb shell wm size | tr -d '\r' | tail -1)" <<'PY'
import re,sys
size=re.search(r'(\d+)x(\d+)',sys.argv[2]); W,H=int(size.group(1)),int(size.group(2))
x0=y0=0; x1,y1=W,H
try:
    xml=open(sys.argv[1],encoding='utf-8',errors='replace').read()
    m=re.search(r'class="android\.webkit\.WebView"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"',xml)
    if m: x0,y0,x1,y1=map(int,m.groups())
except Exception: pass
vw,vh=x1-x0,y1-y0
w=min(vw,vh*480/760); h=w*760/480
print(x0+(vw-w)/2, y0+(vh-h)/2, w, h, vw, vh)
PY
)"
read -r GX GY GW GH VW VH <<<"$GEO"
pt(){ python3 -c "import sys;gx,gy,X,Y,W,H=map(float,sys.argv[1:]);print(int(round(X+gx/480*W)),int(round(Y+gy/760*H)))" "$1" "$2" "$GX" "$GY" "$GW" "$GH"; }
echo "WebView ${VW}x${VH}px, khung chơi ${GW%.*}x${GH%.*} tại (${GX%.*},${GY%.*})"
ok "A03 WebView phủ kín màn hình (ẩn thanh trạng thái/điều hướng)" "$(python3 -c "import sys;print(1 if float(sys.argv[1])>=0.9*float(sys.argv[2]) else 0)" "$VH" "$(adb shell wm size | tr -d '\r' | tail -1 | sed 's/.*x//')")" "cao ${VH}px"

# Bấm nút theo chữ hiển thị: lấy toạ độ từ cây trợ năng của WebView; không có thì dùng Tab/Enter
tap_text(){
  local label="$1" xy=""
  for try in 1 2 3; do
    adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb pull /sdcard/ui.xml "$OUT/ui.xml" >/dev/null 2>&1 || true
    xy="$(python3 - "$OUT/ui.xml" "$label" <<'PY'
import re,sys
try: xml=open(sys.argv[1],encoding='utf-8',errors='replace').read()
except Exception: xml=''
for m in re.finditer(r'<node[^>]*>',xml):
    n=m.group(0)
    t=re.search(r' text="([^"]*)"',n); d=re.search(r' content-desc="([^"]*)"',n); b=re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"',n)
    if b and ((t and t.group(1)==sys.argv[2]) or (d and d.group(1)==sys.argv[2])):
        x0,y0,x1,y1=map(int,b.groups()); print((x0+x1)//2,(y0+y1)//2); break
PY
)"
    [ -n "$xy" ] && break; sleep 1
  done
  if [ -n "$xy" ]; then adb shell input tap $xy; echo "tap:$label@$xy"; else adb shell input keyevent 61; adb shell input keyevent 66; echo "phím:$label"; fi
}

# ---------- bắt đầu ----------
HOW="$(tap_text 'Bắt đầu')"
wait_log "state=ready" 1 15
ok "A04 Bấm \"Bắt đầu\" (cảm ứng thật)" "$([ "$(count 'state=ready')" -ge 1 ] && echo 1 || echo 0)" "$HOW"
sleep 1; shot 02-ready

# ---------- giữ yên 3 giây trên nút tròn: lượt chơi chỉ được kết thúc khi nhấc tay ----------
read -r JX JY <<<"$(pt 240 680)"
adb shell input swipe "$JX" "$JY" "$JX" "$JY" 3000
wait_log "over reason=" 1 10
L="$(last 'over reason=')"; T="$(sed -n 's/.* t=\([0-9]*\).*/\1/p' <<<"$L")"
ok "A05 Giữ yên 3 giây trên nút tròn: không bị hệ thống cắt ngang (không menu giữ-lâu, không huỷ chạm)" \
   "$(grep -q 'reason=lift' <<<"$L" && grep -q 'mode=stick' <<<"$L" && [ "${T:-0}" -ge 2500 ] && echo 1 || echo 0)" "$L"
sleep 1; shot 03-over-lift

# ---------- kéo nút tròn sang phải: nhân vật phải đi theo và chạm tường ----------
HOW="$(tap_text 'Chơi lại')"; wait_log "state=ready" 2 15
read -r JX2 JY2 <<<"$(pt 370 680)"
adb shell input swipe "$JX" "$JY" "$JX2" "$JY2" 1500
wait_log "over reason=" 2 10
L="$(last 'over reason=')"
ok "A06 Kéo nút tròn sang phải: nhân vật đi theo ngón tay và chạm tường" "$([ "$(count 'over reason=')" -ge 2 ] && grep -q 'reason=wall' <<<"$L" && grep -q 'mode=stick' <<<"$L" && echo 1 || echo 0)" "$L ($HOW)"
sleep 1; shot 04-over-wall

# ---------- kiểu kéo trực tiếp từ vòng sáng ----------
tap_text 'Chơi lại' >/dev/null; wait_log "state=ready" 3 15
read -r RX RY <<<"$(pt 240 501.6)"; read -r RX2 RY2 <<<"$(pt 370 501.6)"
adb shell input swipe "$RX" "$RY" "$RX2" "$RY2" 1500
wait_log "over reason=" 3 10
L="$(last 'over reason=')"
ok "A07 Giữ vòng sáng rồi kéo: chế độ kéo trực tiếp hoạt động" "$([ "$(count 'over reason=')" -ge 3 ] && grep -q 'mode=drag' <<<"$L" && grep -q 'reason=wall' <<<"$L" && echo 1 || echo 0)" "$L"

# ---------- bảng xếp hạng trên máy ----------
tap_text 'Bảng xếp hạng' >/dev/null; sleep 2; shot 05-board
adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb pull /sdcard/ui.xml "$OUT/ui-board.xml" >/dev/null 2>&1 || true
ok "A08 Mở bảng xếp hạng: hiện kỷ lục trên máy" "$(grep -q 'Kỷ lục trên máy này' "$OUT/ui-board.xml" 2>/dev/null && echo 1 || echo 0)"
tap_text 'Đóng' >/dev/null; sleep 1

# ---------- ẩn app giữa lượt (phím Home): lượt phải kết thúc, app không treo ----------
tap_text 'Chơi lại' >/dev/null; wait_log "state=ready" 4 15
( adb shell input swipe "$JX" "$JY" "$JX" "$JY" 6000 >/dev/null 2>&1 & )
sleep 2; adb shell input keyevent 3
wait_log "over reason=" 4 12
L="$(last 'over reason=')"; T="$(sed -n 's/.* t=\([0-9]*\).*/\1/p' <<<"$L")"
ok "A09 Bấm Home giữa lượt: lượt kết thúc ngay (tính là nhấc tay)" "$([ "$(count 'over reason=')" -ge 4 ] && grep -q 'reason=lift' <<<"$L" && [ "${T:-9999}" -lt 5500 ] && echo 1 || echo 0)" "$L"
sleep 5

# ---------- quay lại app + deep link kết quả đăng nhập ----------
adb shell am start -W -a android.intent.action.VIEW -d "vn.lupin.oneline://auth?error=cancelled\&state=x" >/dev/null 2>&1
sleep 2; shot 06-after-deeplink
TOP="$(adb shell dumpsys activity activities 2>/dev/null | grep -E 'ResumedActivity' | head -2 | tr -d '\r')"
ok "A10 Deep link vn.lupin.oneline://auth đưa app trở lại, không tạo màn hình thứ hai" "$(grep -q "$PKG" <<<"$TOP" && [ "$(count 'boot v')" = 1 ] && echo 1 || echo 0)" "$(head -1 <<<"$TOP" | sed 's/^ *//')"

# ---------- nút Back thoát app; mở lại vẫn giữ kỷ lục ----------
adb shell input keyevent 4; sleep 2
TOP="$(adb shell dumpsys activity activities 2>/dev/null | grep -E 'ResumedActivity' | head -2 | tr -d '\r')"
ok "A11 Nút Back thoát app" "$(grep -q "$PKG" <<<"$TOP" && echo 0 || echo 1)"
adb shell am force-stop "$PKG"; sleep 1
adb shell am start -W -n "$PKG/.MainActivity" >/dev/null 2>&1
wait_log "boot v" 2 60
B2="$(last 'boot v')"; BEST="$(sed -n 's/.* best=\([0-9]*\).*/\1/p' <<<"$B2")"
ok "A12 Tắt hẳn rồi mở lại: kỷ lục vẫn còn (lưu trữ của WebView bền)" "$([ "$(count 'boot v')" -ge 2 ] && [ "${BEST:-0}" -ge 1 ] && echo 1 || echo 0)" "$B2"
sleep 2; shot 07-relaunch

# ---------- lỗi ----------
sleep 1
CRASH="$(grep -a -E "FATAL EXCEPTION|ANR in $PKG" "$OUT/logcat.txt" | head -3)"
JSERR="$(grep -a -F 'CONSOLE' "$OUT/logcat.txt" | grep -E "Uncaught|frame error|SyntaxError|is not defined|is not a function" | head -3)"
ok "A13 Không crash, không ANR" "$([ -z "$CRASH" ] && echo 1 || echo 0)" "$CRASH"
ok "A14 Không có lỗi JavaScript trong WebView" "$([ -z "$JSERR" ] && echo 1 || echo 0)" "$JSERR"
lines > "$OUT/oneline-log.txt"
echo "--- log của game ---"; cat "$OUT/oneline-log.txt"
[ "$fail" = 0 ] && echo "==> Android API $API: tất cả đạt" || echo "==> Android API $API: CÓ LỖI"
exit $fail
