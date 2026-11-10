#!/usr/bin/env bash
# Dùng trong CI: chạy smoke test trên máy ảo cho cả APK phát hành (dist/) lẫn APK vừa build từ mã nguồn (out/).
set -uo pipefail
API="$(adb shell getprop ro.build.version.sdk | tr -d '\r')"
BASE="tests/.out/android-$API"
rc=0
for kind in shipped built; do
  dir=dist; [ "$kind" = built ] && dir=out
  apk="$(ls $dir/OneLine-*.apk 2>/dev/null | head -1)"
  [ -n "$apk" ] || { echo "(không có APK trong $dir/, bỏ qua)"; continue; }
  echo; echo "=================== $kind: $apk ==================="
  bash tests/android/smoke.sh "$apk" "$BASE/$kind" || rc=1
done
exit $rc
