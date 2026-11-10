#!/usr/bin/env bash
# Test cầu nối đăng nhập của app Android trên máy ảo / điện thoại đang nối adb.
# Cần APK build với cấu hình Firebase GIẢ để nút Google/Facebook hiện ra:
#   ONELINE_CONFIG_JS=tests/fixtures/firebase-config.login-test.js DIST=out/logintest bash android/build.sh
#   bash tests/android/login.sh out/logintest/OneLine-1.5.apk [thư-mục-kết-quả]
# Kiểm tra: bấm "Google" -> app mở trình duyệt hệ thống tới trang login.html; trình duyệt trả kết quả về
# vn.lupin.oneline://auth -> app quay lại, giao nguyên vẹn kết quả cho game (đọc qua các mốc "[oneline] auth ...").
set -uo pipefail
APK="${1:?thiếu đường dẫn APK}"
OUT="${2:-tests/.out/android-login}"
PKG=vn.lupin.oneline
HOST=oneline-test.invalid
mkdir -p "$OUT"
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

API="$(adb shell getprop ro.build.version.sdk | tr -d '\r')"
adb uninstall "$PKG" >/dev/null 2>&1 || true
adb install -r "$APK" >/dev/null 2>&1 || { echo "FAIL  L00 Không cài được $APK"; exit 1; }
adb logcat -c || true
adb logcat -v threadtime > "$OUT/logcat.txt" 2>/dev/null &
LOGPID=$!
trap 'kill $LOGPID 2>/dev/null || true' EXIT
# số lần hệ thống được yêu cầu mở trang đăng nhập (dòng "START u0 {act=...VIEW ... dat=https://<host>/...}")
starts(){ grep -a -c -E "START u0 \{act=android\.intent\.action\.VIEW[^}]*dat=https://$HOST[^}]*cmp=" "$OUT/logcat.txt" 2>/dev/null || true; }
wait_starts(){ local i=0; while [ "$i" -lt "$(( $2 * 2 ))" ]; do [ "$(starts)" -ge "$1" ] && return 0; sleep 0.5; i=$((i+1)); done; return 1; }
# trình duyệt trả kết quả về app qua đường dẫn sâu
deeplink(){ adb shell "am start -W -a android.intent.action.VIEW -c android.intent.category.BROWSABLE -d '$1'" >/dev/null 2>&1 </dev/null; }

adb shell am start -W -n "$PKG/.MainActivity" >/dev/null 2>&1
wait_log "boot v" 1 120
BOOT="$(last 'boot v')"
if grep -q 'online=none' <<<"$BOOT"; then
  # WebView gốc của máy quá cũ (vd. bản 52 trên máy ảo Android 7.0 chưa cập nhật): game tự bỏ lớp online.
  # Việc cần kiểm là game vẫn chạy và không chìa nút đăng nhập ra.
  XY="$(find_text 'Bắt đầu' 60)"
  ok "L01 WebView của máy quá cũ cho lớp online: game vẫn chạy và ẩn nút đăng nhập" \
     "$([ -n "$XY" ] && [ -z "$(python3 "$LIBDIR/uidump.py" find "$OUT/ui.xml" 'Google')" ] && echo 1 || echo 0)" "$BOOT · $(python3 "$LIBDIR/uidump.py" texts "$OUT/ui.xml")"
  shot 11-no-online
  echo "SKIP  L02-L08 (cần WebView hỗ trợ lớp online)"
  [ "$fail" = 0 ] && echo "==> Đăng nhập (Android API $API): đạt (máy không hỗ trợ lớp online)" || echo "==> Đăng nhập (Android API $API): CÓ LỖI"
  exit $fail
fi
ok "L01 App khởi động với cấu hình online, lớp đăng nhập sẵn sàng" "$(grep -q 'online=on' <<<"$BOOT" && wait_log 'auth user=0 busy=0 err=-' 1 30 && echo 1 || echo 0)" "$BOOT"
[ "$fail" = 0 ] || { lines; echo "==> Đăng nhập (Android API $API): app không khởi động với cấu hình test"; exit 1; }

# ---------- bấm "Google": app phải nhờ hệ thống mở trang đăng nhập bằng trình duyệt ----------
HOW="$(tap_text 'Google' 60)"
BROWSER=1
if wait_starts 1 15; then
  ST="$(grep -a -E "START u0 \{act=android\.intent\.action\.VIEW[^}]*dat=https://$HOST[^}]*cmp=" "$OUT/logcat.txt" | tail -1 | sed 's/.*START u0 //')"
  ok "L02 Bấm \"Google\": app mở trang đăng nhập bằng trình duyệt hệ thống" 1 "$ST"
  sleep 2; shot 11-browser
  TOP="$(top_activity)"
  ok "L03 Trình duyệt lên trước, game lùi về nền" "$(grep -q "$PKG" <<<"$TOP" && echo 0 || echo 1)" "$(head -1 <<<"$TOP" | sed 's/^ *//')"
  # tắt trình duyệt để máy ảo chậm không bật hộp thoại "không phản hồi" che mất game
  BPKG="$(sed -n 's/.*cmp=\([^/ ]*\)\/.*/\1/p' <<<"$ST")"
  [ -n "$BPKG" ] && [ "$BPKG" != android ] && adb shell am force-stop "$BPKG" >/dev/null 2>&1 </dev/null
