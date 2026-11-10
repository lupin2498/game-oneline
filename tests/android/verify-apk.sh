#!/usr/bin/env bash
# Kiểm tra tĩnh một file APK (không cần máy ảo): manifest, nội dung, căn chỉnh zip, chữ ký.
#   bash tests/android/verify-apk.sh dist/OneLine-1.6.apk
set -euo pipefail
APK="${1:?thiếu đường dẫn APK}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TOOLS="$ROOT/android/.tools"
[ -x "$TOOLS/aapt2" ] || { echo "Chưa có công cụ build: chạy bash android/build.sh trước"; exit 2; }
fail=0
ok(){ if [ "$2" = "1" ]; then echo "PASS  $1${3:+  — $3}"; else echo "FAIL  $1${3:+  — $3}"; fail=1; fi; }
has(){ grep -q -- "$1" <<<"$2" && echo 1 || echo 0; }

B="$("$TOOLS/aapt2" dump badging "$APK")"
V="$(sed -n "s/.*versionName='\([^']*\)'.*/\1/p" <<<"$B" | head -1)"
WANT_V="$(sed -n 's/^VERSION_NAME="\(.*\)"/\1/p' "$ROOT/android/build.sh")"
ok "V1 Gói vn.lupin.oneline" "$(has "package: name='vn.lupin.oneline'" "$B")"
ok "V2 Phiên bản $WANT_V khớp build.sh, manifest và trang web" \
   "$([ "$V" = "$WANT_V" ] && grep -q "android:versionName=\"$WANT_V\"" "$ROOT/android/AndroidManifest.xml" && grep -q "var VERSION='$WANT_V'" "$ROOT/index.html" && echo 1 || echo 0)" "APK $V"
ok "V3 minSdk 24, targetSdk >= 34" "$([ "$(has "^minSdkVersion:'24'" "$B")" = 1 ] && [ "$(sed -n "s/^targetSdkVersion:'\([0-9]*\)'.*/\1/p" <<<"$B")" -ge 34 ] && echo 1 || echo 0)" \
   "$(grep -E "^(minSdkVersion|targetSdkVersion)" <<<"$B" | tr '\n' ' ')"
ok "V4 Activity khởi chạy đúng" "$(has "launchable-activity: name='vn.lupin.oneline.MainActivity'" "$B")"
PERMS="$(grep "^uses-permission" <<<"$B" | sed "s/.*name='\([^']*\)'.*/\1/" | tr '\n' ' ')"
ok "V5 Chỉ xin quyền Internet" "$([ "$PERMS" = "android.permission.INTERNET " ] && echo 1 || echo 0)" "$PERMS"
ok "V6 Có tên app và icon" "$([ "$(has "application-label:'Một Nét'" "$B")" = 1 ] && [ "$(has "application-icon-" "$B")" = 1 ] && echo 1 || echo 0)"

X="$("$TOOLS/aapt2" dump xmltree "$APK" --file AndroidManifest.xml)"
ok "V7 Manifest: exported, singleTask, nhận vn.lupin.oneline://auth" \
   "$([ "$(has 'android:exported.*=true' "$X")" = 1 ] && [ "$(has 'android:launchMode.*=2' "$X")" = 1 ] && [ "$(has '="vn.lupin.oneline"' "$X")" = 1 ] && [ "$(has 'android.intent.category.BROWSABLE' "$X")" = 1 ] && echo 1 || echo 0)"
ok "V8 Không bật chế độ debug" "$([ "$(has 'android:debuggable' "$X")" = 0 ] && echo 1 || echo 0)"

L="$(unzip -Z1 "$APK")"
miss=""; for f in AndroidManifest.xml classes.dex resources.arsc assets/index.html assets/lib/online.js assets/firebase-config.js assets/privacy.html assets/icons/icon-192.png; do
  grep -qx "$f" <<<"$L" || miss="$miss $f"; done
ok "V9 Đủ file bắt buộc trong APK" "$([ -z "$miss" ] && echo 1 || echo 0)" "${miss:+thiếu:$miss}"
junk="$(grep -E "(\.p12|\.jks|\.keystore|node_modules|\.git/|tests/|login\.html|\.map)$|^assets/(src|tools|android|ios)/" <<<"$L" || true)"
ok "V10 Không lẫn khoá ký, mã nguồn test hay file thừa" "$([ -z "$junk" ] && echo 1 || echo 0)" "$junk"
diff=""; for f in index.html lib/online.js firebase-config.js privacy.html; do
  cmp -s <(unzip -p "$APK" "assets/$f") "$ROOT/$f" || diff="$diff $f"; done
ok "V11 Trang, lớp online, cấu hình và trang riêng tư trong APK giống hệt bản trong repo" "$([ -z "$diff" ] && echo 1 || echo 0)" "${diff:+khác:$diff}"
D="$(unzip -p "$APK" classes.dex | head -c 8 | od -An -c | tr -d ' \n')"
ok "V12 classes.dex đúng định dạng" "$([ "$D" = 'dex\n035\0' ] && echo 1 || echo 0)" "$D"

T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
javac -nowarn -cp "$TOOLS/apksig.jar" -d "$T" "$ROOT/android/tools/Align.java" "$ROOT/android/tools/Verify.java" 2>/dev/null
ok "V13 resources.arsc không nén, mọi mục không nén căn 4 byte (bắt buộc từ Android 11)" "$(java -cp "$T" Align --check "$APK" >/dev/null 2>&1 && echo 1 || echo 0)"
S="$(java --add-exports java.base/sun.security.x509=ALL-UNNAMED --add-exports java.base/sun.security.pkcs=ALL-UNNAMED \
     --add-exports java.base/sun.security.util=ALL-UNNAMED -cp "$TOOLS/apksig.jar:$T" Verify "$APK" 2>/dev/null || true)"
ok "V14 Chữ ký APK Signature Scheme v2 hợp lệ" "$(has 'verified=true v1=false v2=true' "$S")" "$(grep cert-sha256 <<<"$S" | cut -c1-48)…"
echo "$S" | grep "^cert-" || true
[ "$fail" = 0 ] && echo "==> APK tĩnh: tất cả đạt" || { echo "==> APK tĩnh: CÓ LỖI"; exit 1; }
