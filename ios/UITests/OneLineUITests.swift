import XCTest

/// UI test trên iOS Simulator: thao tác cảm ứng THẬT (bấm, giữ, kéo) lên game chạy trong WKWebView.
/// Chạy:  xcodebuild test -project ios/OneLine.xcodeproj -scheme OneLine -destination 'platform=iOS Simulator,name=iPhone 16'
/// Ảnh chụp từng bước được ghi vào thư mục $SHOT_DIR (truyền qua TEST_RUNNER_SHOT_DIR) và đính kèm kết quả test.
final class OneLineUITests: XCTestCase {

    private var app: XCUIApplication!
    private var origin = CGPoint.zero          // góc trên-trái khung chơi so với web view (point)
    private var size = CGSize.zero             // kích thước khung chơi (point)

    override func setUp() {
        continueAfterFailure = true
        app = XCUIApplication()
        app.launch()
    }

    // MARK: - tiện ích

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

    /// Các số "N m" đang hiện (HUD + màn thua)
    private func meters() -> [Int] {
        let q = app.descendants(matching: .staticText).matching(NSPredicate(format: "label MATCHES %@", "^[0-9]+ m$"))
        return q.allElementsBoundByIndex.compactMap { Int($0.label.dropLast(2)) }
    }

    /// Tìm vị trí khung chơi 480x760 trong web view. Khung rộng = min(rộng, cao*480/760) và nằm giữa VÙNG AN TOÀN
    /// (trừ tai thỏ / thanh home), nên lấy mốc thật từ nhãn HUD "Quãng đường": trong bố cục gốc rộng 400,
    /// nhãn này cách mép trái khung 25 và cách mép trên 19.
    private func calibrate() {
        let web = app.webViews.firstMatch
        let f = web.frame
        let w = min(f.width, f.height * 480 / 760).rounded(.down)
        var left = (f.width - w) / 2
        var top = (f.height - w * 760 / 480) / 2
        let chip = app.descendants(matching: .staticText).matching(NSPredicate(format: "label ==[c] %@", "Quãng đường")).firstMatch
        if chip.waitForExistence(timeout: 5) {
            let s = w / 400
            left = chip.frame.minX - f.minX - 25 * s
            top = chip.frame.minY - f.minY - 19 * s
        } else {
            print("KHUNG CHƠI: không thấy nhãn HUD, giả định khung nằm chính giữa web view")
        }
        origin = CGPoint(x: max(0, left), y: max(0, top))
        size = CGSize(width: w, height: w * 760 / 480)
        print("KHUNG CHƠI: web \(f), khung tại \(origin) cỡ \(size)")
    }

