#!/usr/bin/env bash
# Test APK trên máy ảo / điện thoại Android thật đang nối adb:
# cài, mở, chụp màn hình, GIỮ và KÉO bằng thao tác cảm ứng thật (adb input), nút Back, deep link, ẩn app.
# Game ghi các mốc "[oneline] ..." ra logcat (console của WebView) nên đọc được kết quả từng thao tác.
#
#   bash tests/android/smoke.sh dist/OneLine-1.6.apk [thư-mục-kết-quả]
set -uo pipefail
APK="${1:?thiếu đường dẫn APK}"
OUT="${2:-tests/.out/android}"
PKG=vn.lupin.oneline
mkdir -p "$OUT"
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

API="$(adb shell getprop ro.build.version.sdk | tr -d '\r')"
REL="$(adb shell getprop ro.build.version.release | tr -d '\r')"
WV="$(adb shell dumpsys webviewupdate 2>/dev/null | grep -i -m1 'Current WebView package' | sed 's/.*: *//' | tr -d '\r')"
# Android 7 không báo bản WebView qua dumpsys: lấy từ gói đang làm WebView
if [ -z "$WV" ]; then
  for p in com.google.android.webview com.android.webview com.android.chrome; do
    v="$(adb shell dumpsys package $p 2>/dev/null | grep -m1 versionName | sed 's/.*versionName=//' | tr -d '\r ')"
    [ -n "$v" ] && { WV="($p, $v)"; break; }
  done
fi
# Máy ảo (emulator của Android SDK)?
EMU=0
{ [ "$(adb shell getprop ro.kernel.qemu | tr -d '\r')" = 1 ] || [ "$(adb shell getprop ro.boot.qemu | tr -d '\r')" = 1 ] \
  || grep -q -E 'ranchu|goldfish' <<<"$(adb shell getprop ro.hardware | tr -d '\r')"; } && EMU=1
echo "Thiết bị: Android $REL (API $API)$([ $EMU = 1 ] && echo ' máy ảo') · WebView ${WV:-không rõ}"

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
# Trang phải biết kích thước cửa sổ: ngay lúc chạy (view=WxH trong dòng boot), hoặc muộn hơn một nhịp (dòng "view WxH t=ms";
# trong lúc chờ game giấu khung nên không lộ bố cục vỡ). Không bao giờ có kích thước = lỗi.
VIEW="$(sed -n 's/.* view=\([0-9x-]*\).*/\1/p' <<<"$BOOT")"
grep -q -E '^[1-9][0-9]*x[1-9][0-9]*$' <<<"$VIEW" || wait_log "view [1-9][0-9]*x[1-9]" 1 10
ok "A02b Game biết kích thước cửa sổ để dàn khung chơi" "$( { grep -q -E '^[1-9][0-9]*x[1-9][0-9]*$' <<<"$VIEW" || [ "$(count 'view [1-9][0-9]*x[1-9]')" -ge 1 ]; } && echo 1 || echo 0)" "lúc khởi động view=$VIEW $(last 'view [1-9]')"
sleep 2; shot 01-start
E1="$(edge_px 01-start)"
ok "A02c Vừa mở app không lộ bảng chưa co giãn (nội dung không bị cắt ở mép phải màn hình)" "$(edge_ok "$E1" && echo 1 || echo 0)" "$E1 điểm sáng sát mép phải"
if [ $booted != 0 ]; then
  grep -a -E "AndroidRuntime|chromium|$PKG" "$OUT/logcat.txt" | tail -40
  echo "==> Android API $API: app không khởi động"; exit 1
fi

# ---------- toạ độ: khung chơi 480x760 nằm giữa WebView ----------
dump_ui; if dismiss_system_dialog; then dump_ui; fi
cp "$OUT/ui.xml" "$OUT/ui-start.xml" 2>/dev/null || true
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

