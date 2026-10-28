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
