#!/usr/bin/env bash
# Build file IPA CHƯA KÝ cho iPhone/iPad. Cần macOS + Xcode + XcodeGen (brew install xcodegen).
#
#   bash ios/build-ipa.sh            # -> dist/OneLine-<phiên bản>-unsigned.ipa
#
# IPA chưa ký không cài trực tiếp được: dùng Sideloadly / AltStore để ký bằng Apple ID của bạn khi cài,
# hoặc mở ios/OneLine.xcodeproj bằng Xcode, chọn Team rồi bấm Run.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
OUT="${OUT:-$ROOT/dist}"
VER="$(sed -n 's/^ *MARKETING_VERSION: "\(.*\)"/\1/p' "$HERE/project.yml" | head -1)"
say(){ printf "\033[36m==>\033[0m %s\n" "$*"; }

ONELINE_CONFIG_JS="" bash "$HERE/prepare.sh"
( cd "$HERE" && xcodegen generate --quiet )

say "xcodebuild (Release, iphoneos, không ký)"
xcodebuild -project "$HERE/OneLine.xcodeproj" -scheme OneLine -configuration Release -sdk iphoneos \
  -derivedDataPath "$HERE/.build" \
  CODE_SIGN_IDENTITY="" CODE_SIGNING_REQUIRED=NO CODE_SIGNING_ALLOWED=NO ONLY_ACTIVE_ARCH=NO \
  build 2>&1 | grep -E "error|warning: (unre|depre)|BUILD (SUCCEEDED|FAILED)" || true

APP="$HERE/.build/Build/Products/Release-iphoneos/OneLine.app"
[ -d "$APP" ] || { echo "Build thất bại: không thấy $APP" >&2; exit 1; }

say "Kiểm tra gói app"
PB=/usr/libexec/PlistBuddy
[ "$($PB -c 'Print :CFBundleIdentifier' "$APP/Info.plist")" = "vn.lupin.oneline" ]
[ "$($PB -c 'Print :CFBundleShortVersionString' "$APP/Info.plist")" = "$VER" ]
echo "  phiên bản $VER (build $($PB -c 'Print :CFBundleVersion' "$APP/Info.plist")), tên hiển thị: $($PB -c 'Print :CFBundleDisplayName' "$APP/Info.plist")"
echo "  iOS tối thiểu: $($PB -c 'Print :MinimumOSVersion' "$APP/Info.plist")"
echo "  kiến trúc: $(lipo -archs "$APP/OneLine")"
lipo -archs "$APP/OneLine" | grep -q arm64
for f in www/index.html www/lib/online.js www/firebase-config.js www/privacy.html Assets.car; do
  [ -e "$APP/$f" ] || { echo "Thiếu $f trong app" >&2; exit 1; }
done
for f in index.html firebase-config.js privacy.html lib/online.js; do
  cmp -s "$APP/www/$f" "$ROOT/$f" || { echo "$f trong app khác bản trong repo" >&2; exit 1; }
done

rm -rf "$HERE/.build/Payload"; mkdir -p "$HERE/.build/Payload" "$OUT"
cp -R "$APP" "$HERE/.build/Payload/"
IPA="$OUT/OneLine-$VER-unsigned.ipa"
rm -f "$OUT"/OneLine-*-unsigned.ipa
( cd "$HERE/.build" && zip -qry "$IPA" Payload )
say "Xong: ${IPA#$ROOT/}  ($(du -h "$IPA" | cut -f1))"
