// Lớp "online" của game: đăng nhập Google/Facebook + bảng xếp hạng (Firebase Auth + Firestore Lite).
// Build: bash tools/build-online.sh  ->  lib/online.js (một file, không cần CDN).
import { initializeApp } from 'firebase/app';
import {
  initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, inMemoryPersistence,
  browserPopupRedirectResolver, GoogleAuthProvider, FacebookAuthProvider, signInWithPopup,
  signInWithRedirect, getRedirectResult, signInWithCredential, onAuthStateChanged, signOut,
  deleteUser, connectAuthEmulator
} from 'firebase/auth';
import {
  getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, deleteDoc, serverTimestamp,
  collection, query, orderBy, limit, getDocs, getCount, where
} from 'firebase/firestore/lite';

var CFG = window.FIREBASE_CONFIG || null;
var UA = navigator.userAgent || '';
var NATIVE = (UA.match(/OneLineApp\/(Android|iOS)/) || [])[1] || null;   // app Android/iOS tự gắn vào UA
var CALLBACK = 'vn.lupin.oneline://auth';
var MAX_BEST = 50000;
var WRITE_GAP = 3300;   // luật Firestore: mỗi tài khoản ghi cách nhau > 3 giây

var st = { configured: false, ready: false, user: null, serverBest: null, busy: false, error: '' };
var listeners = [];
var app = null, auth = null, db = null;
var credPending = false;          // đang đổi token từ app native lấy phiên Firebase
var lastWrite = 0;                // thời điểm ghi điểm thành công gần nhất
var chain = Promise.resolve();    // các lần gửi điểm chạy nối tiếp nhau

