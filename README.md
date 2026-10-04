# Đường Kẻ Một Nét (One Line)

Game HTML5 canvas: vẽ **một đường liền** qua mê cung đang cuộn. Hai cách điều khiển:
giữ **vòng sáng** rồi kéo trực tiếp, hoặc giữ **nút tròn** (joystick) ở đáy màn hình và đẩy núm để lái. **Nhấc tay hoặc chạm tường là thua.** Hành lang hẹp dần (±54px → ±12px),
thỉnh thoảng có cửa thắt, tốc độ cuộn tăng dần (130 → 440 px/s). Kỷ lục lưu bằng `localStorage`.

| Bản | Cài thế nào |
|---|---|
| **Android** | Tải [`dist/OneLine-1.1.apk`](dist/) → mở file → cho phép "Cài ứng dụng không rõ nguồn gốc". Đã cài 1.0 thì cài đè được luôn |
| **iPhone / iPad** | Mở trang web bằng **Safari** → nút Chia sẻ → **Thêm vào màn hình chính** (chạy toàn màn hình, offline) |
| **Máy tính / trình duyệt** | Mở `index.html`, hoặc bật GitHub Pages rồi vào link |

## Nội dung repo

```
index.html              game (một file, chạy offline)
manifest.webmanifest    PWA: cài lên màn hình chính, chạy fullscreen
sw.js                   service worker: cache offline
icons/                  bộ icon 48 → 1024 px
dist/OneLine-1.1.apk    bản cài Android đã ký sẵn
android/                nguồn app Android (WebView) + build.sh
ios/                    nguồn app iOS (WKWebView) + XcodeGen
.github/workflows/      CI build APK (Ubuntu) và IPA chưa ký (macOS)
```

## Android

APK có sẵn ở `dist/`. Thông số: `vn.lupin.oneline`, minSdk 24 (Android 7+),
targetSdk 29, ký theo APK Signature Scheme v2, không xin quyền nào.

Build lại — **không cần Android Studio hay Android SDK**, chỉ cần JDK 11+, curl, zip:

```bash
bash android/build.sh        # -> dist/OneLine-1.1.apk
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
