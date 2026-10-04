#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Build APK cho game "Đường Kẻ Một Nét" KHÔNG cần Android Studio / Android SDK.
# Chỉ cần: JDK 11+ (javac, keytool), curl, tar, zip, unzip.
# Toàn bộ công cụ được tải từ Maven Central + npm registry về thư mục .tools/
#
#   bash android/build.sh            # build + ký -> dist/OneLine-<ver>.apk
#   KEEP=1 bash android/build.sh     # giữ lại thư mục build trung gian
# ---------------------------------------------------------------------------
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
TOOLS="$HERE/.tools"
BUILD="$HERE/.build"
DIST="$ROOT/dist"

VERSION_NAME="1.0"
MIN_SDK=24
TARGET_SDK=29
PKG="vn.lupin.oneline"
APK_NAME="OneLine-$VERSION_NAME.apk"

AAPT2_TGZ="https://registry.npmjs.org/aaptjs3/-/aaptjs3-2.0.2.tgz"
ANDROID_JAR="https://repo1.maven.org/maven2/com/google/android/android/4.1.1.4/android-4.1.1.4.jar"
DX_JAR="https://repo1.maven.org/maven2/com/google/android/tools/dx/1.7/dx-1.7.jar"
ECJ_JAR="https://repo1.maven.org/maven2/org/eclipse/jdt/ecj/3.21.0/ecj-3.21.0.jar"
APKSIG_JAR="https://repo1.maven.org/maven2/com/android/tools/build/apksig/2.3.0/apksig-2.3.0.jar"

KS="$HERE/.keystore/one-line.p12"
KS_PASS="onelinegame"
KS_ALIAS="oneline"

say(){ printf "\033[36m==>\033[0m %s\n" "$*"; }

# ---------------------------------------------------------------- 1. công cụ
mkdir -p "$TOOLS"
if [ ! -x "$TOOLS/aapt2" ]; then
  say "Tải aapt2 (npm aaptjs3)"
  curl -fsSL "$AAPT2_TGZ" -o "$TOOLS/aapt2.tgz"
  tar xzf "$TOOLS/aapt2.tgz" -C "$TOOLS" package/bin/x64/linux/aapt2 2>/dev/null \
    || tar xzf "$TOOLS/aapt2.tgz" -C "$TOOLS" package/bin/x64/darwin/aapt2
  mv "$TOOLS"/package/bin/x64/*/aapt2 "$TOOLS/aapt2"
  rm -rf "$TOOLS/package" "$TOOLS/aapt2.tgz"
  chmod +x "$TOOLS/aapt2"
fi
for pair in "android.jar|$ANDROID_JAR" "dx.jar|$DX_JAR" "ecj.jar|$ECJ_JAR" "apksig.jar|$APKSIG_JAR"; do
  f="${pair%%|*}"; u="${pair##*|}"
  [ -f "$TOOLS/$f" ] || { say "Tải $f"; curl -fsSL "$u" -o "$TOOLS/$f"; }
done

# ------------------------------------------------------------- 2. dọn & assets
rm -rf "$BUILD"; mkdir -p "$BUILD/assets" "$BUILD/flat" "$BUILD/classes" "$DIST"
say "Chép web assets"
cp "$ROOT/index.html" "$ROOT/manifest.webmanifest" "$ROOT/sw.js" "$BUILD/assets/"
cp -r "$ROOT/icons" "$BUILD/assets/icons"

# ------------------------------------------------------------ 3. tài nguyên
say "aapt2 compile + link"
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
say "Nhét classes.dex vào APK"
( cd "$BUILD" && zip -q -X "base.apk" classes.dex )

# ------------------------------------------------------------------- 6. ký
if [ ! -f "$KS" ]; then
  say "Tạo keystore mới: $KS"
  mkdir -p "$(dirname "$KS")"
  keytool -genkeypair -v -keystore "$KS" -storetype PKCS12 \
    -alias "$KS_ALIAS" -keyalg RSA -keysize 2048 -validity 10950 \
    -storepass "$KS_PASS" -keypass "$KS_PASS" \
    -dname "CN=One Line Game, OU=Games, O=lupin2498, C=VN" >/dev/null 2>&1
fi
say "Ký APK (APK Signature Scheme v2)"
javac -nowarn -cp "$TOOLS/apksig.jar" -d "$BUILD/signer" "$HERE/tools/Sign.java" 2>/dev/null
# apksig 2.3.0 dùng sun.security.x509 -> JDK 9+ cần mở module java.base
java --add-exports java.base/sun.security.x509=ALL-UNNAMED \
  --add-exports java.base/sun.security.pkcs=ALL-UNNAMED \
  --add-exports java.base/sun.security.util=ALL-UNNAMED \
  -cp "$TOOLS/apksig.jar:$BUILD/signer" Sign \
  "$BUILD/base.apk" "$DIST/$APK_NAME" "$KS" "$KS_PASS" "$KS_ALIAS" "$MIN_SDK"

[ "${KEEP:-0}" = "1" ] || rm -rf "$BUILD"
say "Xong: dist/$APK_NAME  ($(du -h "$DIST/$APK_NAME" | cut -f1))"
