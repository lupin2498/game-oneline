'use strict';
// Cảm ứng thật qua CDP Input.dispatchTouchEvent (sinh pointer/touch event như trên điện thoại):
// đa chạm, giữ lâu, cuộn bảng xếp hạng. Chạy cả hai nhánh: có và không có Pointer Events.
const H = require('../lib/harness');

async function scenario(t, browser, url, label, init) {
  const pg = await H.newPage(browser, url, { touch: true, mobile: true, init: init });
  const cdp = await pg.context().newCDPSession(pg);
  const box = await pg.locator('#wrap').boundingBox(), k = box.width / 480;
  const P = function (x, y, id) { return { x: box.x + x * k, y: box.y + y * k, id: id }; };
  const touch = function (type, pts) { return cdp.send('Input.dispatchTouchEvent', { type: type, touchPoints: pts }); };
  const snap = function () { return H.snap(pg); };
  const fresh = async function () {
    await touch('touchEnd', []).catch(function () {});
    await pg.evaluate(function () {
      ['pStart', 'pOver', 'pBoard'].forEach(function (id) { document.getElementById(id).classList.add('hide'); });
      window.__dbg.run('reset()');
    });
    await pg.waitForTimeout(40);
  };
  const ok = function (name, cond, detail) { return t.ok(label + ' ' + name, cond, detail); };

  await fresh();
  await touch('touchStart', [P(240, 680, 1)]); await pg.waitForTimeout(60);
  await touch('touchStart', [P(240, 680, 1), P(400, 300, 2)]); await pg.waitForTimeout(40);
  await touch('touchEnd', [P(400, 300, 2)]); await pg.waitForTimeout(60);
  let s = await snap();
  ok('MT1 Ngón thứ 2 chạm rồi nhấc khi đang giữ nút tròn: vẫn chơi tiếp', s.st === 'run', 'state=' + s.st + ' ' + s.reason);

  await fresh();
  await touch('touchStart', [P(240, 680, 1)]); await pg.waitForTimeout(60);
  let s0 = await snap();
  await touch('touchStart', [P(240, 680, 1), P(100, 400, 2)]); await pg.waitForTimeout(30);
  for (let i = 1; i <= 5; i++) { await touch('touchMove', [P(240, 680, 1), P(100 + i * 20, 400, 2)]); await pg.waitForTimeout(16); }
  await pg.waitForTimeout(40);
  s = await snap();
  ok('MT2 Ngón thứ 2 rê: nhân vật không nhảy', s.st === 'run' && Math.abs(s.dotX - s0.dotX) < 0.5, s0.dotX.toFixed(1) + ' -> ' + s.dotX.toFixed(1));

  await fresh();
  await touch('touchStart', [P(240, 760 * 0.66, 1)]); await pg.waitForTimeout(60);
  s0 = await snap();
  await touch('touchStart', [P(240, 760 * 0.66, 1), P(60, 300, 2)]); await pg.waitForTimeout(30);
  await touch('touchMove', [P(240, 760 * 0.66, 1), P(80, 300, 2)]); await pg.waitForTimeout(80);
  s = await snap();
  ok('MT3 Chế độ kéo: ngón thứ 2 rê không đổi hướng nhân vật', s.st === 'run' && s.mode === 'drag' && Math.abs(s.dotX - s0.dotX) < 0.5);

  await fresh();
  await touch('touchStart', [P(240, 680, 1)]); await pg.waitForTimeout(60);
  await touch('touchStart', [P(240, 680, 1), P(400, 300, 2)]); await pg.waitForTimeout(30);
  await touch('touchEnd', [P(240, 680, 1)]); await pg.waitForTimeout(60);
  s = await snap();
  ok('MT4 Nhấc ngón chính (ngón 2 còn giữ) -> thua', s.st === 'over' && s.code === 'lift');

  await fresh();
  await touch('touchStart', [P(240, 680, 1)]); await pg.waitForTimeout(60);
  s0 = await snap();
  await touch('touchMove', [P(255, 680, 1)]); await pg.waitForTimeout(50);
  s = await snap();
  ok('MT5 Rê 15 px game bằng cảm ứng thật -> nhân vật dời 15', Math.abs((s.dotX - s0.dotX) - 15) < 0.6, (s.dotX - s0.dotX).toFixed(2));
  await touch('touchEnd', []); await pg.waitForTimeout(60);
  ok('MT6 Nhấc ngón duy nhất -> thua', (await snap()).st === 'over');

  // Giữ yên 2 giây (gấp 4 ngưỡng "giữ lâu" 500 ms của trình duyệt): lượt chơi không được tự kết thúc.
  // Không giữ lâu hơn: người chơi đứng yên chỉ chắc chắn an toàn 2,5 giây đầu (đoạn thẳng khởi động của mê cung).
  await fresh();
  await pg.evaluate(function () { window.__ctx = 0; window.__sel = 0;
    window.addEventListener('contextmenu', function (e) { if (!e.defaultPrevented) window.__ctx++; });
    document.addEventListener('selectionchange', function () { if (String(getSelection())) window.__sel++; }); });
  await touch('touchStart', [P(240, 680, 1)]);
  await pg.waitForTimeout(2000);
  s = await snap();
  const side = await pg.evaluate(function () { return { ctx: window.__ctx, sel: window.__sel }; });
  ok('MT7 Giữ yên 2 giây: vẫn đang chơi, không bật menu / chọn chữ', s.st === 'run' && s.m >= 8 && side.ctx === 0 && side.sel === 0,
    'state=' + s.st + ' ' + s.m + ' m, menu=' + side.ctx + ', chọn chữ=' + side.sel);
  await touch('touchEnd', []); await pg.waitForTimeout(60);

  // Chạm lên chữ HUD rồi giữ: không được chọn chữ
  const hud = await pg.locator('#hD').boundingBox();
  await touch('touchStart', [{ x: hud.x + hud.width / 2, y: hud.y + hud.height / 2, id: 4 }]); await pg.waitForTimeout(900);
  await touch('touchEnd', []); await pg.waitForTimeout(60);
  const sel = await pg.evaluate(function () { return String(getSelection()); });
  ok('MT8 Giữ lâu trên chữ HUD không bôi đen chữ', sel === '', JSON.stringify(sel));

  ok('MT9 Không có lỗi JS', pg._errs.length === 0, pg._errs.slice(0, 2).join(' | '));
  await pg.context().close();
}

