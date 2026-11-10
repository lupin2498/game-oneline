#!/usr/bin/env bash
# Chạy UI test (bấm / giữ / kéo thật) trên iOS Simulator. Cần macOS + Xcode + XcodeGen.
#   bash tests/ios/run-ui-tests.sh [thư-mục-kết-quả]
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${1:-$ROOT/tests/.out/ios}"
mkdir -p "$OUT/shots"; OUT="$(cd "$OUT" && pwd)"

bash "$ROOT/ios/prepare.sh"
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

rm -rf "$OUT/Test.xcresult"
TEST_RUNNER_SHOT_DIR="$OUT/shots" xcodebuild test \
  -project "$ROOT/ios/OneLine.xcodeproj" -scheme OneLine \
  -destination "platform=iOS Simulator,id=$UDID" \
  -derivedDataPath "$ROOT/ios/.build-sim" -resultBundlePath "$OUT/Test.xcresult" \
  > "$OUT/xcodebuild-test.log" 2>&1
RC=$?
grep -E "Test Case .*(passed|failed)|error:|KHUNG CHƠI|XCTAssert|\*\* TEST|Executed [0-9]+ tests" "$OUT/xcodebuild-test.log" | sed 's/^/  /' | tail -60
# Ảnh chụp: test tự ghi vào shots/; nếu không ghi được thì lấy từ gói kết quả
if [ -z "$(ls "$OUT/shots" 2>/dev/null)" ]; then
  xcrun xcresulttool export attachments --path "$OUT/Test.xcresult" --output-path "$OUT/shots" >/dev/null 2>&1 || true
fi
xcrun simctl io "$UDID" screenshot "$OUT/shots/99-final.png" >/dev/null 2>&1 || true
echo "==> Ảnh chụp: $(ls "$OUT/shots" 2>/dev/null | wc -l | tr -d ' ') tệp trong $OUT/shots"
if [ $RC = 0 ] && grep -q "\*\* TEST SUCCEEDED \*\*" "$OUT/xcodebuild-test.log"; then echo "==> iOS UI test: tất cả đạt"; exit 0; fi
echo "==> iOS UI test: CÓ LỖI (xem $OUT/xcodebuild-test.log)"; tail -40 "$OUT/xcodebuild-test.log"; exit 1
