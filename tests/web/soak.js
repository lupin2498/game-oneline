'use strict';
// Độ bền: bot chơi liên tục nhiều lượt (cả hai kiểu điều khiển), theo dõi bộ nhớ và thời gian khung hình.
//   node tests/web/soak.js [số phút, mặc định 10]
const H = require('../lib/harness');

H.main('Độ bền', async function (t, cleanup) {
  const MIN = +(process.argv[2] || process.env.SOAK_MINUTES || 10);
  const srv = await H.serve(); cleanup.push(srv.close);
  const browser = await H.launch(); cleanup.push(function () { return browser.close(); });
  const pg = await H.newPage(browser, srv.url + '/index.html');
  await pg.click('#bStart');
  await pg.evaluate(function () {
    var d = window.__dbg; window.__runs = []; window.__ft = []; var lastT = 0, fx, fy, mode = 'stick', runNo = 0;
    function start() {
      document.getElementById('pOver').classList.add('hide'); d.run('reset()');
      mode = (runNo++ % 2) ? 'drag' : 'stick'; fx = 240; fy = mode === 'stick' ? 680 : 501.6;
      window.__t.fire('pointerdown', fx, fy);
    }
    start();
    (function tick(ts) {
      if (lastT) window.__ft.push(ts - lastT); lastT = ts; if (window.__ft.length > 20000) window.__ft.splice(0, 10000);
      var g = d.snap();
      if (g.st === 'run') {
        var c = d.run('corridor(wy(dotY)+speed/60)');
        fx += (c.x - g.dotX) * 0.55; fy += (460 - g.dotY) * 0.25;
        window.__t.fire('pointermove', fx, fy);
      } else if (g.st === 'over') {
        window.__runs.push({ mode: mode, m: g.m, why: g.code });
        window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 }));
        start();
      }
      requestAnimationFrame(tick);
    })(0);
  });
  const t0 = Date.now(), samples = [];
  while (Date.now() - t0 < MIN * 60000) {
    await pg.waitForTimeout(30000);
    const m = await pg.evaluate(function () {
      var ft = window.__ft.slice(-1500).sort(function (a, b) { return a - b; });
      return { heap: performance.memory.usedJSHeapSize / 1048576, p50: ft[Math.floor(ft.length * .5)], p95: ft[Math.floor(ft.length * .95)], runs: window.__runs.length, s: window.__dbg.snap(),
        nodes: document.getElementsByTagName('*').length };
    });
    samples.push(m);
    console.log('[' + ((Date.now() - t0) / 60000).toFixed(1) + ' phút] heap ' + m.heap.toFixed(1) + ' MB | khung p50 ' + m.p50.toFixed(1) + ' ms, p95 ' + m.p95.toFixed(1) + ' ms | ' + m.runs + ' lượt | trail ' + m.s.trail + ', wps ' + m.s.wps + ', DOM ' + m.nodes);
  }
  const runs = await pg.evaluate(function () { return window.__runs; });
  const med = function (md) { const r = runs.filter(function (x) { return x.mode === md; }).map(function (x) { return x.m; }).sort(function (a, b) { return a - b; }); return r.length ? r[Math.floor(r.length / 2)] : 0; };
  const first = samples.slice(0, 3).reduce(function (a, s) { return a + s.heap; }, 0) / Math.min(3, samples.length);
  const lastAvg = samples.slice(-3).reduce(function (a, s) { return a + s.heap; }, 0) / Math.min(3, samples.length);
  t.ok('K1 ' + runs.length + ' lượt trong ' + MIN + ' phút, trung vị nút tròn ' + med('stick') + ' m / kéo ' + med('drag') + ' m', runs.length > MIN * 2 && med('stick') >= 60 && med('drag') >= 60);
  t.ok('K2 Bộ nhớ ổn định (không rò rỉ)', lastAvg < first + 6, first.toFixed(1) + ' -> ' + lastAvg.toFixed(1) + ' MB');
  t.ok('K3 Số phần tử DOM không tăng', samples[samples.length - 1].nodes <= samples[0].nodes + 2, samples[0].nodes + ' -> ' + samples[samples.length - 1].nodes);
  t.ok('K4 Dữ liệu trong game luôn có giới hạn', samples.every(function (s) { return s.s.trail < 1900 && s.s.wps < 40; }));
  t.ok('K5 Không lỗi JS', pg._errs.length === 0, pg._errs.slice(0, 2).join(' | '));
});
