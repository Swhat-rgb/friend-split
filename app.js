const STORAGE_KEY = "friendSplitSoloV4";
const OLD_STORAGE_KEY = "friendSplitSoloV3";
const OLDER_STORAGE_KEY = "friendSplitSoloV2";
const DB_NAME = "friendSplitAttachments";
const DB_STORE = "files";
const CURRENCIES = ["TWD","JPY","USD","EUR","KRW","CNY","HKD","SGD","THB","GBP","AUD","CAD","CHF","MYR","PHP","VND"];
const CATEGORIES = ["餐飲","交通","住宿","娛樂","購物","門票","其他"];

const defaultState = {friends:["A","B","C","D","E","F","G"],events:[],activeEventId:null,rateCache:{}};
let state = loadState();
let draftParticipants = new Set();
let pendingSettlement = null;
let editExpenseId = null;
let editingReceiptId = null;

function el(id){return document.getElementById(id)}
function round2(n){return Math.round((Number(n)+Number.EPSILON)*100)/100}
function round6(n){return Math.round((Number(n)+Number.EPSILON)*1e6)/1e6}
function uid(prefix="id"){return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`}
function today(){return new Date().toISOString().slice(0,10)}
function localDateTimeValue(d=new Date()){const z=new Date(d.getTime()-d.getTimezoneOffset()*60000);return z.toISOString().slice(0,16)}
function escapeHtml(v){return String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;")}
function activeEvent(){return state.events.find(e=>e.id===state.activeEventId)||null}
function saveState(reason="local-change"){
  localStorage.setItem(STORAGE_KEY,JSON.stringify(state));
  window.dispatchEvent(new CustomEvent("friend-split:state-saved",{detail:{state:structuredClone(state),reason}}));
}
function money(n,c){const currency=c||activeEvent()?.baseCurrency||"TWD";try{return new Intl.NumberFormat("zh-TW",{style:"currency",currency,maximumFractionDigits:2}).format(round2(n))}catch{return `${currency} ${round2(n)}`}}
function formatDateRange(ev){if(!ev)return "";if(ev.endDate&&ev.endDate!==ev.startDate)return `${ev.startDate} ～ ${ev.endDate}`;return ev.startDate||"未設定日期"}
function formatDateTime(iso){if(!iso)return "";const d=new Date(iso);if(Number.isNaN(d.getTime()))return iso.replace("T"," ");return new Intl.DateTimeFormat("zh-TW",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}).format(d)}

function normalizeState(p){
  const out={...structuredClone(defaultState),...p,rateCache:p?.rateCache||{},events:p?.events||[]};
  out.events=out.events.map(ev=>({...ev,attendees:ev.attendees||[],expenses:(ev.expenses||[]).map(x=>({...x,discountEnabled:!!x.discountEnabled,discountType:x.discountType||"amount",discountValue:x.discountValue||0,discountAmount:x.discountAmount||0,discountMode:x.discountMode||"all_proportional",discountRecipients:x.discountRecipients||[],discountAllocations:x.discountAllocations||{},serviceFeeBasis:x.serviceFeeBasis||"before_discount",shares:(x.shares||[]).map(s=>({...s,discountAmount:s.discountAmount||0,serviceFeeAmount:s.serviceFeeAmount??round2((s.amount||0)-(s.rawAmount||0)+(s.discountAmount||0))}))})),payments:ev.payments||[],settlementMode:ev.settlementMode||"optimized"}));
  return out;
}
function loadState(){
  try{
    const raw=localStorage.getItem(STORAGE_KEY);
    if(raw)return normalizeState(JSON.parse(raw));
    const v3=localStorage.getItem(OLD_STORAGE_KEY);
    if(v3)return normalizeState(JSON.parse(v3));
    const old=localStorage.getItem(OLDER_STORAGE_KEY);
    if(old){
      const p=JSON.parse(old);
      const ev={id:uid("event"),name:p.eventName||"舊版活動",startDate:today(),endDate:"",baseCurrency:p.baseCurrency||"TWD",attendees:p.attendees||[],expenses:(p.expenses||[]).map(x=>({...x,occurredAt:x.createdAt||new Date().toISOString()})),payments:p.payments||[],settlementMode:"optimized",createdAt:new Date().toISOString()};
      return normalizeState({friends:p.friends||defaultState.friends,events:[ev],activeEventId:ev.id,rateCache:p.rateCache||{}});
    }
  }catch(e){console.warn(e)}
  return structuredClone(defaultState);
}

function safeMath(expr){
  const s=String(expr||"").trim().replaceAll(",","");
  if(!s)return 0;
  if(!/^[0-9+\-*/().%\s]+$/.test(s))throw new Error("只能輸入數字與 + - * / ( ) %");
  const normalized=s.replace(/(\d+(?:\.\d+)?)%/g,"($1/100)");
  const value=Function(`"use strict"; return (${normalized});`)();
  if(!Number.isFinite(value)||value<0)throw new Error("算式結果不正確");
  return round2(value);
}

function openDb(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DB_NAME,1);req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(DB_STORE))db.createObjectStore(DB_STORE)};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
async function saveAttachment(file,idOverride=null){if(!file)return idOverride;const id=idOverride||uid("att");const db=await openDb();return new Promise((resolve,reject)=>{const tx=db.transaction(DB_STORE,"readwrite");tx.objectStore(DB_STORE).put(file,id);tx.oncomplete=()=>resolve(id);tx.onerror=()=>reject(tx.error)})}
async function getAttachment(id){if(!id)return null;const db=await openDb();return new Promise((resolve,reject)=>{const req=db.transaction(DB_STORE,"readonly").objectStore(DB_STORE).get(id);req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error)})}
async function deleteAttachment(id){if(!id)return;const db=await openDb();return new Promise((resolve,reject)=>{const tx=db.transaction(DB_STORE,"readwrite");tx.objectStore(DB_STORE).delete(id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)})}
async function clearAttachments(){const db=await openDb();return new Promise((resolve,reject)=>{const tx=db.transaction(DB_STORE,"readwrite");tx.objectStore(DB_STORE).clear();tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)})}
async function getAllAttachmentKeys(){const db=await openDb();return new Promise((resolve,reject)=>{const req=db.transaction(DB_STORE,"readonly").objectStore(DB_STORE).getAllKeys();req.onsuccess=()=>resolve(req.result||[]);req.onerror=()=>reject(req.error)})}
async function viewAttachment(id){const blob=await getAttachment(id);if(!blob)return alert("找不到附件，可能已被瀏覽器清除。");const url=URL.createObjectURL(blob);el("imagePreview").src=url;el("imageDialog").showModal();el("imageDialog").dataset.url=url}
function blobToDataURL(blob){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.readAsDataURL(blob)})}
function dataURLToBlob(dataURL){const [meta,b64]=dataURL.split(",");const mime=(meta.match(/data:(.*?);base64/)||[])[1]||"application/octet-stream";const bytes=atob(b64);const arr=new Uint8Array(bytes.length);for(let i=0;i<bytes.length;i++)arr[i]=bytes.charCodeAt(i);return new Blob([arr],{type:mime})}

function initSelects(){
  for(const id of ["newEventCurrency","baseCurrency","expenseCurrency"]){el(id).innerHTML=CURRENCIES.map(c=>`<option value="${c}">${c}</option>`).join("")}
  el("newEventCurrency").value="TWD";
  el("categorySelect").innerHTML=CATEGORIES.map(c=>`<option value="${c}">${c}</option>`).join("");
  el("categorySelect").value="餐飲";
  el("newEventStartDate").value=today();
}

function renderAll(){
  renderFriends();renderEvents();renderActiveEvent();updateNetworkBadge();
}

function renderFriends(){
  const host=el("friendList");host.innerHTML="";
  if(!state.friends.length){host.innerHTML='<span class="muted">尚未新增朋友。</span>';return}
  state.friends.forEach(name=>{const chip=document.createElement("div");chip.className="chip";chip.innerHTML=`<span>${escapeHtml(name)}</span><button class="chip-remove" title="刪除">×</button>`;chip.querySelector("button").onclick=()=>removeFriend(name);host.appendChild(chip)})
}

function renderEvents(){
  const host=el("eventList");host.innerHTML="";
  if(!state.events.length){host.innerHTML='<div class="empty-state">尚未建立活動。先建立一次聚餐或旅遊吧。</div>';return}
  [...state.events].sort((a,b)=>(b.startDate||"").localeCompare(a.startDate||"")).forEach(ev=>{
    const total=round2((ev.expenses||[]).reduce((s,x)=>s+(x.baseAmount||0),0));
    const row=document.createElement("div");row.className=`event-item ${ev.id===state.activeEventId?"active":""}`;
    row.innerHTML=`<div><div class="event-name">${escapeHtml(ev.name||"未命名活動")}</div><div class="event-sub">${escapeHtml(formatDateRange(ev))} · ${(ev.expenses||[]).length} 筆 · ${money(total,ev.baseCurrency)}</div></div><button class="${ev.id===state.activeEventId?"secondary":""}">${ev.id===state.activeEventId?"目前開啟":"開啟"}</button>`;
    row.querySelector("button").onclick=()=>{state.activeEventId=ev.id;saveState();cancelEditExpense();renderAll()};host.appendChild(row)
  })
}

function renderActiveEvent(){
  const ev=activeEvent();
  for(const id of ["activeEventCard","expenseFormCard","expenseHistoryCard","settlementCard","statsCard"])el(id).classList.toggle("hidden",!ev);
  if(!ev)return;
  el("activeEventTitle").textContent=ev.name||"未命名活動";
  el("activeEventDateText").textContent=`${formatDateRange(ev)} · 主要幣別 ${ev.baseCurrency}`;
  el("eventName").value=ev.name||"";el("eventStartDate").value=ev.startDate||"";el("eventEndDate").value=ev.endDate||"";el("baseCurrency").value=ev.baseCurrency||"TWD";el("settlementMode").value=ev.settlementMode||"optimized";
  draftParticipants = editExpenseId ? draftParticipants : new Set(ev.attendees||[]);
  renderAttendees();renderPayerOptions();renderExpenseParticipants();renderExpenses();renderBalances();renderPaidHistory();renderStats();
  if(!editExpenseId)resetExpenseForm(false);
}

function renderAttendees(){
  const ev=activeEvent(),host=el("attendeeList");host.innerHTML="";
  state.friends.forEach(name=>{const label=document.createElement("label");label.className="check-item";label.innerHTML=`<input type="checkbox" ${(ev.attendees||[]).includes(name)?"checked":""}><span>${escapeHtml(name)}</span>`;label.querySelector("input").onchange=e=>{if(e.target.checked&&!ev.attendees.includes(name))ev.attendees.push(name);else if(!e.target.checked)ev.attendees=ev.attendees.filter(x=>x!==name);saveState();if(!editExpenseId){draftParticipants=new Set(ev.attendees);renderExpenseParticipants();updateDraftPreview()}};host.appendChild(label)})
}

function renderPayerOptions(){
  const s=el("payerSelect"),cur=s.value;s.innerHTML=state.friends.map(n=>`<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join("");if(state.friends.includes(cur))s.value=cur;else if(activeEvent()?.attendees?.[0])s.value=activeEvent().attendees[0]
}
function renderExpenseParticipants(){
  const host=el("expenseParticipantList");host.innerHTML="";state.friends.forEach(name=>{const label=document.createElement("label");label.className="check-item";label.innerHTML=`<input type="checkbox" ${draftParticipants.has(name)?"checked":""}><span>${escapeHtml(name)}</span>`;label.querySelector("input").onchange=e=>{if(e.target.checked)draftParticipants.add(name);else draftParticipants.delete(name);renderCustomAmountArea();renderDiscountControls();updateDraftPreview()};host.appendChild(label)});renderCustomAmountArea()
}
function renderCustomAmountArea(values=null){
  const host=el("customAmountArea"),custom=el("splitMode").value==="custom";host.classList.toggle("hidden",!custom);if(!custom){host.innerHTML="";return}
  const old={};host.querySelectorAll("input[data-person]").forEach(i=>old[i.dataset.person]=i.value);host.innerHTML="";[...draftParticipants].forEach(name=>{const row=document.createElement("label");row.className="custom-row";row.innerHTML=`<span>${escapeHtml(name)}</span><input inputmode="decimal" data-person="${escapeHtml(name)}" placeholder="原始金額">`;const input=row.querySelector("input");input.value=(values&&values[name]!=null)?values[name]:(old[name]||"");input.oninput=updateDraftPreview;host.appendChild(row)})
}
function getCustomShares(){const v={};document.querySelectorAll("#customAmountArea input[data-person]").forEach(i=>{try{v[i.dataset.person]=safeMath(i.value||0)}catch{v[i.dataset.person]=NaN}});return v}
function currentServicePct(){return el("serviceFeeToggle").checked?Number(el("serviceFeePercent").value||0):0}
function currentServiceBasis(){return el("serviceFeeBasis").value||"before_discount"}
function getDraftBaseAmount(){return safeMath(el("expenseAmount").value)}
function getRate(){return el("foreignCurrencyToggle").checked?Number(el("exchangeRate").value||0):1}
function currentCurrency(){return el("foreignCurrencyToggle").checked?el("expenseCurrency").value:activeEvent().baseCurrency}
function currentDiscountTotal(rawTotal){
  if(!el("discountToggle").checked)return 0;
  let v=0;try{v=safeMath(el("discountValue").value||0)}catch{return NaN}
  const total=el("discountType").value==="percent"?round2(rawTotal*v/100):round2(v);
  return total;
}
function selectedDiscountRecipients(){return [...document.querySelectorAll("#discountRecipientList input[data-person]:checked")].map(i=>i.dataset.person)}
function getCustomDiscounts(){const out={};document.querySelectorAll("#customDiscountArea input[data-person]").forEach(i=>{try{out[i.dataset.person]=safeMath(i.value||0)}catch{out[i.dataset.person]=NaN}});return out}
function renderDiscountControls(customValues=null,selectedValues=null){
  const enabled=el("discountToggle").checked,area=el("discountArea");area.classList.toggle("hidden",!enabled);
  el("discountValueLabel").textContent=el("discountType").value==="percent"?"折扣 %":"折扣金額";
  const mode=el("discountMode").value,needsSelect=mode==="selected_equal"||mode==="custom";
  el("discountRecipientsArea").classList.toggle("hidden",!enabled||!needsSelect);
  const list=el("discountRecipientList"),oldSelected=new Set(selectedValues||selectedDiscountRecipients());list.innerHTML="";
  [...draftParticipants].forEach(name=>{const label=document.createElement("label");label.className="check-item";label.innerHTML=`<input type="checkbox" data-person="${escapeHtml(name)}" ${oldSelected.has(name)?"checked":""}><span>${escapeHtml(name)}</span>`;label.querySelector("input").onchange=()=>{renderCustomDiscountArea();updateDraftPreview()};list.appendChild(label)});
  renderCustomDiscountArea(customValues);
}
function renderCustomDiscountArea(values=null){
  const host=el("customDiscountArea"),show=el("discountToggle").checked&&el("discountMode").value==="custom";host.classList.toggle("hidden",!show);if(!show){host.innerHTML="";return}
  const old={};host.querySelectorAll("input[data-person]").forEach(i=>old[i.dataset.person]=i.value);host.innerHTML="";const selected=new Set(selectedDiscountRecipients());
  [...draftParticipants].filter(n=>selected.has(n)).forEach(name=>{const row=document.createElement("label");row.className="custom-row";row.innerHTML=`<span>${escapeHtml(name)}</span><input inputmode="decimal" data-person="${escapeHtml(name)}" placeholder="折扣金額">`;const input=row.querySelector("input");input.value=(values&&values[name]!=null)?values[name]:(old[name]||"");input.oninput=updateDraftPreview;host.appendChild(row)});
}
function allocateDiscount(rawShares,discountTotal){
  const allocations=Object.fromEntries(rawShares.map(x=>[x.person,0]));if(!(discountTotal>0))return allocations;
  const mode=el("discountMode").value;
  if(discountTotal>round2(rawShares.reduce((s,x)=>s+x.rawAmount,0))+0.01)throw new Error("折扣不能大於原始總額。");
  let targets=[];
  if(mode==="all_proportional"||mode==="all_equal")targets=rawShares.map(x=>x.person);else targets=selectedDiscountRecipients();
  if(!targets.length)throw new Error("請選擇至少一位享有折扣的人。");
  if(mode==="custom"){const c=getCustomDiscounts();let sum=0;for(const person of targets){const v=Number(c[person]||0);if(!Number.isFinite(v))throw new Error("自訂折扣金額格式不正確。");allocations[person]=round2(v);sum=round2(sum+v)}if(Math.abs(sum-discountTotal)>0.01)throw new Error(`自訂折扣合計 ${money(sum,currentCurrency())}，必須等於折扣總額 ${money(discountTotal,currentCurrency())}。`);}
  else if(mode==="all_proportional"){const eligible=rawShares.filter(x=>targets.includes(x.person)),base=eligible.reduce((s,x)=>s+x.rawAmount,0);let used=0;eligible.forEach((x,i)=>{const v=i===eligible.length-1?round2(discountTotal-used):round2(discountTotal*x.rawAmount/base);allocations[x.person]=v;used=round2(used+v)});}
  else{let used=0;targets.forEach((person,i)=>{const v=i===targets.length-1?round2(discountTotal-used):round2(discountTotal/targets.length);allocations[person]=v;used=round2(used+v)});}
  for(const x of rawShares)if((allocations[x.person]||0)>x.rawAmount+0.01)throw new Error(`${x.person} 的折扣超過原始消費金額。`);
  return allocations;
}
function getDraftShares(rawTotal){
  const people=[...draftParticipants],mode=el("splitMode").value,pct=currentServicePct(),basis=currentServiceBasis();if(!people.length)return [];
  let raw=[];if(mode==="equal"){const per=rawTotal/people.length;raw=people.map((person,i)=>({person,rawAmount:i===people.length-1?round2(rawTotal-round2(per)*(people.length-1)):round2(per)}))}else{const custom=getCustomShares();raw=people.map(person=>({person,rawAmount:round2(Number(custom[person]||0))}))}
  const discountTotal=currentDiscountTotal(rawTotal);if(!Number.isFinite(discountTotal))throw new Error("折扣金額格式不正確。");const allocations=allocateDiscount(raw,discountTotal);
  let out=raw.map(x=>{const discountAmount=round2(allocations[x.person]||0),afterDiscount=round2(x.rawAmount-discountAmount),feeBase=basis==="after_discount"?afterDiscount:x.rawAmount,serviceFeeAmount=round2(feeBase*pct/100),amount=round2(afterDiscount+serviceFeeAmount);return {...x,discountAmount,serviceFeeAmount,amount}});
  const feeTotal=round2(out.reduce((s,x)=>s+x.serviceFeeAmount,0)),target=round2(rawTotal-discountTotal+feeTotal),sum=round2(out.reduce((s,x)=>s+x.amount,0));if(out.length&&Math.abs(target-sum)>.001)out[out.length-1].amount=round2(out[out.length-1].amount+(target-sum));
  return out;
}
function updateDraftPreview(){
  if(!activeEvent())return;const box=el("expensePreview"),people=[...draftParticipants];let rawTotal=0;try{rawTotal=getDraftBaseAmount()}catch(e){box.textContent=e.message;return}if(!rawTotal||!people.length){box.textContent="請輸入金額並選擇參與者。";return}
  const mode=el("splitMode").value,pct=currentServicePct(),currency=currentCurrency(),rate=getRate();if(el("foreignCurrencyToggle").checked&&!rate){box.textContent="請先取得或輸入匯率。";return}
  let shares;try{shares=getDraftShares(rawTotal)}catch(e){box.textContent=e.message;return}
  const rawShareSum=round2(shares.reduce((s,x)=>s+x.rawAmount,0));if(mode==="custom"&&Math.abs(rawShareSum-rawTotal)>0.01){box.innerHTML=`自訂原始金額合計 <strong>${money(rawShareSum,currency)}</strong>，與輸入總額 <strong>${money(rawTotal,currency)}</strong> 相差 ${money(rawTotal-rawShareSum,currency)}。`;return}
  const discountTotal=round2(shares.reduce((s,x)=>s+x.discountAmount,0)),feeTotal=round2(shares.reduce((s,x)=>s+x.serviceFeeAmount,0)),finalTotal=round2(shares.reduce((s,x)=>s+x.amount,0)),baseTotal=round2(finalTotal*rate);
  let html=`原始金額 <strong>${money(rawTotal,currency)}</strong>`;if(discountTotal)html+=` − 折扣 <strong>${money(discountTotal,currency)}</strong>`;if(pct)html+=` ＋ 服務費 ${pct}% <strong>${money(feeTotal,currency)}</strong>`;html+=` = <strong>${money(finalTotal,currency)}</strong>`;if(currency!==activeEvent().baseCurrency)html+=`；換算約 <strong>${money(baseTotal,activeEvent().baseCurrency)}</strong>（匯率 ${round6(rate)}）`;
  html+=`<br>${shares.map(s=>{let bits=[`${escapeHtml(s.person)} ${money(s.amount,currency)}`,`原 ${money(s.rawAmount,currency)}`];if(s.discountAmount)bits.push(`折 ${money(s.discountAmount,currency)}`);if(s.serviceFeeAmount)bits.push(`服務費 ${money(s.serviceFeeAmount,currency)}`);return `${bits[0]}（${bits.slice(1).join("、")}）`}).join("、")}`;box.innerHTML=html
}

