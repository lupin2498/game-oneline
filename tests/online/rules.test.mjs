// Luật bảo vệ Firestore (firestore.rules) trên Emulator, dùng SDK client thật + đăng nhập qua Auth Emulator.
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithCredential, GoogleAuthProvider, FacebookAuthProvider } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, doc, setDoc, getDoc, deleteDoc, serverTimestamp, Timestamp, collection, getDocs,
  query, orderBy, limit, where, getCount } from 'firebase/firestore/lite';

await fetch('http://127.0.0.1:8089/emulator/v1/projects/demo-oneline/databases/(default)/documents', { method: 'DELETE' });
await fetch('http://127.0.0.1:9099/emulator/v1/projects/demo-oneline/accounts', { method: 'DELETE' });

let n = 0;
function mk() {
  const app = initializeApp({ apiKey: 'demo-key', projectId: 'demo-oneline', authDomain: 'demo-oneline.firebaseapp.com' }, 'a' + (n++));
  const auth = getAuth(app); connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const db = getFirestore(app); connectFirestoreEmulator(db, '127.0.0.1', 8089);
  return { app, auth, db };
}
const G = (sub, name) => GoogleAuthProvider.credential(JSON.stringify({ sub, email: sub + '@ex.com', email_verified: true, name }));
const F = (sub, name) => FacebookAuthProvider.credential(JSON.stringify({ sub, name }));
const res = [];
async function expect(label, shouldPass, fn) {
  let passed; try { await fn(); passed = true; } catch (e) { passed = false; }
  const ok = passed === shouldPass;
  res.push(ok);
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + (ok ? '' : '  — kết quả: ' + (passed ? 'được phép' : 'bị chặn')));
}
const S = (best, extra = {}) => Object.assign({ name: 'An', photo: '', provider: 'google.com', best, updatedAt: serverTimestamp() }, extra);
const FB = (best, extra = {}) => S(best, Object.assign({ provider: 'facebook.com', name: 'Bình' }, extra));
// tắt log cảnh báo của SDK khi bị từ chối (đó là kết quả mong đợi)
const origWarn = console.warn, origErr = console.error; console.warn = () => {}; console.error = () => {};

const A = mk(), B = mk(), C = mk(), U = mk();
const ua = (await signInWithCredential(A.auth, G('rule-a', 'An'))).user.uid;
const ub = (await signInWithCredential(B.auth, F('rule-b', 'Bình'))).user.uid;
const uc = (await signInWithCredential(C.auth, G('rule-c', 'Chi'))).user.uid;

