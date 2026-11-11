#!/usr/bin/env bash
# Hàm dùng chung cho các bài test trên máy ảo / điện thoại Android (smoke.sh, login.sh).
# Trước khi nạp tệp này phải đặt: OUT (thư mục kết quả, đã tạo) và PKG (tên gói của app).
fail=0
ok(){ if [ "$2" = "1" ]; then echo "PASS  $1${3:+  — $3}"; else echo "FAIL  $1${3:+  — $3}"; fail=1; fi; }
shot(){ adb exec-out screencap -p > "$OUT/$1.png" 2>/dev/null || true; }
# logcat được ghi liên tục ra tệp (bộ đệm trên máy ảo có thể xoay vòng làm mất dòng cũ)
lines(){ grep -a -F '"[oneline] ' "$OUT/logcat.txt" 2>/dev/null | sed 's/.*"\[oneline\] /[oneline] /; s/", source:.*//' ; }
# App bị crash / treo (chỉ tính tiến trình của app: máy ảo đôi khi ghi FATAL EXCEPTION của chính công cụ uiautomator)
app_crashes(){ grep -a -E "AndroidRuntime: Process: $PKG[, ]|ANR in $PKG( |\$|\))" "$OUT/logcat.txt" 2>/dev/null | head -3; }
count(){ lines | grep -c -- "$1" || true; }
last(){ lines | grep -- "$1" | tail -1; }
# wait_raw <biểu thức chính quy> <giây>: chờ một dòng bất kỳ của logcat (không chỉ dòng "[oneline]" của trang)
wait_raw(){
  local i=0
  while [ "$i" -lt "$(( $2 * 2 ))" ]; do
    grep -a -q -E -- "$1" "$OUT/logcat.txt" 2>/dev/null && return 0
    sleep 0.5; i=$((i+1))
  done
  return 1
}
# wait_log <mẫu> <số lần phải có> <giây>
wait_log(){ local i=0; while [ "$i" -lt "$(( $3 * 2 ))" ]; do [ "$(count "$1")" -ge "$2" ] && return 0; sleep 0.5; i=$((i+1)); done; return 1; }
# Ảnh chụp có lộ bố cục chưa co giãn không (nội dung bị cắt ở mép phải màn hình)? In số điểm sáng sát mép phải; "?" = không đọc được ảnh
edge_px(){ python3 "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/pngcheck.py" rightedge "$OUT/$1.png" 2>/dev/null || echo '?'; }
edge_ok(){ [ "$1" = '?' ] || [ "$1" -lt 4 ]; }
# Số điểm sáng ở dải giữa màn hình của một ảnh chụp (0 = sân chơi không hiện gì); "?" = không đọc được ảnh
bright_px(){ python3 "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/pngcheck.py" bright "$OUT/$1.png" 2>/dev/null || echo '?'; }
# Activity đang ở trên cùng (tên trường khác nhau giữa các bản Android, đều chứa "ResumedActivity")
top_activity(){ adb shell dumpsys activity activities 2>/dev/null </dev/null | grep -E 'ResumedActivity' | head -2 | tr -d '\r'; }

LIBDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Đọc cây trợ năng của màn hình đang hiện vào $OUT/ui.xml (xoá tệp cũ trước để không đọc nhầm kết quả lần trước)
dump_ui(){
  adb shell rm -f /sdcard/ui.xml >/dev/null 2>&1 </dev/null
  adb shell uiautomator dump /sdcard/ui.xml 2>&1 </dev/null | tr -d '\r' >> "$OUT/uiautomator.log"
  rm -f "$OUT/ui.xml"; adb pull /sdcard/ui.xml "$OUT/ui.xml" >/dev/null 2>&1 </dev/null || true
}
# Hộp thoại của hệ thống che mất app: lời nhắc "Viewing full screen" khi app lần đầu vào chế độ toàn màn hình
# (Android 14+ giữ nó trên cùng tới khi bấm "Got it"), hay "... isn't responding" trên máy ảo vừa khởi động.
dismiss_system_dialog(){
  local xy; xy="$(python3 "$LIBDIR/uidump.py" dialog "$OUT/ui.xml")"
  [ -n "$xy" ] || return 1
  echo "(đóng hộp thoại hệ thống: $(python3 "$LIBDIR/uidump.py" texts "$OUT/ui.xml"))" >&2
  adb shell input tap $xy </dev/null; sleep 1
}
# Tìm nút theo chữ hiển thị, toạ độ lấy từ cây trợ năng của WebView. WebView chỉ dựng cây này sau lần đọc đầu
# tiên (trên máy ảo chậm có thể mất hàng chục giây) nên phải thử lại cho tới khi thấy nút.
#   find_text <chữ trên nút> [số lần thử, mặc định 15]  -> in "x y"; không thấy thì trả về 1
find_text(){
  local label="$1" tries="${2:-15}" xy="" i=0
  while [ "$i" -lt "$tries" ]; do
    dump_ui
    xy="$(python3 "$LIBDIR/uidump.py" find "$OUT/ui.xml" "$label")"
    [ -n "$xy" ] && { echo "$xy"; return 0; }
    dismiss_system_dialog || sleep 1.5
    i=$((i+1))
  done
  cp "$OUT/ui.xml" "$OUT/ui-khong-thay.xml" 2>/dev/null || true
  return 1
}
#   tap_text <chữ trên nút> [số lần thử]  -> bấm nút đó (cảm ứng thật), in ra cách đã bấm
tap_text(){
  local xy
  if ! xy="$(find_text "$@")"; then
    echo "KHÔNG THẤY nút \"$1\" sau ${2:-15} lần đọc màn hình — $(python3 "$LIBDIR/uidump.py" texts "$OUT/ui.xml")"; return 1
  fi
  adb shell input tap $xy </dev/null; echo "chạm \"$1\" tại $xy"
}