async function fetchRate(force=false){
  const ev=activeEvent(),base=el("expenseCurrency").value,quote=ev.baseCurrency;if(base===quote){el("exchangeRate").value=1;el("rateStatus").textContent="同幣別，匯率 1";updateDraftPreview();return}
  const key=`${base}_${quote}`,cached=state.rateCache[key],day=today();if(!force&&cached&&cached.fetchedOn===day){el("exchangeRate").value=cached.rate;el("rateStatus").textContent=`快取：${cached.rateDate||cached.fetchedOn}`;updateDraftPreview();return}
  if(!navigator.onLine){if(cached){el("exchangeRate").value=cached.rate;el("rateStatus").textContent=`離線，使用上次匯率 ${cached.rateDate||cached.fetchedOn}`;updateDraftPreview()}else el("rateStatus").textContent="目前離線，沒有舊匯率；可手動輸入。";return}
  el("rateStatus").textContent="查詢匯率中…";try{const r=await fetch(`https://api.frankfurter.dev/v2/rate/${base.toLowerCase()}/${quote.toLowerCase()}`);if(!r.ok)throw new Error();const d=await r.json();const rate=Number(d.rate);state.rateCache[key]={rate,rateDate:d.date,fetchedOn:day};saveState();el("exchangeRate").value=rate;el("rateStatus").textContent=`最新資料日期：${d.date}`;updateDraftPreview()}catch{if(cached){el("exchangeRate").value=cached.rate;el("rateStatus").textContent=`查詢失敗，使用上次匯率 ${cached.rateDate||cached.fetchedOn}`}else el("rateStatus").textContent="查詢失敗，可手動輸入匯率。";updateDraftPreview()}
}

