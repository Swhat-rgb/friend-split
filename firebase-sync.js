import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
    signOut,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  doc,
  collection,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
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
  console.warn("Firestore persistent cache unavailable", err);
}
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

const GROUP_STORAGE_KEY = "friendSplitSharedActiveGroupV6_1";
let currentUser = null;
let currentIsAdmin = false;
let activeGroupId = localStorage.getItem(GROUP_STORAGE_KEY) || "";
let activeGroupMeta = null;
window.friendSplitPermissions={role:"guest",isOwner:false,isAdmin:false,uid:"",name:""};
let initializedForGroup = false;
let applyingCloudState = false;
let lastUploadedJson = "";
let uploadTimer = null;
let unsubscribeGroup = null;
let unsubscribeUserGroups = null;
let unsubscribeMembers = null;
let unsubscribePokerSessions = null;
const pokerUploadTimers = new Map();

const $ = id => document.getElementById(id);
const status = (text, kind="") => {
  const n=$("cloudStatus"); if(!n)return;
  n.textContent=text; n.className=`badge cloud-status ${kind}`.trim();
};
const api = () => window.friendSplitApp || null;
const groupRef = gid => doc(db,"groups",gid);
const memberRef = (gid,uid) => doc(db,"groups",gid,"members",uid);
const userGroupRef = (uid,gid) => doc(db,"users",uid,"groups",gid);
const adminRef = uid => doc(db,"admins",uid);
const pokerSessionsRef = gid => collection(db,"groups",gid,"pokerSessions");
const pokerSessionRef = (gid,sid) => doc(db,"groups",gid,"pokerSessions",sid);
const pokerApi = () => window.friendSplitPokerApp || null;

function randomInviteCode(){
  const chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const a=new Uint32Array(8); crypto.getRandomValues(a);
  return Array.from(a,x=>chars[x%chars.length]).join("");
}
function setAuthUi(user){
  $("googleSignInBtn")?.classList.toggle("hidden",!!user);
  $("googleSignOutBtn")?.classList.toggle("hidden",!user);
  $("cloudUserName")?.classList.toggle("hidden",!user);
  if($("cloudUserName")) $("cloudUserName").textContent=user?(user.displayName||user.email||"已登入"):"";
  $("sharedGroupPanel")?.classList.toggle("hidden",!user);
}
function setGroupUi(meta=null){
  activeGroupMeta=meta;
  const isOwner=!!(meta&&currentUser&&meta.ownerUid===currentUser.uid);
  window.friendSplitPermissions={role:currentIsAdmin?"admin":(isOwner?"owner":(meta?"member":"guest")),isOwner,isAdmin:currentIsAdmin,uid:currentUser?.uid||"",name:currentUser?.displayName||currentUser?.email||"成員"};
  window.dispatchEvent(new CustomEvent("friend-split:permissions-changed",{detail:window.friendSplitPermissions}));
  const label=$("currentGroupLabel");
  const invite=$("currentInviteCode");
  if(label) label.textContent=meta?`${meta.name||"未命名群組"}`:"尚未選擇共享群組";
  if(invite) invite.textContent=meta?.inviteCode?`邀請碼：${meta.inviteCode}`:"";
  $("copyInviteBtn")?.classList.toggle("hidden",!meta?.inviteCode);
  $("forceCloudUploadBtn")?.classList.toggle("hidden",!meta);
  $("deleteGroupBtn")?.classList.toggle("hidden",!(isOwner||currentIsAdmin));
}
function stopGroupListeners(){
  if(unsubscribeGroup){unsubscribeGroup();unsubscribeGroup=null;}
  if(unsubscribeMembers){unsubscribeMembers();unsubscribeMembers=null;}
  if(unsubscribePokerSessions){unsubscribePokerSessions();unsubscribePokerSessions=null;}
  pokerUploadTimers.forEach(t=>clearTimeout(t));pokerUploadTimers.clear();
  initializedForGroup=false; applyingCloudState=false; lastUploadedJson="";
}
async function writeGroupState(state, reason="update"){
  if(!currentUser||!activeGroupId||!initializedForGroup||applyingCloudState||!state)return;
  const json=JSON.stringify(state); if(json===lastUploadedJson)return;
  status(navigator.onLine?"☁ 群組同步中…":"☁ 離線，待同步", navigator.onLine?"syncing":"offline");
  try{
    await setDoc(groupRef(activeGroupId),{
      state, schemaVersion:6.8, updatedAt:serverTimestamp(), updatedAtMs:Date.now(),
      updatedBy:currentUser.uid, updatedByName:currentUser.displayName||currentUser.email||"成員",
      lastReason:reason
    },{merge:true});
    lastUploadedJson=json;
    status(navigator.onLine?"☁ 群組已同步":"☁ 已排入離線同步","online");
  }catch(err){console.error(err); status("☁ 群組同步失敗","error");}
}
function queueGroupState(state,reason="local-change"){
  if(!currentUser||!activeGroupId||!initializedForGroup||applyingCloudState)return;
  clearTimeout(uploadTimer); uploadTimer=setTimeout(()=>writeGroupState(state,reason),700);
}
async function activateGroup(gid){
  if(!currentUser||!gid)return;
  stopGroupListeners(); activeGroupId=gid; localStorage.setItem(GROUP_STORAGE_KEY,gid);
  status("☁ 載入共享群組…","syncing");
  const snap=await getDoc(groupRef(gid));
  if(!snap.exists()){ status("☁ 找不到群組","error"); return; }
  const data=snap.data(); setGroupUi({id:gid,...data});
  if(data.state){
    applyingCloudState=true; api()?.replaceState(data.state,{source:"cloud"}); applyingCloudState=false;
    lastUploadedJson=JSON.stringify(data.state);
  }
  initializedForGroup=true;
  unsubscribeGroup=onSnapshot(groupRef(gid),{includeMetadataChanges:true},s=>{
    if(!s.exists())return; const d=s.data(); setGroupUi({id:gid,...d});
    if(s.metadata.hasPendingWrites){status("☁ 群組同步中…","syncing");return;}
    if(!d.state)return; const remoteJson=JSON.stringify(d.state);
    if(remoteJson!==lastUploadedJson){
      applyingCloudState=true; api()?.replaceState(d.state,{source:"cloud"}); applyingCloudState=false;
      lastUploadedJson=remoteJson;
    }
    status("☁ 群組已同步","online");
  },err=>{console.error(err); status("☁ 群組連線錯誤","error");});
  unsubscribeMembers=onSnapshot(collection(db,"groups",gid,"members"),snapMembers=>{
    const names=[]; snapMembers.forEach(x=>names.push(x.data().displayName||x.data().email||"成員"));
    if($("groupMembers")) $("groupMembers").textContent=names.length?`成員：${names.join("、")}`:"";
  });
  unsubscribePokerSessions=onSnapshot(pokerSessionsRef(gid),snapPoker=>{
    const sessions=[];
    snapPoker.forEach(d=>{
      const x=d.data();
      sessions.push({...x.session,id:d.id,hostUid:x.hostUid||x.session?.hostUid||"",hostName:x.hostName||x.session?.hostName||"",cloudGroupId:gid});
    });
    pokerApi()?.mergeCloudSessions?.(gid,sessions);
  },err=>console.error("Poker sync error",err));
}


