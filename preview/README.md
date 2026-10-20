# 検証用 Study Room

このディレクトリは、本番切替前のPages/POST/PWA受入用です。公開には利用者の承認が必要です。

- 接続先は本番と別の検証GAS v3・検証スプレッドシートです。
- 架空の名前・学習記録だけを入力してください。検証記録は本番へ移行しません。
- 現在の `/study-room/` の画面・データ・PWAは置き換えません。
- この下のService Workerは同じディレクトリだけを対象とし、通信内容をキャッシュしません。
- ブラウザCORS、教室管理者の権限、iPhone/Safari/PWAの実機確認は未完了です。

再生成：

```sh
python3 multi-classroom/tools/build_pages.py --endpoint '承認済みの検証GAS /exec URL' --output preview --staging
```

生成ファイルは `index.html / manifest.webmanifest / sw.js / build-info.json` です。認証情報は含みません。
