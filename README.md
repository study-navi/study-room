# Study Room

自習室の入室・休憩・退室・振り返りを記録するWebアプリです。

## GitHub Pagesに必要なファイル

- `index.html`
- `manifest.webmanifest`
- `sw.js`
- `icons/`

## Apps Script

Googleスプレッドシート連携には `study_room.gs` をApps Scriptへ貼り付けてデプロイします。

## アイコンが変わらない場合

iPhoneはホーム画面アイコンを強くキャッシュします。

1. ホーム画面の既存のStudy Roomを削除
2. Safariでページを開き直す
3. 共有ボタン → ホーム画面に追加

それでも変わらない場合は、SafariのWebサイトデータ削除後に再追加してください。


## Study Room v1.1

- タイマー画面に戻るボタンを追加
- ホーム画面とタイマー画面に「今日の利用人数」「連続記録」「今日の名言」を追加
- 名言101種類
- スプレッドシート送信処理は変更していません