function addFriend(){const i=el("friendName"),name=i.value.trim();if(!name)return;if(state.friends.includes(name))return alert("這個名字已經存在。");state.friends.push(name);i.value="";saveState();renderAll()}
function removeFriend(name){const used=state.events.some(ev=>(ev.expenses||[]).some(e=>e.payer===name||e.shares.some(s=>s.person===name))||(ev.payments||[]).some(p=>p.from===name||p.to===name));if(used)return alert("這個人已經出現在活動的消費或付款紀錄中，無法直接刪除。");if(!confirm(`確定要移除「${name}」嗎？`))return;state.friends=state.friends.filter(x=>x!==name);state.events.forEach(ev=>ev.attendees=(ev.attendees||[]).filter(x=>x!==name));saveState();renderAll()}

function createEvent(){const name=el("newEventName").value.trim(),start=el("newEventStartDate").value,end=el("newEventEndDate").value,base=el("newEventCurrency").value;if(!name)return alert("請輸入活動名稱。");if(!start)return alert("請選擇活動開始日期。");if(end&&end<start)return alert("結束日期不能早於開始日期。");const ev={id:uid("event"),name,startDate:start,endDate:end,baseCurrency:base,attendees:[],expenses:[],payments:[],settlementMode:"optimized",createdAt:new Date().toISOString()};state.events.push(ev);state.activeEventId=ev.id;saveState();el("newEventName").value="";el("newEventEndDate").value="";cancelEditExpense();renderAll()}
async function deleteEvent(){const ev=activeEvent();if(!ev)return;if(!confirm(`確定刪除「${ev.name}」？這會連同支出、收據與付款證明一起刪除。`))return;for(const e of ev.expenses||[])await deleteAttachment(e.receiptId);for(const p of ev.payments||[])await deleteAttachment(p.proofId);state.events=state.events.filter(x=>x.id!==ev.id);state.activeEventId=state.events[0]?.id||null;saveState();cancelEditExpense();renderAll()}
function saveEventMeta(){const ev=activeEvent(),name=el("eventName").value.trim(),start=el("eventStartDate").value,end=el("eventEndDate").value,base=el("baseCurrency").value;if(!name||!start)return alert("活動名稱與開始日期不可空白。");if(end&&end<start)return alert("結束日期不能早於開始日期。");if(base!==ev.baseCurrency&&ev.expenses.length&&!confirm("更改主要幣別不會重算既有支出，只會影響之後的新支出。仍要更改嗎？")){el("baseCurrency").value=ev.baseCurrency;return}Object.assign(ev,{name,startDate:start,endDate:end,baseCurrency:base});saveState();el("eventMetaEditor").classList.add("hidden");renderAll()}

