// Cấu hình GIẢ, chỉ dùng cho test trên máy ảo Android / iOS Simulator: bật nút đăng nhập để kiểm tra cầu nối
// giữa app và trình duyệt hệ thống (tests/android/login.sh, ios/UITests/OneLineLoginUITests.swift).
// Không trỏ tới dự án Firebase nào và KHÔNG BAO GIỜ được đóng gói vào bản phát hành
// (tests/android/verify-apk.sh và ios/build-ipa.sh đều so tệp cấu hình trong bộ cài với bản của repo).
window.FIREBASE_CONFIG = {
  apiKey: 'test-only',
  authDomain: 'oneline-test.invalid',
  projectId: 'oneline-test',
  appId: 'test-only'
};
