# 本番環境の手順

構成：Workers（`playland.<アカウントのサブドメイン>.workers.dev`）＋ D1 ＋ 非公開 R2 ＋ Worker 単位の Cloudflare Access。
検証用の環境は作らず、確認はローカルで行う。

## 前提

- 家族のログインは、夫婦 2 人のメールアドレスを Access のポリシーで許可するだけ（アカウントごとの挙動はない）。
- 管理（編集）はアプリ内の PIN で入る。
- Worker は Access の検証を自分でも行い（`ctx.access` の aud 一致、なければ `Cf-Access-Jwt-Assertion` の JWT を検証）、
  `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` が空なら全リクエストを 503 で拒否する。Access の設定前にデプロイしても公開状態にはならない。
- Cloudflare への操作はすべて、自分の Cloudflare ログイン（wrangler と cf）で行う。

## 0. 準備（一度だけ）

```bash
npx wrangler login
npm install --global cf     # Cloudflare CLI（ベータ）。Access の設定に使う
cf auth login               # cf は wrangler のログインを共有しない
```

Workers の `workers.dev` サブドメインが未登録なら、ダッシュボードの Workers & Pages で登録する。

## 1. D1 と R2 を作る

```bash
npx wrangler d1 create playland
```

表示された `database_id` を `wrangler.jsonc` の `d1_databases[0].database_id` に設定してコミットする。

```bash
npx wrangler r2 bucket create playland-media
npx wrangler r2 bucket dev-url get playland-media      # 「無効」であることを確認（公開 URL を作らない）
pnpm db:migrate:remote
```

## 2. シークレット

```bash
openssl rand -base64 48 | npx wrangler secret put ADMIN_SESSION_SECRET
npx wrangler secret put PARENT_PIN                     # 4〜12 桁の数字を入力
```

## 3. 最初のデプロイ（この時点ではすべて 503 で拒否される）

```bash
pnpm deploy
curl -s -o /dev/null -w "%{http_code}\n" https://playland.<サブドメイン>.workers.dev/api/settings   # 503
```

## 4. Access を Worker に設定する（cf）

cf はベータのため、コマンド名が変わっていたら `cf cli search "<やりたいこと>"` で確認する。

1. Worker の ID と、チームのドメイン（`<チーム名>.cloudflareaccess.com`）を確認する。

   ```bash
   cf workers list
   cf cli search "get zero trust organization auth domain"
   ```

2. Access アプリを作る。まず `--dry-run` で内容を確認してから実行する。

   ```bash
   cf zero-trust access applications create --dry-run --body '{
     "name": "playland",
     "type": "self_hosted",
     "destinations": [{ "type": "worker", "worker_id": "<Worker の ID>" }],
     "session_duration": "720h",
     "policies": [{
       "name": "family",
       "decision": "allow",
       "include": [
         { "email": { "email": "<自分のメールアドレス>" } },
         { "email": { "email": "<家族のメールアドレス>" } }
       ]
     }]
   }'
   ```

   `destinations` の `worker` 型で、workers.dev・プレビュー URL を含む Worker のすべてのアドレスが保護される。
   ログイン方法は、既定のワンタイムコード（メールで届くコード）を使う。
   cf で作れない場合は、ダッシュボードの Workers & Pages → playland → Access タブ →「Protect this Worker behind Access」で同じ設定をする。

3. 作成結果の `aud`（Application Audience Tag）と、チームのドメインを `wrangler.jsonc` の `vars` に設定してコミットし、再デプロイする。

   ```jsonc
   "ACCESS_TEAM_DOMAIN": "<チーム名>.cloudflareaccess.com",
   "ACCESS_AUD": "<aud>"
   ```

   ```bash
   pnpm deploy
   ```

## 5. 公開後の確認

```bash
U=https://playland.<サブドメイン>.workers.dev
for p in / /search /api/items /api/settings /media/x; do curl -s -o /dev/null -w "$p %{http_code}\n" $U$p; done
```

- すべて 302（Access のログインへ転送）か 401/403 になり、200 が返らないこと。
- ブラウザで、許可した 2 人のメールアドレスではログインでき、それ以外では拒否されること。
- 「管理」から PIN で入れること。
- `npx wrangler r2 bucket dev-url get playland-media` が無効のままであること。

## 6. ローカルのデータを移す（一度だけ）

```bash
pnpm ops status --target production        # 本番が空であることを確認
pnpm ops copy-to-production --confirm      # 写真 → データの順に複製。本番が空でなければ中止する
pnpm ops status --target production        # ローカルと件数が一致することを確認
```

移したあと、本番の管理画面で次を設定する：出発地（自宅の位置・地図で指定）、自転車の上限時間、PLAY! PARK のピン（町の代表点のため）。

## 7. バックアップと復元

```bash
pnpm ops backup --target production                    # .local/backups/production-<日時>/ に書き出す
```

- 取り込みや大きな編集の後に実行する。自宅の座標など家族の情報を含むので、Git や共有フォルダに置かない。
- D1 の Time Travel（`npx wrangler d1 time-travel info playland`）でも、一定期間内の時点に戻せる（保持期間はプランによる）。
- 復元の確認は、ローカルの別の保存場所で行う（実データを消さない）：

  ```bash
  npx wrangler d1 migrations apply playland --local --persist-to /tmp/restore-check
  pnpm ops restore .local/backups/production-<日時> --target local --state /tmp/restore-check
  ```

- 本番が壊れた場合は、空の D1 にマイグレーションを適用してから `pnpm ops restore <DIR> --target production --confirm`。

## 8. 今後の取り込み

LLM と対話しながら候補を調べて登録用 JSON を作り、コマンドで本番へ登録する（手順の原本は `skills/collect-outings/SKILL.md`）。

```bash
pnpm ingest export-known --target production
pnpm ingest preview  .local/ingest/<batch>.json --target production
pnpm ingest apply    .local/ingest/<batch>.json --target production --confirm [--accept 1,3]
pnpm ingest geocode  --target production --apply --confirm
pnpm ingest photos-fetch .local/ingest/<photos>.json --target production
pnpm ingest photos-apply .local/ingest/<photos>.json --target production --confirm --accept 0,3
pnpm ops backup --target production
```

- 本番への書き込み（apply・geocode --apply・photos-apply・copy-to-production・restore）は `--confirm` がないと実行されない。
  エージェントは preview の結果を親に見せ、承認を得てから `--confirm` を付ける。
- 本番への接続は wrangler のリモートバインディング（`wrangler login` の認証）を使う。一時設定 `.wrangler-remote.tmp.json` は終了時に削除される。
