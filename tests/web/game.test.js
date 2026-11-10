'use strict';
// Logic game: máy trạng thái, hai kiểu điều khiển, va chạm, điểm, chơi lại, dự phòng touch event.
const H = require('../lib/harness');

H.main('Logic game', async function (t, cleanup) {
  const srv = await H.serve(); cleanup.push(srv.close);
  const browser = await H.launch(); cleanup.push(function () { return browser.close(); });
  const pg = await H.newPage(browser, srv.url + '/index.html');
  const snap = function () { return H.snap(pg); };
  const frames = function (n) { return pg.evaluate(function (k) { return window.__t.raf(k); }, n || 2); };
  const fire = function (type, x, y, id, ptype, extra) {
    return pg.evaluate(function (a) { return window.__t.fire(a[0], a[1], a[2], a[3], a[4], a[5]); }, [type, x, y, id, ptype, extra]);
  };
  const fresh = async function (page) {         // về trạng thái "ready" sạch
    await (page || pg).evaluate(function () {
      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 }));
      ['pStart', 'pOver', 'pBoard'].forEach(function (id) { document.getElementById(id).classList.add('hide'); });
      window.__dbg.run('reset()');
    });
  };

  // ---- khởi động ----
  let s = await snap();
  t.ok('G01 Khởi động: trạng thái idle, hiện bảng mở đầu', s.st === 'idle' && await pg.locator('#pStart').isVisible());
  t.ok('G02 Ghi log khởi động kèm phiên bản', pg._logs.some(function (l) { return /^\[oneline\] boot v\d+\.\d+ online=off pointer=1 best=0$/.test(l); }), pg._logs.join(' | '));
  t.ok('G03 Nhãn phiên bản hiện trên bảng mở đầu', /^v\d+\.\d+$/.test(await pg.locator('#ver').innerText()));
  t.ok('G04 Chưa cấu hình Firebase: không hiện nút đăng nhập', !(await pg.locator('#logins1').isVisible()) && !(await pg.locator('#acct').isVisible()));

  await pg.click('#bStart'); await frames(2);
  s = await snap();
  t.ok('G05 Bấm Bắt đầu -> ready, ẩn bảng', s.st === 'ready' && !(await pg.locator('#pStart').isVisible()));

  // ---- bắt đầu lượt ----
  await fire('pointerdown', 60, 300); await frames(2);
  t.ok('G06 Chạm chỗ trống không bắt đầu lượt', (await snap()).st === 'ready');
  await fire('pointerdown', 240, 680, 1, 'mouse', { button: 2, buttons: 2 }); await frames(2);
  t.ok('G07 Chuột phải vào nút tròn không bắt đầu lượt', (await snap()).st === 'ready');
  const ctxPrevented = await pg.evaluate(function () {
    var e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    document.getElementById('cv').dispatchEvent(e); return e.defaultPrevented;
  });
  t.ok('G08 Chặn menu chuột phải / giữ lâu trên khung chơi', ctxPrevented);

  // ---- nút tròn 1:1 ----
  await fire('pointerdown', 240, 680); await frames(2);
  let a = await snap();
  t.ok('G09 Giữ nút tròn -> run, chế độ stick', a.st === 'run' && a.mode === 'stick', a.st + '/' + a.mode);
  await fire('pointermove', 270, 680); await frames(2);
  let b = await snap();
  t.ok('G10 Rê ngón +30 ngang -> nhân vật dời đúng 30', Math.abs((b.dotX - a.dotX) - 30) < 0.01, (b.dotX - a.dotX).toFixed(3));
  await fire('pointermove', 270, 660); await frames(2);
  let c = await snap();
  t.ok('G11 Rê ngón -20 dọc -> nhân vật dời đúng -20', Math.abs((c.dotY - b.dotY) + 20) < 0.01, (c.dotY - b.dotY).toFixed(3));
  const slow = await pg.evaluate(async function () {
    var d = window.__dbg, x0 = d.snap().dotX, fx = 270;
    for (var i = 0; i < 20; i++) { fx -= 2; window.__t.fire('pointermove', fx, 660); await window.__t.raf(1); }
    await window.__t.raf(2);
    var x1 = d.snap().dotX; await window.__t.raf(10);
    return { moved: x1 - x0, idle: d.snap().dotX - x1, st: d.snap().st };
  });
  t.ok('G12 Rê chậm 40 px qua 20 khung -> dời đúng 40', Math.abs(slow.moved + 40) < 0.01 && slow.st === 'run', slow.moved.toFixed(3));
  t.ok('G13 Ngón đứng yên -> nhân vật đứng yên', Math.abs(slow.idle) < 0.001, slow.idle.toFixed(4));
  const before = await snap();
  await fire('pointermove', 230, 790); await frames(2);
  const far = await snap();
  t.ok('G14 Ngón ra quá tầm: núm kẹp 46 px, nền nút chạy theo', Math.abs(Math.hypot(far.sx, far.sy) - 46) < 0.01 && far.ay > before.ay + 20,
    'núm ' + Math.hypot(far.sx, far.sy).toFixed(1) + ', nền y ' + before.ay.toFixed(0) + '->' + far.ay.toFixed(0));
  t.ok('G15 Nhân vật không xuống quá 78% chiều cao', Math.abs(far.dotY - 760 * 0.78) < 0.01, far.dotY.toFixed(1));

  // ---- nhấc tay ----
  await pg.evaluate(function () { window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7 })); }); await frames(2);
  t.ok('G16 Ngón khác nhấc lên không làm thua', (await snap()).st === 'run');
  await pg.evaluate(function () { window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 })); }); await frames(2);
  s = await snap();
  t.ok('G17 Nhấc ngón đang vẽ -> thua "Nhấc tay rồi!"', s.st === 'over' && s.code === 'lift' && (await pg.locator('#oTitle').innerText()) === 'Nhấc tay rồi!');
  t.ok('G18 Màn thua hiện quãng đường và kỷ lục', (await pg.locator('#oD').innerText()) === s.m + ' m' && (await pg.locator('#oB').innerText()) === 'Tốt nhất: ' + s.best + ' m');
  t.ok('G19 Ghi log kết thúc lượt', pg._logs.some(function (l) { return /over reason=lift m=\d+ best=\d+ mode=stick t=\d+$/.test(l); }));

  // ---- chơi lại ----
  await pg.click('#bAgain'); await frames(2);
  s = await snap();
  t.ok('G20 Chơi lại -> ready, quãng đường về 0', s.st === 'ready' && s.dist === 0 && s.trail === 0 && !(await pg.locator('#pOver').isVisible()));

  // ---- va chạm ----
  await fire('pointerdown', 240, 680); await frames(2);
  await fire('pointermove', 420, 680); await frames(3);
  s = await snap();
  t.ok('G21 Vẩy 180 px xuyên tường -> "Chạm tường!"', s.st === 'over' && s.code === 'wall' && (await pg.locator('#oTitle').innerText()) === 'Chạm tường!');
  t.ok('G22 Dừng ngay tại mép tường, không lọt sang bên kia', Math.abs(s.dotX - s.cx) < s.hw + 6, 'lệch ' + (s.dotX - s.cx).toFixed(1) + ' / hw ' + s.hw.toFixed(1));

  // ---- kéo trực tiếp ----
  await fresh();
  await fire('pointerdown', 250, 510); await frames(2);
  a = await snap();
  t.ok('G23 Giữ vòng sáng (lệch 10 px) -> chế độ drag, bắt đầu đúng tâm', a.st === 'run' && a.mode === 'drag' && Math.abs(a.dotX - 240) < 0.01);
  await fire('pointermove', 275, 480); await frames(6);
  b = await snap();
  t.ok('G24 Kéo ngón (+25,-30) -> nhân vật tới đúng vị trí tương ứng', Math.abs(b.dotX - 265) < 0.5 && Math.abs(b.dotY - (760 * 0.66 - 30)) < 0.5,
    b.dotX.toFixed(1) + ',' + b.dotY.toFixed(1));

  // ---- mất focus / ẩn app ----
  await pg.evaluate(function () { window.dispatchEvent(new Event('blur')); }); await frames(2);
  t.ok('G25 Mất focus khi đang chơi -> tính là nhấc tay', (await snap()).code === 'lift' && (await snap()).st === 'over');
  await fresh(); await fire('pointerdown', 240, 680); await frames(2);
  await pg.evaluate(function () {
    Object.defineProperty(document, 'hidden', { configurable: true, get: function () { return true; } });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'hidden', { configurable: true, get: function () { return false; } });
  }); await frames(2);
  t.ok('G26 Ẩn app / tắt màn khi đang chơi -> tính là nhấc tay', (await snap()).st === 'over');
  await fresh(); await fire('pointerdown', 240, 680); await frames(2);
  await pg.evaluate(function () { window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1 })); }); await frames(2);
  t.ok('G27 Hệ thống huỷ cảm ứng (pointercancel) -> tính là nhấc tay', (await snap()).st === 'over');

  // ---- kỷ lục ----
  const rec = await pg.evaluate(async function () {
    var d = window.__dbg, out = [];
    for (var m of [30, 12, 55, 41]) {
      document.getElementById('pOver').classList.add('hide'); d.run('reset()');
      d.run("state='run'; dist=" + (m * 22 + 3) + "; lose('wall')");
      out.push(d.snap().best);
    }
    return { bests: out, ls: localStorage.getItem('oneline.best'), runs: JSON.parse(localStorage.getItem('oneline.runs')) };
  });
  t.ok('G28 Kỷ lục chỉ tăng, không giảm', JSON.stringify(rec.bests) === '[30,30,55,55]' && rec.ls === '55', JSON.stringify(rec.bests));
  const ms = rec.runs.map(function (r) { return r.m; });
  t.ok('G29 Lưu các lượt tốt nhất trên máy, xếp giảm dần', ms.length >= 4 && ms.join() === ms.slice().sort(function (x, y) { return y - x; }).join() && ms[0] === 55, ms.join());
  await pg.reload(); await pg.waitForFunction(function () { return !!window.__dbg; });
  t.ok('G30 Tải lại trang vẫn giữ kỷ lục', (await snap()).best === 55 && (await pg.locator('#hB').innerText()) === '55 m');
  await pg.click('#bBoard1'); await frames(2);
  const rows = await pg.$$eval('#bdList li', function (ls) { return ls.map(function (l) { return l.innerText.replace(/\s+/g, ' ').trim(); }); });
  t.ok('G31 Bảng xếp hạng trên máy liệt kê các lượt', (await pg.locator('#bdSub').innerText()) === 'Kỷ lục trên máy này' && rows.length >= 4 && / 55 m$/.test(rows[0]), rows.slice(0, 3).join(' | '));
  await pg.click('#bClose'); await frames(1);
  t.ok('G32 Đóng bảng xếp hạng -> về bảng mở đầu', await pg.locator('#pStart').isVisible() && !(await pg.locator('#pBoard').isVisible()));
  for (let i = 0; i < 12; i++) await pg.evaluate(function (m) {
    var d = window.__dbg; d.run('reset()'); d.run("state='run'; dist=" + (m * 22 + 3) + "; lose('lift')");
    document.getElementById('pOver').classList.add('hide');
  }, 60 + i);
  const nRuns = await pg.evaluate(function () { return JSON.parse(localStorage.getItem('oneline.runs')).length; });
  t.ok('G33 Chỉ giữ 10 lượt tốt nhất', nRuns === 10, String(nRuns));

  // ---- tự chỉnh khung khi lỡ sự kiện resize ----
  await fresh();
  const heal = await pg.evaluate(async function () {
    var w = document.getElementById('wrap'), d = window.__dbg, good = w.style.width;
    w.style.width = '123px'; d.run('fitW=-1');
    await window.__t.raf(45);
    return { good: good, now: w.style.width };
  });
  t.ok('G34 Khung chơi tự chỉnh lại kích thước trong vòng lặp', heal.now === heal.good, heal.good + ' -> ' + heal.now);

  // ---- vòng lặp không chết khi một khung hình lỗi ----
  const alive = await pg.evaluate(async function () {
    var d = window.__dbg, t0 = d.snap().time;
    d.run('wps=[]');                       // dữ liệu hỏng -> step/draw ném lỗi
    await window.__t.raf(5);
    d.run('reset()'); await window.__t.raf(5);
    return d.snap().time > t0 && d.snap().st === 'ready';
  });
  t.ok('G35 Một khung hình lỗi không làm treo game', alive);
  pg._errs = pg._errs.filter(function (e) { return !/frame error/.test(e); });

  // ---- bot tự chơi: game phải chơi được bằng cả hai kiểu ----
  for (const mode of ['stick', 'drag']) {
    const dists = await pg.evaluate(async function (mode) {
      var d = window.__dbg, out = [];
      for (var k = 0; k < 3; k++) {
        document.getElementById('pOver').classList.add('hide'); d.run('reset()');
        var fx = 240, fy = mode === 'stick' ? 680 : 501.6;
        window.__t.fire('pointerdown', fx, fy);
        var t0 = performance.now();
        while (d.snap().st === 'run' && performance.now() - t0 < 12000) {
          var g = d.snap(), c = d.run('corridor(wy(dotY)+speed/60)');
          fx += (c.x - g.dotX) * 0.55; fy += (460 - g.dotY) * 0.25;
          window.__t.fire('pointermove', fx, fy);
          await window.__t.raf(1);
        }
        out.push(d.snap().m);
        window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 }));
      }
      return out;
    }, mode);
    t.ok('G36 Bot chơi bằng ' + (mode === 'stick' ? 'nút tròn' : 'kéo trực tiếp') + ' qua được đoạn đầu (>= 40 m cả 3 lượt)',
      Math.min.apply(null, dists) >= 40, dists.join(', ') + ' m');
  }

  t.ok('G37 Không có lỗi JS trong suốt bài test', pg._errs.length === 0, pg._errs.slice(0, 3).join(' | '));

  // ---- dự phòng cho trình duyệt không có Pointer Events ----
  const old = await H.newPage(browser, srv.url + '/index.html', { touch: true, init: function () { delete window.PointerEvent; } });
  const touch = function (type, pts) {
    return old.evaluate(function (a) {
      var cv = document.getElementById('cv'), r = cv.getBoundingClientRect(), k = r.width / 480;
      var ts = a.pts.map(function (p) { return new Touch({ identifier: p[2], target: cv, clientX: r.left + p[0] * k, clientY: r.top + p[1] * k }); });
      var target = a.type === 'touchstart' ? cv : window;
      return target.dispatchEvent(new TouchEvent(a.type, { bubbles: true, cancelable: true, changedTouches: ts, touches: a.type === 'touchend' ? [] : ts }));
    }, { type: type, pts: pts });
  };
  const of = function (n) { return old.evaluate(function (k) { return new Promise(function (res) { var i = 0; (function f() { if (i++ >= k) return res(); requestAnimationFrame(f); })(); }); }, n || 2); };
  t.ok('T01 Không có Pointer Events: game vẫn khởi động', old._logs.some(function (l) { return /pointer=0/.test(l); }), old._logs.join(' | '));
  await old.click('#bStart'); await of(2);
  await touch('touchstart', [[240, 680, 5]]); await of(2);
  let o1 = await H.snap(old);
  t.ok('T02 Touch: giữ nút tròn -> run', o1.st === 'run' && o1.mode === 'stick');
  await touch('touchmove', [[262, 680, 5]]); await of(2);
  let o2 = await H.snap(old);
  t.ok('T03 Touch: rê +22 -> nhân vật dời đúng 22', Math.abs((o2.dotX - o1.dotX) - 22) < 0.01, (o2.dotX - o1.dotX).toFixed(3));
  await touch('touchstart', [[100, 300, 6]]); await touch('touchmove', [[160, 300, 6]]); await touch('touchend', [[160, 300, 6]]); await of(2);
  let o3 = await H.snap(old);
  t.ok('T04 Touch: ngón thứ hai chạm/rê/nhấc không ảnh hưởng', o3.st === 'run' && Math.abs(o3.dotX - o2.dotX) < 0.01);
  await touch('touchend', [[262, 680, 5]]); await of(2);
  t.ok('T05 Touch: nhấc ngón đang vẽ -> thua', (await H.snap(old)).code === 'lift');
  await old.click('#bAgain'); await of(2);
  await old.evaluate(function () {
    var cv = document.getElementById('cv'), r = cv.getBoundingClientRect(), k = r.width / 480;
    cv.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: r.left + 240 * k, clientY: r.top + 501.6 * k }));
    window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: r.left + 255 * k, clientY: r.top + 501.6 * k }));
  }); await of(6);
  o1 = await H.snap(old);
  // MouseEvent tổng hợp bị làm tròn toạ độ về số nguyên px nên cho phép lệch ~1 px game
  t.ok('T06 Chuột (không Pointer Events): giữ vòng sáng rồi kéo', o1.st === 'run' && o1.mode === 'drag' && Math.abs(o1.dotX - 255) < 1.3, o1.dotX.toFixed(1));
  await old.evaluate(function () { window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); }); await of(2);
  t.ok('T07 Chuột: nhả nút -> thua', (await H.snap(old)).code === 'lift');
  t.ok('T08 Không có lỗi JS ở chế độ dự phòng', old._errs.length === 0, old._errs.slice(0, 3).join(' | '));

  // ---- máy rất cũ (thiếu API ES2017): bỏ qua lớp online, game vẫn chạy ----
  const anc = await H.newPage(browser, srv.url + '/index.html', { init: function () { delete String.prototype.padStart; delete window.PointerEvent; } });
  const ancOnline = await anc.evaluate(function () { return typeof window.Online; });
  t.ok('T09 Trình duyệt quá cũ: không tải lớp online, game vẫn khởi động sạch', ancOnline === 'undefined' && anc._errs.length === 0 &&
    anc._logs.some(function (l) { return /online=none pointer=0/.test(l); }), ancOnline + ' | ' + anc._logs.join(' | ') + anc._errs.join(' | '));
  await anc.click('#bStart');
  t.ok('T10 Trình duyệt quá cũ: bấm Bắt đầu chơi được', (await H.snap(anc)).st === 'ready');
});
