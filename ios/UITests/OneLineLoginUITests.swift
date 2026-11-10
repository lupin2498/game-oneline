import XCTest

/// Cầu nối đăng nhập của app iOS. Chạy với bản build dùng cấu hình Firebase GIẢ
/// (tests/fixtures/firebase-config.login-test.js, xem tests/ios/run-ui-tests.sh) để nút Google/Facebook hiện ra:
/// bấm nút -> app phải mở phiên đăng nhập của hệ thống (ASWebAuthenticationSession); người chơi huỷ thì game
/// trở lại bình thường và bấm lại được.
final class OneLineLoginUITests: XCTestCase {

    private var app: XCUIApplication!
    private let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")

    override func setUp() {
        continueAfterFailure = true
        app = XCUIApplication()
        app.launch()
    }

    private func shot(_ name: String) {
        let s = XCUIScreen.main.screenshot()
        let a = XCTAttachment(screenshot: s)
        a.name = name
        a.lifetime = .keepAlways
        add(a)
        if let dir = ProcessInfo.processInfo.environment["SHOT_DIR"], !dir.isEmpty {
            try? s.pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent(name + ".png"))
        }
    }

    private func el(_ label: String) -> XCUIElement {
        return app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", label)).firstMatch
    }

    private func elContaining(_ text: String) -> XCUIElement {
        return app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS[c] %@", text)).firstMatch
    }

    /// Nút trên hộp thoại của hệ thống ("… Wants to Use … to Sign In" do SpringBoard hiện) hoặc trên trang đăng nhập.
    private func button(_ labels: [String], in hosts: [XCUIApplication], timeout: TimeInterval) -> XCUIElement? {
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            for host in hosts {
                for label in labels {
                    let b = host.buttons.matching(identifier: label).firstMatch
                    if b.exists { return b }
                }
            }
            usleep(300_000)
        } while Date() < deadline
        return nil
    }

    private func waitEnabled(_ e: XCUIElement, _ timeout: TimeInterval) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            if e.exists && e.isEnabled { return true }
            usleep(300_000)
        } while Date() < deadline
        return false
    }

    func test01_loginOpensSystemSessionAndCancelRecovers() throws {
        let google = el("Google")
        // tests/ios/run-ui-tests.sh đặt LOGIN_TEST=1 cho lượt dùng cấu hình test: khi đó thiếu nút đăng nhập là lỗi.
        // Chạy tay với app chưa cấu hình Firebase (firebase-config.js để null) thì bỏ qua bài này.
        let required = ProcessInfo.processInfo.environment["LOGIN_TEST"] == "1"
        if !google.waitForExistence(timeout: required ? 90 : 30) {
            if !required { throw XCTSkip("app chưa cấu hình đăng nhập: bỏ qua test cầu nối đăng nhập") }
            XCTFail("không thấy nút Google: lượt này phải dùng bản build với cấu hình test (ONELINE_CONFIG_JS)")
            return
        }
        XCTAssertTrue(elContaining("Đăng nhập để lưu điểm").waitForExistence(timeout: 10), "chưa đăng nhập: phải có lời mời đăng nhập")
        shot("10-login-buttons")

        // 1) Bấm Google -> iOS xin phép mở phiên đăng nhập tới đúng tên miền của trang login.html
        google.tap()
        guard let cancel = button(["Cancel"], in: [springboard], timeout: 20) else {
            shot("11-login-no-consent")
            XCTFail("bấm Google: iOS phải hiện hộp thoại xin mở phiên đăng nhập (ASWebAuthenticationSession)\n\(springboard.debugDescription)")
            return
        }
        shot("11-login-consent")
        let domain = springboard.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS[c] %@", "oneline-test.invalid")).firstMatch
        XCTAssertTrue(domain.exists, "hộp thoại phải nêu đúng tên miền của trang đăng nhập")

        // 2) Huỷ -> game nhận kết quả "cancelled": không báo lỗi, nút bấm lại được
        cancel.tap()
        XCTAssertTrue(waitEnabled(google, 15), "huỷ đăng nhập: nút Google phải bấm lại được")
        XCTAssertTrue(elContaining("Đăng nhập để lưu điểm").waitForExistence(timeout: 5), "huỷ đăng nhập: phải trở lại lời mời ban đầu")
        XCTAssertFalse(elContaining("không thành công").exists, "người chơi tự huỷ thì không được báo lỗi")

        // 3) Bấm Facebook: phiên mới mở được (phiên cũ đã dọn sạch); đồng ý -> trang đăng nhập mở ngay trong app
        let facebook = el("Facebook")
        XCTAssertTrue(facebook.exists, "không thấy nút Facebook")
        facebook.tap()
        guard let go = button(["Continue"], in: [springboard], timeout: 20) else {
            shot("12-login-no-consent")
            XCTFail("bấm Facebook sau khi huỷ: phải mở được phiên đăng nhập mới\n\(springboard.debugDescription)")
            return
        }
        go.tap()
        sleep(4)
        shot("12-login-sheet")
        XCTAssertTrue(app.state == .runningForeground, "mở trang đăng nhập xong app phải còn chạy (trạng thái: \(app.state.rawValue))")

        // 4) Đóng trang đăng nhập -> game trở lại bình thường. Nút đóng do Safari của hệ thống vẽ (tên khác nhau
        //    giữa các bản iOS) nên nếu không tìm thấy thì chỉ ghi chú, không tính là lỗi của game.
        let safariService = XCUIApplication(bundleIdentifier: "com.apple.SafariViewService")
        if let close = button(["Cancel", "Done", "Close"], in: [app, safariService], timeout: 10) {
            close.tap()
            XCTAssertTrue(waitEnabled(google, 15), "đóng trang đăng nhập: nút Google phải bấm lại được")
            XCTAssertFalse(elContaining("không thành công").exists, "đóng trang đăng nhập không được báo lỗi")
            shot("13-login-closed")
        } else {
            print("ĐĂNG NHẬP: không tìm thấy nút đóng trang đăng nhập của hệ thống, bỏ qua bước 4")
        }
    }
}