function cleanName(n) {
  n = String(n == null ? '' : n)
    .replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩﻿]/g, '')   // ký tự điều khiển, đảo chiều chữ
    .replace(/\s+/g, ' ').trim();
  var out = '', i = 0;
  while (i < n.length) {                        // cắt theo ký tự Unicode, không cắt đôi emoji
    var c = n.codePointAt(i), ch = String.fromCodePoint(c);
    i += ch.length;
    if (c >= 0xd800 && c <= 0xdfff) continue;   // nửa cặp surrogate lẻ
    if (out.length + ch.length > 40) break;
    out += ch;
  }
  return out || 'Người chơi';
}
function cleanPhoto(u) {
  u = String(u || '');
  return /^https:\/\/[^\s"'<>\\]+$/.test(u) && u.length <= 500 ? u : '';
}
function profile(u) {
  var p = (u.providerData && u.providerData[0]) || {};
  return { uid: u.uid, name: cleanName(u.displayName || p.displayName), photo: cleanPhoto(u.photoURL || p.photoURL),
           provider: p.providerId || '' };
}
function snapshot() {
  return { configured: st.configured, ready: st.ready, native: NATIVE, busy: st.busy, error: st.error,
           user: st.user ? profile(st.user) : null, serverBest: st.serverBest };
}
function emit() { listeners.forEach(function (fn) { try { fn(snapshot()); } catch (e) { /* bỏ qua lỗi UI */ } }); }
// code === '' nghĩa là người chơi tự huỷ: không báo lỗi
function fail(code) { credPending = false; st.busy = false; st.error = code == null ? 'unknown' : code; emit(); }
function errCode(e) { return (e && (e.code || e.message)) || 'unknown'; }
function wait(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }

if (CFG && CFG.apiKey && CFG.projectId && CFG.authDomain) {
  try {
    app = initializeApp(CFG);
    auth = initializeAuth(app, {
      persistence: [indexedDBLocalPersistence, browserLocalPersistence, inMemoryPersistence],
      popupRedirectResolver: NATIVE ? undefined : browserPopupRedirectResolver
    });
    db = getFirestore(app);
    if (CFG.emulator) {   // chỉ dùng khi test với Firebase Emulator
      connectAuthEmulator(auth, CFG.emulator.auth, { disableWarnings: true });
      connectFirestoreEmulator(db, CFG.emulator.host, CFG.emulator.firestorePort);
    }
    st.configured = true;
  } catch (e) {
    console.warn('[online] không khởi tạo được Firebase:', e);
  }
}

if (st.configured) {
  onAuthStateChanged(auth, function (u) {
    st.user = u; st.serverBest = null; st.ready = true; st.busy = false; credPending = false;
    if (u) st.error = '';
    emit();
    if (u) fetchMyBest().catch(function () {});
  });
  if (!NATIVE && !window.__OL_BRIDGE__) {
    getRedirectResult(auth).catch(function (e) { fail(errCode(e)); });
  }
} else {
  st.ready = true;
}

function makeProvider(id) {
  if (id === 'google') {
    var g = new GoogleAuthProvider();
    g.setCustomParameters({ prompt: 'select_account' });
    return g;
  }
  if (id === 'facebook') {
    var f = new FacebookAuthProvider();
    f.addScope('public_profile');
    return f;
  }
  throw new Error('bad-provider');
}

function randomState() {
  var a = new Uint8Array(16);
  (window.crypto || window.msCrypto).getRandomValues(a);
  return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
}

function loginPageUrl(id, state) {
  var base = CFG.loginPage || ('https://' + CFG.authDomain + '/login.html');
  return base + '?provider=' + id + '&state=' + state + '&return=' + encodeURIComponent(CALLBACK);
}

// Mở trang đăng nhập bằng trình duyệt hệ thống (Google/Facebook chặn đăng nhập trong WebView).
function openNative(url) {
  if (NATIVE === 'iOS' && window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.oneline) {
    window.webkit.messageHandlers.oneline.postMessage({ type: 'login', url: url });
  } else {
    window.location.href = 'oneline-native://login?url=' + encodeURIComponent(url);
  }
}

// Người chơi quay lại app mà không đăng nhập xong (bấm Back ở trình duyệt): nhả trạng thái "đang đăng nhập".
function clearStaleBusy() {
  if (NATIVE && st.busy && !st.user && !credPending) { st.busy = false; emit(); }
}
window.OneLineNativeResume = function () { setTimeout(clearStaleBusy, 2500); };
document.addEventListener('visibilitychange', function () {
  if (!document.hidden) setTimeout(clearStaleBusy, 2500);
});

function login(id) {
  if (!st.configured) return fail('not-configured');
  if (st.user || st.busy) return;
  st.error = '';
  var provider;
  try { provider = makeProvider(id); } catch (e) { return fail('bad-provider'); }
  st.busy = true; emit();
  if (NATIVE) {
    var state = randomState();
    try { localStorage.setItem('oneline.authState', state); } catch (e) { /* bộ nhớ bị chặn */ }
    Online._openNative(loginPageUrl(id, state));
    // Kết quả quay về qua window.OneLineNativeLogin; phòng khi không có tín hiệu nào thì nhả sau 2 phút
    setTimeout(clearStaleBusy, 120000);
    return;
  }
  var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
                   (window.matchMedia && window.matchMedia('(display-mode: fullscreen)').matches) || navigator.standalone;
  var run = standalone ? signInWithRedirect(auth, provider) : signInWithPopup(auth, provider);
  run.catch(function (e) {
    var c = errCode(e);
    if (/popup-blocked|operation-not-supported-in-this-environment/.test(c)) {
      return signInWithRedirect(auth, provider).catch(function (e2) { fail(errCode(e2)); });
    }
    fail(/popup-closed-by-user|cancelled-popup-request|user-cancelled/.test(c) ? '' : c);
  });
}

// Gọi từ app native khi trình duyệt trả về vn.lupin.oneline://auth?...
window.OneLineNativeLogin = function (uri) {
  if (!st.configured) return;
  var s = String(uri || ''), q = s.indexOf('?') >= 0 ? s.slice(s.indexOf('?') + 1) : '';
  if (q.indexOf('#') >= 0) q = q.split('#')[0];
  var p = new URLSearchParams(q);
  var saved = null;
  try { saved = localStorage.getItem('oneline.authState'); localStorage.removeItem('oneline.authState'); } catch (e) { /* */ }
  if (st.user) return;                                    // đã đăng nhập rồi: bỏ qua kết quả đến muộn
  if (p.get('error')) return fail(p.get('error') === 'cancelled' ? '' : String(p.get('error')).slice(0, 60));
  if (!saved || p.get('state') !== saved) return fail('state-mismatch');
  var cred;
  if (p.get('provider') === 'google') cred = GoogleAuthProvider.credential(p.get('idToken') || null, p.get('accessToken') || null);
  else if (p.get('provider') === 'facebook') cred = FacebookAuthProvider.credential(p.get('accessToken') || '');
  else return fail('bad-provider');
  credPending = true; st.busy = true; st.error = ''; emit();
  signInWithCredential(auth, cred).catch(function (e) { fail(errCode(e)); });
};

function logout() {
  if (!st.configured) return Promise.resolve();
  return signOut(auth);
}

function fetchMyBest() {
  if (!st.user) return Promise.resolve(null);
  var uid = st.user.uid;
  return getDoc(doc(db, 'scores', uid)).then(function (snap) {
    if (!st.user || st.user.uid !== uid) return null;
    st.serverBest = snap.exists() ? (snap.data().best | 0) : 0;
    emit();
    return st.serverBest;
  });
}
function myBest() { return st.serverBest == null ? fetchMyBest() : Promise.resolve(st.serverBest); }

function writeScore(uid, meters, retried) {
  return wait(Math.max(0, lastWrite + WRITE_GAP - Date.now())).then(function () {
    if (!st.user || st.user.uid !== uid) return { status: 'signed-out' };
    var me = profile(st.user);
    return st.user.getIdTokenResult().then(function (tok) {
      return setDoc(doc(db, 'scores', uid), {
        name: me.name, photo: me.photo, provider: tok.signInProvider || me.provider,
        best: meters, updatedAt: serverTimestamp()
      });
    }).then(function () {
      lastWrite = Date.now();
      if (st.user && st.user.uid === uid) { st.serverBest = meters; emit(); }
      return { status: 'saved', best: meters };
    }, function (e) {
      // Bị từ chối vì vừa ghi ở máy/tab khác chưa đủ 3 giây: chờ rồi thử lại đúng một lần
      if (!retried && /permission-denied/.test(errCode(e))) {
        lastWrite = Date.now();
        st.serverBest = null;
        return myBest().then(function (prev) {
          if (meters <= (prev | 0)) return { status: 'not-better', best: prev | 0 };
          return writeScore(uid, meters, true);
        });
      }
      throw e;
    });
  });
}

// Lưu điểm nếu cao hơn kỷ lục trên máy chủ. Trả về {status, best}
function submit(meters) {
  meters = Math.floor(Number(meters) || 0);
  if (!st.configured) return Promise.resolve({ status: 'offline' });
  if (!st.user) return Promise.resolve({ status: 'signed-out' });
  if (meters < 1) return Promise.resolve({ status: 'not-better', best: st.serverBest });
  meters = Math.min(meters, MAX_BEST);
  var uid = st.user.uid;
  var job = chain.then(function () {
    if (!st.user || st.user.uid !== uid) return { status: 'signed-out' };
    return myBest().then(function (prev) {
      if (meters <= (prev | 0)) return { status: 'not-better', best: prev | 0 };
      return writeScore(uid, meters, false);
    });
  });
  chain = job.catch(function () {});
  return job;
}

function top(n) {
  if (!st.configured) return Promise.resolve([]);
  return getDocs(query(collection(db, 'scores'), orderBy('best', 'desc'), limit(n || 20))).then(function (qs) {
    return qs.docs.map(function (d, i) {
      var x = d.data();
      return { rank: i + 1, uid: d.id, name: cleanName(x.name), photo: cleanPhoto(x.photo), best: x.best | 0 };
    });
  });
}

function myRank() {
  if (!st.configured || !st.user) return Promise.resolve(null);
  return myBest().then(function (b) {
    if (!b) return null;
    return getCount(query(collection(db, 'scores'), where('best', '>', b))).then(function (c) {
      return c.data().count + 1;
    });
  });
}

// Xoá điểm trên bảng xếp hạng rồi xoá luôn tài khoản đăng nhập trên Firebase.
// Firebase chỉ cho xoá tài khoản khi vừa đăng nhập gần đây; nếu không được thì đăng xuất và báo account:false.
function deleteMe() {
  if (!st.user) return Promise.resolve({ account: true });
  var u = st.user;
  return deleteDoc(doc(db, 'scores', u.uid)).then(function () {
    if (st.user && st.user.uid === u.uid) st.serverBest = 0;
    return deleteUser(u).then(function () { return { account: true }; }, function (e) {
      return signOut(auth).then(function () { return { account: false, code: errCode(e) }; });
    });
  });
}

// Dành cho trang login.html (cầu nối của app native)
function bridge(id, state) {
  return getRedirectResult(auth).then(function (res) {
    if (!res) {
      var key = 'oneline.bridge.' + state;
      if (sessionStorage.getItem(key)) return { error: 'cancelled' };
      sessionStorage.setItem(key, '1');
      return signInWithRedirect(auth, makeProvider(id)).then(function () { return null; });
    }
    var cred = id === 'google' ? GoogleAuthProvider.credentialFromResult(res) : FacebookAuthProvider.credentialFromResult(res);
    var out = { provider: id, idToken: (cred && cred.idToken) || '', accessToken: (cred && cred.accessToken) || '' };
    return signOut(auth).then(function () { return out; });   // không giữ phiên trên trang cầu nối
  });
}

var Online = {
  get configured() { return st.configured; },
  native: NATIVE,
  state: snapshot,
  onChange: function (fn) { listeners.push(fn); try { fn(snapshot()); } catch (e) { /* */ } },
  login: login, logout: logout, submit: submit, top: top, myRank: myRank, deleteMe: deleteMe,
  bridge: bridge, callback: CALLBACK,
  _openNative: openNative, _cleanName: cleanName, _cleanPhoto: cleanPhoto
};
window.Online = Online;
