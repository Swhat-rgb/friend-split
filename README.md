# 朋友分帳 Cloud V5

V4 全功能 + Firebase Firestore 雲端同步。

## 新增
- Google 登入 / 登出
- 電腦與手機登入同一 Google 帳號後同步帳目
- Firestore 雲端為空時，第一次登入會自動上傳目前瀏覽器的 V4/V5 本機資料
- 雲端已有資料時，以雲端資料載入目前裝置
- Firestore 使用持久快取；離線修改可在恢復網路後同步
- 收據照片與付款證明目前仍保存在各裝置 IndexedDB，不會同步圖片

## Firebase 必要設定
1. Authentication 啟用 Google。
2. Firestore Rules 限制 users/{uid}/... 僅本人可讀寫。
3. Authentication > Settings > Authorized domains 加入 GitHub Pages 網域：`swhat-rgb.github.io`。

## GitHub Pages 更新
把本資料夾內檔案上傳/覆蓋到 friend-split repository 根目錄並 Commit。


## V5.1
- Google 登入改用 Redirect 模式
- 新增「上傳本機到雲端」按鈕
- 適合公司網路 popup 登入容易被擋的情況


## Shared V6
- 真正的共享群組：每位朋友用自己的 Google 帳號登入。
- 建立群組會產生 8 碼邀請碼。
- 成員輸入邀請碼後看到同一份活動、消費、結算與付款資料。
- 任一成員修改帳目後，其他成員近即時同步。
- 收據與付款證明圖片仍留在各裝置 IndexedDB，尚未跨裝置共享。
- 上線前請把 firestore-rules-v6.txt 的內容發布到 Firebase Firestore 規則。


## V6.1
- 手機 Google 登入改回 Popup 模式。
- 保留 Shared V6 的共享群組、邀請碼與即時同步功能。
- 公司網路若封鎖 Firebase Auth，建議以手機建立/加入群組。


## V6.2
- 自訂每人金額時，自動加總並回填「總金額」。
- 例如 A=135、B=120、C=110，總金額會即時變成 365。
- 折扣與服務費仍依既有規則在原始總額之後計算。
- 更新 Service Worker 快取版本，降低手機停留舊版的機率。


## V6.3
- 網頁進入時預設不開啟任何活動。
- 開啟哪一個活動改為「各裝置自己的畫面狀態」，不再同步給其他群組成員。
- 新增「關閉活動」按鈕；關閉不會刪除資料。
- 建立新活動後不會自動打開，需從活動紀錄自行按「開啟」。
- 「刪除活動」只對共享群組 Owner 顯示，程式也會再次檢查 Owner 權限。
- Firestore 規則額外阻止一般 Member 讓活動數量減少，以降低誤刪風險。


## V6.4
- Owner 可刪除整個共享群組，需連續兩次確認；第二次固定詢問「你犯了跟偉鈞一樣的錯誤嗎?」。
- 新增消費時，消費日期時間永遠預設為實際記帳當下，不再固定活動開始日 12:00。
- 新增的消費會記錄建立者。
- 消費建立者可直接修改自己的帳；舊帳沒有建立者資訊時由群組 Owner 直接管理。
- 非建立者看到「聯署修改」，可先提出修改內容；發起人算第 1 位聯署，再有 1 位不同成員聯署即自動套用。
- 修改提案會顯示在原本消費紀錄旁，包含修正摘要與聯署進度。
- 非建立者不再顯示該筆消費的直接刪除按鈕。


## V6.5 — Developer Admin
- 新增 Developer/Admin 身分。
- Admin 可查看並進入所有共享群組，即使不是該群組成員。
- Admin 可直接修改/刪除任何消費，不需要聯署。
- Admin 可刪除任何活動與任何群組，不受 Owner 限制。
- 刪除群組時會嘗試同步清除 invite、members 與各成員的群組索引。
- Developer Admin 必須由 Firebase Console 手動建立 `/admins/{你的UID}` 文件，App 不能自行把任何人升級成 Admin。


## V6.6 — Poker Alpha
- 主畫面新增「德州撲克」入口。
- 玩家名單預設沿用 Friend Split 朋友名單，可勾選與新增臨時玩家。
- 入場費預設 10、下注上限預設 100、調整單位預設 10，全部可修改。
- 固定 3 回合。
- 每位玩家可快速 ± 調整、跟到目前目標、ALL IN、棄權。
- 棄權立即依「入場費 + 已確認下注」計算損失。
- 本回合下注在確認前均為暫定。
- 支援「復原上一動作」與「撤銷上一局」。
- 第 3 回合確認後選擇贏家，自動計算本局損益。
- 累積損益面板即時統計，並檢查全體合計是否為 0。
- 歷史紀錄保存每局最終結果，可展開查看。
- Poker Alpha 目前使用本機 localStorage 保存，尚未接 Firestore 群組同步。


## V6.6.1 — Poker hotfix
- 修正 Poker HTML 將 `\n` 顯示在頁面上的問題。
- 修正 Poker JavaScript 被錯誤插入 `renderAll()` 內，導致按鈕無反應/重複初始化的問題。
- Poker DOM 現在會先建立，再載入 app.js，事件只綁定一次。