function resetExpenseForm(resetParticipants=true){
  const ev=activeEvent();if(!ev)return;editExpenseId=null;editingReceiptId=null;el("expenseFormTitle").textContent="3. 新增消費";el("addExpenseBtn").textContent="加入這筆消費";el("cancelEditExpenseBtn").classList.add("hidden");el("expenseTitle").value="";el("expenseAmount").value="";el("categorySelect").value="餐飲";el("splitMode").value="equal";el("receiptInput").value="";el("receiptHint").textContent="";
  el("discountToggle").checked=false;el("discountArea").classList.add("hidden");el("discountType").value="amount";el("discountValue").value="";el("discountMode").value="all_proportional";el("discountRecipientList").innerHTML="";el("customDiscountArea").innerHTML="";
  el("serviceFeeToggle").checked=false;el("serviceFeeArea").classList.add("hidden");el("serviceFeePercent").value=10;el("serviceFeeBasis").value="before_discount";el("foreignCurrencyToggle").checked=false;el("foreignCurrencyArea").classList.add("hidden");el("exchangeRate").value="";el("rateStatus").textContent="";el("expenseCurrency").value=ev.baseCurrency;el("expenseDateTime").value=(ev.startDate===today()?localDateTimeValue():`${ev.startDate}T12:00`);if(resetParticipants)draftParticipants=new Set(ev.attendees||[]);renderPayerOptions();renderExpenseParticipants();renderDiscountControls();updateDraftPreview()
}
function cancelEditExpense(){editExpenseId=null;editingReceiptId=null;if(activeEvent())resetExpenseForm(true)}