async function createPokerCloudSession(session){
  if(!currentUser||!activeGroupId)throw new Error("尚未登入或尚未選擇共享群組");
  const payload={...session,hostUid:currentUser.uid,hostName:currentUser.displayName||currentUser.email||"主持人",cloudGroupId:activeGroupId};
  await setDoc(pokerSessionRef(activeGroupId,payload.id),{
    hostUid:payload.hostUid,hostName:payload.hostName,session:payload,
    createdAt:serverTimestamp(),updatedAt:serverTimestamp(),updatedAtMs:Date.now()
  });
}
function queuePokerCloudSession(session,reason="update"){
  if(!currentUser||!activeGroupId||!session?.id||session.cloudGroupId!==activeGroupId)return;
  const canWrite=currentIsAdmin||session.hostUid===currentUser.uid;
  if(!canWrite)return;
  clearTimeout(pokerUploadTimers.get(session.id));
  pokerUploadTimers.set(session.id,setTimeout(async()=>{
    try{
      const payload={...session,cloudGroupId:activeGroupId};
      await setDoc(pokerSessionRef(activeGroupId,session.id),{
        hostUid:session.hostUid||currentUser.uid,
        hostName:session.hostName||currentUser.displayName||currentUser.email||"主持人",
        session:payload,updatedAt:serverTimestamp(),updatedAtMs:Date.now(),
        updatedBy:currentUser.uid,updatedByName:currentUser.displayName||currentUser.email||"成員",
        lastReason:reason
      },{merge:true});
    }catch(err){console.error("Poker upload failed",err)}
  },300));
}
window.friendSplitPokerCloud={
  getContext:()=>({
    uid:currentUser?.uid||"",name:currentUser?.displayName||currentUser?.email||"成員",
    groupId:activeGroupId||"",groupName:activeGroupMeta?.name||"",isAdmin:currentIsAdmin
  }),
  createSession:createPokerCloudSession,
  queueSession:queuePokerCloudSession
};


