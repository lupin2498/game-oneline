import UIKit
import WebKit
import AuthenticationServices

/// Vỏ WKWebView toàn màn hình cho game Đường Kẻ Một Nét (thư mục www).
///
/// Đăng nhập Google/Facebook: hai nhà cung cấp này chặn đăng nhập trong WKWebView, nên game gửi
/// `webkit.messageHandlers.oneline.postMessage({type:"login", url})` -> app mở trang đăng nhập bằng
/// ASWebAuthenticationSession; kết quả `vn.lupin.oneline://auth?...` được giao lại cho
/// `window.OneLineNativeLogin` trong game.
final class GameViewController: UIViewController, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate,
                                ASWebAuthenticationPresentationContextProviding {

    private static let callbackScheme = "vn.lupin.oneline"
    private static let background = UIColor(red: 0x04/255.0, green: 0x06/255.0, blue: 0x0c/255.0, alpha: 1)
    private var web: WKWebView!
    private var authSession: ASWebAuthenticationSession?
    private var authSeq = 0                      // số thứ tự phiên đăng nhập đang chờ

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = Self.background

        let cfg = WKWebViewConfiguration()
        cfg.allowsInlineMediaPlayback = true
        cfg.applicationNameForUserAgent = "OneLineApp/iOS"
        cfg.userContentController.add(WeakScriptHandler(self), name: "oneline")
        if #available(iOS 14.0, *) {
            cfg.defaultWebpagePreferences.allowsContentJavaScript = true
        }
        if #available(iOS 14.5, *) {
            // Trò chơi dựa vào việc GIỮ ngón tay: tắt hẳn chọn chữ / kính lúp của hệ thống
            cfg.preferences.isTextInteractionEnabled = false
        }

        web = WKWebView(frame: .zero, configuration: cfg)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.isOpaque = false
        web.backgroundColor = Self.background
        web.scrollView.backgroundColor = Self.background
        web.scrollView.isScrollEnabled = false
        web.scrollView.bounces = false
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.allowsLinkPreview = false                    // giữ lâu trên link không bật xem trước
        web.allowsBackForwardNavigationGestures = false
        web.translatesAutoresizingMaskIntoConstraints = false
        #if DEBUG
        if #available(iOS 16.4, *) { web.isInspectable = true }
        #endif
        view.addSubview(web)

        NSLayoutConstraint.activate([
            web.topAnchor.constraint(equalTo: view.topAnchor),
            web.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            web.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: view.trailingAnchor)
        ])
        loadGame()
    }

    private func loadGame() {
        if let url = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "www") {
            web.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        } else {
            let label = UILabel()
            label.text = "Thiếu thư mục www — chạy ios/prepare.sh"
            label.textColor = .white
            label.textAlignment = .center
            label.numberOfLines = 0
            label.frame = view.bounds
            label.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            view.addSubview(label)
        }
    }

    deinit {
        web?.configuration.userContentController.removeScriptMessageHandler(forName: "oneline")
    }

    // MARK: - Điều hướng: trang của game mở trong app, link ngoài mở bằng Safari

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        let scheme = (url.scheme ?? "").lowercased()
        if url.isFileURL || scheme == "about" || scheme == "blob" || scheme == "data" {
            decisionHandler(.allow)
            return
        }
        let mainFrame = navigationAction.targetFrame?.isMainFrame ?? true
        if mainFrame {
            if scheme == "http" || scheme == "https" || scheme == "mailto" {
                UIApplication.shared.open(url, options: [:], completionHandler: nil)
            }
            decisionHandler(.cancel)      // không bao giờ tải trang ngoài vào khung game (không có nút quay lại)
            return
        }
        decisionHandler(.allow)
    }

    /// Trang game không cuộn (mọi cử chỉ dành cho game); các trang khác trong app (quyền riêng tư) dài hơn màn hình
    /// nên phải cuộn được bằng ngón tay — nếu không người chơi không tới được nút "Về game" ở cuối trang.
    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        let isGame = webView.url?.lastPathComponent == "index.html"
        webView.scrollView.isScrollEnabled = !isGame
        if isGame { webView.scrollView.setContentOffset(.zero, animated: false) }
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, ["http", "https"].contains((url.scheme ?? "").lowercased()) {
            UIApplication.shared.open(url, options: [:], completionHandler: nil)   // target=_blank / window.open
        }
        return nil
    }

    /// iOS thu hồi tiến trình web khi thiếu bộ nhớ lúc app chạy nền: nạp lại để không còn màn hình trống.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        loadGame()
    }

    // MARK: - Đăng nhập qua trình duyệt an toàn của hệ thống

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "oneline",
              let body = message.body as? [String: Any],
              body["type"] as? String == "login" else { return }
        guard let raw = body["url"] as? String,
              let url = URL(string: raw), url.scheme == "https" else {
            deliver("\(Self.callbackScheme)://auth?error=failed")   // báo ngay để nút đăng nhập không kẹt ở trạng thái chờ
            return
        }
        startLogin(url)
    }

    private func startLogin(_ url: URL) {
        authSession?.cancel()
        authSeq += 1
        let seq = authSeq
        let session = ASWebAuthenticationSession(url: url, callbackURLScheme: Self.callbackScheme) { [weak self] callback, error in
            DispatchQueue.main.async {
                // Phiên đã bị phiên mới thay thế: bỏ qua, kẻo kết quả "huỷ" của phiên cũ xoá mất phiên đang chờ
                guard let self = self, seq == self.authSeq else { return }
                if let callback = callback {
                    self.deliver(callback.absoluteString)
                } else {
                    let cancelled = (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin
                    self.deliver("\(Self.callbackScheme)://auth?error=\(cancelled ? "cancelled" : "failed")")
                }
                self.authSession = nil
            }
        }
        session.presentationContextProvider = self
        authSession = session
        if !session.start() {
            authSession = nil
            deliver("\(Self.callbackScheme)://auth?error=failed")
        }
    }

    private func deliver(_ uri: String) {
        guard let data = try? JSONSerialization.data(withJSONObject: [uri]),
              let json = String(data: data, encoding: .utf8) else { return }
        web.evaluateJavaScript("window.OneLineNativeLogin && window.OneLineNativeLogin(\(json)[0])",
                               completionHandler: nil)
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        return view.window ?? ASPresentationAnchor()
    }

    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .portrait }
}

/// WKUserContentController giữ handler bằng tham chiếu mạnh -> dùng lớp trung gian để tránh vòng giữ.
private final class WeakScriptHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
        target?.userContentController(c, didReceive: m)
    }
}