async function saveExpense(){
  const ev=activeEvent();if(!ev)return;const title=el("expenseTitle").value.trim(),payer=el("payerSelect").value,mode=el("splitMode").value,people=[...draftParticipants],category=el("categorySelect").value,currency=currentCurrency(),rate=getRate(),pct=currentServicePct(),occurredValue=el("expenseDateTime").value;let rawTotal=0;
  try{rawTotal=getDraftBaseAmount()}catch(e){return alert(e.message)}
  if(!title)return alert("請輸入項目名稱。");if(!(rawTotal>0))return alert("請輸入正確金額或算式。");if(!payer)return alert("請選擇付款人。");if(!people.length)return alert("至少要選一位參與者。");if(!occurredValue)return alert("請選擇消費日期時間。");if(currency!==ev.baseCurrency&&!(rate>0))return alert("請先取得或輸入正確匯率。");
  let shares;try{shares=getDraftShares(rawTotal)}catch(e){return alert(e.message)}const rawShareSum=round2(shares.reduce((s,x)=>s+x.rawAmount,0));if(mode==="custom"&&Math.abs(rawShareSum-rawTotal)>0.01)return alert(`自訂原始金額合計 ${money(rawShareSum,currency)}，必須等於原始總額 ${money(rawTotal,currency)}。`);
  const discountAmount=round2(shares.reduce((s,x)=>s+x.discountAmount,0)),serviceFeeAmount=round2(shares.reduce((s,x)=>s+x.serviceFeeAmount,0)),amount=round2(shares.reduce((s,x)=>s+x.amount,0)),baseAmount=round2(amount*rate),newFile=el("receiptInput").files[0];let receiptId=editingReceiptId||null;
  try{if(newFile){const old=receiptId;receiptId=await saveAttachment(newFile);if(old)await deleteAttachment(old)}}catch(e){console.warn(e);return alert("收據儲存失敗，請再試一次。")}  
  const discountRecipients=(el("discountMode").value==="selected_equal"||el("discountMode").value==="custom")?selectedDiscountRecipients():[];const discountAllocations=Object.fromEntries(shares.map(s=>[s.person,s.discountAmount]));
  const data={title,rawTotal,amount,baseAmount,payer,mode,category,currency,rate:round6(rate),discountEnabled:el("discountToggle").checked,discountType:el("discountType").value,discountValue:el("discountToggle").checked?Number(el("discountValue").value||0):0,discountAmount,discountMode:el("discountMode").value,discountRecipients,discountAllocations,serviceFeePercent:pct,serviceFeeAmount,serviceFeeBasis:currentServiceBasis(),shares:shares.map(s=>({...s,baseAmount:round2(s.amount*rate)})),receiptId,occurredAt:new Date(occurredValue).toISOString()};
  if(editExpenseId){const idx=ev.expenses.findIndex(x=>x.id===editExpenseId);if(idx>=0)ev.expenses[idx]={...ev.expenses[idx],...data,updatedAt:new Date().toISOString()}}else ev.expenses.push({id:uid("expense"),...data,createdAt:new Date().toISOString()});
  saveState();resetExpenseForm(true);renderAll();
}

