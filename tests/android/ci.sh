#!/usr/bin/env bash
# Dùng trong CI: chạy smoke test trên máy ảo cho cả APK phát hành (dist/) lẫn APK vừa build từ mã nguồn (out/).
set -uo pipefail
API="$(adb shell getprop ro.build.version.sdk | tr -d '\r')"
BASE="out/android-$API"
# Máy ảo vừa khởi động hay bật hộp thoại "System UI isn't responding" che mất app: tắt loại hộp thoại này
adb shell settings put global hide_error_dialogs 1 >/dev/null 2>&1 || true
adb shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS >/dev/null 2>&1 || true
rc=0
for kind in shipped built; do
  dir=dist; [ "$kind" = built ] && dir=out
  apk="$(ls $dir/OneLine-*.apk 2>/dev/null | head -1)"
  [ -n "$apk" ] || { echo "(không có APK trong $dir/, bỏ qua)"; continue; }
  echo; echo "=================== $kind: $apk ==================="
  bash tests/android/smoke.sh "$apk" "$BASE/$kind" || rc=1
done
# Cầu nối đăng nhập: APK build với cấu hình giả (job "apk" đặt ở out/logintest/)
apk="$(ls out/logintest/OneLine-*.apk 2>/dev/null | head -1)"
if [ -n "$apk" ]; then
  echo; echo "=================== đăng nhập: $apk ==================="
  bash tests/android/login.sh "$apk" "$BASE/login" || rc=1
fi
exit $rc
