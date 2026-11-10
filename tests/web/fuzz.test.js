'use strict';
// Fuzz: bắn chuỗi thao tác ngẫu nhiên (chạm, rê, nhấc, huỷ, bấm nút, xoay màn, ẩn app...) rồi kiểm bất biến sau mỗi bước.
//   FUZZ_SECONDS (mặc định 25 giây mỗi hạt giống), FUZZ_SEEDS (mặc định "7,23,2026")
const H = require('../lib/harness');

H.main('Fuzz', async function (t, cleanup) {
  const srv = await H.serve(); cleanup.push(srv.close);
  const browser = await H.launch(); cleanup.push(function () { return browser.close(); });
  const SECONDS = +(process.env.FUZZ_SECONDS || 25);
  const seeds = (process.env.FUZZ_SEEDS || '7,23,2026').split(',').map(Number);

  for (const SEED of seeds) {
    let seed = SEED;
    const R = function () { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const pg = await H.newPage(browser, srv.url + '/index.html', { touch: true, mobile: true });
    const cdp = await pg.context().newCDPSession(pg);
    let box = await pg.locator('#wrap').boundingBox();
    const viol = {}; const note = function (k, d) { if (!viol[k]) viol[k] = { n: 0, ex: d }; viol[k].n++; };
    let steps = 0, runs = 0, navs = 0, maxTrail = 0; const deaths = {};
    const active = new Map();
    const pts = function () { return Array.from(active.entries()).map(function (e) { return { x: e[1].x, y: e[1].y, id: e[0] }; }); };
    const release = async function () { if (active.size) { active.clear(); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); } };
    const comeBack = async function (force) {
      if (force) await pg.waitForTimeout(500);          // chờ lệnh chuyển trang (nếu có) kịp hoàn tất
      await pg.waitForLoadState('load').catch(function () {});
      if (!force && /index\.html/.test(pg.url())) return;
      if (!/index\.html/.test(pg.url())) {       // đang ở trang riêng tư hoặc link ngoài: thử Back, không được thì mở lại game
        navs++;
        await pg.goBack().catch(function () {}); await pg.waitForLoadState('load').catch(function () {});
        if (!/index\.html/.test(pg.url())) await pg.goto(srv.url + '/index.html');
      }
      await pg.waitForFunction(function () { return !!window.__dbg; }, null, { timeout: 10000 });
      box = await pg.locator('#wrap').boundingBox(); active.clear();
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }).catch(function () {});
    };
    const t0 = Date.now();
    while (Date.now() - t0 < SECONDS * 1000) {
      const k = box.width / 480, r = R();
      try {
        if (r < 0.18) {
          const id = 1 + Math.floor(R() * 4); if (active.has(id)) continue;
          const z = R(); let x, y;
          if (z < 0.4) { x = 240 + (R() - .5) * 90; y = 680 + (R() - .5) * 90; } else if (z < 0.7) { x = 240 + (R() - .5) * 80; y = 501 + (R() - .5) * 80; } else { x = R() * 480; y = R() * 760; }
          active.set(id, { x: box.x + x * k, y: box.y + y * k });
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts() });
        } else if (r < 0.68 && active.size) {
          active.forEach(function (p) { p.x += (R() - .5) * 30 * k; p.y += (R() - .5) * 30 * k; });
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts() });
        } else if (r < 0.78 && active.size) {
          const ids = Array.from(active.keys()); active.delete(ids[Math.floor(R() * ids.length)]);
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: pts() });
        } else if (r < 0.80 && active.size) {
          active.clear(); await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
        } else if (r < 0.88) {
          await release();
          const vis = await pg.evaluate(function () {
            var v = function (id) { return !document.getElementById(id).classList.contains('hide'); };
            return { s: v('pStart'), o: v('pOver'), b: v('pBoard') };
          });
          const pick = R();
          if (vis.b) await pg.tap('#bClose');
          else if (vis.s) await pg.tap(pick < 0.75 ? '#bStart' : '#bBoard1');
          else if (vis.o) await pg.tap(pick < 0.75 ? '#bAgain' : '#bBoard2');
        } else if (r < 0.90) {
          await release();
          const dims = [[412, 860], [360, 640], [768, 1024], [860, 412], [320, 568]][Math.floor(R() * 5)];
          await pg.setViewportSize({ width: dims[0], height: dims[1] }); await pg.waitForTimeout(40);
          box = await pg.locator('#wrap').boundingBox();
        } else if (r < 0.91) {
          await pg.evaluate(function () { window.dispatchEvent(new Event('blur')); });
        } else if (r < 0.93) {
          await pg.evaluate(function () {
            Object.defineProperty(document, 'hidden', { configurable: true, get: function () { return true; } }); document.dispatchEvent(new Event('visibilitychange'));
            Object.defineProperty(document, 'hidden', { configurable: true, get: function () { return false; } }); document.dispatchEvent(new Event('visibilitychange'));
          });
        } else {
          await pg.waitForTimeout(10 + R() * 120);
        }
        steps++;
        await comeBack();
        const s = await pg.evaluate(function () {
          var d = window.__dbg.snap(), v = function (id) { return !document.getElementById(id).classList.contains('hide'); };
          d.pStart = v('pStart'); d.pOver = v('pOver'); d.pBoard = v('pBoard');
          var wr = document.getElementById('wrap').getBoundingClientRect();
          d.cw = document.getElementById('cv').width; d.ratio = wr.width / wr.height; d.inView = wr.right <= innerWidth + 0.5 && wr.bottom <= innerHeight + 0.5;
          return d;
        });
        if (['idle', 'ready', 'run', 'over'].indexOf(s.st) < 0) note('trạng thái lạ', s.st);
        if ((s.pStart ? 1 : 0) + (s.pOver ? 1 : 0) + (s.pBoard ? 1 : 0) > 1) note('hai bảng hiện cùng lúc', JSON.stringify([s.pStart, s.pOver, s.pBoard]));
        if (!s.pBoard && s.pOver !== (s.st === 'over')) note('bảng Thua lệch trạng thái', s.st + ' pOver=' + s.pOver);
        if (!s.pBoard && s.pStart !== (s.st === 'idle')) note('bảng Mở đầu lệch trạng thái', s.st + ' pStart=' + s.pStart);
        if (s.pBoard && (s.st === 'run' || s.st === 'ready')) note('bảng xếp hạng mở khi đang chơi', s.st);
        ['dotX', 'dotY', 'dist', 'scroll', 'speed', 'cx', 'hw'].forEach(function (f) { if (!Number.isFinite(s[f])) note('NaN/Infinity ở ' + f, String(s[f])); });
        if (s.st === 'run' && (s.dotY < 760 * 0.15 - 0.01 || s.dotY > 760 * 0.78 + 0.01)) note('nhân vật ra ngoài dải dọc', s.dotY);
        if (s.st === 'run' && Math.abs(s.dotX - s.cx) > s.hw) note('đang chơi mà nhân vật nằm trong tường', (s.dotX - s.cx).toFixed(1) + ' / ' + s.hw.toFixed(1));
        if (s.st === 'run' && s.activeId == null) note('đang chơi mà không có ngón nào giữ', '');
        if (s.cw < 2 || Math.abs(s.ratio - 480 / 760) > 0.004 || !s.inView) note('khung chơi sai kích thước', s.cw + ' ' + s.ratio);
        maxTrail = Math.max(maxTrail, s.trail);
        if (s.st === 'over' && s.code) { deaths[s.code] = (deaths[s.code] || 0) + 1; await pg.evaluate(function () { window.__dbg.run("overCode=''"); }); runs++; }
      } catch (e) {
        // Chạm trúng link "Quyền riêng tư" làm trang chuyển hướng giữa chừng: quay lại game rồi fuzz tiếp
        if (/context was destroyed|navigation|Target closed|detached/i.test(String(e.message))) { try { await comeBack(true); } catch (e2) { note('không quay lại được game', String(e2.message).slice(0, 80) + ' @ ' + pg.url() + ' dbg=' + await pg.evaluate(function () { return typeof window.__dbg + '/' + document.readyState + '/' + document.title; }).catch(function (x) { return 'ERR ' + x.message.slice(0, 60); })); } }
        else note('lỗi khi chạy fuzz', String(e.message).slice(0, 120));
      }
    }
    const keys = Object.keys(viol);
    t.ok('F seed=' + SEED + ': ' + steps + ' thao tác, ' + runs + ' lượt ' + JSON.stringify(deaths) + ', mở trang riêng tư ' + navs + ' lần',
      keys.length === 0 && pg._errs.length === 0 && steps > 50,
      keys.map(function (k) { return k + ' x' + viol[k].n + ' (vd: ' + viol[k].ex + ')'; }).concat(pg._errs.slice(0, 2)).join('; '));
    await pg.context().close();
  }
});
