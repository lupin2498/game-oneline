# Đường Kẻ Một Nét (One Line)

Game HTML5 canvas: vẽ **một đường liền** qua mê cung đang cuộn. Hai cách điều khiển:
giữ **vòng sáng** rồi kéo trực tiếp, hoặc giữ **nút tròn** ở đáy màn hình rồi rê núm —
nhân vật di chuyển đúng bằng quãng và tốc độ ngón tay di (1:1). **Nhấc tay hoặc chạm tường là thua.**
Hành lang hẹp dần (±54px → ±12px), thỉnh thoảng có cửa thắt, tốc độ cuộn tăng dần (130 → 440 px/s).

| Bản | Cài thế nào |
|---|---|
| **Android** | Tải [`dist/OneLine-1.5.apk`](dist/) → mở file → cho phép "Cài ứng dụng không rõ nguồn gốc". Android 7.0 trở lên |
| **iPhone / iPad** | [`dist/OneLine-1.5-unsigned.ipa`](dist/) cài bằng Sideloadly / AltStore (xem mục iOS), hoặc mở trang web bằng **Safari** → Chia sẻ → **Thêm vào màn hình chính** |
| **Máy tính / trình duyệt** | Mở `index.html`, hoặc đưa lên GitHub Pages / Firebase Hosting rồi vào link |

## Nội dung repo

```
index.html              game (một file, chạy offline)
manifest.webmanifest    PWA: cài lên màn hình chính, chạy fullscreen
sw.js                   service worker: chạy offline, tự cập nhật
icons/                  bộ icon 48 → 1024 px
firebase-config.js      cấu hình Firebase (để null = chơi offline, không đăng nhập)
lib/online.js           đăng nhập Google/Facebook + bảng xếp hạng (build từ src/online.js)
login.html              trang cầu nối đăng nhập cho app Android/iOS
privacy.html            chính sách quyền riêng tư + cách xoá dữ liệu
firestore.rules         luật bảo vệ bảng xếp hạng
dist/                   bộ cài: APK đã ký + IPA chưa ký
android/                nguồn app Android (WebView) + build.sh
ios/                    nguồn app iOS (WKWebView) + XcodeGen + build-ipa.sh
tests/                  bộ test tự động (web, online, Android, iOS) + cấu hình giả cho test đăng nhập
extras/pour/            game phụ "Rót Nước" (Pour), một file HTML, mở là chơi
.github/workflows/ci.yml  CI: test web, build APK, chạy trên máy ảo Android + iOS Simulator, build IPA
```

## Android

APK có sẵn ở `dist/`. Thông số: `vn.lupin.oneline`, minSdk 24 (Android 7.0+), targetSdk 35,
ký theo APK Signature Scheme v2, căn chỉnh zip 4 byte, chỉ xin quyền Internet (cho đăng nhập + bảng xếp hạng).

Build lại — **không cần Android Studio hay Android SDK**, chỉ cần JDK 11+, curl, zip:

```bash
bash android/build.sh                          # -> dist/OneLine-1.5.apk
bash tests/android/verify-apk.sh dist/*.apk    # kiểm tra tĩnh: manifest, nội dung, căn chỉnh, chữ ký
```

Script tự tải công cụ về `android/.tools/` (`aapt2` từ npm `aaptjs3`; `android.jar`, `dx`, `ecj`, `apksig`
từ Maven Central hoặc máy chủ dự phòng) và chỉ dùng khi **khớp mã băm SHA-256** ghi sẵn trong script.

### Khoá ký — quan trọng

Android chỉ cho cài đè khi bản mới ký **cùng khoá** với bản đang cài. Khoá nằm ở
`android/.keystore/one-line.p12` (mật khẩu mặc định `onelinegame`), **không** đưa lên git vì repo công khai.

- Lần đầu chạy `build.sh` mà chưa có file này thì script tự sinh khoá mới → APK đó không cài đè lên bản
  ký bằng khoá khác (phải gỡ bản cũ trước).
- Hãy cất file `.p12` ở nơi an toàn. Khi build trên máy khác, chép nó vào đúng đường dẫn trên.
- Để CI luôn ký cùng khoá: vào *Settings → Secrets and variables → Actions* của repo, thêm secret
  `ONELINE_KEYSTORE_B64` (kết quả lệnh `base64 -w0 one-line.p12`) và `ONELINE_KEYSTORE_PASS`.

