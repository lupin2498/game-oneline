#!/usr/bin/env bash
# Chạy UI test (bấm / giữ / kéo thật) trên iOS Simulator. Cần macOS + Xcode + XcodeGen.
#   bash tests/ios/run-ui-tests.sh [thư-mục-kết-quả]
# Hai lượt: (1) app đúng như bản phát hành; (2) app build với cấu hình Firebase GIẢ để thử cầu nối đăng nhập.
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
echo "==> Simulator: $(cut -d'|' -f2 <<<"$PICK") ($(cut -d'|' -f3 <<<"$PICK"))"
xcrun simctl boot "$UDID" 2>/dev/null || true
xcrun simctl bootstatus "$UDID" -b >/dev/null 2>&1 || true

# run_tests <tên lượt> <tệp log> <tham số chọn test>
run_tests(){
  local name="$1" log="$2" pick="$3" rc
  rm -rf "$OUT/$name.xcresult"
  TEST_RUNNER_SHOT_DIR="$OUT/shots" xcodebuild test \
    -project "$ROOT/ios/OneLine.xcodeproj" -scheme OneLine \
    -destination "platform=iOS Simulator,id=$UDID" \
    -derivedDataPath "$DERIVED" -resultBundlePath "$OUT/$name.xcresult" "$pick" \
    > "$log" 2>&1
  rc=$?
  grep -E "Test Case .*(passed|failed|skipped)|error:|KHUNG CHƠI|ĐĂNG NHẬP|XCTAssert|\*\* TEST|Executed [0-9]+ tests" "$log" | sed 's/^/  /' | tail -60
  # lượt phải thật sự chạy test: không có bài nào chạy, hoặc có bài bị bỏ qua, đều tính là lỗi
  if [ $rc = 0 ] && grep -q "\*\* TEST SUCCEEDED \*\*" "$log" && grep -q -E "Executed [1-9][0-9]* tests?, with 0 failures" "$log" \
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
xcrun simctl io "$UDID" screenshot "$OUT/shots/99-final.png" >/dev/null 2>&1 || true
echo "==> Ảnh chụp: $(ls "$OUT/shots" 2>/dev/null | wc -l | tr -d ' ') tệp trong $OUT/shots"
if [ $FAIL = 0 ]; then echo "==> iOS UI test: tất cả đạt"; exit 0; fi
echo "==> iOS UI test: CÓ LỖI"; exit 1
