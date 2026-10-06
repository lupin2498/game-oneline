import UIKit
import WebKit
import AuthenticationServices

/// Vỏ WKWebView toàn màn hình cho game Đường Kẻ Một Nét (thư mục www).
///
/// Đăng nhập Google/Facebook: hai nhà cung cấp này chặn đăng nhập trong WKWebView, nên game gửi
/// `webkit.messageHandlers.oneline.postMessage({type:"login", url})` -> app mở trang đăng nhập bằng
/// ASWebAuthenticationSession; kết quả `vn.lupin.oneline://auth?...` được giao lại cho
/// `window.OneLineNativeLogin` trong game.
final class GameViewController: UIViewController, WKScriptMessageHandler,
                                ASWebAuthenticationPresentationContextProviding {

    private static let callbackScheme = "vn.lupin.oneline"
    private var web: WKWebView!
    private var authSession: ASWebAuthenticationSession?

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0x04/255.0, green: 0x06/255.0, blue: 0x0c/255.0, alpha: 1)

        let cfg = WKWebViewConfiguration()
        cfg.allowsInlineMediaPlayback = true
        cfg.applicationNameForUserAgent = "OneLineApp/iOS"
        cfg.userContentController.add(WeakScriptHandler(self), name: "oneline")
        if #available(iOS 14.0, *) {
            cfg.defaultWebpagePreferences.allowsContentJavaScript = true
        }

        web = WKWebView(frame: .zero, configuration: cfg)
        web.isOpaque = false
        web.backgroundColor = .clear
        web.scrollView.isScrollEnabled = false
        web.scrollView.bounces = false
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.translatesAutoresizingMaskIntoConstraints = false
        if #available(iOS 16.4, *) { web.isInspectable = true }
        view.addSubview(web)

        NSLayoutConstraint.activate([
            web.topAnchor.constraint(equalTo: view.topAnchor),
            web.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            web.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: view.trailingAnchor)
        ])

        if let url = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "www") {
            web.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        } else {
            let label = UILabel()
            label.text = "Thiếu thư mục www — chạy ios/prepare.sh"
            label.textColor = .white
            label.textAlignment = .center
            label.numberOfLines = 0
            label.frame = view.bounds
            view.addSubview(label)
        }
    }

    deinit {
        web?.configuration.userContentController.removeScriptMessageHandler(forName: "oneline")
    }

    // MARK: - Đăng nhập qua trình duyệt an toàn của hệ thống

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "oneline",
              let body = message.body as? [String: Any],
              body["type"] as? String == "login",
              let raw = body["url"] as? String,
              let url = URL(string: raw), url.scheme == "https" else { return }
        startLogin(url)
    }

    private func startLogin(_ url: URL) {
        authSession?.cancel()
        let session = ASWebAuthenticationSession(url: url, callbackURLScheme: Self.callbackScheme) { [weak self] callback, error in
            DispatchQueue.main.async {
                guard let self = self else { return }
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
