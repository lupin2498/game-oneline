'use strict';
// Trường hợp biên: dữ liệu lưu hỏng, quãng đường cực lớn, chơi lại liên tục, độ chính xác va chạm,
// mê cung luôn qua được và không lòi khỏi màn.
const H = require('../lib/harness');

H.main('Trường hợp biên', async function (t, cleanup) {
  const srv = await H.serve(); cleanup.push(srv.close);
  const browser = await H.launch(); cleanup.push(function () { return browser.close(); });

  // 1. localStorage hỏng / bị chặn
  const cases = [
    ['best="abc"', function () { localStorage.setItem('oneline.best', 'abc'); }],
    ['best="-5"', function () { localStorage.setItem('oneline.best', '-5'); }],
    ['best="1e309"', function () { localStorage.setItem('oneline.best', '1e309'); }],
    ['runs là chuỗi hỏng', function () { localStorage.setItem('oneline.runs', '{oops'); }],
    ['runs sai kiểu', function () { localStorage.setItem('oneline.runs', '{"a":1}'); }],
    ['runs chứa phần tử rác', function () { localStorage.setItem('oneline.runs', '[null,5,{"m":"x"},{"m":7,"t":1},{"m":8},{"m":1e999}]'); }],
    ['localStorage ném lỗi', function () { Object.defineProperty(window, 'localStorage', { get: function () { throw new Error('blocked'); } }); }]
  ];
  for (const c of cases) {
    const pg = await H.newPage(browser, srv.url + '/index.html', { init: c[1] });
    await pg.click('#bStart');
    await pg.evaluate(function () { window.__dbg.run("state='run'; dist=22*9+1; lose('wall')"); });
    await pg.evaluate(function () { document.getElementById('bBoard2').click(); });
    await pg.waitForTimeout(60);
    const best = await pg.locator('#hB').innerText();
    const rows = await pg.$$eval('#bdList li', function (ls) { return ls.map(function (l) { return l.innerText.replace(/\s+/g, ' ').trim(); }); });
    t.ok('E1 Dữ liệu lưu hỏng: ' + c[0], !pg._errs.length && /^\d+ m$/.test(best) && rows.some(function (r) { return / 9 m$/.test(r); }) &&
      rows.every(function (r) { return !/NaN|undefined|Invalid|Infinity|1970/.test(r); }),
      'HUD "' + best + '", bảng: ' + rows.slice(0, 2).join(' | ') + (pg._errs.length ? ' JS: ' + pg._errs[0] : ''));
    await pg.context().close();
  }

  const pg = await H.newPage(browser, srv.url + '/index.html');
  await pg.click('#bStart');

  // 2. quãng đường cực lớn
  const far = await pg.evaluate(async function () {
    var d = window.__dbg;
    d.run("dist=2e6; scroll=2e6; wps=[]; for(var k=0;k<=6;k++) wps.push({y:scroll-100+STEP*k,x:240,hw:12.5}); ensure(scroll+H+STEP*3); startX=corridor(wy(startY)).x; dotX=tgtX=startX;");
    window.__t.fire('pointerdown', 240, 680);
    var fx = 240, fy = 680, frames = 0, nan = false, t0 = performance.now();
    while (d.snap().st === 'run' && performance.now() - t0 < 4000) {
      var g = d.snap(); frames++;
      ['dotX', 'dotY', 'dist', 'scroll', 'speed', 'cx', 'hw'].forEach(function (f) { if (!isFinite(g[f])) nan = true; });
      var c = d.run('corridor(wy(dotY)+speed/60)'); fx += (c.x - g.dotX) * 0.6; fy += (460 - g.dotY) * 0.25;
      window.__t.fire('pointermove', fx, fy);
      await window.__t.raf(1);
    }
    var g2 = d.snap();
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 }));
    return { nan: nan, frames: frames, m: g2.m, speed: g2.speed, hud: document.getElementById('hD').textContent };
  });
  t.ok('E2 Quãng đường ~91 km: không NaN, HUD vẫn đúng', !far.nan && far.frames > 5 && far.speed === 440 && /^9\d{4} m$/.test(far.hud), far.frames + ' khung, HUD ' + far.hud);

  // 3. chơi lại 300 lần
  const h0 = await pg.evaluate(function () { return performance.memory ? performance.memory.usedJSHeapSize / 1048576 : 0; });   // chỉ Chromium đo được bộ nhớ
  const again = await pg.evaluate(async function () {
    var d = window.__dbg;
    for (var i = 0; i < 300; i++) {
      document.getElementById('pOver').classList.add('hide'); d.run('reset()');
      window.__t.fire('pointerdown', 240, 680);
      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 }));
      if (i % 25 === 0) await window.__t.raf(1);
    }
    document.getElementById('bAgain').click();
    await window.__t.raf(3);
    var t0 = d.snap().time, r0 = performance.now(); await new Promise(function (r) { setTimeout(r, 1000); });
    return { st: d.snap().st, gameSec: d.snap().time - t0, realSec: (performance.now() - r0) / 1000, heap: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : 0,
      over: !document.getElementById('pOver').classList.contains('hide'), runs: JSON.parse(localStorage.getItem('oneline.runs') || '[]').length };
  });
  t.ok('E3 Chơi lại 300 lần: trạng thái sạch, chỉ một vòng lặp chạy', again.st === 'ready' && !again.over && Math.abs(again.gameSec - again.realSec) < 0.15 && again.heap < h0 + 12,
    'thời gian game ' + again.gameSec.toFixed(2) + 's / thực ' + again.realSec.toFixed(2) + 's, heap ' + h0.toFixed(1) + ' -> ' + again.heap.toFixed(1) + ' MB');

  // 4. va chạm: chấm không được lún vào tường quá 1,5 px (+ sai số đo) mà vẫn sống
  const col = await pg.evaluate(function () {
    var d = window.__dbg, worst = 0, n = 0, loose = 0;
    for (var runNo = 0; runNo < 30; runNo++) {
      d.run('reset()'); d.run('ensure(12000)');
      for (var y = 700; y < 11000; y += 13) {
        for (var side = -1; side <= 1; side += 2) {
          var c = d.run('corridor(' + y + ')'), lo = 0, hi = c.hw + 2;
          for (var it = 0; it < 26; it++) {
            var m = (lo + hi) / 2;
            var hit = d.run('(function(){var sv=[dotX,dotY,scroll];scroll=0;dotY=H-' + y + ';dotX=' + c.x + '+(' + side + ')*' + m + ';var h=hitWall();dotX=sv[0];dotY=sv[1];scroll=sv[2];return h;})()');
            if (hit) hi = m; else lo = m;
          }
          var px = c.x + side * lo, dmin = 1e9;
          for (var yy = y - 30; yy <= y + 30; yy += 0.25) { var cc = d.run('corridor(' + yy + ')'); dmin = Math.min(dmin, Math.hypot(cc.x + side * cc.hw - px, yy - y)); }
          worst = Math.max(worst, 6.5 - dmin); if (6.5 - dmin < -1.0) loose++; n++;
        }
      }
    }
    return { worst: worst, n: n, loose: loose };
  });
  t.ok('E4 Va chạm khớp hình vẽ: lún tường tối đa <= 1,55 px', col.worst <= 1.55, col.worst.toFixed(2) + ' px trên ' + col.n + ' điểm đo');
  t.ok('E5 Va chạm không quá khắt khe (chưa chạm tường đã thua)', col.loose === 0, col.loose + ' điểm thua sớm hơn 1 px');

  // 5. mê cung: không lòi khỏi màn, không có NaN, không có khúc không thể qua
  const maze = await pg.evaluate(function () {
    var d = window.__dbg;
    return d.run('(function(){var out=0,nan=0,tot=0,narrow=0,infeasible=0,minHb=1e9;' +
      'for(var r=0;r<60;r++){reset();ensure(700*22+2000);' +
      ' var lo=235,hi=245,y=258,di=0,dt=1/240,bad=false;' +
      ' while(di<600*22){var sp=Math.min(440,130+di*0.055);di+=sp*dt;y+=sp*dt;' +
      '  var c=corridor(y),c2=corridor(y+0.5),sl=(c2.x-c.x)/0.5,room=c.hw-R*Math.sqrt(1+sl*sl)+1.5;tot++;' +
      '  if(!isFinite(c.x)||!isFinite(c.hw))nan++; if(c.x-c.hw<3.99||c.x+c.hw>W-3.99)out++; if(c.hb<minHb)minHb=c.hb;' +
      '  if(room<0){narrow++;bad=true;break;}' +
      '  lo=Math.max(lo-2600*dt,c.x-room);hi=Math.min(hi+2600*dt,c.x+room);if(lo>hi){bad=true;break;}}' +
      ' if(bad)infeasible++;}' +
      'reset();return {out:out,nan:nan,tot:tot,narrow:narrow,infeasible:infeasible,minHb:minHb};})()');
  });
  t.ok('E6 Mê cung (60 bản, tới 600 m): tường không lòi khỏi màn, không NaN', maze.out === 0 && maze.nan === 0, maze.tot + ' mẫu, lòi ' + maze.out + ', NaN ' + maze.nan);
  t.ok('E7 Mê cung luôn có đường qua được (tốc độ kéo tối đa 2600 px/s)', maze.infeasible === 0 && maze.narrow === 0, maze.infeasible + '/60 bản kẹt, hẹp nhất ±' + maze.minHb.toFixed(1) + ' px');

  // 6. đoạn thẳng khởi động
  const straight = await pg.evaluate(function () {
    var d = window.__dbg; d.run('reset()'); var y = 258; while (Math.abs(d.run('corridor(' + y + ').x') - 240) < 0.5 && y < 3000) y++;
    return (y - 258) / 130;
  });
  t.ok('E8 Có đoạn thẳng ~2 giây sau vạch xuất phát', straight >= 2 && straight <= 3.5, straight.toFixed(1) + ' giây');

  t.ok('E9 Không có lỗi JS', pg._errs.length === 0, pg._errs.slice(0, 2).join(' | '));
});