await expect('R01 Chưa đăng nhập: không được ghi điểm', false, () => setDoc(doc(U.db, 'scores', 'x'), S(10)));
await expect('R02 Ghi vào dòng của người khác', false, () => setDoc(doc(A.db, 'scores', ub), S(10)));
await expect('R03 Tạo kỷ lục hợp lệ của chính mình', true, () => setDoc(doc(A.db, 'scores', ua), S(100)));
await expect('R04 Hạ kỷ lục xuống thấp hơn', false, () => setDoc(doc(A.db, 'scores', ua), S(50)));
await expect('R05 Ghi lại đúng điểm cũ (không cao hơn)', false, () => setDoc(doc(A.db, 'scores', ua), S(100)));
await expect('R06 Nâng kỷ lục ngay trong vòng 3 giây (chống spam)', false, () => setDoc(doc(A.db, 'scores', ua), S(150)));
await new Promise(r => setTimeout(r, 3200));
await expect('R07 Nâng kỷ lục sau 3 giây', true, () => setDoc(doc(A.db, 'scores', ua), S(160)));
await expect('R08 Trường lạ ngoài danh sách', false, () => setDoc(doc(B.db, 'scores', ub), FB(10, { admin: true })));
await expect('R09 Điểm vượt trần 50000 m', false, () => setDoc(doc(B.db, 'scores', ub), FB(50001)));
await expect('R10 Điểm số thực (không phải số nguyên)', false, () => setDoc(doc(B.db, 'scores', ub), FB(10.5)));
await expect('R11 Điểm 0', false, () => setDoc(doc(B.db, 'scores', ub), FB(0)));
await expect('R12 Điểm âm', false, () => setDoc(doc(B.db, 'scores', ub), FB(-5)));
await expect('R13 Điểm là chuỗi', false, () => setDoc(doc(B.db, 'scores', ub), FB('999')));
await expect('R14 Khai sai nhà cung cấp (đăng nhập Facebook, khai Google)', false, () => setDoc(doc(B.db, 'scores', ub), FB(10, { provider: 'google.com' })));
await expect('R15 Ảnh đại diện javascript:', false, () => setDoc(doc(B.db, 'scores', ub), FB(10, { photo: 'javascript:alert(1)' })));
await expect('R16 Ảnh đại diện http:// (không https)', false, () => setDoc(doc(B.db, 'scores', ub), FB(10, { photo: 'http://x.com/a.png' })));
await expect('R17 Ảnh đại diện dài hơn 500 ký tự', false, () => setDoc(doc(B.db, 'scores', ub), FB(10, { photo: 'https://x.com/' + 'a'.repeat(500) })));
await expect('R18 Tên 41 ký tự', false, () => setDoc(doc(B.db, 'scores', ub), FB(10, { name: 'x'.repeat(41) })));
await expect('R19 Tên rỗng', false, () => setDoc(doc(B.db, 'scores', ub), FB(10, { name: '' })));
await expect('R20 Tên không phải chuỗi', false, () => setDoc(doc(B.db, 'scores', ub), FB(10, { name: 12345 })));
await expect('R21 Thời gian do máy khách tự đặt', false, () => setDoc(doc(B.db, 'scores', ub), FB(10, { updatedAt: Timestamp.fromMillis(Date.now()) })));
await expect('R22 Thiếu trường photo', false, () => setDoc(doc(B.db, 'scores', ub), { name: 'Bình', provider: 'facebook.com', best: 10, updatedAt: serverTimestamp() }));
await expect('R23 Facebook: tạo kỷ lục hợp lệ (ảnh https)', true, () => setDoc(doc(B.db, 'scores', ub), FB(220, { photo: 'https://graph.facebook.com/1/picture' })));
// Tên tiếng Việt có dấu dài đúng 40 ký tự và tên có emoji (đúng như cleanName() trong game cắt) phải ghi được
const viet40 = 'Nguyễn Thị Hoàng Ánh Dương Ngọc Bảo Trâm'.padEnd(40, 'ờ').slice(0, 40);
await expect('R24 Tên tiếng Việt có dấu đủ 40 ký tự', true, () => setDoc(doc(C.db, 'scores', uc), S(5, { name: viet40 })));
await new Promise(r => setTimeout(r, 3200));
await expect('R25 Tên chứa emoji (20 emoji = 40 đơn vị UTF-16)', true, () => setDoc(doc(C.db, 'scores', uc), S(6, { name: '😀'.repeat(20) })));
await expect('R26 Ai cũng đọc được bảng xếp hạng (chưa đăng nhập)', true, () => getDocs(query(collection(U.db, 'scores'), orderBy('best', 'desc'), limit(20))));
await expect('R27 Ai cũng đếm được thứ hạng', true, () => getCount(query(collection(U.db, 'scores'), where('best', '>', 100))));
await expect('R28 Đọc bộ sưu tập khác', false, () => getDocs(collection(U.db, 'users')));
await expect('R29 Ghi vào bộ sưu tập khác', false, () => setDoc(doc(A.db, 'admin', 'x'), { a: 1 }));
await expect('R30 Xoá điểm của người khác', false, () => deleteDoc(doc(A.db, 'scores', ub)));
await expect('R31 Xoá điểm của chính mình', true, () => deleteDoc(doc(A.db, 'scores', ua)));
const gone = !(await getDoc(doc(U.db, 'scores', ua))).exists();
res.push(gone); console.log((gone ? 'PASS' : 'FAIL') + '  R32 Sau khi xoá, dòng điểm không còn');
await new Promise(r => setTimeout(r, 300));
await expect('R33 Xoá rồi tạo lại điểm mới (bất kỳ, kể cả thấp hơn trước)', true, () => setDoc(doc(A.db, 'scores', ua), S(3)));

console.warn = origWarn; console.error = origErr;
const bad = res.filter(x => !x).length;
console.log(`==> Luật Firestore: ${res.length - bad} đạt, ${bad} lỗi`);
for (const x of [A, B, C, U]) await deleteApp(x.app);
process.exit(bad ? 1 : 0);