function editExpense(id){
  const ev=activeEvent(),exp=ev.expenses.find(x=>x.id===id);if(!exp)return;editExpenseId=id;editingReceiptId=exp.receiptId||null;el("expenseFormTitle").textContent="3. 編輯消費";el("addExpenseBtn").textContent="儲存修改";el("cancelEditExpenseBtn").classList.remove("hidden");el("expenseTitle").value=exp.title;el("expenseAmount").value=exp.rawTotal;el("payerSelect").value=exp.payer;el("categorySelect").value=exp.category||"其他";el("splitMode").value=exp.mode||"equal";el("expenseDateTime").value=localDateTimeValue(new Date(exp.occurredAt||exp.createdAt));
  el("discountToggle").checked=!!exp.discountEnabled||!!exp.discountAmount;el("discountType").value=exp.discountType||"amount";el("discountValue").value=exp.discountValue||exp.discountAmount||"";el("discountMode").value=exp.discountMode||"all_proportional";
  el("serviceFeeToggle").checked=!!exp.serviceFeePercent;el("serviceFeeArea").classList.toggle("hidden",!exp.serviceFeePercent);el("serviceFeePercent").value=exp.serviceFeePercent||10;el("serviceFeeBasis").value=exp.serviceFeeBasis||"before_discount";const foreign=exp.currency!==ev.baseCurrency;el("foreignCurrencyToggle").checked=foreign;el("foreignCurrencyArea").classList.toggle("hidden",!foreign);el("expenseCurrency").value=exp.currency||ev.baseCurrency;el("exchangeRate").value=foreign?exp.rate:"";el("rateStatus").textContent=foreign?`使用原紀錄匯率 ${exp.rate}`:"";el("receiptInput").value="";el("receiptHint").textContent=exp.receiptId?"目前已有收據；不重新選檔就會保留原收據。":"";draftParticipants=new Set(exp.shares.map(s=>s.person));renderExpenseParticipants();if(exp.mode==="custom"){const vals=Object.fromEntries(exp.shares.map(s=>[s.person,s.rawAmount]));renderCustomAmountArea(vals)}
  const discountVals=exp.discountAllocations||Object.fromEntries((exp.shares||[]).map(s=>[s.person,s.discountAmount||0]));renderDiscountControls(discountVals,exp.discountRecipients||[]);updateDraftPreview();el("expenseFormCard").scrollIntoView({behavior:"smooth",block:"start"})
}

function renderExpenses(){
  const ev=activeEvent(),host=el("expenseList");if(!ev.expenses.length){host.className="expense-list empty-state";host.textContent="目前還沒有任何消費。";return}host.className="expense-list";host.innerHTML="";
  [...ev.expenses].sort((a,b)=>new Date(b.occurredAt||b.createdAt)-new Date(a.occurredAt||a.createdAt)).forEach(exp=>{const detail=exp.shares.map(s=>`${s.person} ${money(s.amount,exp.currency)}`).join("、");const row=document.createElement("div");row.className="expense-row";let meta=`${formatDateTime(exp.occurredAt||exp.createdAt)}<br>${escapeHtml(exp.payer)} 先付款 · ${escapeHtml(exp.category||"其他")} · ${exp.mode==="equal"?"平均分攤":"自訂金額"}<br>${escapeHtml(detail)}`;if(exp.discountAmount)meta+=`<br>折扣 ${money(exp.discountAmount,exp.currency)} · ${exp.discountMode==="all_proportional"?"全體依比例":exp.discountMode==="all_equal"?"全體平均":exp.discountMode==="selected_equal"?`指定 ${escapeHtml((exp.discountRecipients||[]).join("、"))}`:"自訂分配"}`;if(exp.serviceFeePercent)meta+=`<br>服務費 ${exp.serviceFeePercent}%（${(exp.serviceFeeBasis||"before_discount")==="before_discount"?"折扣前":"折扣後"}計算） ${money(exp.serviceFeeAmount??round2(exp.amount-exp.rawTotal+(exp.discountAmount||0)),exp.currency)}`;if(exp.currency!==ev.baseCurrency)meta+=`<br>${exp.currency} → ${ev.baseCurrency}，匯率 ${exp.rate}，入帳 ${money(exp.baseAmount,ev.baseCurrency)}`;row.innerHTML=`<div><h4>${escapeHtml(exp.title)}</h4><div class="expense-meta">${meta}</div></div><div class="expense-actions"><div class="amount">${money(exp.amount,exp.currency)}</div>${exp.receiptId?'<button class="attach-btn receipt-btn">看收據</button>':""}<button class="secondary edit-btn">編輯</button><button class="icon-btn delete-btn">刪除</button></div>`;row.querySelector(".receipt-btn")?.addEventListener("click",()=>viewAttachment(exp.receiptId));row.querySelector(".edit-btn").onclick=()=>editExpense(exp.id);row.querySelector(".delete-btn").onclick=async()=>{if(!confirm(`刪除「${exp.title}」？`))return;await deleteAttachment(exp.receiptId);ev.expenses=ev.expenses.filter(x=>x.id!==exp.id);if(editExpenseId===exp.id)resetExpenseForm(true);saveState();renderAll()};host.appendChild(row)})
}

