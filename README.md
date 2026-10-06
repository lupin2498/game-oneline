# Đường Kẻ Một Nét (One Line)

Game HTML5 canvas: vẽ **một đường liền** qua mê cung đang cuộn. Hai cách điều khiển:
giữ **vòng sáng** rồi kéo trực tiếp, hoặc giữ **nút tròn** ở đáy màn hình rồi rê núm —
nhân vật di chuyển đúng bằng quãng và tốc độ ngón tay di (1:1). **Nhấc tay hoặc chạm tường là thua.** Hành lang hẹp dần (±54px → ±12px),
thỉnh thoảng có cửa thắt, tốc độ cuộn tăng dần (130 → 440 px/s). Kỷ lục lưu bằng `localStorage`.

| Bản | Cài thế nào |
|---|---|
| **Android** | Tải [`dist/OneLine-1.4.apk`](dist/) → mở file → cho phép "Cài ứng dụng không rõ nguồn gốc". Đã cài bản cũ thì cài đè được luôn |
| **iPhone / iPad** | Mở trang web bằng **Safari** → nút Chia sẻ → **Thêm vào màn hình chính** (chạy toàn màn hình, offline) |
| **Máy tính / trình duyệt** | Mở `index.html`, hoặc bật GitHub Pages rồi vào link |

## Nội dung repo

```
index.html              game (một file, chạy offline)
manifest.webmanifest    PWA: cài lên màn hình chính, chạy fullscreen
sw.js                   service worker: cache offline
icons/                  bộ icon 48 → 1024 px
firebase-config.js      cấu hình Firebase (để null = chơi offline, không đăng nhập)
lib/online.js           đăng nhập Google/Facebook + bảng xếp hạng (build từ src/online.js)
login.html              trang cầu nối đăng nhập cho app Android/iOS
privacy.html            chính sách quyền riêng tư + cách xoá dữ liệu
firestore.rules         luật bảo vệ bảng xếp hạng
dist/OneLine-1.4.apk    bản cài Android đã ký sẵn
android/                nguồn app Android (WebView) + build.sh
ios/                    nguồn app iOS (WKWebView) + XcodeGen
.github/workflows/      CI build APK (Ubuntu) và IPA chưa ký (macOS)
```

## Android

APK có sẵn ở `dist/`. Thông số: `vn.lupin.oneline`, minSdk 24 (Android 7+),
targetSdk 29, ký theo APK Signature Scheme v2, chỉ xin quyền Internet (cho đăng nhập + bảng xếp hạng).

Build lại — **không cần Android Studio hay Android SDK**, chỉ cần JDK 11+, curl, zip:

```bash
bash android/build.sh        # -> dist/OneLine-1.4.apk
```

Script tự tải công cụ về `android/.tools/`: `aapt2` (npm `aaptjs3`), `android.jar`,
`dx`, `ecj`, `apksig` (Maven Central). Lần đầu chạy sẽ tự sinh keystore ở
`android/.keystore/` — **giữ lại file này** nếu muốn cập nhật app sau mà không phải gỡ bản cũ.

## iOS

Apple bắt buộc ký bằng tài khoản Apple và build trên macOS, nên không có sẵn file cài.
Ba đường:

1. **PWA (không cần máy Mac, khuyến nghị):** mở trang bằng Safari → *Thêm vào màn hình chính*.
   App chạy toàn màn hình, offline, có icon riêng.
2. **Có máy Mac:** cài [XcodeGen](https://github.com/yonaskolb/XcodeGen) rồi:
   ```bash
   bash ios/prepare.sh
   cd ios && xcodegen generate && open OneLine.xcodeproj
   ```
   Chọn team (Apple ID miễn phí cũng được) → Run. Bản ký bằng Apple ID miễn phí hết hạn sau 7 ngày.
3. **Không có Mac:** chạy workflow *Build iOS (unsigned IPA)* trong tab Actions → tải artifact
   `OneLine-ipa-unsigned` → sideload bằng AltStore / Sideloadly bằng Apple ID của mình.

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
   npm install
   npx firebase login
   npx firebase use <project-id>          # sửa luôn .firebaserc
   npx firebase deploy --only hosting,firestore
   ```
   Game chạy ở `https://<project>.web.app`; trang `login.html` ở đó là cầu nối đăng nhập cho app.
6. Build lại app để nhúng cấu hình mới: `bash android/build.sh` (Android), `bash ios/prepare.sh` (iOS).

### Cách hoạt động

- **Web / PWA:** đăng nhập bằng cửa sổ popup của Google/Facebook (PWA trên iPhone dùng chuyển hướng).
- **App Android/iOS:** Google và Facebook chặn đăng nhập bên trong WebView, nên app mở
  `https://<project>.firebaseapp.com/login.html` bằng trình duyệt hệ thống (iOS: `ASWebAuthenticationSession`),
  đăng nhập xong trả về app qua `vn.lupin.oneline://auth` kèm mã `state` ngẫu nhiên để chống giả mạo.
- **Bảng xếp hạng:** mỗi người 1 dòng `scores/{uid}` (tên, ảnh, kỷ lục). `firestore.rules` chỉ cho chủ
  tài khoản ghi, chỉ được **nâng** kỷ lục, tối đa 50 000 m, 3 giây/lần, đúng nhà cung cấp đã đăng nhập.
- Người chơi tự xoá dữ liệu trong game: Bảng xếp hạng → *Xoá dữ liệu của tôi*.
- Giới hạn: điểm do máy người chơi gửi lên; luật chặn dữ liệu sai dạng và spam, nhưng người cố tình gọi API
  vẫn có thể gửi điểm giả trong giới hạn. Muốn chống gian lận triệt để cần kiểm tra phía máy chủ (Cloud Functions).

### Sửa lớp online

```bash
npm install
bash tools/build-online.sh                         # src/online.js -> lib/online.js
npx firebase emulators:start --only auth,firestore,hosting --project demo-oneline   # chạy thử không cần dự án thật
```
