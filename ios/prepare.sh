#!/usr/bin/env bash
# Chép web assets vào ios/www để Xcode đóng gói vào app bundle.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
rm -rf "$HERE/www"; mkdir -p "$HERE/www/icons"
cp "$ROOT/index.html" "$ROOT/firebase-config.js" "$ROOT/privacy.html" "$HERE/www/"
# Chỉ dành cho UI test đăng nhập trên Simulator: ONELINE_CONFIG_JS=<tệp> thay cho firebase-config.js
if [ -n "${ONELINE_CONFIG_JS:-}" ]; then
  echo "==> BẢN TEST: dùng cấu hình $ONELINE_CONFIG_JS"
  cp "$ONELINE_CONFIG_JS" "$HERE/www/firebase-config.js"
fi
cp "$ROOT/icons/icon-192.png" "$ROOT/icons/apple-touch-icon.png" "$HERE/www/icons/"
cp -r "$ROOT/lib" "$HERE/www/lib"
# manifest chỉ dùng cho bản web; file trống để trang không báo lỗi thiếu file trong app
printf '{}' > "$HERE/www/manifest.webmanifest"
echo "==> ios/www đã sẵn sàng"
