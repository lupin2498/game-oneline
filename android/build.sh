#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Build APK cho game "Đường Kẻ Một Nét" KHÔNG cần Android Studio / Android SDK.
# Chỉ cần: JDK 11+ (javac, keytool), curl, tar, zip, unzip.
# Toàn bộ công cụ được tải từ Maven Central + npm registry về thư mục .tools/
#
#   bash android/build.sh            # build + ký -> dist/OneLine-<ver>.apk
#   KEEP=1 bash android/build.sh     # giữ lại thư mục build trung gian
#
# Khoá ký: mặc định android/.keystore/one-line.p12 (tự sinh nếu chưa có).
# GIỮ file này: APK ký bằng khoá khác sẽ không cài đè lên bản cũ được.
# Có thể truyền qua biến môi trường (dùng cho CI):
#   ONELINE_KEYSTORE_B64   nội dung file .p12 mã hoá base64
#   ONELINE_KEYSTORE_PASS  mật khẩu (mặc định "onelinegame")
# ---------------------------------------------------------------------------
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
TOOLS="$HERE/.tools"
BUILD="$HERE/.build"
DIST="${DIST:-$ROOT/dist}"

VERSION_NAME="1.5"
MIN_SDK=24
TARGET_SDK=35
APK_NAME="OneLine-$VERSION_NAME.apk"

# Công cụ build: <tên tệp>|<đường dẫn>|<SHA-256>. Tải xong phải khớp mã băm mới được dùng.
AAPT2_TGZ="https://registry.npmjs.org/aaptjs3/-/aaptjs3-2.0.2.tgz"
AAPT2_SHA="26031bd1acb577edce91675ae92daf63cf85795d4e2399333edeb994dd9197e9"
MAVEN_BASES="https://repo1.maven.org/maven2 https://maven-central.storage-download.googleapis.com/maven2"
MAVEN_TOOLS="
android.jar|com/google/android/android/4.1.1.4/android-4.1.1.4.jar|84072541cbb711eff89f7277100ff854929a446dba7ceb1b195c340e0b4fd3cb
dx.jar|com/google/android/tools/dx/1.7/dx-1.7.jar|923302e666d76e126e4cdf7129318532b258b1a66e435b92ccc29e91a60357bf
ecj.jar|org/eclipse/jdt/ecj/3.21.0/ecj-3.21.0.jar|9082211f48782750093f07822d1ae481e8ece250449578f372334da626ccdead
apksig.jar|com/android/tools/build/apksig/2.3.0/apksig-2.3.0.jar|9637078c0016244e4be0941836295365a7e2e5b164c59cb7885783c40460bfee
"

KS="${ONELINE_KEYSTORE:-$HERE/.keystore/one-line.p12}"
KS_PASS="${ONELINE_KEYSTORE_PASS:-onelinegame}"
KS_ALIAS="oneline"

say(){ printf "\033[36m==>\033[0m %s\n" "$*"; }
sha256(){ if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
# fetch <tệp đích> <sha256> <url...>: thử lần lượt từng địa chỉ (Maven Central đôi khi trả 429), chỉ nhận tệp khớp mã băm
fetch(){
  local out="$1" want="$2" url; shift 2
  for url in "$@"; do
    if curl -fsSL --retry 2 --retry-delay 3 "$url" -o "$out.part" && [ "$(sha256 "$out.part")" = "$want" ]; then
      mv "$out.part" "$out"; return 0
    fi
    rm -f "$out.part"
  done
  echo "Không tải được (hoặc sai mã băm): $(basename "$out")" >&2; return 1
}

# ---------------------------------------------------------------- 1. công cụ
mkdir -p "$TOOLS"
if [ ! -x "$TOOLS/aapt2" ]; then
  say "Tải aapt2 (npm aaptjs3)"
  fetch "$TOOLS/aapt2.tgz" "$AAPT2_SHA" "$AAPT2_TGZ"
  case "$(uname -s)" in Darwin) plat=darwin ;; *) plat=linux ;; esac
  tar xzf "$TOOLS/aapt2.tgz" -C "$TOOLS" "package/bin/x64/$plat/aapt2"
  mv "$TOOLS/package/bin/x64/$plat/aapt2" "$TOOLS/aapt2"
  rm -rf "$TOOLS/package" "$TOOLS/aapt2.tgz"
  chmod +x "$TOOLS/aapt2"
fi
for line in $MAVEN_TOOLS; do
  f="${line%%|*}"; rest="${line#*|}"; path="${rest%%|*}"; sum="${rest##*|}"
  if [ ! -f "$TOOLS/$f" ] || [ "$(sha256 "$TOOLS/$f")" != "$sum" ]; then
    say "Tải $f"
    urls=""; for b in $MAVEN_BASES; do urls="$urls $b/$path"; done
    # shellcheck disable=SC2086
    fetch "$TOOLS/$f" "$sum" $urls
  fi
