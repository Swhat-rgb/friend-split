import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCjPlXocWLsE2VWyJoB75Ucek8PAw3NBaU",
  authDomain: "friend-split-94c78.firebaseapp.com",
  projectId: "friend-split-94c78",
  storageBucket: "friend-split-94c78.firebasestorage.app",
  messagingSenderId: "829483705668",
  appId: "1:829483705668:web:fff92300f1dbae1cd6e311"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
let db;
try {
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
  });
} catch (err) {
  console.warn("Firestore persistent cache unavailable; using existing instance if present.", err);
}

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

let currentUser = null;
let initializedForUser = false;
let unsubscribeSnapshot = null;
let uploadTimer = null;
let applyingCloudState = false;
let lastUploadedJson = "";

const $ = id => document.getElementById(id);
const status = (text, kind = "") => {
  const node = $("cloudStatus");
  if (!node) return;
  node.textContent = text;
  node.className = `badge cloud-status ${kind}`.trim();
};

function setAuthUi(user) {
  const signIn = $("googleSignInBtn");
  const signOutBtn = $("googleSignOutBtn");
  const who = $("cloudUserName");
  if (!signIn || !signOutBtn || !who) return;
  if (user) {
    signIn.classList.add("hidden");
    signOutBtn.classList.remove("hidden");
    who.classList.remove("hidden");
    who.textContent = user.displayName || user.email || "已登入";
  } else {
    signIn.classList.remove("hidden");
    signOutBtn.classList.add("hidden");
    who.classList.add("hidden");
    who.textContent = "";
  }
}

function getAppApi() {
  return window.friendSplitApp || null;
}

function cloudDocRef(uid) {
  return doc(db, "users", uid, "sync", "main");
}

function isMeaningfulState(s) {
  if (!s) return false;
  const defaultNames = ["A","B","C","D","E","F","G"];
  const friendsChanged = Array.isArray(s.friends) && JSON.stringify(s.friends) !== JSON.stringify(defaultNames);
  return friendsChanged || (Array.isArray(s.events) && s.events.length > 0);
}

async function writeCloudState(state, reason = "update") {
  if (!currentUser || !initializedForUser || applyingCloudState || !state) return;
  const json = JSON.stringify(state);
  if (json === lastUploadedJson) return;
  status(navigator.onLine ? "☁ 同步中…" : "☁ 離線，待同步", navigator.onLine ? "syncing" : "offline");
  try {
    await setDoc(cloudDocRef(currentUser.uid), {
      state,
      schemaVersion: 5,
      updatedAt: serverTimestamp(),
      updatedAtMs: Date.now(),
      lastReason: reason
    }, { merge: true });
    lastUploadedJson = json;
    status(navigator.onLine ? "☁ 已同步" : "☁ 已排入離線同步", "online");
  } catch (err) {
    console.error("Cloud save failed", err);
    status("☁ 同步失敗", "error");
  }
}

function queueCloudState(state, reason = "local-change") {
  if (!currentUser || !initializedForUser || applyingCloudState) return;
  clearTimeout(uploadTimer);
  uploadTimer = setTimeout(() => writeCloudState(state, reason), 650);
}

async function bootstrapUser(user) {
  const api = getAppApi();
  if (!api) return;
  status("☁ 連接雲端中…", "syncing");
  const ref = cloudDocRef(user.uid);
  try {
    const snap = await getDoc(ref);
    const localState = api.getState();
    if (!snap.exists() || !snap.data()?.state) {
      // 首次登入：雲端是空的，把目前這台裝置既有 V4/V5 帳目上傳。
      await setDoc(ref, {
        state: localState,
        schemaVersion: 5,
        updatedAt: serverTimestamp(),
        updatedAtMs: Date.now(),
        migratedFromLocal: isMeaningfulState(localState)
      });
      lastUploadedJson = JSON.stringify(localState);
      status("☁ 已上傳本機資料", "online");
    } else {
      const cloudState = snap.data().state;
      applyingCloudState = true;
      api.replaceState(cloudState, { source: "cloud" });
      applyingCloudState = false;
      lastUploadedJson = JSON.stringify(cloudState);
      status("☁ 已載入雲端資料", "online");
    }

    initializedForUser = true;
    if (unsubscribeSnapshot) unsubscribeSnapshot();
    unsubscribeSnapshot = onSnapshot(ref, { includeMetadataChanges: true }, snap2 => {
      if (!snap2.exists() || !snap2.data()?.state) return;
      if (snap2.metadata.hasPendingWrites) {
        status(navigator.onLine ? "☁ 同步中…" : "☁ 離線，待同步", navigator.onLine ? "syncing" : "offline");
        return;
      }
      const remote = snap2.data().state;
      const remoteJson = JSON.stringify(remote);
      if (remoteJson === lastUploadedJson) {
        status("☁ 已同步", "online");
        return;
      }
      applyingCloudState = true;
      api.replaceState(remote, { source: "cloud" });
      applyingCloudState = false;
      lastUploadedJson = remoteJson;
      status("☁ 已同步", "online");
    }, err => {
      console.error("Cloud listener failed", err);
      status("☁ 雲端連線錯誤", "error");
    });
  } catch (err) {
    console.error("Cloud bootstrap failed", err);
    status(navigator.onLine ? "☁ 連線失敗" : "☁ 離線模式", navigator.onLine ? "error" : "offline");
  }
}

async function doSignIn() {
  status("Google 登入中…", "syncing");
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    console.warn("Popup sign-in failed", err);
    if (["auth/popup-blocked", "auth/operation-not-supported-in-this-environment"].includes(err?.code)) {
      await signInWithRedirect(auth, provider);
      return;
    }
    status(`登入失敗${err?.code ? `：${err.code}` : ""}`, "error");
    alert("Google 登入失敗。若網站是 GitHub Pages，請確認 Firebase Authentication 的授權網域已加入 swhat-rgb.github.io。\n\n" + (err?.message || ""));
  }
}

async function doSignOut() {
  if (!confirm("要登出雲端同步嗎？本機資料仍會保留在這台裝置。")) return;
  await signOut(auth);
}

window.addEventListener("friend-split:state-saved", e => {
  queueCloudState(e.detail?.state, e.detail?.reason || "local-change");
});

window.addEventListener("online", () => {
  if (currentUser) {
    status("☁ 已連線，檢查同步…", "syncing");
    const api = getAppApi();
    if (api) queueCloudState(api.getState(), "back-online");
  }
});
window.addEventListener("offline", () => {
  if (currentUser) status("☁ 離線，變更會稍後同步", "offline");
});

$("googleSignInBtn")?.addEventListener("click", doSignIn);
$("googleSignOutBtn")?.addEventListener("click", doSignOut);

try {
  await setPersistence(auth, browserLocalPersistence);
  await getRedirectResult(auth);
} catch (err) {
  console.warn("Auth persistence/redirect initialization warning", err);
}

onAuthStateChanged(auth, async user => {
  currentUser = user;
  initializedForUser = false;
  if (unsubscribeSnapshot) {
    unsubscribeSnapshot();
    unsubscribeSnapshot = null;
  }
  setAuthUi(user);
  if (!user) {
    status("☁ 尚未登入", "offline");
    return;
  }
  await bootstrapUser(user);
});
