'use strict';
// Hiệu năng vẽ: số lệnh vẽ mỗi khung hình (không đo thời gian — máy test nhanh chậm khác nhau) và cơ chế tự hạ
// độ phân giải canvas khi máy vẽ không kịp.
const H = require('../lib/harness');

H.main('Hiệu năng', async function (t, cleanup) {
  const srv = await H.serve(); cleanup.push(srv.close);
  const browser = await H.launch(); cleanup.push(function () { return browser.close(); });
  const open = function () { return H.newPage(browser, srv.url + '/index.html', { viewport: { width: 412, height: 915 }, dpr: 2.625, touch: true, mobile: true }); };
  const q = function (pg) { return pg.evaluate(function () { var d = window.__dbg; return { q: d.run('quality'), lock: d.run('qLock'), tr: d.run('qTry'), cw: document.getElementById('cv').width, w: document.getElementById('wrap').getBoundingClientRect().width }; }); };
  const adapt = async function (pg, list) { for (const a of list) await pg.evaluate(function (a) { window.__dbg.run('adapt(' + a + ')'); }, a); await pg.evaluate(function () { return window.__t.raf(3); }); };

  // ---- số lệnh vẽ mỗi khung hình: vẽ từng nét gạch chéo dưới vùng cắt từng làm một khung hình tốn 32 ms ----
  let pg = await open();
  await pg.click('#bStart');
  const n = await pg.evaluate(function () {
    var d = window.__dbg, cx = document.getElementById('cv').getContext('2d'), c = { stroke: 0, fill: 0, clip: 0, grad: 0, fillRect: 0 };
    d.run("state='run'; activeId=1; mode='stick'");
    for (var i = 0; i < 90; i++) d.run('dotX=corridor(wy(dotY)).x; step(1/60);');
    ['stroke', 'fill', 'clip', 'fillRect'].forEach(function (k) { var f = cx[k]; cx[k] = function () { c[k]++; return f.apply(cx, arguments); }; });
    ['createLinearGradient', 'createRadialGradient'].forEach(function (k) { var f = cx[k]; cx[k] = function () { c.grad++; return f.apply(cx, arguments); }; });
    d.run('draw()');
    return c;
  });
  t.ok('PF1 Một khung hình dùng ít lệnh vẽ (gạch chéo trên tường gộp trong một nét dưới mỗi vùng cắt)', n.stroke <= 24 && n.clip <= 2 && n.fill <= 30, JSON.stringify(n));
  t.ok('PF2 Không tô lại nền gradient cả màn mỗi khung hình (nền là CSS của canvas)', n.grad <= 5 && n.fillRect <= 2 &&
    /gradient/.test(await pg.evaluate(function () { return getComputedStyle(document.getElementById('cv')).backgroundImage; })), JSON.stringify(n));
  await pg.context().close();

  // ---- tự hạ độ phân giải: máy vẽ không kịp (50 ms/khung), nhịp màn hình làm tròn nên nấc đầu chưa thấy khác ----
  pg = await open();
  const q0 = await q(pg);
  await adapt(pg, [50]);
  const q1 = await q(pg);
  await adapt(pg, [50]);
  const q2 = await q(pg);
  await adapt(pg, [50]);
  const q3 = await q(pg);
  await adapt(pg, [33]);
  const q4 = await q(pg);
  t.ok('Q1 Hai đợt đo liền dưới 28 khung hình/giây mới hạ độ nét (một đợt thì chưa)', q0.q === 1 && q1.q === 1 && q2.q === 0.75 && q2.tr === 1, [q0.q, q1.q, q2.q].join(' -> '));
  t.ok('Q2 Hạ một nấc chưa nhanh hơn thì hạ tiếp; nhanh hơn rõ thì dừng ở đó', q3.q === 0.56 && q4.q === 0.56 && !q4.tr && !q4.lock, [q3.q, q4.q].join(' -> '));
  t.ok('Q3 Canvas nhỏ đi đúng tỉ lệ, khung chơi trên màn hình giữ nguyên', Math.abs(q4.cw - q0.cw * 0.56) <= 1 && q4.w === q0.w, 'canvas ' + q0.cw + ' -> ' + q4.cw + ', khung ' + q0.w + ' -> ' + q4.w);
  // điều khiển vẫn đúng 1:1 sau khi đổi độ phân giải
  await pg.click('#bStart');
  await pg.evaluate(function () { window.__t.fire('pointerdown', 240, 680); });
  await pg.evaluate(function () { return window.__t.raf(2); });
  const a = await H.snap(pg);
  await pg.evaluate(function () { window.__t.fire('pointermove', 262, 680); });
  await pg.evaluate(function () { return window.__t.raf(2); });
  const b = await H.snap(pg);
  t.ok('Q4 Sau khi hạ độ nét, nhân vật vẫn đi đúng 1:1 theo ngón tay', b.st === 'run' && Math.abs((b.dotX - a.dotX) - 22) < 0.05, (b.dotX - a.dotX).toFixed(2));
  await pg.context().close();

  // ---- tốc độ bị chặn bởi thứ khác (hạ tới đáy vẫn không nhanh hơn): trả lại độ nét, thôi không thử nữa ----
  pg = await open();
  await adapt(pg, [45, 45, 45, 45]);
  const c1 = await q(pg);
  await adapt(pg, [45]);
  const c2 = await q(pg);
  await adapt(pg, [80, 80, 80]);
  const c3 = await q(pg);
  t.ok('Q5 Hạ tới đáy vẫn không nhanh hơn: trả lại độ nét ban đầu và khoá', c1.q === 0.42 && c2.q === 1 && c2.lock && c3.q === 1 && c3.cw === q0.cw, [c1.q, c2.q, c3.q].join(' -> '));
  t.ok('Q6 Có ghi mốc "quality" để chẩn đoán trên máy thật', pg._logs.filter(function (l) { return /^\[oneline\] quality /.test(l); }).join('|') === '[oneline] quality 0.75 try avg=45|[oneline] quality 1 lock avg=45', pg._logs.join(' | '));
  await pg.context().close();

  // ---- máy chạy đều 30 khung hình/giây (tiết kiệm pin, màn 30 Hz) hay 60: không đụng tới ----
  pg = await open();
  await adapt(pg, [33.4, 33.4, 33.4, 33.4, 33.4, 34, 16.7, 16.7, 35.9, 35.9]);
  const s1 = await q(pg);
  t.ok('Q7 Chạy đều 30 hoặc 60 khung hình/giây: giữ nguyên độ nét', s1.q === 1 && !s1.lock && !s1.tr, JSON.stringify(s1));
  await pg.context().close();

  // ---- hạ sâu mà chỉ nhanh hơn chút ít thì không đáng: trả lại ----
  pg = await open();
  await adapt(pg, [57, 57, 55, 52, 48]);
  const w1 = await q(pg);
  t.ok('Q8 Hạ ba nấc mà chỉ nhanh hơn 16%: không đáng đánh đổi độ nét, trả lại và khoá', w1.q === 1 && w1.lock, JSON.stringify(w1));
  await pg.context().close();
  // máy thật sự được lợi (mỗi nấc nhanh hơn rõ): giữ từng nấc, dừng khi đã đủ mượt
  pg = await open();
  await adapt(pg, [53.5, 53.5, 44.4, 44.4, 33.8, 33.8, 33.8]);
  const w2 = await q(pg);
  t.ok('Q9 Mỗi nấc đều nhanh hơn rõ: giữ lại, dừng khi đạt ~30 khung hình/giây', w2.q === 0.56 && !w2.lock && !w2.tr, JSON.stringify(w2));
  await pg.context().close();

  // ---- đo thật trong vòng lặp: làm chậm draw() -> game tự phát hiện qua nhịp khung hình ----
  // (canvas nhỏ để phần vẽ thật không đáng kể so với phần làm chậm cố định: hạ độ nét không giúp gì -> trả lại và khoá)
  pg = await H.newPage(browser, srv.url + '/index.html', { viewport: { width: 320, height: 568 }, dpr: 1, touch: true, mobile: true });
  await pg.evaluate(function () { window.__dbg.run('var _dr=draw; draw=function(){ var t=performance.now(); while(performance.now()-t<44){} _dr(); }'); });
  await pg.waitForTimeout(2500);
  const early = await q(pg);            // 4 giây đầu sau khi mở trang chưa đo (máy nào lúc mới mở cũng giật)
  await pg.waitForFunction(function () { return window.__dbg.run('qLock'); }, null, { timeout: 40000 }).catch(function () {});
  const r1 = await q(pg);
  const logs = pg._logs.filter(function (l) { return /quality/.test(l); });
  t.ok('Q10 Vòng lặp tự đo nhịp khung hình: draw() chậm cố định -> thử hạ độ nét, không ăn thua thì trả lại và khoá',
    early.q === 1 && !early.tr && r1.lock && logs.length >= 2 && /quality 0\.75 try/.test(logs[0]) && /quality [0-9.]+ lock/.test(logs[logs.length - 1]) && [1, 0.75, 0.56].indexOf(r1.q) >= 0 && !pg._errs.length,
    'độ nét cuối ' + r1.q + ': ' + logs.join(' | ') + ' ' + pg._errs.join(','));
  await pg.context().close();
});
