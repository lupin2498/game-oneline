'use strict';
// Bố cục trên nhiều cỡ màn hình, xoay máy, vùng tai thỏ, số lớn trên HUD.
const H = require('../lib/harness');
const fs = require('fs'), path = require('path');

H.main('Bố cục', async function (t, cleanup) {
  const srv = await H.serve(); cleanup.push(srv.close);
  const browser = await H.launch(); cleanup.push(function () { return browser.close(); });
  fs.mkdirSync(H.OUT, { recursive: true });
  const vps = [['iPhone SE', 320, 568, 2], ['Android nhỏ', 360, 640, 3], ['iPhone 15', 393, 852, 3], ['Pixel 8', 412, 915, 2.625],
    ['Gập mở', 673, 841, 2.5], ['iPad', 768, 1024, 2], ['Ngang', 844, 390, 3], ['Desktop', 1440, 900, 1], ['Rất nhỏ', 240, 320, 1]];
  for (const v of vps) {
    const name = v[0], w = v[1], h = v[2];
    const pg = await H.newPage(browser, srv.url + '/index.html', { viewport: { width: w, height: h }, dpr: v[3], touch: w < 900, mobile: w < 900,
      init: function () { var a = []; for (var i = 1; i <= 10; i++) a.push({ m: 300 - i, t: Date.now() }); try { localStorage.setItem('oneline.runs', JSON.stringify(a)); localStorage.setItem('oneline.best', '12345'); } catch (e) {} } });
    await pg.waitForTimeout(120);
    const clipped = function (id) {      // nội dung bảng có tràn khỏi khung không
      return pg.evaluate(function (id) {
        var p = document.getElementById(id), r = p.getBoundingClientRect(), bad = [];
        if (p.scrollHeight > p.clientHeight + 1) bad.push('tràn dọc');
        Array.prototype.forEach.call(p.querySelectorAll('button,a,h1,h2,p,ol,.big'), function (el) {
          if (!el.offsetParent && el.tagName !== 'OL') return;
          var q = el.getBoundingClientRect(); if (!q.width) return;
          if (q.left < r.left - 0.5 || q.right > r.right + 0.5 || q.top < r.top - 0.5 || q.bottom > r.bottom + 0.5) bad.push((el.id || el.tagName) + ' lòi ra ngoài');
        });
        return bad;
      }, id);
    };
    const m = await pg.evaluate(function () {
      var wr = document.getElementById('wrap').getBoundingClientRect(), cv = document.getElementById('cv');
      var over = Array.prototype.filter.call(document.querySelectorAll('.chip b,.chip span,.row i'), function (e) { return e.scrollWidth > e.clientWidth + 1; }).map(function (e) { return e.textContent; });
      var hud = document.querySelector('.hud').getBoundingClientRect();
      var bars = document.querySelector('.bars').getBoundingClientRect();
      return { ww: wr.width, wh: wr.height, cw: cv.width, ch: cv.height, over: over,
        inView: wr.top >= -0.5 && wr.left >= -0.5 && wr.bottom <= innerHeight + 0.5 && wr.right <= innerWidth + 0.5,
        centered: Math.abs((wr.left + wr.right) / 2 - innerWidth / 2) < 1 && Math.abs((wr.top + wr.bottom) / 2 - innerHeight / 2) < 1,
        hudIn: hud.right <= wr.right + 0.5 && bars.right <= wr.right + 0.5 && bars.width > 20, dpr: devicePixelRatio };
    });
    const c1 = await clipped('pStart');
    await pg.screenshot({ path: path.join(H.OUT, 'layout-' + w + 'x' + h + '-start.png') });
    await pg.evaluate(function () { document.getElementById('pStart').classList.add('hide'); window.__dbg.run("reset(); state='run'; dist=22*12345+5; lose('wall')"); });
    await pg.waitForTimeout(80);
    const c2 = await clipped('pOver');
    const hudOver = await pg.evaluate(function () {
      var wr = document.getElementById('wrap').getBoundingClientRect();
      return Array.prototype.filter.call(document.querySelectorAll('.chip'), function (e) { return e.getBoundingClientRect().right > wr.right + 0.5; }).length;
    });
    await pg.evaluate(function () { document.getElementById('bBoard2').click(); });
    await pg.waitForTimeout(120);
    const c3 = await clipped('pBoard');
    await pg.screenshot({ path: path.join(H.OUT, 'layout-' + w + 'x' + h + '-board.png') });
    const ratioOk = Math.abs(m.ww / m.wh - 480 / 760) < 0.004;
    const full = Math.abs(m.ww - Math.floor(Math.min(w, h * 480 / 760))) < 1.01;
    const dprUsed = Math.min(m.dpr, 2.5);
    const sharp = Math.abs(m.cw - Math.round(m.ww * dprUsed)) <= 1;
    const all = ratioOk && full && m.inView && m.centered && sharp && m.hudIn && !m.over.length && !hudOver && !c1.length && !c2.length && !c3.length && !pg._errs.length;
    t.ok('L ' + (name + ' ' + w + 'x' + h).padEnd(22) + ' khung ' + m.ww.toFixed(0) + 'x' + m.wh.toFixed(0) + ', canvas ' + m.cw + 'x' + m.ch, all,
      [ratioOk ? '' : 'sai tỉ lệ', full ? '' : 'không vừa khít màn', m.inView ? '' : 'lòi khỏi màn', m.centered ? '' : 'lệch tâm', sharp ? '' : 'canvas mờ',
        m.hudIn ? '' : 'HUD tràn', m.over.length ? 'chữ tràn: ' + m.over.join(',') : '', hudOver ? 'chip tràn khi số lớn' : '',
        c1.length ? 'mở đầu: ' + c1.join(',') : '', c2.length ? 'thua: ' + c2.join(',') : '', c3.length ? 'xếp hạng: ' + c3.join(',') : '', pg._errs.join(',')].filter(Boolean).join('; '));
    await pg.context().close();
  }

  // Xoay máy / đổi cỡ cửa sổ giữa lượt chơi
  const pg = await H.newPage(browser, srv.url + '/index.html', { viewport: { width: 412, height: 915 }, touch: true, mobile: true });
  await pg.click('#bStart');
  await pg.evaluate(function () { window.__t.fire('pointerdown', 240, 680); });
  await pg.waitForTimeout(100);
  const r1 = await pg.evaluate(function () { var s = window.__dbg.snap(); return { x: s.dotX, y: s.dotY, st: s.st }; });
  await pg.setViewportSize({ width: 915, height: 412 }); await pg.waitForTimeout(200);
  const r2 = await pg.evaluate(function () {
    var s = window.__dbg.snap(), wr = document.getElementById('wrap').getBoundingClientRect(), cv = document.getElementById('cv');
    return { x: s.dotX, y: s.dotY, st: s.st, w: wr.width, h: wr.height, cw: cv.width, inView: wr.bottom <= innerHeight + 0.5 && wr.right <= innerWidth + 0.5 };
  });
  t.ok('R1 Xoay ngang giữa lượt: khung co lại vừa màn, không văng lỗi', r2.inView && Math.abs(r2.w / r2.h - 480 / 760) < 0.004 && Math.abs(r2.h - 412) < 1.7 && !pg._errs.length,
    r2.w.toFixed(0) + 'x' + r2.h.toFixed(0) + ' ' + pg._errs.join(','));
  t.ok('R2 Xoay máy không làm nhân vật nhảy chỗ', Math.abs(r2.x - r1.x) < 0.01 && Math.abs(r2.y - r1.y) < 0.01, r1.x + ',' + r1.y + ' -> ' + r2.x + ',' + r2.y);
  await pg.evaluate(function () { window.__t.fire('pointermove', 250, 680); }); await pg.waitForTimeout(60);
  const r3 = await H.snap(pg);
  t.ok('R3 Sau khi xoay vẫn điều khiển đúng tỉ lệ 1:1', r3.st !== 'run' || Math.abs((r3.dotX - r2.x) - 10) < 0.05, (r3.dotX - r2.x).toFixed(2) + ' ' + r3.st);
  await pg.context().close();

  // Vùng an toàn (tai thỏ, thanh home): khung chơi phải nằm trong phần còn lại
  const sa = await H.newPage(browser, srv.url + '/index.html', { viewport: { width: 393, height: 600 } });
  await sa.addStyleTag({ content: 'body{padding:47px 0 34px 0 !important}' });
  await sa.evaluate(function () { window.dispatchEvent(new Event('resize')); }); await sa.waitForTimeout(100);
  const sr = await sa.evaluate(function () { var r = document.getElementById('wrap').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: r.height, w: r.width }; });
  t.ok('S1 Tôn trọng vùng an toàn trên/dưới (tai thỏ, thanh home)', sr.top >= 46.5 && sr.bottom <= 600 - 33.5 && Math.abs(sr.w / sr.h - 480 / 760) < 0.004,
    'khung từ y=' + sr.top.toFixed(0) + ' tới ' + sr.bottom.toFixed(0));
  await sa.context().close();

  // App Android 15+ từng chạy trang khi WebView chưa có kích thước: bảng mở đầu hiện quá cỡ, lệch phải, tới khi
  // game tự dàn lại. Giờ: chưa có kích thước thì giấu khung, có kích thước là dàn ngay.
  const ref = await H.newPage(browser, srv.url + '/index.html', { viewport: { width: 320, height: 640 }, dpr: 1 });
  const want = await H.frameInfo(ref); await ref.context().close();
  const z = await H.newPage(browser, srv.url + '/index.html', { viewport: { width: 320, height: 640 }, dpr: 1, init: H.zeroViewport });
  await z.waitForTimeout(500);
  const z0 = await H.frameInfo(z);
  t.ok('Z1 Trang chạy khi cửa sổ chưa có kích thước: không lộ bố cục chưa co giãn', z0.vis === 'hidden', JSON.stringify(z0));
  t.ok('Z2 Log khởi động ghi view=0x0', z._logs.some(function (l) { return /boot v.* view=0x0$/.test(l); }), z._logs.join(' | '));
  const tz = Date.now();
  await z.evaluate(function () { window.__zero = false; });
  await z.waitForFunction(function () { return getComputedStyle(document.getElementById('wrap')).visibility === 'visible'; }, null, { timeout: 3000 }).catch(function () {});
  const dz = Date.now() - tz, z1 = await H.frameInfo(z);
  t.ok('Z3 Có kích thước là dàn lại ngay (không chờ sự kiện resize), đúng như khi mở bình thường',
    z1.vis === 'visible' && dz < 400 && z1.canvas === want.canvas && z1.inside && Math.abs(z1.bx - want.bx) < 0.005 && Math.abs(z1.bw - want.bw) < 0.005 && z1.ui === want.ui,
    'sau ' + dz + ' ms: ' + JSON.stringify(z1) + ' / chuẩn ' + JSON.stringify(want));
  t.ok('Z4 Ghi mốc "view WxH" để chẩn đoán trên máy thật', z._logs.some(function (l) { return /^\[oneline\] view 320x640 t=\d+$/.test(l); }) && !z._errs.length, z._logs.join(' | ') + z._errs.join(','));
  await z.click('#bStart');
  t.ok('Z5 Sau đó chơi bình thường', (await H.snap(z)).st === 'ready');
  await z.context().close();

  // Trang quyền riêng tư: dài hơn màn hình điện thoại nên phải cuộn được, có nút Về game ở cả đầu và cuối trang
  const pv = await H.newPage(browser, srv.url + '/privacy.html', { viewport: { width: 320, height: 568 }, touch: true, mobile: true, wait: false });
  const pi = await pv.evaluate(function () {
    var b = document.querySelectorAll('a.back'), de = document.documentElement;
    return { n: b.length, top: b[0] ? b[0].getBoundingClientRect().top : -1, last: b[b.length - 1] ? b[b.length - 1].getBoundingClientRect().top : -1,
      href: Array.prototype.map.call(b, function (a) { return a.getAttribute('href'); }).join(','), sh: de.scrollHeight, vh: innerHeight,
      ov: getComputedStyle(document.body).overflowY + '/' + getComputedStyle(de).overflowY, wide: de.scrollWidth > de.clientWidth + 1 };
  });
  t.ok('V1 Trang quyền riêng tư: nút Về game ngay đầu trang (không cần cuộn) và ở cuối trang', pi.n === 2 && pi.top >= 0 && pi.top < 120 && pi.last > pi.vh && pi.href === 'index.html,index.html', JSON.stringify(pi));
  await pv.mouse.wheel(0, 5000); await pv.waitForTimeout(300);
  const py = await pv.evaluate(function () { var b = document.querySelectorAll('a.back'); return { y: scrollY, lastBottom: b[b.length - 1].getBoundingClientRect().bottom, vh: innerHeight }; });
  t.ok('V2 Trang quyền riêng tư cuộn được tới cuối, không tràn ngang', py.y > 100 && py.lastBottom <= py.vh + 0.5 && !pi.wide && !/hidden/.test(pi.ov) && !pv._errs.length, JSON.stringify(py) + ' ' + pi.ov);
  await pv.click('a.back >> nth=1');
  await pv.waitForFunction(function () { return !!document.getElementById('bStart'); }, null, { timeout: 8000 }).catch(function () {});
  t.ok('V3 Bấm Về game ở cuối trang trở lại game', /index\.html$/.test(pv.url()), pv.url());
  await pv.context().close();

  // Tỉ lệ điểm ảnh rất cao: canvas bị giới hạn ở 2.5x để không ngốn bộ nhớ
  const hd = await H.newPage(browser, srv.url + '/index.html', { viewport: { width: 412, height: 915 }, dpr: 4 });
  const hc = await hd.evaluate(function () { return document.getElementById('cv').width; });
  t.ok('D1 Màn hình 4x: canvas giới hạn ở 2.5x', hc === Math.round(412 * 2.5), String(hc));
  await hd.context().close();
});
