#!/usr/bin/env bash
# Chép web assets vào ios/www để Xcode đóng gói vào app bundle.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
rm -rf "$HERE/www"; mkdir -p "$HERE/www"
cp "$ROOT/index.html" "$ROOT/manifest.webmanifest" "$ROOT/sw.js" "$ROOT/firebase-config.js" \
   "$ROOT/privacy.html" "$HERE/www/"
cp -r "$ROOT/icons" "$HERE/www/icons"
cp -r "$ROOT/lib" "$HERE/www/lib"
echo "==> ios/www đã sẵn sàng"
