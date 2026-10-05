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
