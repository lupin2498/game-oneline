'use strict';
// Đăng nhập trên web bằng cửa sổ popup thật của Firebase (trang chọn tài khoản của Auth Emulator).
// Cần ra được apis.google.com nên chỉ chạy được trên CI / máy có mạng đầy đủ.
const H = require('../lib/harness');

H.main('Đăng nhập popup (web)', async function (t, cleanup) {
  const reach = await fetch('https://apis.google.com/js/api.js', { method: 'HEAD' }).then(function (x) { return x.ok; }, function () { return false; });
  if (!reach) { console.log('SKIP  Máy test không ra được apis.google.com (chạy trên CI)'); return; }
  await H.resetEmulators();
  const srv = await H.serve({ config: 'emulator' }); cleanup.push(srv.close);
  const browser = await H.launch(); cleanup.push(function () { return browser.close(); });
  const pg = await H.newPage(browser, srv.url + '/index.html');
  await pg.waitForFunction(function () { return window.Online && Online.state().ready; });

  async function viaPopup(buttonSel, name, cancel) {
    const pop = await Promise.all([pg.context().waitForEvent('page', { timeout: 20000 }), pg.click(buttonSel)]).then(function (a) { return a[0]; });
    await pop.waitForSelector('#add-account-button', { timeout: 20000 });
    if (cancel) { await pop.close(); return; }
    await pop.click('#add-account-button');
    await pop.click('#autogen-button');
    await pop.fill('#display-name-input', name);
    await pop.click('#sign-in');
    await pg.waitForFunction(function () { return !!Online.state().user; }, null, { timeout: 20000 });
  }

  await viaPopup('#logins1 [data-login=google]', '', true);
  await pg.waitForFunction(function () { return !Online.state().busy; }, null, { timeout: 15000 }).catch(function () {});
  let s = await pg.evaluate(function () { return Online.state(); });
  t.ok('PP1 Đóng cửa sổ đăng nhập giữa chừng: không báo lỗi, nút bấm lại được', !s.user && !s.busy && !s.error, JSON.stringify({ busy: s.busy, error: s.error }));

  await viaPopup('#logins1 [data-login=google]', 'Người Dùng Popup');
  s = await pg.evaluate(function () { return Online.state(); });
  t.ok('PP2 Đăng nhập Google bằng popup', !!s.user && s.user.name === 'Người Dùng Popup' && s.user.provider === 'google.com', JSON.stringify(s.user));
  t.ok('PP3 Giao diện chuyển sang đã đăng nhập', await pg.locator('#who').isVisible() && !(await pg.locator('#logins1').isVisible()));

  await pg.evaluate(function () { var d = window.__dbg; document.getElementById('pStart').classList.add('hide'); d.run('reset()'); d.run("state='run'; dist=22*88+1"); d.run("lose('wall')"); });
  await pg.waitForFunction(function () { return /đã lưu/.test(document.getElementById('oNet').textContent); }, null, { timeout: 12000 }).catch(function () {});
  t.ok('PP4 Điểm của phiên popup lưu được lên bảng xếp hạng', /đã lưu/.test(await pg.locator('#oNet').innerText()), await pg.locator('#oNet').innerText());

  await pg.evaluate(function () { return Online.logout(); }); await pg.waitForTimeout(500);
  await viaPopup('#logins2 [data-login=facebook]', 'Người Dùng Facebook');
  s = await pg.evaluate(function () { return Online.state(); });
  t.ok('PP5 Đăng xuất rồi đăng nhập Facebook bằng popup', !!s.user && s.user.provider === 'facebook.com', JSON.stringify(s.user));
  t.ok('PP6 Không lỗi JS', pg._errs.length === 0, pg._errs.slice(0, 2).join(' | '));
});