async function refreshAdminGroups(){
  const panel=$("developerPanel"),badge=$("developerBadge"),sel=$("adminGroupSelect");
  panel?.classList.toggle("hidden",!currentIsAdmin);
  badge?.classList.toggle("hidden",!currentIsAdmin);
  if(!currentIsAdmin||!sel)return;
  sel.innerHTML='<option value="">選擇群組</option>';
  try{
    const snap=await getDocs(collection(db,"groups"));
    snap.forEach(d=>{
      const data=d.data(),o=document.createElement("option");
      o.value=d.id;
      o.textContent=`${data.name||"未命名群組"} · ${data.inviteCode||d.id}`;
      sel.appendChild(o);
    });
  }catch(err){
    console.error("Developer groups load failed",err);
  }
}
async function detectDeveloperAdmin(user){
  currentIsAdmin=false;
  if(!user)return false;
  try{
    const snap=await getDoc(adminRef(user.uid));
    currentIsAdmin=snap.exists() && snap.data()?.active!==false;
  }catch(err){
    console.warn("Admin check failed",err);
  }
  await refreshAdminGroups();
  return currentIsAdmin;
}

async function deleteActiveGroup(){
  if(!currentUser||!activeGroupId||!activeGroupMeta)return;
  if(activeGroupMeta.ownerUid!==currentUser.uid&&!currentIsAdmin)return alert("只有群組建立者（Owner）或 Developer Admin 可以刪除群組。");
  const groupName=activeGroupMeta.name||"未命名群組";
  if(!confirm(`你要刪除群組「${groupName}」嗎？`))return;
  if(!confirm("你犯了跟偉鈞一樣的錯誤嗎?"))return;
  try{
    const gid=activeGroupId,code=activeGroupMeta.inviteCode||"";
    const membersSnap=await getDocs(collection(db,"groups",gid,"members"));
    const pokerSnap=await getDocs(collection(db,"groups",gid,"pokerSessions"));
    stopGroupListeners();
    if(code){try{await deleteDoc(doc(db,"invites",code))}catch(e){console.warn("刪除邀請碼失敗",e)}}
    for(const m of membersSnap.docs){
      try{await deleteDoc(userGroupRef(m.id,gid))}catch(e){console.warn("清除成員群組索引失敗",m.id,e)}
      try{await deleteDoc(memberRef(gid,m.id))}catch(e){console.warn("刪除成員資料失敗",m.id,e)}
    }
    for(const p of pokerSnap.docs){
      try{await deleteDoc(pokerSessionRef(gid,p.id))}catch(e){console.warn("刪除 Poker 紀錄失敗",p.id,e)}
    }
    await deleteDoc(groupRef(gid));
    localStorage.removeItem(GROUP_STORAGE_KEY);
    activeGroupId="";activeGroupMeta=null;setGroupUi(null);
    if($("groupSelect"))$("groupSelect").value="";
    api()?.clearForDeletedGroup?.();
    await refreshAdminGroups();
    alert(`群組「${groupName}」已刪除。`);
  }catch(err){
    console.error(err);alert("刪除群組失敗：\n"+(err?.message||err));
  }
}