H.main('Cảm ứng', async function (t, cleanup) {
  const srv = await H.serve(); cleanup.push(srv.close);
  const browser = await H.launch(); cleanup.push(function () { return browser.close(); });
  await scenario(t, browser, srv.url + '/index.html', '[pointer]', undefined);
  await scenario(t, browser, srv.url + '/index.html', '[touch cũ]', function () { delete window.PointerEvent; });

  // Cuộn bảng xếp hạng bằng ngón tay (danh sách dài hơn khung)
  const pg = await H.newPage(browser, srv.url + '/index.html', { touch: true, mobile: true, init: function () {
    var a = []; for (var i = 1; i <= 10; i++) a.push({ m: 200 - i, t: Date.now() });
    try { localStorage.setItem('oneline.runs', JSON.stringify(a)); } catch (e) {}
  } });
  await pg.tap('#bBoard1'); await pg.waitForTimeout(150);
  const cdp = await pg.context().newCDPSession(pg);
  const lb = await pg.locator('#bdList').boundingBox();
  const sc0 = await pg.evaluate(function () { var l = document.getElementById('bdList'); return { top: l.scrollTop, sh: l.scrollHeight, ch: l.clientHeight }; });
  const x = lb.x + lb.width / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x, y: lb.y + lb.height - 20, id: 1 }] });
  for (let i = 1; i <= 8; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x, y: lb.y + lb.height - 20 - i * 12, id: 1 }] }); await pg.waitForTimeout(16); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await pg.waitForTimeout(300);
  const sc1 = await pg.evaluate(function () { return document.getElementById('bdList').scrollTop; });
  t.ok('SC1 Bảng xếp hạng dài cuộn được bằng ngón tay', sc0.sh > sc0.ch && sc1 >= Math.min(20, sc0.sh - sc0.ch) - 1,
    'cao ' + sc0.sh + '/' + sc0.ch + ', cuộn ' + sc0.top + ' -> ' + sc1);
  await pg.tap('#bClose'); await pg.waitForTimeout(100);
  t.ok('SC2 Chạm nút Đóng bằng cảm ứng thật', await pg.locator('#pStart').isVisible());
  await pg.tap('#bStart'); await pg.waitForTimeout(100);
  t.ok('SC3 Chạm nút Bắt đầu bằng cảm ứng thật', (await H.snap(pg)).st === 'ready');
});