function calculateBalances(){const ev=activeEvent(),b=Object.fromEntries(state.friends.map(n=>[n,0]));ev.expenses.forEach(exp=>{b[exp.payer]=round2((b[exp.payer]||0)+exp.baseAmount);exp.shares.forEach(s=>b[s.person]=round2((b[s.person]||0)-s.baseAmount))});ev.payments.forEach(p=>{b[p.from]=round2((b[p.from]||0)+p.amount);b[p.to]=round2((b[p.to]||0)-p.amount)});return b}
function optimizeSettlements(b){const c=[],d=[];Object.entries(b).forEach(([n,v])=>{if(v>.009)c.push({name:n,amount:round2(v)});if(v<-.009)d.push({name:n,amount:round2(-v)})});c.sort((a,b)=>b.amount-a.amount);d.sort((a,b)=>b.amount-a.amount);const out=[];let i=0,j=0;while(i<d.length&&j<c.length){const pay=round2(Math.min(d[i].amount,c[j].amount));if(pay>0)out.push({from:d[i].name,to:c[j].name,amount:pay});d[i].amount=round2(d[i].amount-pay);c[j].amount=round2(c[j].amount-pay);if(d[i].amount<=.009)i++;if(c[j].amount<=.009)j++}return out}
function directSettlements(){
  const ev=activeEvent(),debts={};const key=(a,b)=>`${a}|||${b}`;const add=(from,to,amount)=>{if(from===to||amount<=.009)return;const k=key(from,to);debts[k]=round2((debts[k]||0)+amount)};
  ev.expenses.forEach(exp=>exp.shares.forEach(s=>{if(s.person!==exp.payer)add(s.person,exp.payer,s.baseAmount)}));
  // 已付款先抵同方向的原始債務；若付款超過或沒有該方向債務，超出的部分視為反向債權。
  ev.payments.forEach(p=>{let left=round2(p.amount),k=key(p.from,p.to),existing=round2(debts[k]||0);const used=Math.min(left,existing);if(used>0){debts[k]=round2(existing-used);left=round2(left-used)}if(left>.009)add(p.to,p.from,left)});
  // 同一對人若彼此都有欠款，只保留淨額，但不跨第三人重新配對。
  const seen=new Set();Object.keys(debts).forEach(k=>{if(seen.has(k))return;const [a,b]=k.split("|||"),rk=key(b,a),ab=round2(debts[k]||0),ba=round2(debts[rk]||0);if(ab>=ba){debts[k]=round2(ab-ba);debts[rk]=0}else{debts[rk]=round2(ba-ab);debts[k]=0}seen.add(k);seen.add(rk)});
  return Object.entries(debts).filter(([,v])=>v>.009).map(([k,amount])=>{const [from,to]=k.split("|||");return {from,to,amount:round2(amount)}}).sort((a,b)=>a.to.localeCompare(b.to,"zh-Hant")||a.from.localeCompare(b.from,"zh-Hant"));
}
function renderBalances(){
  const ev=activeEvent(),balances=calculateBalances(),host=el("balanceSummary");host.innerHTML="";state.friends.forEach(name=>{const v=balances[name]||0,card=document.createElement("div");card.className=`balance-card ${v>.009?"positive":v<-.009?"negative":""}`;card.innerHTML=`<div class="name">${escapeHtml(name)}</div><div class="value">${v>.009?"應收 ":v<-.009?"應付 ":"已平衡 "}${money(Math.abs(v),ev.baseCurrency)}</div>`;host.appendChild(card)});
  const settlements=(ev.settlementMode||"optimized")==="direct"?directSettlements():optimizeSettlements(balances),list=el("settlementList");if(!settlements.length){list.className="settlement-list empty-state";list.textContent=ev.expenses.length?"目前沒有待付款項。":"新增消費後會自動計算。";return}list.className="settlement-list";list.innerHTML="";settlements.forEach(s=>{const row=document.createElement("div");row.className="settlement-row";const req=`${s.from} 需支付 ${s.to} ${money(s.amount,ev.baseCurrency)}｜${ev.name}（${formatDateRange(ev)}）`;row.innerHTML=`<div><strong>${escapeHtml(s.from)}</strong> → <strong>${escapeHtml(s.to)}</strong><br><span class="status-note">${money(s.amount,ev.baseCurrency)}</span></div><div class="settlement-actions"><button class="secondary request-btn">付款請求</button><button class="paid-btn">標記已付款</button></div>`;row.querySelector(".request-btn").onclick=async()=>{if(navigator.share){try{await navigator.share({title:"付款請求",text:req});return}catch{}}try{await navigator.clipboard.writeText(req);alert("付款請求已複製，可貼到 LINE。") }catch{prompt("請複製付款請求：",req)}};row.querySelector(".paid-btn").onclick=()=>openPaymentDialog(s);list.appendChild(row)})
}
function openPaymentDialog(s){pendingSettlement={...s};el("paymentDialogText").textContent=`${s.from} → ${s.to} ${money(s.amount,activeEvent().baseCurrency)}`;el("paymentProofInput").value="";el("paymentDialog").showModal()}
async function confirmPayment(e){e.preventDefault();if(!pendingSettlement)return;let proofId=null;try{proofId=await saveAttachment(el("paymentProofInput").files[0])}catch{alert("付款證明儲存失敗，仍會保留付款紀錄。")}activeEvent().payments.push({id:uid("payment"),from:pendingSettlement.from,to:pendingSettlement.to,amount:pendingSettlement.amount,proofId,paidAt:new Date().toISOString()});saveState();el("paymentDialog").close();pendingSettlement=null;renderAll()}
function renderPaidHistory(){
  const ev=activeEvent(),host=el("paidHistoryList");if(!ev.payments.length){host.className="settlement-list empty-state";host.textContent="目前沒有已付款紀錄。";return}host.className="settlement-list";host.innerHTML="";[...ev.payments].sort((a,b)=>new Date(b.paidAt)-new Date(a.paidAt)).forEach(p=>{const row=document.createElement("div");row.className="settlement-row paid";row.innerHTML=`<div><strong>✅ ${escapeHtml(p.from)} → ${escapeHtml(p.to)}</strong><br><span class="status-note">${money(p.amount,ev.baseCurrency)} · ${formatDateTime(p.paidAt)}</span></div><div class="settlement-actions">${p.proofId?'<button class="attach-btn proof-btn">查看付款證明</button>':""}<button class="ghost undo-btn">撤銷已付款</button></div>`;row.querySelector(".proof-btn")?.addEventListener("click",()=>viewAttachment(p.proofId));row.querySelector(".undo-btn").onclick=async()=>{if(!confirm(`撤銷 ${p.from} → ${p.to} 的已付款紀錄？`))return;await deleteAttachment(p.proofId);ev.payments=ev.payments.filter(x=>x.id!==p.id);saveState();renderAll()};host.appendChild(row)})
}

function renderStats(){const ev=activeEvent(),total=round2(ev.expenses.reduce((s,e)=>s+e.baseAmount,0)),host=el("statsSummary"),counts=ev.expenses.length,per=ev.attendees.length?round2(total/ev.attendees.length):0;host.innerHTML=`<div class="stat-card"><span class="muted">活動總支出</span><strong>${money(total,ev.baseCurrency)}</strong></div><div class="stat-card"><span class="muted">消費筆數</span><strong>${counts}</strong></div><div class="stat-card"><span class="muted">以本次出席平均</span><strong>${money(per,ev.baseCurrency)}</strong></div>`;const sums={};ev.expenses.forEach(e=>sums[e.category||"其他"]=round2((sums[e.category||"其他"]||0)+e.baseAmount));const bars=el("categoryStats");bars.innerHTML="";const max=Math.max(1,...Object.values(sums));Object.entries(sums).sort((a,b)=>b[1]-a[1]).forEach(([cat,val])=>{const row=document.createElement("div");row.className="stat-row";row.innerHTML=`<span>${escapeHtml(cat)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(2,val/max*100)}%"></div></div><strong>${money(val,ev.baseCurrency)}</strong>`;bars.appendChild(row)});if(!Object.keys(sums).length)bars.innerHTML='<div class="empty-state">新增消費後會顯示分類統計。</div>'}
function updateNetworkBadge(){const b=el("networkBadge");b.textContent=navigator.onLine?"● 已連線":"● 離線可記帳";b.className=`badge ${navigator.onLine?"online":"offline"}`}

