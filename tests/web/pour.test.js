'use strict';
// Game phụ Rót Nước (extras/pour): giữ để rót, thả đúng vạch; đa chạm, bố cục, bot chơi thử.
const H = require('../lib/harness');
const fs = require('fs'), path = require('path');

const HOOK = 'window.__dbg={snap:function(){return {st:state,level:level,score:score,best:best,yw:yw,yT:yTarget,tol:tol,vol:vol,' +
  'cap:cup?cup.cap:0,name:cup?cup.name:"",activeId:activeId};},run:function(code){return eval(code);}};';

H.main('Rót Nước', async function (t, cleanup) {
  const src = fs.readFileSync(path.join(H.ROOT, 'extras', 'pour', 'index.html'), 'utf8');
  if (!src.includes('/*__TEST_HOOK__*/')) throw new Error('pour thiếu dấu móc test');
  const srv = await H.serve({ overrides: { '/extras/pour/index.html': src.replace('/*__TEST_HOOK__*/', HOOK) } }); cleanup.push(srv.close);
  const browser = await H.launch(); cleanup.push(function () { return browser.close(); });
  const url = srv.url + '/extras/pour/index.html';
  const pg = await H.newPage(browser, url, { touch: true, mobile: true });
  const snap = function () { return H.snap(pg); };
  const down = function (id) { return pg.evaluate(function (i) { document.getElementById('wrap').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: i, pointerType: 'touch', button: 0, clientX: 200, clientY: 500 })); }, id); };
  const up = function (id) { return pg.evaluate(function (i) { window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: i })); }, id); };

  t.ok('P01 Mở game: hiện bảng mở đầu, không lỗi', await pg.locator('#pStart').isVisible() && !pg._errs.length, pg._errs.join(' | '));
  await pg.tap('#bStart'); await pg.waitForTimeout(80);
  let s = await snap();
  t.ok('P02 Bắt đầu -> sẵn sàng rót, có cốc và vạch', s.st === 'ready' && s.cap > 500 && s.yT > 0 && s.name.length > 0, s.name);

  await down(1); await pg.waitForTimeout(150);
  s = await snap();
  t.ok('P03 Giữ ngón tay -> nước dâng', s.st === 'pour' && s.vol > 0);
  await down(2); await pg.waitForTimeout(40); await up(2); await pg.waitForTimeout(60);
  t.ok('P04 Ngón thứ hai chạm rồi nhấc: vẫn đang rót', (await snap()).st === 'pour');
  await up(1); await pg.waitForTimeout(80);
  s = await snap();
  t.ok('P05 Thả quá sớm -> "Thiếu nước!"', s.st === 'over' && (await pg.locator('#oTitle').innerText()) === 'Thiếu nước!');
  t.ok('P06 Màn thua hiện điểm và số thiếu', /Còn thiếu [\d.]+ px/.test(await pg.locator('#oSub').innerText()) && (await pg.locator('#oScore').innerText()) === '0');

  await pg.tap('#bAgain'); await pg.waitForTimeout(80);
  await down(1);
  await pg.waitForFunction(function () { return window.__dbg.snap().st === 'over'; }, null, { timeout: 8000 });
  t.ok('P07 Giữ mãi -> "Tràn ly!"', (await pg.locator('#oTitle').innerText()) === 'Tràn ly!');
  await up(1);

  await pg.tap('#bAgain'); await pg.waitForTimeout(80);
  await pg.keyboard.down('Space'); await pg.waitForTimeout(120);
  t.ok('P08 Phím Space cũng rót được', (await snap()).st === 'pour');
  await pg.evaluate(function () { window.dispatchEvent(new Event('blur')); }); await pg.waitForTimeout(60);
  t.ok('P09 Mất focus khi đang rót -> coi như thả tay', (await snap()).st !== 'pour');
  await pg.keyboard.up('Space');

  // Bot: thả đúng lúc mực nước chạm vạch -> phải qua được nhiều màn, điểm tăng, vạch hẹp dần
  const bot = await pg.evaluate(async function () {
    var d = window.__dbg, names = {}, tols = [];
    document.getElementById('bAgain').click();
    await new Promise(function (r) { setTimeout(r, 60); });
    for (var round = 0; round < 12; round++) {
      var s = d.snap(); if (s.st !== 'ready') break;
      names[s.name] = 1; tols.push(s.tol);
      document.getElementById('wrap').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 9, pointerType: 'touch', button: 0 }));
      while (true) {
        s = d.snap(); if (s.st !== 'pour') break;
        if (s.yw - s.yT <= s.tol * 0.3) { window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 9 })); break; }
        await new Promise(function (r) { requestAnimationFrame(r); });
      }
      var t0 = performance.now();
      while (d.snap().st === 'result' && performance.now() - t0 < 3000) await new Promise(function (r) { requestAnimationFrame(r); });
    }
    var f = d.snap();
    return { level: f.level, score: f.score, st: f.st, shapes: Object.keys(names).length, tols: tols };
  });
  t.ok('P10 Bot thả đúng vạch qua được >= 8 màn', bot.level >= 8 && bot.score > 500, 'màn ' + bot.level + ', ' + bot.score + ' điểm, ' + bot.shapes + ' dáng cốc');
  t.ok('P11 Vạch hẹp dần theo màn', bot.tols.length > 3 && bot.tols.every(function (v, i) { return i === 0 || v < bot.tols[i - 1]; }), bot.tols.slice(0, 5).map(function (v) { return v.toFixed(1); }).join(' > '));

  // Hình học cốc: thể tích tăng đơn điệu theo mực nước với mọi dáng cốc, mọi màn
  const geo = await pg.evaluate(function () {
    return window.__dbg.run('(function(){var bad=0,n=0;for(var lv=1;lv<=25;lv++)for(var i=0;i<40;i++){var c=makeCup(lv),prev=Infinity;n++;' +
      'if(!(c.cap>500)||!isFinite(c.cap)){bad++;continue;}' +
      'for(var k=0;k<=20;k++){var y=levelAt(c,c.cap*k/20);if(!isFinite(y)||y>prev+0.01){bad++;break;}prev=y;}' +
      'if(c.xMin<0||c.xMax>W||c.yTop<SPOUT_Y)bad++;}return {bad:bad,n:n};})()');
  });
  t.ok('P12 1000 cốc ngẫu nhiên: hình học hợp lệ, nằm trong màn', geo.bad === 0, geo.bad + '/' + geo.n + ' cốc lỗi');
  t.ok('P13 Không có lỗi JS', pg._errs.length === 0, pg._errs.slice(0, 2).join(' | '));
  await pg.context().close();

  // Bố cục
  for (const v of [[320, 568], [412, 915], [844, 390], [1440, 900]]) {
    const p2 = await H.newPage(browser, url, { viewport: { width: v[0], height: v[1] } });
    await p2.waitForTimeout(100);
    const m = await p2.evaluate(function () {
      var wr = document.getElementById('wrap').getBoundingClientRect(), ps = document.getElementById('pStart');
      var btn = document.getElementById('bStart').getBoundingClientRect();
      return { r: wr.width / wr.height, inView: wr.bottom <= innerHeight + 0.5 && wr.right <= innerWidth + 0.5 && wr.top >= -0.5,
        clip: ps.scrollHeight > ps.clientHeight + 1, btnIn: btn.bottom <= wr.bottom + 0.5 && btn.top >= wr.top };
    });
    t.ok('P14 Bố cục ' + v[0] + 'x' + v[1] + ': đúng tỉ lệ, nút Bắt đầu nằm trong khung', Math.abs(m.r - 480 / 760) < 0.004 && m.inView && !m.clip && m.btnIn && !p2._errs.length, JSON.stringify(m));
    await p2.context().close();
  }

  // Trang chạy khi cửa sổ chưa có kích thước (WebView): giấu khung, có kích thước là dàn ngay
  const ref = await H.newPage(browser, srv.url + '/extras/pour/index.html', { viewport: { width: 320, height: 640 }, dpr: 1 });
  const want = await H.frameInfo(ref); await ref.context().close();
  const z = await H.newPage(browser, srv.url + '/extras/pour/index.html', { viewport: { width: 320, height: 640 }, dpr: 1, init: H.zeroViewport });
  await z.waitForTimeout(400);
  const z0 = await H.frameInfo(z);
  await z.evaluate(function () { window.__zero = false; });
  await z.waitForFunction(function () { return getComputedStyle(document.getElementById('wrap')).visibility === 'visible'; }, null, { timeout: 3000 }).catch(function () {});
  const z1 = await H.frameInfo(z);
  t.ok('P15 Cửa sổ chưa có kích thước lúc tải: giấu khung, có kích thước là dàn lại đúng', z0.vis === 'hidden' && z1.vis === 'visible' && z1.canvas === want.canvas && z1.inside && Math.abs(z1.bx - want.bx) < 0.005 && z1.ui === want.ui && !z._errs.length,
    JSON.stringify(z0) + ' -> ' + JSON.stringify(z1));
  await z.context().close();
});