    /// Toạ độ game (480x760) -> điểm chạm trên màn hình
    private func pt(_ gx: CGFloat, _ gy: CGFloat) -> XCUICoordinate {
        let web = app.webViews.firstMatch
        return web.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: origin.x + gx / 480 * size.width, dy: origin.y + gy / 760 * size.height))
    }

    /// Vuốt lên bằng cử chỉ thật (như ngón tay người chơi) cho tới khi phần tử nằm trong màn hình
    private func swipeUntilHittable(_ e: XCUIElement, limit: Int = 8) {
        var n = 0
        while !e.isHittable && n < limit {
            app.swipeUp()
            n += 1
        }
    }

    private func startGame(_ button: String) {
        let b = el(button)
        XCTAssertTrue(b.waitForExistence(timeout: 20), "không thấy nút \(button)")
        b.tap()
        // bảng biến mất nghĩa là game đang chờ người chơi giữ vòng sáng / nút tròn
        let gone = NSPredicate(format: "exists == false")
        expectation(for: gone, evaluatedWith: b, handler: nil)
        waitForExpectations(timeout: 10, handler: nil)
    }

    // MARK: - bài test

    func test01_holdDragAndLift() {
        XCTAssertTrue(el("Bắt đầu").waitForExistence(timeout: 90), "game không khởi động trong WKWebView")
        shot("01-start")
        calibrate()

        // 1) Giữ yên 2 giây (quá ngưỡng giữ-lâu của iOS) RỒI kéo sang phải: nếu iOS cắt ngang cú chạm thì
        //    game báo "Nhấc tay rồi!"; cú chạm còn sống thì nhân vật đi theo và "Chạm tường!"
        startGame("Bắt đầu")
        shot("02-ready")
        pt(240, 680).press(forDuration: 2.0, thenDragTo: pt(385, 680))
        XCTAssertTrue(el("Chạm tường!").waitForExistence(timeout: 8),
                      "giữ 2 giây rồi kéo nút tròn: mong đợi Chạm tường! — iOS đã cắt ngang cú chạm? (tiêu đề hiện: \(el("Nhấc tay rồi!").exists ? "Nhấc tay rồi!" : "?"))")
        XCTAssertGreaterThanOrEqual(meters().max() ?? 0, 3, "giữ 2 giây mà quãng đường quá ngắn")
        shot("03-over-wall-stick")

        // 2) Giữ rồi nhấc tay, không kéo
        startGame("Chơi lại")
        pt(240, 680).press(forDuration: 1.0)
        XCTAssertTrue(el("Nhấc tay rồi!").waitForExistence(timeout: 8), "nhấc tay khỏi nút tròn phải thua")
        shot("04-over-lift")

        // 3) Kiểu kéo trực tiếp từ vòng sáng
        startGame("Chơi lại")
        pt(240, 501.6).press(forDuration: 0.6, thenDragTo: pt(385, 501.6))
        XCTAssertTrue(el("Chạm tường!").waitForExistence(timeout: 8), "kéo từ vòng sáng: nhân vật phải đi theo ngón tay")
        shot("05-over-wall-drag")

        // 4) Bảng xếp hạng trên máy
        el("Bảng xếp hạng").tap()
        XCTAssertTrue(el("Kỷ lục trên máy này").waitForExistence(timeout: 8))
        XCTAssertGreaterThanOrEqual(meters().count, 3, "bảng xếp hạng phải liệt kê các lượt vừa chơi")
        shot("06-board")

        // 5) Trang quyền riêng tư mở ngay trong app, CUỘN ĐƯỢC BẰNG NGÓN TAY (trang dài hơn màn hình) và quay về được
        el("Quyền riêng tư").tap()
        XCTAssertTrue(elContaining("Chính sách quyền riêng tư").waitForExistence(timeout: 10), "trang quyền riêng tư không mở")
        shot("07-privacy")
        let external = elContaining("myaccount.google.com")
        if external.waitForExistence(timeout: 5) {
            swipeUntilHittable(external)
            XCTAssertTrue(external.isHittable, "vuốt lên phải cuộn được trang quyền riêng tư tới link ở gần cuối trang")
            shot("07b-privacy-scrolled")
            external.tap()
            let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
            XCTAssertTrue(safari.wait(for: .runningForeground, timeout: 40), "link ngoài phải mở bằng Safari, không mở trong khung game")
            app.activate()
            XCTAssertTrue(elContaining("Chính sách quyền riêng tư").waitForExistence(timeout: 10), "quay lại app: trang riêng tư vẫn còn")
        } else {
            XCTFail("không thấy link ngoài trong trang quyền riêng tư")
        }
        // nút "Về game" ở cuối trang: phải vuốt tới được rồi bấm
        let backs = app.links.matching(NSPredicate(format: "label CONTAINS[c] %@", "Về game"))
        XCTAssertGreaterThanOrEqual(backs.count, 2, "trang quyền riêng tư phải có nút Về game ở cả đầu và cuối trang")
        let back = backs.element(boundBy: max(0, backs.count - 1))
        swipeUntilHittable(back)
        XCTAssertTrue(back.isHittable, "vuốt lên phải tới được nút Về game ở cuối trang")
        back.tap()
        XCTAssertTrue(el("Bắt đầu").waitForExistence(timeout: 15), "bấm Về game phải trở lại màn mở đầu")
    }

    func test02_bestScoreSurvivesRelaunch() {
        XCTAssertTrue(el("Bắt đầu").waitForExistence(timeout: 90))
        calibrate()
        startGame("Bắt đầu")
        pt(240, 680).press(forDuration: 1.5)
        XCTAssertTrue(el("Nhấc tay rồi!").waitForExistence(timeout: 8))
        let best = meters().max() ?? 0
        XCTAssertGreaterThan(best, 0, "lượt 1,5 giây phải đi được vài mét")

        app.terminate()
        app.launch()
        XCTAssertTrue(el("Bắt đầu").waitForExistence(timeout: 60))
        let after = meters().max() ?? 0
        XCTAssertGreaterThanOrEqual(after, best, "mở lại app phải còn kỷ lục (trước: \(best) m, sau: \(after) m)")
        shot("08-relaunch")
    }

    func test03_backgroundEndsRun() {
        XCTAssertTrue(el("Bắt đầu").waitForExistence(timeout: 90))
        // App chuyển nền rồi quay lại: không treo, không trắng màn hình
        XCUIDevice.shared.press(.home)
        sleep(2)
        app.activate()
        XCTAssertTrue(el("Bắt đầu").waitForExistence(timeout: 20), "quay lại từ màn hình chính: game phải còn nguyên")
        shot("09-after-background")
    }
}