async function exportBackup(){
  const keys=await getAllAttachmentKeys(),attachments={};for(const key of keys){const blob=await getAttachment(key);if(blob)attachments[key]=await blobToDataURL(blob)}const payload={version:5,exportedAt:new Date().toISOString(),state,attachments};const blob=new Blob([JSON.stringify(payload)],{type:"application/json"});const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=`朋友分帳備份_${today()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
}
async function importBackup(file){if(!file)return;if(!confirm("匯入備份會覆蓋目前這個瀏覽器內的分帳資料，確定嗎？"))return;try{const payload=JSON.parse(await file.text());if(!payload.state||!Array.isArray(payload.state.events))throw new Error();await clearAttachments();for(const [id,dataURL] of Object.entries(payload.attachments||{}))await saveAttachment(dataURLToBlob(dataURL),id);state=payload.state;saveState();cancelEditExpense();renderAll();alert("備份匯入完成。") }catch(e){console.error(e);alert("備份檔格式不正確或匯入失敗。") }finally{el("importBackupInput").value=""}}

el("addFriendBtn").onclick=addFriend;el("friendName").onkeydown=e=>{if(e.key==="Enter")addFriend()};
el("createEventBtn").onclick=createEvent;el("editEventMetaBtn").onclick=()=>el("eventMetaEditor").classList.remove("hidden");el("cancelEventMetaBtn").onclick=()=>el("eventMetaEditor").classList.add("hidden");el("saveEventMetaBtn").onclick=saveEventMeta;el("deleteEventBtn").onclick=deleteEvent;
el("selectAllAttendeesBtn").onclick=()=>{const ev=activeEvent();ev.attendees=[...state.friends];draftParticipants=new Set(ev.attendees);saveState();renderAttendees();renderExpenseParticipants();updateDraftPreview()};el("clearAttendeesBtn").onclick=()=>{const ev=activeEvent();ev.attendees=[];draftParticipants=new Set();saveState();renderAttendees();renderExpenseParticipants();updateDraftPreview()};
el("expenseSelectDefaultBtn").onclick=()=>{draftParticipants=new Set(activeEvent().attendees);renderExpenseParticipants();renderDiscountControls();updateDraftPreview()};el("expenseSelectAllBtn").onclick=()=>{draftParticipants=new Set(state.friends);renderExpenseParticipants();renderDiscountControls();updateDraftPreview()};
el("splitMode").onchange=()=>{renderCustomAmountArea();renderDiscountControls();updateDraftPreview()};el("expenseAmount").oninput=updateDraftPreview;el("serviceFeePercent").oninput=updateDraftPreview;el("serviceFeeBasis").onchange=updateDraftPreview;el("exchangeRate").oninput=updateDraftPreview;
el("discountToggle").onchange=()=>{renderDiscountControls();updateDraftPreview()};el("discountType").onchange=()=>{renderDiscountControls();updateDraftPreview()};el("discountValue").oninput=updateDraftPreview;el("discountMode").onchange=()=>{renderDiscountControls();updateDraftPreview()};
el("serviceFeeToggle").onchange=e=>{el("serviceFeeArea").classList.toggle("hidden",!e.target.checked);updateDraftPreview()};
el("foreignCurrencyToggle").onchange=e=>{el("foreignCurrencyArea").classList.toggle("hidden",!e.target.checked);if(e.target.checked){if(el("expenseCurrency").value===activeEvent().baseCurrency)el("expenseCurrency").value=activeEvent().baseCurrency==="TWD"?"JPY":"TWD";fetchRate()}updateDraftPreview()};el("expenseCurrency").onchange=()=>fetchRate();el("refreshRateBtn").onclick=()=>fetchRate(true);el("addExpenseBtn").onclick=saveExpense;el("cancelEditExpenseBtn").onclick=()=>{resetExpenseForm(true);renderAll()};
el("settlementMode").onchange=e=>{const ev=activeEvent();if(!ev)return;ev.settlementMode=e.target.value;saveState();renderBalances()};
el("confirmPaymentBtn").onclick=confirmPayment;el("closeImageDialog").onclick=()=>{const d=el("imageDialog"),u=d.dataset.url;if(u)URL.revokeObjectURL(u);d.close();el("imagePreview").src=""};
el("exportBackupBtn").onclick=exportBackup;el("importBackupInput").onchange=e=>importBackup(e.target.files[0]);
el("resetBtn").onclick=async()=>{if(!confirm("這會清除所有朋友、活動、支出、收據與付款證明，確定嗎？"))return;await clearAttachments();state=structuredClone(defaultState);saveState();cancelEditExpense();renderAll()};window.addEventListener("online",updateNetworkBadge);window.addEventListener("offline",updateNetworkBadge);

// 提供 Firebase 模組安全地讀取/套用目前 App 狀態。
window.friendSplitApp={
  getState:()=>structuredClone(state),
  replaceState:(next,{source="external"}={})=>{
    state=normalizeState(next||structuredClone(defaultState));
    localStorage.setItem(STORAGE_KEY,JSON.stringify(state));
    draftParticipants=new Set(activeEvent()?.attendees||[]);
    pendingSettlement=null;editExpenseId=null;editingReceiptId=null;
    renderAll();
    if(source!=="cloud")window.dispatchEvent(new CustomEvent("friend-split:state-saved",{detail:{state:structuredClone(state),reason:`replace-${source}`}}));
  },
  storageKey:STORAGE_KEY
};

initSelects();renderAll();
window.dispatchEvent(new Event("friend-split:app-ready"));
if("serviceWorker" in navigator&&location.protocol!=="file:")window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(console.warn));


