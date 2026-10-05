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
