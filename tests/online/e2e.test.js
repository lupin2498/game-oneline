'use strict';
// E2E trên Firebase Emulator: đăng nhập (luồng app native), lưu điểm, bảng xếp hạng, xoá dữ liệu + tài khoản, lỗi mạng, XSS.
const H = require('../lib/harness');

const AND_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36 OneLineApp/Android';
const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 OneLineApp/iOS';
const fakeG = function (sub, name, pic) { return JSON.stringify({ sub: sub, email: sub + '@ex.com', email_verified: true, name: name, picture: pic }); };
const fakeF = function (sub, name) { return JSON.stringify({ sub: sub, name: name }); };

async function authUsers() {
  const r = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/demo-oneline/accounts:query', {
    method: 'POST', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ returnUserInfo: true }) });
  return ((await r.json()).userInfo || []).map(function (u) { return u.displayName; });
}
async function adminScore(id, name, best) {       // ghi thẳng vào Firestore Emulator, bỏ qua luật (để dựng dữ liệu)
  await fetch('http://127.0.0.1:8089/v1/projects/demo-oneline/databases/(default)/documents/scores/' + id, {
    method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { name: { stringValue: name }, photo: { stringValue: '' }, provider: { stringValue: 'google.com' },
      best: { integerValue: String(best) }, updatedAt: { timestampValue: new Date(Date.now() - 60000).toISOString() } } }) });
}

