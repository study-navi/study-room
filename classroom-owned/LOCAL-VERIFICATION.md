# 検証結果：2026-10-21

対象は`classroom-owned/`の公開候補。実際のGoogleアカウント／Cloudflareリソースは使用していない。本番反映、GAS設定変更、既存スプレッドシートへの書込み、実データ移行は行っていない。

| 確認 | 結果 |
| --- | --- |
| 新方式の単体・HTTP検証 | 36件すべて合格 |
| 既存一元管理版の回帰検証 | 19件すべて合格 |
| スマホ390px／PC1440pxの実ブラウザ統合検証 | 合格、実HTTP API通信46回、ブラウザ例外0件 |
| Cloudflareバンドルのdry-run | 合格、外部デプロイなし、約636 KiB／gzip約137 KiB |
| 実ローカルworkerdとSQLite | 合格、OAuth開始、PKCE、Secure Cookie、CSRF、未ログイン拒否、静的画面／案内の配信 |
| 公開中のindex.html、PWA、preview、既存GAS | ベースコミット5904889と差分なし |

ブラウザ検証はローカルHTTPサーバー→共通HTTP境界→実際のドメイン処理→架空Google保存先を通した。Google APIをブラウザ側で置き換える方式ではなく、保存・権限検証も実装したサーバー側を実行した。

確認済み操作は、自習開始、入室、休憩、退室、振り返り入力、送信前リロード復元、送信、本人の履歴、別教室URLでのプロフィール分離、先生の自教室一覧、教室設定・在籍数変更、利用率、記録編集、CSVファイルの内容、教室モードでの追加入退室、QR画像、スマホ横はみ出しなし、PWAのprivate cacheが空であること、別教室を指定した管理アクセスの拒否、画面からのログアウトでサーバーセッションが失効すること。

単体・HTTP検証では、同姓同名の別ID、偽造セッション・教室ID、署名検証の失敗・nonce・scope・別ブラウザstate、暗号化情報の改ざん・別所有者の復号拒否、所有者・列構成不一致、再送・応答喪失・不確定な保存待機・外部変更への上書き拒否、バックアップ応答喪失からの照合も確認した。

ブラウザのスクリーンショットは`npm run test:browser`実行時に`release/proofs/`へ出力する。架空生徒・架空Google応答のみ。Node 24.19.0、ローカルChromium 131、Noto Sans CJK JPで画面を確認した。

実Googleの同意画面・所有者別の専用Sheets作成・認証失効と復旧・実スマホでのQR/PWA・バックアップからの実復元は未確認。詳細な受入項目と影響・承認範囲はDEPLOYMENT.mdを参照する。ローカルで通ったことを、一般公開済み・他教室で運用可能・実Googleで確認済みとは扱わない。

# 検証環境の作成状況：2026-10-22

検証用のCloudflare Workerと、Google Cloudの専用プロジェクトを作成した。いずれも検証用の作成のみで、この時点では認証用設定を投入しておらず、動作確認は行っていない。本番切替・実データ移行・既存GitHub Pages／GAS／元スプレッドシートの変更は行っていない。

- Cloudflare：Worker `study-room-classroom-owned-staging` をWorkers Buildsで作成。ルートは`classroom-owned`、実行ブランチは`feature/classroom-owned-registration`、プレビュービルドは無効。`SR_ORIGIN`・`GOOGLE_CLIENT_ID`・`GOOGLE_CLIENT_SECRET`・`SR_KEY`・`SR_CONTACT_EMAIL`は未設定のため、設定完了まで503で停止する想定。
- - Google Cloud：専用プロジェクトを作成し、Google Drive API・Google Sheets APIを有効化。OAuth同意画面・OAuthクライアントは未設定。請求先は追加していない。
  - - 未確認のまま：実Googleアカウントでの認証、先生所有の専用Sheets作成、2アカウント間の分離、接続失効・再接続、実スマホのQR／PWA、バックアップからの実復元。
    - 