# ---------- bắt đầu ----------
HOW="$(tap_text 'Bắt đầu' 40)"
wait_log "state=ready" 1 15
ok "A04 Bấm \"Bắt đầu\" (cảm ứng thật)" "$([ "$(count 'state=ready')" -ge 1 ] && echo 1 || echo 0)" "$HOW"
if [ "$fail" != 0 ]; then   # không vào được game thì các bước sau vô nghĩa: dừng sớm, để lại ảnh chụp và cây giao diện
  shot 02-khong-bat-dau; lines
  echo "==> Android API $API: không bấm được nút Bắt đầu (xem $OUT/02-khong-bat-dau.png, ui-khong-thay.xml)"; exit 1
fi
sleep 1; shot 02-ready

# ---------- giữ yên 2 giây trên nút tròn: lượt chơi chỉ được kết thúc khi nhấc tay ----------
# (2 giây = gấp 4 ngưỡng "giữ lâu" của Android. Không giữ lâu hơn: đoạn thẳng khởi động của mê cung chỉ bảo đảm
#  an toàn 2,5 giây đầu cho người chơi đứng yên, sau đó tuỳ mê cung mà chạm tường.)
read -r JX JY <<<"$(pt 240 680)"
adb shell input swipe "$JX" "$JY" "$JX" "$JY" 2000
wait_log "over reason=" 1 10
L="$(last 'over reason=')"; T="$(sed -n 's/.* t=\([0-9]*\).*/\1/p' <<<"$L")"
ok "A05 Giữ yên 2 giây trên nút tròn: không bị hệ thống cắt ngang (không menu giữ-lâu, không huỷ chạm)" \
   "$(grep -q 'reason=lift' <<<"$L" && grep -q 'mode=stick' <<<"$L" && [ "${T:-0}" -ge 1700 ] && echo 1 || echo 0)" "$L"
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
dump_ui; cp "$OUT/ui.xml" "$OUT/ui-board.xml" 2>/dev/null || true
ok "A08 Mở bảng xếp hạng: hiện kỷ lục trên máy" "$(grep -q 'Kỷ lục trên máy này' "$OUT/ui-board.xml" 2>/dev/null && echo 1 || echo 0)"
tap_text 'Đóng' >/dev/null; sleep 1

# ---------- ẩn app giữa lượt (phím Home): lượt phải kết thúc, app không treo ----------
tap_text 'Chơi lại' >/dev/null; wait_log "state=ready" 4 15
( adb shell input swipe "$JX" "$JY" "$JX" "$JY" 6000 >/dev/null 2>&1 & )
sleep 1; adb shell input keyevent 3
wait_log "over reason=" 4 12
L="$(last 'over reason=')"; T="$(sed -n 's/.* t=\([0-9]*\).*/\1/p' <<<"$L")"
ok "A09 Bấm Home giữa lượt: lượt kết thúc ngay (tính là nhấc tay)" "$([ "$(count 'over reason=')" -ge 4 ] && grep -q 'reason=lift' <<<"$L" && [ "${T:-9999}" -lt 4000 ] && echo 1 || echo 0)" "$L"
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
E2="$(edge_px 07-relaunch)"
ok "A12c Mở lại app cũng không lộ bảng chưa co giãn" "$(edge_ok "$E2" && echo 1 || echo 0)" "$E2 điểm sáng sát mép phải"

# ---------- trang quyền riêng tư mở ngay trong app; nút Back của máy đưa về game chứ không thoát app ----------
NB="$(count 'boot v')"
tap_text 'Bảng xếp hạng' >/dev/null; tap_text 'Quyền riêng tư' >/dev/null
P="$(find_text '~Chính sách quyền riêng tư' 15)"
sleep 1; shot 08-privacy
adb shell input keyevent 4
# Về tới game = trang game nạp lại (thêm một dòng boot). Không dò nút qua cây trợ năng ở bước này: WebView 124
# (máy ảo Android 15) không dựng lại cây sau khi lùi trang.
wait_log "boot v" "$((NB + 1))" 20; sleep 2; shot 09-back-to-game
TOP="$(top_activity)"
ok "A12b Trang quyền riêng tư mở trong app; nút Back đưa về game (không thoát app)" "$([ -n "$P" ] && [ "$(count 'boot v')" -gt "$NB" ] && grep -q "$PKG" <<<"$TOP" && echo 1 || echo 0)" \
   "trang riêng tư tại ${P:-KHÔNG THẤY}; về game: $(last 'boot v')"