async function createGroup(){
  if(!currentUser)return alert("請先登入 Google。");
  const name=($("newGroupName")?.value||"").trim(); if(!name)return alert("請輸入群組名稱。");
  const gid=doc(collection(db,"groups")).id; const code=randomInviteCode();
  try{
    const localState=api()?.getState();
    await setDoc(groupRef(gid),{
      name, ownerUid:currentUser.uid, inviteCode:code, state:localState,
      schemaVersion:6.8, createdAt:serverTimestamp(), updatedAt:serverTimestamp(), updatedAtMs:Date.now()
    });
    await setDoc(memberRef(gid,currentUser.uid),{
      displayName:currentUser.displayName||currentUser.email||"建立者", email:currentUser.email||"", role:"owner", inviteCode:"owner", joinedAt:serverTimestamp()
    });
    await setDoc(doc(db,"invites",code),{groupId:gid,groupName:name,ownerUid:currentUser.uid,active:true,createdAt:serverTimestamp()});
    await setDoc(userGroupRef(currentUser.uid,gid),{name,role:"owner",inviteCode:code,joinedAt:serverTimestamp()});
    if($("newGroupName")) $("newGroupName").value="";
    await activateGroup(gid);
    alert(`共享群組已建立。\n邀請碼：${code}\n把這組邀請碼傳給朋友即可。`);
  }catch(err){console.error(err);alert("建立群組失敗：\n"+(err?.message||err));}
}
async function joinGroup(){
  if(!currentUser)return alert("請先登入 Google。");
  const code=($("joinGroupCode")?.value||"").trim().toUpperCase(); if(!code)return alert("請輸入邀請碼。");
  try{
    const inv=await getDoc(doc(db,"invites",code));
    if(!inv.exists()||inv.data().active!==true)return alert("邀請碼不存在或已失效。");
    const {groupId,groupName}=inv.data();
    await setDoc(memberRef(groupId,currentUser.uid),{
      displayName:currentUser.displayName||currentUser.email||"成員", email:currentUser.email||"", role:"member", inviteCode:code, joinedAt:serverTimestamp()
    },{merge:true});
    await setDoc(userGroupRef(currentUser.uid,groupId),{name:groupName||"共享群組",role:"member",inviteCode:code,joinedAt:serverTimestamp()},{merge:true});
    if($("joinGroupCode")) $("joinGroupCode").value="";
    await activateGroup(groupId);
  }catch(err){console.error(err);alert("加入群組失敗：\n"+(err?.message||err));}
}
function listenMyGroups(){
  if(unsubscribeUserGroups){unsubscribeUserGroups();unsubscribeUserGroups=null;}
  if(!currentUser)return;
  unsubscribeUserGroups=onSnapshot(collection(db,"users",currentUser.uid,"groups"),snap=>{
    const sel=$("groupSelect"); if(!sel)return;
    const old=activeGroupId; sel.innerHTML='<option value="">選擇共享群組</option>';
    snap.forEach(d=>{const o=document.createElement("option");o.value=d.id;o.textContent=d.data().name||"共享群組";sel.appendChild(o);});
    if(old && [...sel.options].some(o=>o.value===old)){sel.value=old;if(!initializedForGroup)activateGroup(old).catch(console.error)}
    else if(snap.size===1){const gid=snap.docs[0].id;sel.value=gid;activateGroup(gid).catch(console.error)}
  });
}

window.addEventListener("friend-split:state-saved",e=>queueGroupState(e.detail?.state,e.detail?.reason||"local-change"));
window.addEventListener("online",()=>{if(activeGroupId){status("☁ 已連線，檢查群組同步…","syncing");queueGroupState(api()?.getState(),"back-online")}});
window.addEventListener("offline",()=>{if(activeGroupId)status("☁ 離線，變更會稍後同步","offline")});

$("googleSignInBtn")?.addEventListener("click",async()=>{try{status("前往 Google 登入…","syncing");await signInWithPopup(auth,provider)}catch(err){console.error(err);alert("Google 登入失敗：\n"+(err?.message||err))}});
$("googleSignOutBtn")?.addEventListener("click",async()=>{if(confirm("確定登出？本機資料仍會保留。"))await signOut(auth)});
$("createGroupBtn")?.addEventListener("click",createGroup);
$("deleteGroupBtn")?.addEventListener("click",deleteActiveGroup);
$("joinGroupBtn")?.addEventListener("click",joinGroup);
$("groupSelect")?.addEventListener("change",e=>{const gid=e.target.value;if(gid)activateGroup(gid).catch(err=>alert(err.message));});
$("adminGroupSelect")?.addEventListener("change",e=>{const gid=e.target.value;if(gid)activateGroup(gid).catch(err=>alert(err.message));});
$("copyInviteBtn")?.addEventListener("click",async()=>{const code=activeGroupMeta?.inviteCode;if(!code)return;await navigator.clipboard?.writeText(code);alert(`已複製邀請碼：${code}`)});
$("forceCloudUploadBtn")?.addEventListener("click",async()=>{
  if(!currentUser)return alert("請先登入。"); if(!activeGroupId)return alert("請先建立或加入共享群組。");
  if(!confirm("要用這台裝置目前的完整帳目覆蓋共享群組資料嗎？\n\n這會影響群組所有成員看到的內容。"))return;
  initializedForGroup=true; lastUploadedJson=""; await writeGroupState(api()?.getState(),"manual-overwrite"); alert("已上傳本機資料到共享群組。");
});

try{await setPersistence(auth,browserLocalPersistence)}catch(err){console.warn("Auth persistence warning",err)}
onAuthStateChanged(auth,async user=>{
  currentUser=user; setAuthUi(user); stopGroupListeners();
  if(!user){
    currentIsAdmin=false;
    window.friendSplitPermissions={role:"guest",isOwner:false,isAdmin:false,uid:"",name:""};
    $("developerPanel")?.classList.add("hidden");$("developerBadge")?.classList.add("hidden");
    status("☁ 尚未登入","offline");setGroupUi(null);return;
  }
  window.friendSplitPermissions={role:"guest",isOwner:false,isAdmin:false,uid:user.uid,name:user.displayName||user.email||"成員"};
  await detectDeveloperAdmin(user);
  status(currentIsAdmin?"☁ Developer Admin 已登入":"☁ 已登入，選擇共享群組","online");
  listenMyGroups();
});
