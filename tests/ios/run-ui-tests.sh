#!/usr/bin/env bash
# Chạy UI test (bấm / giữ / kéo thật) trên iOS Simulator. Cần macOS + Xcode + XcodeGen.
#   bash tests/ios/run-ui-tests.sh [thư-mục-kết-quả]
# Ba lượt: (1) app đúng như bản phát hành trên iPhone; (2) app build với cấu hình Firebase GIẢ để thử cầu nối
# đăng nhập; (3) app đúng như bản phát hành trên iPad (chơi một lượt, tắt mở lại).
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${1:-$ROOT/tests/.out/ios}"
mkdir -p "$OUT/shots"; OUT="$(cd "$OUT" && pwd)"
DERIVED="$ROOT/ios/.build-sim"

ONELINE_CONFIG_JS="" bash "$ROOT/ios/prepare.sh"
( cd "$ROOT/ios" && xcodegen generate --quiet ) || exit 1

# Chọn một iPhone trên bản iOS mới nhất đang có
PICK="$(xcrun simctl list devices available -j | python3 -c '
import json,sys
d=json.load(sys.stdin)["devices"]
def ver(rt):
    import re
    m=re.search(r"iOS-(\d+)-(\d+)",rt); return (int(m.group(1)),int(m.group(2))) if m else (0,0)
best=None
for rt in sorted([r for r in d if "iOS" in r], key=ver, reverse=True):
    for x in d[rt]:
        n=x["name"]
        if not n.startswith("iPhone") or "SE" in n: continue
        score=("Pro" not in n)*2+("Plus" not in n)+("Max" not in n)
        if best is None or score>best[0]: best=(score,x["udid"],n,rt.split(".")[-1])
    if best: break
print("%s|%s|%s" % (best[1],best[2],best[3]) if best else "")
')"
[ -n "$PICK" ] || { echo "Không tìm thấy iPhone simulator nào" >&2; exit 1; }
UDID="${PICK%%|*}"
# iPad trên bản iOS mới nhất đang có (không có thì bỏ lượt 3)
IPAD="$(xcrun simctl list devices available -j | python3 -c '
import json,sys,re
d=json.load(sys.stdin)["devices"]
def ver(rt):
    m=re.search(r"iOS-(\d+)-(\d+)",rt); return (int(m.group(1)),int(m.group(2))) if m else (0,0)
for rt in sorted([r for r in d if "iOS" in r], key=ver, reverse=True):
    pads=[x for x in d[rt] if x["name"].startswith("iPad")]
    if pads:
        pads.sort(key=lambda x: ("mini" in x["name"], "Pro" in x["name"], x["name"]))
        print("%s|%s|%s" % (pads[0]["udid"],pads[0]["name"],rt.split(".")[-1])); break
')"
# Khởi động máy ảo rồi mở thử một app hệ thống: máy ảo vừa bật còn bận việc nền, lần mở app đầu tiên của bài test
# dễ quá giờ ("Failed to get background assertion", "Failed to terminate") trên máy CI chậm
boot_sim(){
  xcrun simctl boot "$1" 2>/dev/null || true
  xcrun simctl bootstatus "$1" -b >/dev/null 2>&1 || true
  xcrun simctl launch "$1" com.apple.Preferences >/dev/null 2>&1 || true
  sleep 8
  xcrun simctl terminate "$1" com.apple.Preferences >/dev/null 2>&1 || true
}
echo "==> Simulator: $(cut -d'|' -f2 <<<"$PICK") ($(cut -d'|' -f3 <<<"$PICK"))"
boot_sim "$UDID"

