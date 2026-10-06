#!/usr/bin/env bash
# Đóng gói src/online.js + Firebase SDK (từ npm) thành lib/online.js — không phụ thuộc CDN.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
[ -d node_modules/firebase ] || npm install --no-audit --no-fund
npx esbuild src/online.js --bundle --minify --format=iife --target=es2017 \
  --legal-comments=none --outfile=lib/online.js
echo "==> lib/online.js ($(du -h lib/online.js | cut -f1))"
