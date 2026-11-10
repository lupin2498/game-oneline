'use strict';
// Trang cầu nối login.html (app native mở bằng trình duyệt hệ thống): kiểm tham số, chống lấy cắp token,
// và (khi máy test ra được apis.google.com) chạy trọn luồng đăng nhập thật với Firebase Auth Emulator.
const H = require('../lib/harness');

H.main('Cầu nối đăng nhập', async function (t, cleanup) {
  await H.resetEmulators();
  const srv = await H.serve({ config: 'emulator' }); cleanup.push(srv.close);
  const browser = await H.launch(); cleanup.push(function () { return browser.close(); });
  const ST = '0123456789abcdef0123456789abcdef', RET = '&return=' + encodeURIComponent('vn.lupin.oneline://auth');
  const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
  const CHROME = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
  const FIREFOX = 'Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0';

  // Giả kết quả Firebase để kiểm riêng phần dựng đường dẫn trả về
  async function bridge(qs, ua, result) {
    const ctx = await browser.newContext({ userAgent: ua }); const pg = await ctx.newPage(); const errs = [];
    pg.on('pageerror', function (e) { errs.push(e.message); });
    await pg.addInitScript(function (r) {
      var o; Object.defineProperty(window, 'Online', { configurable: true, get: function () { return o; },
        set: function (v) { o = v; if (r) o.bridge = function () { return Promise.resolve(r); }; } });
    }, result);
    // Trang tự chuyển sang scheme riêng của app nên sự kiện "load" không bao giờ tới: chỉ chờ tới lúc trang đổi lời nhắn
    await pg.goto(srv.url + '/login.html' + qs, { waitUntil: 'commit' }).catch(function () {});
    await pg.waitForFunction(function () { var m = document.getElementById('msg'); return !!m && m.textContent !== 'Đang mở trang đăng nhập…'; }, null, { timeout: 15000 }).catch(function () {});
    await pg.waitForTimeout(400);
    const out = { msg: await pg.locator('#msg').innerText().catch(function () { return ''; }), href: await pg.locator('#back').getAttribute('href').catch(function () { return null; }), errs: errs };
    await ctx.close(); return out;
  }
  const tok = { provider: 'google', idToken: 'eyJ+a/b=c', accessToken: 'ya29.x' };
  let r = await bridge('?provider=google&state=' + ST + RET, IOS, tok);
  t.ok('LB1 iOS: trả về vn.lupin.oneline://auth kèm token + state, mã hoá đúng', r.href === 'vn.lupin.oneline://auth?provider=google&idToken=eyJ%2Ba%2Fb%3Dc&accessToken=ya29.x&state=' + ST, r.href);
  r = await bridge('?provider=google&state=' + ST + RET, CHROME, tok);
  t.ok('LB2 Chrome Android: dùng intent:// chỉ đích danh gói của game', r.href === 'intent://auth?provider=google&idToken=eyJ%2Ba%2Fb%3Dc&accessToken=ya29.x&state=' + ST + '#Intent;scheme=vn.lupin.oneline;package=vn.lupin.oneline;end', r.href);
  r = await bridge('?provider=facebook&state=' + ST + RET, FIREFOX, { provider: 'facebook', idToken: '', accessToken: 'EAAB' });
  t.ok('LB3 Firefox Android (không hỗ trợ intent://): dùng scheme riêng của app', r.href === 'vn.lupin.oneline://auth?provider=facebook&idToken=&accessToken=EAAB&state=' + ST, r.href);
  r = await bridge('?provider=google&state=' + ST + '&return=' + encodeURIComponent('https://evil.example/steal'), IOS, tok);
  t.ok('LB4 Địa chỉ trả về lạ (định lấy cắp token) -> chặn, không gửi token đi', /không hợp lệ/.test(r.msg) && r.href === '#', r.msg + ' | ' + r.href);
  r = await bridge('?provider=google&state=' + ST + '&return=' + encodeURIComponent('vn.lupin.oneline://auth.evil'), IOS, tok);
  t.ok('LB5 Địa chỉ trả về gần giống (auth.evil) -> chặn', /không hợp lệ/.test(r.msg) && r.href === '#');
  r = await bridge('?provider=google&state=abc' + RET, IOS, tok);
  t.ok('LB6 Thiếu/sai mã phiên -> chặn', /Thiếu mã phiên/.test(r.msg), r.msg);
  r = await bridge('?provider=twitter&state=' + ST + RET, IOS, tok);
  t.ok('LB7 Nhà cung cấp lạ -> chặn', /không hợp lệ/.test(r.msg), r.msg);
  r = await bridge('?provider=facebook&state=' + ST + RET, IOS, { error: 'cancelled' });
  t.ok('LB8 Huỷ đăng nhập -> trả error=cancelled về app', r.href === 'vn.lupin.oneline://auth?error=cancelled&state=' + ST, r.href);
  t.ok('LB9 Không lỗi JS trên trang cầu nối', r.errs.length === 0, r.errs.join('|'));

  // ---- Luồng thật: login.html -> trang chọn tài khoản của Auth Emulator -> quay lại -> token -> app ----
  const reach = await fetch('https://apis.google.com/js/api.js', { method: 'HEAD' }).then(function (x) { return x.ok; }, function () { return false; });
  if (!reach) {
    console.log('SKIP  LB10-12 Luồng đăng nhập thật qua trình duyệt: máy test không ra được apis.google.com (chạy trên CI)');
    return;
  }
  const ctx = await browser.newContext({ userAgent: IOS, viewport: { width: 393, height: 852 } });
  const bp = await ctx.newPage();
  await bp.goto(srv.url + '/login.html?provider=google&state=' + ST + RET);
  await bp.waitForURL(/emulator\/auth\/handler/, { timeout: 20000 });
  await bp.waitForSelector('#add-account-button', { timeout: 15000 });
  await bp.click('#add-account-button');
  await bp.click('#autogen-button');
  await bp.fill('#display-name-input', 'Người Dùng Cầu Nối');
  let target = null;
  bp.on('request', function (q) { if (/^vn\.lupin\.oneline:/.test(q.url())) target = q.url(); });
  await bp.click('#sign-in');
  await bp.waitForURL(/login\.html/, { timeout: 20000 }).catch(function () {});
  await bp.waitForFunction(function () { var b = document.getElementById('back'); return b && b.getAttribute('href') !== '#'; }, null, { timeout: 20000 });
  const href = await bp.locator('#back').getAttribute('href');
  const q = new URLSearchParams(href.split('?')[1]);
  t.ok('LB10 Luồng thật: đăng nhập xong, trang cầu nối tạo đường dẫn về app kèm token', /^vn\.lupin\.oneline:\/\/auth\?/.test(href) && q.get('provider') === 'google' && q.get('state') === ST && (q.get('idToken') || '').length > 20, href.slice(0, 80) + '…');
  const left = await bp.evaluate(function () { return Online.state().user; }).catch(function () { return 'n/a'; });
  t.ok('LB11 Trang cầu nối không giữ phiên đăng nhập trong trình duyệt', left === null || left === 'n/a', JSON.stringify(left));
  // App nhận đường dẫn đó
  const AND_UA = CHROME + ' OneLineApp/Android';
  const app = await H.newPage(browser, srv.url + '/index.html', { ua: AND_UA });
  await app.waitForFunction(function () { return window.Online && Online.state().ready; });
  await app.evaluate(function (a) { localStorage.setItem('oneline.authState', a.st); window.OneLineNativeLogin(a.href); }, { st: ST, href: href });
  await app.waitForFunction(function () { return !!Online.state().user; }, null, { timeout: 10000 }).catch(function () {});
  const u = await app.evaluate(function () { return Online.state().user; });
  t.ok('LB12 App đổi token lấy phiên đăng nhập: đúng người dùng', !!u && u.name === 'Người Dùng Cầu Nối' && u.provider === 'google.com', JSON.stringify(u));
  await ctx.close();
});