# run_tests <tên lượt> <tệp log> <tham số chọn test> [udid máy ảo] [thư mục ảnh chụp]
run_tests(){
  local name="$1" log="$2" pick="$3" dev="${4:-$UDID}" shots="${5:-$OUT/shots}" rc
  rm -rf "$OUT/$name.xcresult"; mkdir -p "$shots"
  TEST_RUNNER_SHOT_DIR="$shots" xcodebuild test \
    -project "$ROOT/ios/OneLine.xcodeproj" -scheme OneLine \
    -destination "platform=iOS Simulator,id=$dev" \
    -derivedDataPath "$DERIVED" -resultBundlePath "$OUT/$name.xcresult" "$pick" \
    > "$log" 2>&1
  rc=$?
  grep -E "Test Case .*(passed|failed|skipped)|error:|expected failure|KHUNG CHƠI|ĐĂNG NHẬP|XCTAssert|\*\* TEST|Executed [0-9]+ tests" "$log" | sed 's/^/  /' | tail -60
  # lượt phải thật sự chạy test: không có bài nào chạy, có bài hỏng, hoặc có bài bị bỏ qua, đều tính là lỗi.
  # ("expected failure" = Simulator không tắt kịp app cũ, xem launchFresh() trong UITests: không tính là bài hỏng)
  if [ $rc = 0 ] && grep -q "\*\* TEST SUCCEEDED \*\*" "$log" && grep -q -E "Executed [1-9][0-9]* tests?" "$log" \
     && ! grep -q -E "Executed [0-9]+ tests?,.* [1-9][0-9]* failures? \(" "$log" \
     && ! grep -q -E "Test Case .* skipped|with [1-9][0-9]* tests? skipped" "$log"; then return 0; fi
  echo "==> $name: CÓ LỖI (xem $log)"; tail -40 "$log"; return 1
}

FAIL=0
echo "==> Lượt 1: chơi thử (app như bản phát hành)"
run_tests Test "$OUT/xcodebuild-test.log" "-skip-testing:OneLineUITests/OneLineLoginUITests" || FAIL=1

echo "==> Lượt 2: cầu nối đăng nhập (app build với cấu hình test)"
ONELINE_CONFIG_JS="$ROOT/tests/fixtures/firebase-config.login-test.js" bash "$ROOT/ios/prepare.sh"
rm -rf "$DERIVED"/Build/Products/*/OneLine.app/www          # buộc Xcode chép lại thư mục www vừa đổi
TEST_RUNNER_LOGIN_TEST=1 run_tests Test-login "$OUT/xcodebuild-test-login.log" "-only-testing:OneLineUITests/OneLineLoginUITests" || FAIL=1
ONELINE_CONFIG_JS="" bash "$ROOT/ios/prepare.sh" >/dev/null   # trả ios/www về cấu hình thật

# Ảnh chụp: test tự ghi vào shots/; nếu không ghi được thì lấy từ gói kết quả
if [ -z "$(ls "$OUT/shots" 2>/dev/null)" ]; then
  xcrun xcresulttool export attachments --path "$OUT/Test.xcresult" --output-path "$OUT/shots" >/dev/null 2>&1 || true
fi
# iPhone đã xong việc: chụp màn hình cuối rồi tắt, để máy CI không phải chạy hai máy ảo cùng lúc
xcrun simctl io "$UDID" screenshot "$OUT/shots/99-final.png" >/dev/null 2>&1 || true
if [ -n "$IPAD" ]; then
  echo "==> Lượt 3: iPad — $(cut -d'|' -f2 <<<"$IPAD") ($(cut -d'|' -f3 <<<"$IPAD"))"
  rm -rf "$DERIVED"/Build/Products/*/OneLine.app/www
  xcrun simctl shutdown "$UDID" >/dev/null 2>&1 || true
  boot_sim "${IPAD%%|*}"
  run_tests Test-ipad "$OUT/xcodebuild-test-ipad.log" "-only-testing:OneLineUITests/OneLineUITests/test02_bestScoreSurvivesRelaunch" "${IPAD%%|*}" "$OUT/shots-ipad" || FAIL=1
  xcrun simctl io "${IPAD%%|*}" screenshot "$OUT/shots-ipad/99-final.png" >/dev/null 2>&1 || true
  xcrun simctl shutdown "${IPAD%%|*}" >/dev/null 2>&1 || true
else
  echo "==> Lượt 3: bỏ qua (không có iPad simulator)"
fi

echo "==> Ảnh chụp: $(ls "$OUT/shots" 2>/dev/null | wc -l | tr -d ' ') tệp trong $OUT/shots"
if [ $FAIL = 0 ]; then echo "==> iOS UI test: tất cả đạt"; exit 0; fi
echo "==> iOS UI test: CÓ LỖI"; exit 1