done

# ------------------------------------------------------------- 2. dọn & assets
rm -rf "$BUILD"; mkdir -p "$BUILD/assets" "$BUILD/classes" "$BUILD/tools" "$DIST"
say "Chép web assets"
cp "$ROOT/index.html" "$ROOT/firebase-config.js" "$ROOT/privacy.html" "$BUILD/assets/"
mkdir -p "$BUILD/assets/icons"
cp "$ROOT/icons/icon-192.png" "$ROOT/icons/apple-touch-icon.png" "$BUILD/assets/icons/"
cp -r "$ROOT/lib" "$BUILD/assets/lib"
# manifest/service worker chỉ dùng cho bản web; file trống để trang không báo lỗi 404 trong WebView
printf '{}' > "$BUILD/assets/manifest.webmanifest"

# ------------------------------------------------------------ 3. tài nguyên
say "aapt2 compile + link (minSdk $MIN_SDK, targetSdk $TARGET_SDK)"
"$TOOLS/aapt2" compile --dir "$HERE/res" -o "$BUILD/res.zip"
"$TOOLS/aapt2" link \
  -I "$TOOLS/android.jar" \
  --manifest "$HERE/AndroidManifest.xml" \
  -A "$BUILD/assets" \
  --min-sdk-version "$MIN_SDK" \
  --target-sdk-version "$TARGET_SDK" \
  --version-name "$VERSION_NAME" \
  -o "$BUILD/base.apk" \
  "$BUILD/res.zip"

# ------------------------------------------------------------- 4. mã nguồn
say "Biên dịch Java (ECJ, bytecode 1.6 cho dx)"
java -jar "$TOOLS/ecj.jar" -nowarn -source 1.6 -target 1.6 \
  -cp "$TOOLS/android.jar" -d "$BUILD/classes" \
  $(find "$HERE/src" -name '*.java')

say "dx -> classes.dex"
java -cp "$TOOLS/dx.jar" com.android.dx.command.Main \
  --dex --output="$BUILD/classes.dex" "$BUILD/classes"

# -------------------------------------------------------------- 5. đóng gói
say "Nhét classes.dex vào APK, căn chỉnh 4 byte (zipalign)"
( cd "$BUILD" && zip -q -X "base.apk" classes.dex )
javac -nowarn -cp "$TOOLS/apksig.jar" -d "$BUILD/tools" "$HERE/tools/Align.java" "$HERE/tools/Sign.java" 2>/dev/null
java -cp "$BUILD/tools" Align "$BUILD/base.apk" "$BUILD/aligned.apk"

# ------------------------------------------------------------------- 6. ký
if [ ! -f "$KS" ] && [ -n "${ONELINE_KEYSTORE_B64:-}" ]; then
  say "Lấy khoá ký từ biến môi trường ONELINE_KEYSTORE_B64"
  mkdir -p "$(dirname "$KS")"
  printf '%s' "$ONELINE_KEYSTORE_B64" | base64 -d > "$KS"
fi
if [ ! -f "$KS" ]; then
  say "Tạo khoá ký MỚI: $KS  (giữ lại file này để các bản sau cài đè được)"
  mkdir -p "$(dirname "$KS")"
  keytool -genkeypair -v -keystore "$KS" -storetype PKCS12 \
    -alias "$KS_ALIAS" -keyalg RSA -keysize 2048 -validity 10950 \
    -storepass "$KS_PASS" -keypass "$KS_PASS" \
    -dname "CN=One Line Game, OU=Games, O=lupin2498, C=VN" >/dev/null 2>&1
fi
say "Ký APK (APK Signature Scheme v2)"
rm -f "$DIST"/OneLine-*.apk
# apksig 2.3.0 dùng sun.security.x509 -> JDK 9+ cần mở module java.base
java --add-exports java.base/sun.security.x509=ALL-UNNAMED \
  --add-exports java.base/sun.security.pkcs=ALL-UNNAMED \
  --add-exports java.base/sun.security.util=ALL-UNNAMED \
  -cp "$TOOLS/apksig.jar:$BUILD/tools" Sign \
  "$BUILD/aligned.apk" "$DIST/$APK_NAME" "$KS" "$KS_PASS" "$KS_ALIAS" "$MIN_SDK"
java -cp "$BUILD/tools" Align --check "$DIST/$APK_NAME"

FP="$(keytool -list -v -keystore "$KS" -storetype PKCS12 -storepass "$KS_PASS" -alias "$KS_ALIAS" 2>/dev/null \
      | sed -n 's/^[[:space:]]*SHA256:[[:space:]]*//p' | head -1)"
[ "${KEEP:-0}" = "1" ] || rm -rf "$BUILD"
say "Xong: ${DIST#$ROOT/}/$APK_NAME  ($(du -h "$DIST/$APK_NAME" | cut -f1))"
say "Khoá ký SHA-256: ${FP:-không đọc được}"