else
  BROWSER=0
  wait_log 'err=no-browser' 1 5
  ok "L02 Bấm \"Google\": máy không có trình duyệt -> app báo lỗi ngay, nút không kẹt ở trạng thái chờ" "$([ "$(count 'err=no-browser')" -ge 1 ] && echo 1 || echo 0)" "$HOW · $(last 'auth ')"
  echo "SKIP  L03, L05, L07 (máy ảo không có trình duyệt)"
fi

# ---------- kết quả mang mã phiên (state) sai: app quay lại và từ chối ----------
deeplink "vn.lupin.oneline://auth?provider=google&idToken=abc&state=00000000000000000000000000000000"
wait_log 'err=state-mismatch' 1 15
TOP="$(top_activity)"
ok "L04 Trình duyệt trả kết quả sai mã phiên: app quay lại phía trước và từ chối" \
   "$([ "$(count 'err=state-mismatch')" -ge 1 ] && grep -q "$PKG" <<<"$TOP" && echo 1 || echo 0)" "$(last 'auth ') · khởi động $(count 'boot v') lần"
sleep 1; shot 12-state-mismatch

# ---------- sau lỗi vẫn bấm đăng nhập lại được ----------
if [ "$BROWSER" = 1 ]; then
  tap_text 'Facebook' >/dev/null
  wait_starts 2 15
  ok "L05 Sau khi bị từ chối, bấm \"Facebook\" vẫn mở được trang đăng nhập" "$([ "$(starts)" -ge 2 ] && [ "$(count 'login facebook native=Android')" -ge 1 ] && echo 1 || echo 0)" "$(last 'login ')"
  sleep 2; [ -n "${BPKG:-}" ] && [ "$BPKG" != android ] && adb shell am force-stop "$BPKG" >/dev/null 2>&1 </dev/null
fi

# ---------- ký tự đặc biệt trong kết quả phải tới game nguyên vẹn (dấu +, %, nháy, <, chữ có dấu) ----------
deeplink "vn.lupin.oneline://auth?error=a%2Bb%25c%22d%27e%3Cf%C3%A9&state=x"
wait_log "err=a+b%c\"d'e<fé" 1 15
ok "L06 Kết quả chứa ký tự đặc biệt tới game nguyên vẹn (không bị giải mã hai lần)" "$([ "$(count "err=a+b%c\"d'e<fé")" -ge 1 ] && echo 1 || echo 0)" "$(last 'auth ')"

# ---------- bỏ ngang ở trình duyệt rồi quay lại app: nút đăng nhập phải tự nhả ----------
if [ "$BROWSER" = 1 ]; then
  N0="$(count 'auth user=0 busy=0 err=-')"
  tap_text 'Google' >/dev/null
  wait_starts 3 15; sleep 2
  [ -n "${BPKG:-}" ] && [ "$BPKG" != android ] && adb shell am force-stop "$BPKG" >/dev/null 2>&1 </dev/null
  adb shell am start -W -n "$PKG/.MainActivity" >/dev/null 2>&1 </dev/null
  wait_log 'auth user=0 busy=0 err=-' "$((N0 + 1))" 15
  ok "L07 Bỏ ngang ở trình duyệt rồi quay lại app: nút đăng nhập tự nhả sau vài giây" "$([ "$(starts)" -ge 3 ] && [ "$(count 'auth user=0 busy=0 err=-')" -gt "$N0" ] && echo 1 || echo 0)" "$(last 'auth ') · khởi động $(count 'boot v') lần"
  sleep 1; shot 13-back-in-app
fi

# ---------- lỗi ----------
CRASH="$(grep -a -E "FATAL EXCEPTION|ANR in $PKG" "$OUT/logcat.txt" | head -3)"
JSERR="$(grep -a -F 'CONSOLE' "$OUT/logcat.txt" | grep -a -F 'android_asset' | grep -E "Uncaught|frame error|SyntaxError|is not defined|is not a function" | head -3)"
ok "L08 Không crash, không ANR, không lỗi JavaScript" "$([ -z "$CRASH" ] && [ -z "$JSERR" ] && echo 1 || echo 0)" "$CRASH$JSERR"
lines > "$OUT/oneline-log.txt"
echo "--- log của game ---"; cat "$OUT/oneline-log.txt"
[ "$fail" = 0 ] && echo "==> Đăng nhập (Android API $API): tất cả đạt" || echo "==> Đăng nhập (Android API $API): CÓ LỖI"
exit $fail