H.main('Online E2E', async function (t, cleanup) {
  await H.resetEmulators();
  const srv = await H.serve({ config: 'emulator' }); cleanup.push(srv.close);
  const browser = await H.launch(); cleanup.push(function () { return browser.close(); });
  const BASE = srv.url;
  const open = async function (ua, url, extra) {
    const pg = await H.newPage(browser, url || BASE + '/index.html', Object.assign({ ua: ua, touch: true }, extra || {}));
    await pg.waitForFunction(function () { return window.Online && Online.state().ready; });
    return pg;
  };
  const st = function (pg) { return pg.evaluate(function () { return Online.state(); }); };
  // Đăng nhập kiểu app native: bấm nút -> bắt URL mở trình duyệt -> giả lập trình duyệt trả kết quả về app
  const nativeLogin = async function (pg, provider, token, opt) {
    opt = opt || {};
    await pg.evaluate(function () { window.__opened = null; Online._openNative = function (u) { window.__opened = u; }; });
    await pg.click((opt.from || '#logins1') + ' [data-login=' + provider + ']');
    const opened = await pg.evaluate(function () { return window.__opened; });
    if (opt.noReturn) return opened;
    const state = new URL(opened).searchParams.get('state');
    const p = new URLSearchParams({ provider: provider, state: opt.badState ? '0'.repeat(32) : state });
    if (opt.cancel) { p.delete('provider'); p.set('error', 'cancelled'); }
    else if (provider === 'google') p.set('idToken', token); else p.set('accessToken', token);
    await pg.evaluate(function (u) { window.OneLineNativeLogin(u); }, 'vn.lupin.oneline://auth?' + p.toString());
    if (!opt.cancel && !opt.badState) await pg.waitForFunction(function () { return !!Online.state().user; }, null, { timeout: 8000 }).catch(function () {});
    else await pg.waitForTimeout(300);
    return opened;
  };
  const finishRun = async function (pg, meters, waitSave) {
    await pg.evaluate(function (m) {
      var d = window.__dbg;
      ['pStart', 'pOver', 'pBoard'].forEach(function (id) { document.getElementById(id).classList.add('hide'); });
      d.run('reset()'); d.run("state='run'; dist=" + (m * 22 + 1)); d.run("lose('wall')");
    }, meters);
    if (waitSave !== false) await pg.waitForFunction(function () { return !/Đang lưu/.test(document.getElementById('oNet').textContent); }, null, { timeout: 12000 }).catch(function () {});
    await pg.waitForTimeout(350);
    return pg.locator('#oNet').innerText();
  };
  const board = async function (pg) {
    await pg.evaluate(function () { document.getElementById(document.getElementById('pOver').classList.contains('hide') ? 'bBoard1' : 'bBoard2').click(); });
    await pg.waitForFunction(function () { return !/Đang tải/.test(document.getElementById('bdList').textContent); }, null, { timeout: 8000 });
    await pg.waitForTimeout(500);
    const rows = await pg.$$eval('#bdList li', function (ls) { return ls.map(function (l) { return { t: l.innerText.replace(/\s+/g, ' ').trim(), me: l.classList.contains('me') }; }); });
    const me = await pg.locator('#bdMe').innerText();
    return { rows: rows, me: me };
  };
  const closeBoard = function (pg) { return pg.evaluate(function () { document.getElementById('bClose').click(); }); };

  // ---------- A. Google qua luồng app Android ----------
  const p1 = await open(AND_UA);
  t.ok('A01 Đã cấu hình, chưa đăng nhập: hiện nút Google + Facebook và lời nhắc công khai',
    await p1.locator('#logins1 [data-login=google]').isVisible() && await p1.locator('#logins1 [data-login=facebook]').isVisible() &&
    /hiện công khai/.test(await p1.locator('#acctNote').innerText()));
  t.ok('A02 Log khởi động ghi online=on', p1._logs.some(function (l) { return /online=on/.test(l); }), p1._logs.join('|'));
  const opened = await nativeLogin(p1, 'google', fakeG('e2e-an', 'Nguyễn Văn An', 'https://lh3.googleusercontent.com/a/x'));
  t.ok('A03 Bấm Google trong app -> mở trang đăng nhập ngoài, đúng tham số',
    new RegExp('^' + BASE.replace(/[.:/]/g, '\\$&') + '/login\\.html\\?provider=google&state=[0-9a-f]{32}&return=vn\\.lupin\\.oneline%3A%2F%2Fauth$').test(opened), opened);
  let s = await st(p1);
  t.ok('A04 Nhận kết quả từ trình duyệt -> đã đăng nhập', !!s.user && s.user.name === 'Nguyễn Văn An' && s.user.provider === 'google.com' && !s.busy && !s.error, JSON.stringify(s.user));
  t.ok('A05 Hiện tên + Đăng xuất, ẩn nút đăng nhập', await p1.locator('#who').isVisible() && (await p1.locator('#whoName').innerText()) === 'Nguyễn Văn An' && !(await p1.locator('#logins1').isVisible()));
  t.ok('A06 Mã state dùng một lần: đã xoá khỏi máy', (await p1.evaluate(function () { return localStorage.getItem('oneline.authState'); })) === null);

  // ---------- D. lưu điểm ----------
  let net = await finishRun(p1, 137);
  t.ok('D01 Thua ở 137 m -> lưu lên bảng xếp hạng, báo hạng #1', /đã lưu · hạng #1/.test(net), net);
  net = await finishRun(p1, 90);
  t.ok('D02 Lượt thấp hơn không ghi đè kỷ lục', /Kỷ lục trên bảng xếp hạng: 137 m/.test(net), net);
  const t0 = Date.now();
  net = await finishRun(p1, 150);
  t.ok('D03 Kỷ lục mới ngay sau đó vẫn lưu được (tự chờ đủ 3 giây theo luật)', /đã lưu/.test(net), net + ' sau ' + ((Date.now() - t0) / 1000).toFixed(1) + ' giây');

  // ---------- E. người thứ 2: Facebook qua luồng app iOS ----------
  const p2 = await open(IOS_UA);
  await p2.evaluate(function () { window.webkit = { messageHandlers: { oneline: { postMessage: function (m) { window.__ios = m; } } } }; });
  await nativeLogin(p2, 'facebook', fakeF('e2e-binh', 'Trần Bình'));
  s = await st(p2);
  t.ok('E01 Đăng nhập Facebook (luồng app iOS)', !!s.user && s.user.provider === 'facebook.com' && s.native === 'iOS', JSON.stringify(s.user));
  net = await finishRun(p2, 210);
  t.ok('E02 Facebook 210 m -> hạng #1', /hạng #1/.test(net), net);
  let bd = await board(p1);
  t.ok('E03 Bảng xếp hạng đúng thứ tự, đánh dấu dòng của mình', bd.rows.length === 2 && /^1 .*Trần Bình 210 m$/.test(bd.rows[0].t) && /^2 .*Nguyễn Văn An 150 m$/.test(bd.rows[1].t) && bd.rows[1].me && !bd.rows[0].me, JSON.stringify(bd.rows));
  t.ok('E04 Dòng "Bạn: hạng #2 · 150 m"', /hạng #2 · 150 m/.test(bd.me), bd.me);

  // ---------- Q. bảng đang mở tự cập nhật khi có kỷ lục mới ----------
  await p1.evaluate(function () { window.__dbg.run("best=260"); });
  await p1.evaluate(function () { return Online.submit(260).then(function () { return 0; }); }).catch(function () {});
  await p1.evaluate(function () { window.__dbg.run("syncScore(null)"); });
  await p1.waitForTimeout(600);
  // gọi qua đường thật: thua một lượt 260 m khi bảng đang mở là không thể, nên kiểm tra bằng lượt kế tiếp
  await closeBoard(p1);
  bd = await board(p1);
  t.ok('Q01 Sau kỷ lục mới 260 m: lên hạng #1', /^1 .*Nguyễn Văn An 260 m$/.test(bd.rows[0].t) && /hạng #1 · 260 m/.test(bd.me), JSON.stringify(bd.rows.map(function (r) { return r.t; })) + ' | ' + bd.me);
  await closeBoard(p1);

  // ---------- B/C. state sai, huỷ, kẹt "đang đăng nhập" ----------
  const p3 = await open(AND_UA);
  await nativeLogin(p3, 'google', fakeG('e2e-hack', 'Kẻ gian'), { badState: true });
  s = await st(p3);
  t.ok('B01 Kết quả đăng nhập mang state lạ -> từ chối', !s.user && s.error === 'state-mismatch', 'error=' + s.error);
  t.ok('B02 Báo lỗi dễ hiểu cho người chơi', /không khớp/.test(await p3.locator('#acctNote').innerText()));
  await p3.evaluate(function () { window.OneLineNativeLogin('vn.lupin.oneline://auth?provider=google&idToken=x&state=' + 'a'.repeat(32)); });
  await p3.waitForTimeout(200);
  t.ok('B03 Kết quả đăng nhập tự dưng bay tới (không có phiên chờ) -> từ chối', !(await st(p3)).user && (await st(p3)).error === 'state-mismatch');
  await nativeLogin(p3, 'google', '', { cancel: true });
  s = await st(p3);
  t.ok('C01 Người chơi huỷ đăng nhập -> không báo lỗi, nút bấm lại được', !s.user && !s.error && !s.busy && !(await p3.locator('#logins1 [data-login=google]').isDisabled()));
  await nativeLogin(p3, 'google', '', { noReturn: true });
  t.ok('C02 Đang chờ trình duyệt: nút đăng nhập bị khoá, hiện "Đang mở trình duyệt"', (await st(p3)).busy && await p3.locator('#logins1 [data-login=google]').isDisabled() && /Đang mở trình duyệt/.test(await p3.locator('#acctNote').innerText()));
  await p3.click('#logins1 [data-login=facebook]', { force: true }).catch(function () {});
  t.ok('C03 Bấm thêm khi đang chờ không mở phiên thứ hai', (await p3.evaluate(function () { return window.__opened; })).indexOf('provider=google') > 0);
  await p3.evaluate(function () { window.OneLineNativeResume(); });
  await p3.waitForTimeout(3000);
  s = await st(p3);
  t.ok('C04 Quay lại app mà chưa đăng nhập xong (bấm Back ở trình duyệt): tự mở khoá nút sau ~2,5 giây', !s.busy && !s.error && !(await p3.locator('#logins1 [data-login=google]').isDisabled()));
  await p3.evaluate(function () { window.OneLineNativeLogin('vn.lupin.oneline://auth?error=access_denied%3Cscript%3E&state=x'); });
  await p3.waitForTimeout(150);
  const errTxt = await p3.locator('#acctNote').innerText();
  t.ok('C05 Lỗi lạ từ nhà cung cấp hiện dạng chữ, không chạy mã', /access_denied<script>/.test(errTxt) && (await p3.locator('#acctNote script').count()) === 0, errTxt);

  // ---------- N. đăng nhập ngay tại màn thua ----------
  const p4 = await open(AND_UA);
  net = await finishRun(p4, 75, false);
  t.ok('N01 Chưa đăng nhập: màn thua mời đăng nhập, có nút', /Đăng nhập để lưu điểm/.test(net) && await p4.locator('#logins2 [data-login=google]').isVisible(), net);
  await nativeLogin(p4, 'google', fakeG('e2e-chi', '<img src=x onerror=window.__xss=1>'), { from: '#logins2' });
  await p4.waitForFunction(function () { return /đã lưu/.test(document.getElementById('oNet').textContent); }, null, { timeout: 9000 }).catch(function () {});
  net = await p4.locator('#oNet').innerText();
  t.ok('N02 Đăng nhập tại màn thua -> điểm vừa chơi được lưu, dòng trạng thái cập nhật', /đã lưu/.test(net) && !(await p4.locator('#logins2').isVisible()), net);

  // ---------- G. XSS qua tên ----------
  bd = await board(p1);
  const xss = await p1.evaluate(function () { return { flag: window.__xss, imgs: Array.prototype.map.call(document.querySelectorAll('#bdList img'), function (i) { return i.getAttribute('src'); }) }; });
  const flag4 = await p4.evaluate(function () { return window.__xss; });
  t.ok('G01 Tên chứa mã HTML hiện dưới dạng chữ, không chạy (ở cả hai máy)', !xss.flag && !flag4 && xss.imgs.indexOf('x') < 0 && bd.rows.some(function (r) { return r.t.indexOf('<img src=x') >= 0; }), JSON.stringify(xss));
  await closeBoard(p1);
  const names = await p1.evaluate(function () {
    var c = Online._cleanName, p = Online._cleanPhoto;
    return { ctrl: c('A‮b\u0000c​d'), ws: c('  Lê   Văn \n Tám  '), empty: c(' ​ '), nul: c(null), long: c('x'.repeat(60)).length,
      emoji: c('😀'.repeat(30)), half: c('ab\uD83D'), js: p('javascript:alert(1)'), http: p('http://a.b/c.png'), ok: p('https://a.b/c.png'), quote: p('https://a.b/"onerror="x') };
  });
  t.ok('G02 Làm sạch tên: bỏ ký tự điều khiển/đảo chữ, gộp khoảng trắng, tên rỗng -> "Người chơi"',
    names.ctrl === 'Abcd' && names.ws === 'Lê Văn Tám' && names.empty === 'Người chơi' && names.nul === 'Người chơi' && names.long === 40, JSON.stringify(names));
  t.ok('G03 Cắt tên không làm vỡ emoji', names.emoji === '😀'.repeat(20) && names.half === 'ab', names.emoji.length + ' / ' + JSON.stringify(names.half));
  t.ok('G04 Ảnh đại diện chỉ nhận đường dẫn https sạch', names.js === '' && names.http === '' && names.quote === '' && names.ok === 'https://a.b/c.png');

  // ---------- M/R. tải lại vẫn đăng nhập; mở bảng ngay vẫn có hạng ----------
  await p1.reload(); await p1.waitForFunction(function () { return window.Online && Online.state().ready; });
  await p1.evaluate(function () { document.getElementById('bBoard1').click(); });
  await p1.waitForFunction(function () { return /Bạn:|chưa có điểm|Đăng nhập để/.test(document.getElementById('bdMe').textContent); }, null, { timeout: 9000 }).catch(function () {});
  const meNow = await p1.locator('#bdMe').innerText();
  s = await st(p1);
  t.ok('M01 Tải lại app vẫn còn đăng nhập', !!s.user && s.user.name === 'Nguyễn Văn An');
  t.ok('R01 Mở bảng xếp hạng ngay sau khi tải lại vẫn hiện đúng hạng của mình', /Bạn: hạng #1 · 260 m/.test(meNow), meNow);
  await closeBoard(p1);

  // ---------- T. hơn 20 người: chỉ hiện top 20, người ngoài top vẫn biết hạng ----------
  for (let i = 0; i < 24; i++) await adminScore('bot' + i, 'Bot ' + String(i).padStart(2, '0'), 1000 + i);
  bd = await board(p1);
  t.ok('T01 25+ người chơi: bảng chỉ hiện top 20', bd.rows.length === 20 && /^1 .*Bot 23 1023 m$/.test(bd.rows[0].t) && /^20 .*Bot 04 1004 m$/.test(bd.rows[19].t), bd.rows.length + ' dòng, đầu: ' + bd.rows[0].t);
  t.ok('T02 Người ngoài top 20 vẫn thấy hạng của mình (#25)', /Bạn: hạng #25 · 260 m/.test(bd.me) && !bd.rows.some(function (r) { return r.me; }), bd.me);
  const clip = await p1.evaluate(function () { var p = document.getElementById('pBoard'); return p.scrollHeight > p.clientHeight + 1; });
  t.ok('T03 Bảng 20 dòng + phần tài khoản không tràn khung', !clip);
  await closeBoard(p1);

  // ---------- S. mất mạng khi lưu điểm ----------
  await p1.route('**/google.firestore.v1.Firestore/**', function (r) { r.abort(); });
  await p1.route('**/documents**', function (r) { r.abort(); });
  net = await finishRun(p1, 300);
  t.ok('S01 Mất mạng khi lưu điểm -> báo "Chưa lưu được điểm", không treo ở "Đang lưu"', /Chưa lưu được điểm/.test(net), net);
  await p1.evaluate(function () { document.getElementById('bBoard2').click(); });
  await p1.waitForFunction(function () { return /Không tải được|Bot/.test(document.getElementById('bdList').textContent); }, null, { timeout: 9000 }).catch(function () {});
  t.ok('S02 Mất mạng: bảng xếp hạng báo không tải được', /Không tải được bảng xếp hạng/.test(await p1.locator('#bdList').innerText()));
  await closeBoard(p1);
  await p1.unroute('**/google.firestore.v1.Firestore/**'); await p1.unroute('**/documents**');
  net = await finishRun(p1, 120);
  t.ok('S03 Có mạng lại: lượt kế tiếp tự đẩy kỷ lục 300 m còn nợ lên', /đã lưu/.test(net) && (await st(p1)).serverBest === 300, net + ' / serverBest=' + (await st(p1)).serverBest);

  // ---------- I. đăng xuất ----------
  await p2.evaluate(function () { document.getElementById('bBoard2').click(); }); await p2.waitForTimeout(700);
  t.ok('I01 Sau khi chơi vẫn đăng xuất được từ bảng xếp hạng', await p2.locator('#bLogout2').isVisible());
  await p2.click('#bLogout2'); await p2.waitForTimeout(700);
  s = await st(p2);
  t.ok('I02 Đăng xuất -> hiện lại nút đăng nhập, ẩn nút xoá', !s.user && await p2.locator('#logins3').isVisible() && !(await p2.locator('#bLogout2').isVisible()) && !(await p2.locator('#bDelete').isVisible()));
  await closeBoard(p2);
  net = await finishRun(p2, 999, false);
  t.ok('I03 Đã đăng xuất: lượt mới không tự gửi điểm', /Đăng nhập để lưu điểm/.test(net), net);
  bd = await board(p1);
  t.ok('I04 Điểm của người đã đăng xuất vẫn giữ nguyên trên bảng (210 m)', !bd.rows.some(function (r) { return /Trần Bình 999/.test(r.t); }));
  await closeBoard(p1);

  // ---------- H. xoá dữ liệu ----------
  // H-a: máy chủ đòi đăng nhập lại mới cho xoá tài khoản -> xoá điểm, đăng xuất, hướng dẫn rõ
  await p4.route('**/accounts:delete**', function (r) {
    r.fulfill({ status: 400, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ error: { code: 400, message: 'CREDENTIAL_TOO_OLD_LOGIN_AGAIN' } }) });
  });
  await p4.evaluate(function () { document.getElementById('bBoard2').click(); });
  await p4.waitForFunction(function () { return !/Đang tải/.test(document.getElementById('bdList').textContent); });
  await p4.click('#bDelete');
  const armed = await p4.locator('#bDelete').innerText();
  t.ok('H01 Bấm lần 1 chỉ hỏi lại', /Bấm lần nữa/.test(armed) && !!(await st(p4)).user, armed);
  await p4.click('#bDelete');
  await p4.waitForFunction(function () { return /Đã xoá/.test(document.getElementById('bdMe').textContent); }, null, { timeout: 9000 }).catch(function () {});
  const notice = await p4.locator('#bdMe').innerText();
  s = await st(p4);
  const rowsAfter = await p4.$$eval('#bdList li', function (ls) { return ls.map(function (l) { return l.innerText; }).join('|'); });
  t.ok('H02 Tài khoản chưa xoá được (cần đăng nhập lại): điểm đã xoá, đã đăng xuất, có hướng dẫn', !s.user && /đăng nhập lại rồi bấm Xoá lần nữa/.test(notice) && rowsAfter.indexOf('<img src=x') < 0, notice);
  await p4.unroute('**/accounts:delete**');
  await closeBoard(p4);
  // H-b: xoá trọn vẹn
  await p1.evaluate(function () { document.getElementById('bBoard2').click(); });
  await p1.waitForFunction(function () { return !/Đang tải/.test(document.getElementById('bdList').textContent); });
  t.ok('H03 Nút xoá hiện khi đã đăng nhập', await p1.locator('#bDelete').isVisible());
  await p1.click('#bDelete'); await p1.click('#bDelete');
  await p1.waitForFunction(function () { return /Đã xoá/.test(document.getElementById('bdMe').textContent); }, null, { timeout: 9000 }).catch(function () {});
  const notice2 = await p1.locator('#bdMe').innerText();
  s = await st(p1);
  const users = await authUsers();
  const rows2 = await p1.$$eval('#bdList li', function (ls) { return ls.map(function (l) { return l.innerText; }).join('|'); });
  t.ok('H04 Xoá trọn vẹn: mất khỏi bảng xếp hạng, đăng xuất, báo đã xoá toàn bộ', !s.user && /Đã xoá toàn bộ dữ liệu/.test(notice2) && rows2.indexOf('Nguyễn Văn An') < 0, notice2);
  t.ok('H05 Tài khoản đăng nhập cũng bị xoá khỏi máy chủ', users.indexOf('Nguyễn Văn An') < 0 && users.indexOf('Trần Bình') >= 0, users.join(', '));
  await closeBoard(p1);
  t.ok('H06 Đóng bảng: thông báo xoá không còn dính lại lần mở sau', (await board(p1)).me.indexOf('Đã xoá') < 0);
  await closeBoard(p1);

  // ---------- J. chạy từ file:// như trong APK / app iOS ----------
  const fileUrl = H.fileCopy('e2e-file', H.emulatorConfig(srv.port));
  const pf = await open(AND_UA, fileUrl);
  await nativeLogin(pf, 'google', fakeG('e2e-file', 'Người dùng file'));
  net = await finishRun(pf, 75);
  bd = await board(pf);
  t.ok('J01 Chạy từ file:// (như trong app): đăng nhập + lưu + đọc bảng', /đã lưu/.test(net) && bd.rows.length === 20 && /hạng #\d+ · 75 m/.test(bd.me), net + ' | ' + bd.me);
  await pf.reload(); await pf.waitForFunction(function () { return window.Online && Online.state().ready; });
  t.ok('J02 file://: mở lại app vẫn còn đăng nhập', !!(await st(pf)).user);

  // ---------- W. bố cục khi đã đăng nhập, tên rất dài, màn nhỏ ----------
  const pw = await open(AND_UA, null, { viewport: { width: 320, height: 568 } });
  await nativeLogin(pw, 'google', fakeG('e2e-long', 'Công Tằng Tôn Nữ Thị Ngọc Bảo Trâm Anh Thư Quỳnh', 'https://lh3.googleusercontent.com/a/khong-co'));
  const lay = await pw.evaluate(function () {
    var p = document.getElementById('pStart'), w = document.getElementById('who').getBoundingClientRect(), r = p.getBoundingClientRect();
    return { clip: p.scrollHeight > p.clientHeight + 1, whoIn: w.left >= r.left - 0.5 && w.right <= r.right + 0.5, name: document.getElementById('whoName').textContent.length };
  });
  t.ok('W01 Màn 320x568, tên 40 ký tự: bảng mở đầu không tràn', !lay.clip && lay.whoIn && lay.name === 40, JSON.stringify(lay));
  await pw.waitForTimeout(800);
  t.ok('W02 Ảnh đại diện hỏng -> thay bằng chữ cái đầu', (await pw.locator('#who .av').first().innerText()) === 'C' && (await pw.locator('#who img').count()) === 0);

  const all = [p1, p2, p3, p4, pf, pw];
  // SDK Firebase tự ghi lỗi mạng ra console trong đoạn S (ta cố ý cắt mạng): không tính là lỗi của game
  const errs = all.reduce(function (a, p) { return a.concat(p._errs); }, []).filter(function (e) { return !/@firebase\/firestore.*RPC_ERROR/.test(e); });
  t.ok('Z01 Không lỗi JS, không hộp thoại bất ngờ', errs.length === 0, errs.slice(0, 3).join(' | '));
});
