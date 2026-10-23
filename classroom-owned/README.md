# Study Room：教室ごとの独立運用版

先生がGoogleでログインし教室名を入力すると、先生自身のGoogle Driveに専用スプレッドシートを作成する方式。生徒は教室専用URL・QRからログインせず利用する。教室数・教室名・先生のアカウントは固定しない。

**実装とローカル統合検証が済んだ公開候補。Google／Cloudflareの実アカウント設定、実Google APIでの最終試験、一般公開、実データ移行は未実施。これらには利用者の承認が必要。** 現行のGitHub Pages、`preview/`、既存GAS、既存記録には変更を加えていない。

## 接続済みの機能

- 先生のGoogleログイン、PKCE、ブラウザと結び付いた一回限りのstate、nonce、Google公式ライブラリによるIDトークン検証。認証CookieはHttpOnly・Secure・SameSite、管理操作は同一OriginとCSRFを検証。
- 教室登録、所有者の照合、非公開の専用Sheets作成、継続接続用認証情報のAES-256-GCM暗号化。Drive権限は`drive.file`。アクセストークン・refresh token・client secretを生徒画面、localStorage、URLへ渡さない。
- 生徒用URL・SVG QR・先生の管理画面・保存先リンク・手動バックアップを表示する登録画面。
- v9を基にした自習タイマー、休憩、入退室、目標、科目・学習内容、集中度・達成度、振り返り、本人の履歴、端末内の未送信記録復元、利用者切替。
- 先生の自教室に限った一覧、検索、編集、論理削除、ランキング、期間別集計、在籍数を分母にした利用率、CSV、教室モード、本人確認後の履歴引継ぎ、重複IDの統合。
- 教室名・在籍数・利用状態の変更。教室追加は登録画面から行い、新しい保存先を発行する。
- 名前が同じでもランダムな生徒IDと端末キーで識別。教室URLごとにプロフィールと状態を分離。端末キーを失った生徒は先生が本人を確認して引継ぎする。
- PWA、教室URLを保持するインストール用manifest、スマホ表示。Service Workerは認証情報や記録をCacheStorageに保存しない。ネット接続なしで送信できたと扱わない。

独立運用方式では、すべての先生のDriveを自由に閲覧できる全体管理者を作らない。先生は自分が登録した教室だけ管理できる。従来の一元管理版は`multi-classroom/`に維持される。

## 実装構成

| ファイル | 役割 |
| --- | --- |
| `registration.mjs` | 教室登録の所有者・再送・不確定な作成結果の照合 |
| `google-auth.mjs` | Google OAuth、サーバーセッション、継続接続 |
| `google-workspace.mjs` | 固定Google APIへの通信、Sheets読書き、非公開コピー |
| `repository.mjs` | 永続SQL、教室所有者、認証セッション、リース、未完了の書込み |
| `sqlite-repository.mjs` | ローカルNode用の永続ディスクアダプター |
| `study-service.mjs` | 登録先に限定した業務処理、所有者確認、再送とバックアップ |
| `build.mjs` | v9と既存ドメイン処理を元に画面・静的エンジンを生成 |
| `http-handler.mjs` / `fetch-adapter.mjs` | 共通HTTP境界とWorkers Fetchへの接続 |
| `worker.mjs` / `wrangler.jsonc` | Cloudflare無料枠向けのSQLite Durable Object構成 |
| `server.mjs` | 永続ディスク付きNodeサーバーでの実行 |
| `portal.html` / `privacy.html` | 先生の登録・URL・QR・データ取り扱い案内 |

業務エンジンはビルド時に通常のJavaScript関数として生成する。Workersで実行できない`node:vm`・動的eval・`node:sqlite`をWorkersの実行コードへ持ち込まない。SQLite Durable ObjectとNodeの実装は同じリポジトリー契約を使用する。

## 保存の安全性

同じ先生の保存をサーバー側リースで直列化し、教室IDから登録済みの保存先へだけ接続する。任意の保存先IDをHTTP入力から受け付けない。列構成・IDの不整合・他教室の記録混入は上書きせず停止する。JSON文字列はRAWで保存し、CSVは数式として解釈される文字列を無害化する。

各教室で毎日最初の変更前に非公開のDriveコピーを作る。バックアップ結果が不明な場合も識別タグで照合し、同じコピーを重複作成しない。アプリは古いバックアップを自動削除しないため、先生のDrive容量を確認する。

書込み前に対象セル・変更前の値・変更後の値を永続化する。応答が失われた場合は実際のSheetsを読んで照合する。未完了のリクエストが後から古い値を保存することを避けるため、未反映の操作はGoogleの180秒処理上限を超えるまで再実行しない。その後も外部変更があれば上書きしない。正常完了後は送信途中データを削除する。

スプレッドシートの直接編集・行並べ替え・テーブル名変更とアプリの保存を同時に行わない。編集は管理画面から行う。競合を検知した場合は元のシートと未完了状態を保持し、バックアップと照合して復旧する。

## 検証

Node 24とPython 3を使用。リポジトリーのルートから：

```sh
cd classroom-owned
npm ci
npm test
npm run test:browser
npm run check:worker
cd ..
node --test multi-classroom/tests/*.test.cjs
```

`test:browser`はローカルの架空Google保存先とだけ通信する。Googleへの通信は遮断し、390px/1440pxで操作する。利用環境にChromiumがある場合は`SR_CHROMIUM_PATH`で指定できる。日本語の画像確認にはシステムの日本語フォントが必要。

`check:worker`はデプロイせず、バンドル検証と実際のローカルworkerd／SQLiteによる起動・OAuth開始・CSRF・Cookie・静的ファイル確認を行う。Cloudflareアカウントを使用しない。単体・HTTP・ブラウザ検証のGoogle応答は架空であり、実Googleログインが済んだ証拠ではない。

## 公開前に必要な作業

具体的な設定・承認範囲は[DEPLOYMENT.md](DEPLOYMENT.md)。Google OAuth同意、無料枠の新規サービス・非公開保存領域、データの処理先を説明して承認を得てから検証環境を作る。先生2アカウントで実所有権・教室間分離・認証失効・再接続まで確認し、別途承認後に本番公開する。

先生のDriveにファイルを所有させる方式であり、先生が不在の間もこのサービスに継続接続を許可する構成。完全に別インフラの運用ではない。Cloudflare側には教室対応情報、ログイン状態、暗号化認証情報、通信途中の記録が保持される。国内だけに保存する構成ではない。

既存記録の移行は行っていない。移行する場合は、非公開バックアップと最新の元件数・項目を再確認し、教室と生徒IDの対応を先生が確認する。氏名だけで統合しない。前回確認した既存4記録・2生徒・454分は移行時に再照合する参照値であり、現在の件数を保証するものではない。旧シートの削除・初期化・上書きを行わず、移行先と内容を説明して承認後にコピーする。

## 公式仕様

- https://developers.google.com/identity/protocols/oauth2/web-server
- https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- https://developers.google.com/workspace/drive/api/guides/properties
- https://developers.google.com/workspace/sheets/api/limits
- https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/
- https://developers.cloudflare.com/durable-objects/platform/pricing/
- https://developers.cloudflare.com/workers/runtime-apis/nodejs/
