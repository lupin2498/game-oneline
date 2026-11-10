#!/usr/bin/env bash
# TẠM (nhánh dò lỗi): chạy smoke test cho APK build từ mã nguồn và từng biến thể dò lỗi canvas.
set -uo pipefail
API="$(adb shell getprop ro.build.version.sdk | tr -d '\r')"
BASE="out/android-$API"
adb shell settings put secure immersive_mode_confirmations confirmed >/dev/null 2>&1 || true
adb shell settings put global hide_error_dialogs 1 >/dev/null 2>&1 || true
adb shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS >/dev/null 2>&1 || true
echo "GLES: $(adb shell getprop ro.opengles.version | tr -d '\r') / qemu.gles=$(adb shell getprop ro.kernel.qemu.gles | tr -d '\r') / $(adb shell getprop ro.hardware.egl | tr -d '\r')"
adb shell dumpsys SurfaceFlinger 2>/dev/null | tr -d '\r' | grep -i -m3 -E "GLES|OpenGL" | sed 's/^/SF    /' || true
for d in out out/probe-*; do
  apk="$(ls $d/OneLine-*.apk 2>/dev/null | head -1)"
  [ -n "$apk" ] || continue
  echo; echo "=================== $d: $apk ==================="
  bash tests/android/smoke.sh "$apk" "$BASE/$(basename $d)" || true
done
exit 0
