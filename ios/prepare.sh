#!/usr/bin/env bash
# Chép web assets vào ios/www để Xcode đóng gói vào app bundle.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
rm -rf "$HERE/www"; mkdir -p "$HERE/www"
cp "$ROOT/index.html" "$ROOT/manifest.webmanifest" "$ROOT/sw.js" "$HERE/www/"
cp -r "$ROOT/icons" "$HERE/www/icons"
echo "==> ios/www đã sẵn sàng"
