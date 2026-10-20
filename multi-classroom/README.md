# Study Room 複数教室版（検証用候補）

現行公開版を変更せず追加した実装です。現状調査、仕様、制限は [AUDIT.md](AUDIT.md) を参照してください。本番移行・デプロイはまだ実行していません。

## ローカル検証

リポジトリルートから：

```sh
npm ci --prefix multi-classroom
python3 multi-classroom/tools/build.py
node --test multi-classroom/tests/backend.test.cjs
npm exec --prefix multi-classroom -- playwright install chromium
node multi-classroom/tests/browser.cjs
```

実行環境に別のChromiumがある場合は `SR_CHROMIUM_PATH` で指定できます。ブラウザ試験は実バックエンドに接続せず、ローカルのGAS代替実装へRPCを渡します。外部リクエストは遮断します。スクリーンショット出力先は `SR_TEST_OUTPUT`（既定はOSの一時ディレクトリ）です。

`App.html` は生成物です。画面連携は `Client.js`、v9からの変換は `tools/build.py`、共通ロジックは `Core.gs` を編集して再生成します。GASへ渡すファイルは `Code.gs`, `Core.gs`, `Password.gs`, `Migration.gs`, `App.html`, `appsscript.json` です。旧GASとは同じプロジェクトに入れないでください。

## 承認後のステージング準備

1. 現在デプロイ済みのApps Scriptソースと保存先を照合する。GitHub内の複数のGAS版から推測して置き換えない。
2. テスト用の非公開スプレッドシートと、別のApps Scriptプロジェクトを用意する。既存デプロイと既存保存先には変更を加えない。
3. 上記6ファイルを新プロジェクトへ配置する。スクリプトプロパティに `SR_DATABASE_ID`（テスト用）、`SR_INITIAL_ADMIN_ID`、`SR_INITIAL_PASSWORD`（12文字以上）を設定する。
4. エディタから private 関数 `srSetup_` を手動実行する。初期教室は大府柊山校、在籍生徒数は未設定。パスワードのプロパティは成功時に削除される。
5. Webアプリとして所有者権限で実行し、生徒がGoogleログイン不要で開けるアクセス設定を組織ポリシーと照合する。ポリシーが匿名アクセスを認めない場合は、この構成では運用できない。検証用URLとしてデプロイし、そのURLからAppを開く。
6. 2教室以上・2権限・架空の生徒で全フローを実GASとSafari/Chromeで検証する。特にパスワード処理の実行時間、同時接続、スプレッドシート権限、コード引継ぎ、CSVと日付を確認する。
7. PWAの経路を決定し、既存ホーム画面からの利用、アイコン、スコープ、更新、個人情報をキャッシュしないことを確認する。現時点でこの条件は未完了。

新しいGASを配信しても、旧JSONPエンドポイントの権限問題は自動的には解消しません。実ソース確認後、現行版への影響と切替方法を説明して承認を得たうえで、旧エンドポイントの停止・公開範囲変更を計画してください。

## 承認後の移行

移行元の全記録が大府柊山校のものであること、同姓同名や学年変更の対応を確認します。実際の確認時点では4件ですが、移行直前の読み直しが必要です。

1. `SR_LEGACY_DATABASE_ID` を設定し、`srMigrationPlan_` で列構成・件数・教室値・fingerprintを確認する。計画結果には個人情報が含まれるのでGitHubや公開ログに載せない。
2. バックアップ作成の承認後、`SR_BACKUP_APPROVAL=approved` を設定して `srBackupLegacy_` を手動実行する。ブック全体のコピーを作り、記録のfingerprint一致を確認したIDを保存する。コピーは非公開のままにする。
3. 移行先へ確認済みの生徒を登録し、**記録IDごとの**生徒ID対応表を用意する。名前だけで自動結合しない。
4. 内容を承認したうえで `SR_MIGRATION_APPROVAL` に次のJSONを設定する。

```json
{
  "fingerprint": "計画で確認したハッシュ",
  "schoolId": "確認した移行先の教室ID",
  "confirmedSingleSchool": true,
  "studentIdsByRecord": {"記録ID": "確認済みの生徒ID"}
}
```

5. `srMigrateLegacy_` を手動実行する。元データは変更せず、新保存先のRecordsに追記する。再実行は同一のlegacy値なら重複追加せず、異なる値なら停止する。元の15列は `legacy.values` にそのまま保持する。
6. 件数・氏名・学年・日時・分数・内容・振り返り・状態・ID対応、ランキングとCSVを照合する。空欄の状態は退室時間と分数がある場合だけ送信済みとして扱い、元の空欄も保持する。
7. 移行から公開切替まで旧版に追加された差分を再確認し、最終コピーと件数照合を行う。切替時の旧版への書込停止を事前に説明して承認を得る。

検証済みバックアップとfingerprintがなければ移行処理は停止します。移行が途中で失敗しても元のブックは書き換えません。途中の新保存先は再実行で残りを追加し、照合が完了するまで公開しないでください。

新保存先のバックアップ用 `srBackupCurrent_` もあります。自動トリガーの追加・保存期間・復旧テストは、利用規模と保存領域を確認して承認後に設定してください。元ブックを削除する操作は実装していません。
