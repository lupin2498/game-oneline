'use strict';
// PWA: service worker lưu offline, tự cập nhật (kể cả khi chỉ sửa firebase-config.js), manifest + icon hợp lệ.
const H = require('../lib/harness');
const fs = require('fs'), path = require('path');

function pngSize(buf) { return buf.readUInt32BE(16) + 'x' + buf.readUInt32BE(20); }

H.main('PWA', async function (t, cleanup) {
  const srv = await H.serve({ instrument: false }); cleanup.push(srv.close);
  const browser = await H.launch(); cleanup.push(function () { return browser.close(); });
  const pg = await H.newPage(browser, null, { sw: true });
  await pg.goto(srv.url + '/index.html');
  await pg.evaluate(function () { return navigator.serviceWorker.ready; });
  await pg.waitForTimeout(500);

  const cache = await pg.evaluate(async function () {
    var ks = await caches.keys(), c = await caches.open(ks[0]);
    return { ks: ks, urls: (await c.keys()).map(function (r) { return new URL(r.url).pathname; }).sort() };
  });
  const need = ['/', '/index.html', '/manifest.webmanifest', '/firebase-config.js', '/lib/online.js', '/privacy.html', '/icons/icon-192.png'];
  t.ok('W01 Service worker cài xong, lưu đủ file để chạy offline', cache.ks.length === 1 && need.every(function (u) { return cache.urls.indexOf(u) >= 0; }), cache.ks[0] + ': ' + cache.urls.length + ' file');

  // manifest + icon
  const man = JSON.parse(fs.readFileSync(path.join(H.ROOT, 'manifest.webmanifest'), 'utf8'));
  const badIcons = man.icons.filter(function (i) {
    const f = path.join(H.ROOT, i.src);
    return !fs.existsSync(f) || pngSize(fs.readFileSync(f)) !== i.sizes;
  }).map(function (i) { return i.src; });
  t.ok('W02 Manifest: đủ trường cài đặt, icon đúng kích thước khai báo', man.name && man.short_name && man.start_url && /fullscreen|standalone/.test(man.display) &&
    man.icons.some(function (i) { return i.sizes === '192x192'; }) && man.icons.some(function (i) { return i.sizes === '512x512'; }) && badIcons.length === 0, badIcons.join(','));
  const head = fs.readFileSync(path.join(H.ROOT, 'index.html'), 'utf8');
  const links = Array.from(head.matchAll(/<link rel="(?:icon|apple-touch-icon|manifest)" href="([^"]+)"/g)).map(function (m) { return m[1]; });
  t.ok('W03 Icon và manifest khai báo trong trang đều tồn tại', links.length === 3 && links.every(function (l) { return fs.existsSync(path.join(H.ROOT, l)); }), links.join(', '));
  const ati = fs.readFileSync(path.join(H.ROOT, 'icons', 'apple-touch-icon.png'));
  t.ok('W04 apple-touch-icon 180x180, không có kênh trong suốt', pngSize(ati) === '180x180' && ati[25] === 2, pngSize(ati) + ' kiểu màu ' + ati[25]);

  // offline
  await pg.context().setOffline(true);
  await pg.reload(); await pg.waitForTimeout(300);
  const off = await pg.evaluate(async function () {
    var icon = await fetch('icons/icon-192.png').then(function (r) { return r.status; }, function () { return 0; });
    var priv = await fetch('privacy.html').then(function (r) { return r.status; }, function () { return 0; });
    return { title: document.title, start: !!document.getElementById('bStart'), online: typeof window.Online, icon: icon, priv: priv };
  });
  t.ok('W05 Mất mạng: game vẫn mở, đủ script, icon và trang riêng tư', off.title === 'Đường Kẻ Một Nét' && off.start && off.online === 'object' && off.icon === 200 && off.priv === 200, JSON.stringify(off));
  await pg.click('#bStart'); await pg.waitForTimeout(100);
  t.ok('W06 Mất mạng: bấm Bắt đầu chơi được, không lỗi JS', !pg._errs.length && !(await pg.locator('#pStart').isVisible()), pg._errs.join(' | '));
  await pg.goto(srv.url + '/index.html?utm=abc').catch(function () {}); await pg.waitForTimeout(200);
  t.ok('W07 Mất mạng: mở kèm ?tham-số vẫn chạy', (await pg.title()) === 'Đường Kẻ Một Nét');
  await pg.goto(srv.url + '/').catch(function () {}); await pg.waitForTimeout(200);
  t.ok('W08 Mất mạng: mở bằng đường dẫn gốc "/" vẫn chạy', (await pg.title()) === 'Đường Kẻ Một Nét');
  await pg.context().setOffline(false);

  // Mở lại game như người chơi thật: đóng tab rồi mở tab mới (reload thường lấy script từ bộ nhớ đệm của tab,
  // không đi qua service worker, nên không phản ánh đúng lần mở kế tiếp)
  const ctx = pg.context();
  let cur = pg;
  const reopen = async function () {
    const errs = cur._errs;
    await cur.close();
    cur = await ctx.newPage(); cur._errs = errs;
    cur.on('pageerror', function (e) { errs.push('pageerror: ' + e.message); });
    await cur.goto(srv.url + '/index.html'); await cur.waitForTimeout(700);
    return cur;
  };

  // Sửa mỗi firebase-config.js rồi deploy (không đụng sw.js): lần mở thứ hai phải nhận cấu hình mới
  srv.overrides['/firebase-config.js'] = 'window.FIREBASE_CONFIG=null; window.__cfgVersion="moi";';
  await reopen();
  const v1 = await cur.evaluate(function () { return window.__cfgVersion || 'cu'; });
  await reopen();
  const v2 = await cur.evaluate(function () { return window.__cfgVersion || 'cu'; });
  t.ok('W09 Chỉ sửa firebase-config.js: lần mở kế tiếp nhận bản mới', v2 === 'moi', 'lần mở 1: ' + v1 + ', lần mở 2: ' + v2);

  // Phát hành bản mới (đổi sw.js + index.html)
  const sw = fs.readFileSync(path.join(H.ROOT, 'sw.js'), 'utf8');
  srv.overrides['/sw.js'] = sw.replace(/one-line-v\d+/, 'one-line-vTEST');
  srv.overrides['/index.html'] = head.replace('<title>Đường Kẻ Một Nét</title>', '<title>Đường Kẻ Một Nét MỚI</title>');
  let title = '', keys = [], opens = 0;
  for (let i = 0; i < 4 && !/MỚI/.test(title); i++) { await reopen(); opens++; title = await cur.title(); }
  for (let i = 0; i < 20; i++) { keys = await cur.evaluate(function () { return caches.keys(); }); if (keys.length === 1 && keys[0] === 'one-line-vTEST') break; await cur.waitForTimeout(300); }
  t.ok('W10 Phát hành bản mới: trang đổi sang bản mới sau <= 2 lần mở, xoá cache cũ', /MỚI/.test(title) && opens <= 2 && keys.length === 1 && keys[0] === 'one-line-vTEST',
    'sau ' + opens + ' lần mở, title=' + title + ', cache=' + keys.join(','));

  const dup = await cur.evaluate(async function () {
    var c = await caches.open((await caches.keys())[0]);
    return (await c.keys()).map(function (r) { return r.url; }).filter(function (u) { return u.indexOf('?') >= 0; });
  });
  t.ok('W11 Không lưu trùng theo ?tham-số', dup.length === 0, dup.join(','));

  // Không đụng tới yêu cầu ra ngoài (Firebase, ảnh đại diện) và trang đăng nhập
  const swSrc = sw;
  t.ok('W12 Service worker bỏ qua yêu cầu khác nguồn và login.html', /url\.origin !== self\.location\.origin/.test(swSrc) && /login\\\.html/.test(swSrc));
  t.ok('W13 Không có lỗi JS', cur._errs.length === 0, cur._errs.slice(0, 2).join(' | '));
});