## iOS

Apple bắt buộc mọi app phải được ký bằng tài khoản Apple, nên **không tồn tại file cài iOS "mở là cài"**
như APK. Repo cung cấp file **IPA chưa ký** (`dist/OneLine-1.5-unsigned.ipa`, do CI build trên macOS và đã chạy
UI test trên iOS Simulator). Ba cách đưa lên máy:

1. **Sideloadly hoặc AltStore (không cần máy Mac):** cài công cụ trên máy tính Windows/Mac, cắm iPhone,
   kéo file IPA vào, đăng nhập Apple ID của bạn — công cụ sẽ ký rồi cài. Apple ID miễn phí: app hết hạn sau
   7 ngày (cài lại là được); tài khoản Apple Developer (99 USD/năm): 1 năm.
2. **Có máy Mac + Xcode:** cài [XcodeGen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`) rồi:
   ```bash
   bash ios/prepare.sh
   cd ios && xcodegen generate && open OneLine.xcodeproj    # chọn Team → Run lên máy thật
   bash ios/build-ipa.sh                                    # hoặc build lại file IPA chưa ký
   bash tests/ios/run-ui-tests.sh                           # UI test trên Simulator
   ```
3. **PWA (không cần gì thêm):** mở trang web của game bằng Safari → *Thêm vào màn hình chính*.
   Chạy toàn màn hình, offline, có icon riêng, tự cập nhật.

## Đăng nhập Google / Facebook + bảng xếp hạng

Dùng **Firebase** (Authentication + Firestore + Hosting, gói miễn phí là đủ). Khi `firebase-config.js`
để `null`, game vẫn chơi bình thường: ẩn nút đăng nhập, bảng xếp hạng chỉ hiện kỷ lục trên máy.

### Cài đặt (làm 1 lần)

1. Tạo dự án tại <https://console.firebase.google.com> → **Add app → Web** → chép khối `firebaseConfig`
   vào `firebase-config.js` (thay dòng `window.FIREBASE_CONFIG = null;`).
2. **Authentication → Sign-in method**: bật **Google**.
3. **Facebook**: tạo app tại <https://developers.facebook.com> (loại *Consumer*), thêm sản phẩm *Facebook Login*.
   - Chép **App ID** và **App Secret** vào Firebase → Authentication → Facebook.
   - Chép *OAuth redirect URI* Firebase hiện ra (`https://<project>.firebaseapp.com/__/auth/handler`)
     vào Facebook Login → Settings → **Valid OAuth Redirect URIs**.
   - App settings → Basic: **Privacy Policy URL** và **User data deletion** =
     `https://<project>.web.app/privacy.html`, rồi chuyển app sang **Live**.
4. **Firestore Database → Create database** (production mode).
5. Đưa web + luật bảo mật lên Firebase:
   ```bash
   npx -y firebase-tools login
   npx -y firebase-tools use <project-id>          # sửa luôn .firebaserc
   npx -y firebase-tools deploy --only hosting,firestore
   ```
   Game chạy ở `https://<project>.web.app`; trang `login.html` ở đó là cầu nối đăng nhập cho app.
6. Build lại app để nhúng cấu hình mới: `bash android/build.sh` (Android), `bash ios/build-ipa.sh` (iOS, cần máy Mac).
   Không có máy Mac: đẩy thay đổi lên GitHub, CI sẽ build cả hai — vào tab **Actions** → lượt chạy mới nhất →
   **Artifacts**: `ios` (file IPA chưa ký) và `OneLine-apk` (APK; muốn APK này cài đè được lên bản cũ thì thêm
   secret khoá ký như mục *Khoá ký*).

### Cách hoạt động

- **Web / PWA:** đăng nhập bằng cửa sổ popup của Google/Facebook (PWA đã cài dùng chuyển hướng).
- **App Android/iOS:** Google và Facebook chặn đăng nhập bên trong WebView, nên app mở
  `https://<project>.firebaseapp.com/login.html` bằng trình duyệt hệ thống (iOS: `ASWebAuthenticationSession`),
  đăng nhập xong trả về app qua `vn.lupin.oneline://auth` kèm mã `state` ngẫu nhiên dùng một lần để chống giả mạo.
- **Bảng xếp hạng:** mỗi người 1 dòng `scores/{uid}` (tên, ảnh, kỷ lục). `firestore.rules` chỉ cho chủ
  tài khoản ghi, chỉ được **nâng** kỷ lục, tối đa 50 000 m, 3 giây/lần, đúng nhà cung cấp đã đăng nhập.
- **Xoá dữ liệu:** trong game, Bảng xếp hạng → *Xoá dữ liệu của tôi* (bấm 2 lần) xoá điểm rồi xoá luôn tài khoản
  đăng nhập trên Firebase. Nếu Firebase đòi đăng nhập lại (phiên quá cũ), game báo rõ và hướng dẫn.
- **Cập nhật:** service worker trả bản đã lưu ngay và tải bản mới ngầm, nên sửa file nào (kể cả
  `firebase-config.js`) rồi deploy thì người chơi nhận được ở lần mở kế tiếp.
- Giới hạn: điểm do máy người chơi gửi lên; luật chặn dữ liệu sai dạng và spam, nhưng người cố tình gọi API
  vẫn có thể gửi điểm giả trong giới hạn. Muốn chống gian lận triệt để cần kiểm tra phía máy chủ (Cloud Functions).

### Sửa lớp online

```bash
npm install
bash tools/build-online.sh       # src/online.js -> lib/online.js (CI kiểm tra hai file phải khớp)
npm run emulators                # chạy thử với Firebase Emulator, không cần dự án thật
```

## Test

```bash
npm install && npx playwright install chromium
npm test                 # web: logic game, cảm ứng thật (đa chạm, giữ lâu), bố cục, biên, fuzz, PWA, Rót Nước
npm run test:online      # Firebase Emulator: luật Firestore, đăng nhập, bảng xếp hạng, xoá dữ liệu (cần Java 21)
node tests/web/soak.js 10        # độ bền: bot chơi liên tục 10 phút, theo dõi bộ nhớ
python3 tests/ios/verify-ipa.py dist/OneLine-1.5-unsigned.ipa   # kiểm tra tĩnh IPA (chạy được trên mọi hệ điều hành)
bash tests/android/smoke.sh dist/OneLine-1.5.apk   # trên máy ảo / điện thoại Android đang nối adb
bash tests/ios/run-ui-tests.sh                     # trên macOS: UI test trong iOS Simulator
```

Cầu nối đăng nhập của app (app ↔ trình duyệt hệ thống) được thử bằng một bản build riêng dùng cấu hình Firebase
**giả** `tests/fixtures/firebase-config.login-test.js` — bản này chỉ để test, không bao giờ nằm trong `dist/`:

```bash
ONELINE_CONFIG_JS=tests/fixtures/firebase-config.login-test.js DIST=out/logintest bash android/build.sh
bash tests/android/login.sh out/logintest/OneLine-1.5.apk    # Android; trên iOS, run-ui-tests.sh tự chạy lượt 2
```

CI (`.github/workflows/ci.yml`) chạy tất cả mỗi lần push: test web + online trên Chromium, build APK và kiểm tra
tĩnh, **cài và chơi thử APK bằng thao tác cảm ứng thật trên máy ảo Android 7 / 11 / 15 / 16**, biên dịch app iOS,
**UI test giữ / kéo thật trên iOS Simulator**, thử cầu nối đăng nhập trên cả hai nền tảng và build IPA chưa ký.
Game ghi các mốc `[oneline] ...` ra console (khởi động, từng lượt chơi, trạng thái đăng nhập `auth user=… busy=… err=…`;
không ghi tên, mã tài khoản hay token) — xem bằng `adb logcat | grep oneline` hoặc Web Inspector để chẩn đoán trên máy thật.

## Game phụ: Rót Nước (Pour)

`extras/pour/index.html` — giữ ngón tay (hoặc chuột / Space) để rót nước, thả ra đúng vạch vàng; tràn hoặc
thiếu là thua. Mỗi lượt cốc một dáng khác (loe, thu miệng, thắt eo, phình bụng, gợn sóng, nghiêng) nên nước
dâng không đều, vạch hẹp dần theo màn. Không dính tới app Android/iOS hay Firebase.
