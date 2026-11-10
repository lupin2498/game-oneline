'use strict';
// Chạy bộ test:  node tests/run.js [web|online|tên-file...]
//   web    : không cần gì thêm
//   online : cần Firebase Emulator (npm run test:online tự bật)
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path');

const args = process.argv.slice(2);
const groups = { web: 'web', online: 'online' };
let files = [];
const want = args.length ? args : ['web'];
for (const a of want) {
  if (groups[a]) {
    const dir = path.join(__dirname, groups[a]);
    files = files.concat(fs.readdirSync(dir).filter(function (f) { return /\.test\.(js|mjs)$/.test(f); }).sort()
      .map(function (f) { return path.join(dir, f); }));
  } else {
    files.push(path.resolve(a));
  }
}
if (want.indexOf('online') >= 0 && !process.env.FIRESTORE_EMULATOR_HOST && !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.error('Nhóm "online" cần Firebase Emulator. Chạy:  npm run test:online');
  process.exit(2);
}
const failed = [];
const t0 = Date.now();
for (const f of files) {
  console.log('\n=== ' + path.relative(path.join(__dirname, '..'), f) + ' ===');
  const r = spawnSync(process.execPath, [f], { stdio: 'inherit', env: process.env });
  if (r.status !== 0) failed.push(path.basename(f));
}
console.log('\n' + (failed.length ? 'CÓ LỖI ở: ' + failed.join(', ') : 'TẤT CẢ ĐẠT') +
  ' (' + files.length + ' file, ' + Math.round((Date.now() - t0) / 1000) + ' giây)');
process.exit(failed.length ? 1 : 0);
