# 教室ごとの独立運用：登録基盤（未公開）

2026-10-21の方針変更に対応する追加実装。GitHub Pagesの現行版・`preview/`・旧GAS・既存記録を変更していない。

目標の操作は「先生がGoogleでログイン → 教室名を入力 → 自分のDriveに専用保存先を作成 → 教室別URL/QRで生徒へ案内」。生徒のGoogleログインやアカウント登録は要求しない。教室名・教室数・先生のアカウントをコードに固定しない。

## 実装済み

- `registration.mjs`：サーバーで認証済みの先生だけが登録可能。入力から保存先IDや所有者IDを受け付けず、Googleアクセストークンの本人も照合する。操作IDを先生ごとに保存し、同時送信・再送を重複処理しない。保存先作成結果が不明なときは、アプリ専用の識別情報で既存ファイルを照合する。見つからない・複数ある場合には勝手に作り直さず停止する。
- `google-workspace.mjs`：先生本人のOAuth権限で非公開Sheetsを作成。共有権限の追加や全Driveアクセスは要求しない。既存の`SR10_*`テーブル形式を準備し、列構成が違う場合は初期化や削除をせず停止する。教室名等の書込みは`RAW`を使用する。
- `token-vault.mjs`：継続接続に使うrefresh tokenをAES-256-GCMで暗号化。別のGoogle subjectでは復号できない。暗号鍵はトークン保存先と別に保持する。
- `sqlite-repository.mjs`：永続ディスクのあるNodeサーバー用の参照実装。登録の途中状態・教室所有者・暗号化済み認証情報を保存。複数プロセスの同時登録をリースで制御し、サーバー再起動後も途中から照合できる。別アカウントからの参照・上書きを拒否する。
- `tests/`：登録再送、応答喪失、所有者不一致、復号の越境拒否、列構成不一致、同時登録、保存先の再読込等24件。

```sh
node --test classroom-owned/tests/*.test.mjs
# 既存の一元管理候補も回帰確認
node --test multi-classroom/tests/*.test.cjs
```

SQLiteにはNodeの`node:sqlite`を使用。今回の実行環境はNode 24。SQLiteの参照実装を一時ファイルしか保持しないホスティングへ配置してはいけない。

## まだ利用開始できない理由

これは登録基盤のコードであり、Googleログインから生徒の記録保存までが接続済みの完成版ではない。以下を実装・確認してから公開する。

1. 運営側のGoogle OAuthクライアント・同意画面・正規リダイレクトURI・公開状態を設定。先生ごとにGASやAPIキーを設定させない。
2. Google公式認証ライブラリを使うログインとコールバックを実装。stateの一回使用、ブラウザとの紐付け、PKCE、nonce、IDトークンの署名・audience・issuer・期限を検証。`requireGoogleSession`はHTTP入力のsubjectやメールアドレスを信用しない。
3. サーバー側の永続セッション・暗号鍵・リフレッシュ処理・認証失効時の再接続を接続。refresh token、アクセストークン、client secretはPagesやlocalStorageに配置しない。Googleログインが済んでもDriveの同意が足りなければファイルを作らない。
4. ホスティングと永続保存の実構成を決定。新しい外部サービスや有料枠は無断導入しない。Google認証やファイル作成の実試験前に、対象アカウント・権限と影響を説明する。
5. 生徒画面の教室URLから、サーバー側の登録済み教室ID→保存先対応へ接続。リクエストで送られた任意のスプレッドシートIDを開かない。匿名生徒の記録は従来どおり生徒IDと端末秘密キーで制限する。教室URL自体は管理権限を持たない。
6. 生徒・先生の既存機能、CSV、QR発行、スマホ、PWA、通信再送・エラー表示、バックアップと復旧を接続して検証する。
7. 先生2アカウントで所有権・教室間分離・Googleログイン失効後の挙動を実試験。既存4件の元記録は維持し、移行先・対応・件数を説明して承認後に移行する。

新しい方式には自動的な「全教室を閲覧できる管理者」を作らない。運営側のサービスは、生徒が先生の不在時にも利用できるよう、先生が許可した範囲でAPIへアクセスする。保存先は先生のDriveに所有されるが、サーバーへの継続アクセス許可は必要。完全な別インフラ運用とは異なる。この点を導入時に明示し、Google側から許可を取り消せる案内も用意する。

別の先生のスプレッドシートを共有する、既存の認証情報をコピーする、検証用保存先を本番へ流用する処理は含めない。

## Google公式仕様の確認先

- [WebサーバーのOAuthフロー](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Driveの最小スコープ drive.file](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Sheets作成と対応スコープ](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/create)
- [アプリ専用のファイル識別情報](https://developers.google.com/workspace/drive/api/guides/properties)
- [認証トークンの期限とテスト公開の制限](https://developers.google.com/identity/protocols/oauth2)

既存GASを「アクセスしているユーザーとして実行」へ変更するだけでは、匿名生徒のアクセスと先生所有の保存先を両立する実装は完成しない。OAuthと保存先ルーティングを別途実装し、現行の公開設定は変更しない。