# ---------- sân chơi có hiện không ----------
# Game tự đọc lại canvas sau 30 khung hình ("canvas ok|blank"); ảnh chụp lúc sẵn sàng chơi cho biết màn hình có hiện.
wait_log "canvas " 1 40
CV="$(last 'canvas ')"; BR="$(bright_px 02-ready)"
ok "A12d Canvas nhận nét vẽ của game" "$(grep -q 'canvas ok' <<<"$CV" && echo 1 || echo 0)" "$CV"
# Ảnh chụp phải thấy mê cung (đo được 4.000-7.000 điểm sáng; sân chơi trống = 0). Ngoại lệ đã kiểm chứng: MÁY ẢO Android
# chạy WebView cũ (đo trên bản 52 và 66) không đưa được canvas tăng tốc GPU của BẤT KỲ trang nào lên màn hình — kể cả
# trang chỉ có một canvas vẽ vài hình vuông — trong khi canvas không tăng tốc, và WebView 83 trở lên trên cùng máy ảo,
# hiện bình thường. Ở đó chỉ ghi nhận (dòng A12d ở trên vẫn xác nhận game đã vẽ); máy thật và WebView mới thì tính lỗi.
WVMAJ="$(sed -n 's/.*, *\([0-9][0-9]*\)\..*/\1/p' <<<"$WV")"
if [ "$BR" = '?' ]; then echo "INFO  Không đọc được ảnh chụp màn hình lúc sẵn sàng chơi"
elif [ "$BR" -ge 300 ]; then ok "A12e Màn hình hiện sân chơi (ảnh chụp lúc sẵn sàng chơi thấy mê cung)" 1 "$BR điểm sáng"
elif [ "$EMU" = 1 ] && [ "${WVMAJ:-0}" -lt 80 ]; then
  echo "INFO  Máy ảo với WebView cũ (${WVMAJ:-không rõ bản}) không hiện canvas tăng tốc GPU của mọi trang: ảnh chụp trống ($BR điểm sáng), bỏ qua A12e"
else ok "A12e Màn hình hiện sân chơi (ảnh chụp lúc sẵn sàng chơi thấy mê cung)" 0 "$BR điểm sáng dù game báo: $CV"; fi

# ---------- lỗi ----------
sleep 1
CRASH="$(app_crashes)"
JSERR="$(grep -a -F 'CONSOLE' "$OUT/logcat.txt" | grep -E "Uncaught|frame error|SyntaxError|is not defined|is not a function" | head -3)"
ok "A13 Không crash, không ANR" "$([ -z "$CRASH" ] && echo 1 || echo 0)" "$CRASH"
# Thoát app bằng nút Back (bước A11) phải gỡ WebView khỏi cửa sổ rồi mới huỷ; huỷ lúc còn gắn thì WebView ghi cảnh báo
WD="$(grep -a -c -F 'WebView.destroy() called while WebView is still attached' "$OUT/logcat.txt" 2>/dev/null || true)"
ok "A13b Thoát app: WebView được gỡ khỏi cửa sổ trước khi huỷ" "$([ "${WD:-0}" = 0 ] && echo 1 || echo 0)" "${WD:-0} cảnh báo của WebView"
ok "A14 Không có lỗi JavaScript trong WebView" "$([ -z "$JSERR" ] && echo 1 || echo 0)" "$JSERR"
lines > "$OUT/oneline-log.txt"
echo "--- log của game ---"; cat "$OUT/oneline-log.txt"
[ "$fail" = 0 ] && echo "==> Android API $API: tất cả đạt" || echo "==> Android API $API: CÓ LỖI"
exit $fail
