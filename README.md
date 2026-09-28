# playland

家族向けお出かけ発見アプリ（家族限定・非公開）。

構成: React + Vite（画面） / Hono on Cloudflare Workers（API） / D1（データ） / 非公開 R2（写真）。
地図（Phase 3）と取り込みスキル（Phase 4）は未実装。

## ローカル開発

```bash
pnpm install
cp .dev.vars.example .dev.vars   # AUTH_MODE=dev-mock（localhost に限り認証を省略）、親 PIN=1234
pnpm db:reset:local              # マイグレーション適用 + 架空データ投入
pnpm dev                         # http://localhost:5173
```

```bash
pnpm test        # Workers ランタイム上でのテスト（D1 を含む）
pnpm typecheck
pnpm build
```

## ディレクトリ

| パス | 内容 |
| --- | --- |
| `src/domain/` | 画面と API で共有する型・検索・日程・参加条件・移動の判定、タグ定義（`tags.ts`）、入力検証 |
| `src/server/` | Worker（認証境界、API、D1 アクセス） |
| `src/web/` | 画面 |
| `migrations/` | D1 マイグレーション |
| `fixtures/` | 架空のテストデータのみ（実在の施設・人物を入れない） |
| `test/` | テスト |

## 認証

- すべてのリクエスト（画面・API・写真）を Worker で認証してから返す（`assets.run_worker_first`）。
- 本番は `AUTH_MODE=access`。Cloudflare Access の JWT を `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` で検証し、設定が欠けていれば拒否する。
- `workers.dev` とプレビュー URL は無効化している（Access を迂回する経路を作らない）。
- プロフィールの選択は表示の切り替えで、権限ではない。
- 親の編集はアプリ内 PIN で開始する 30 分のセッション（HttpOnly・Secure・SameSite=Strict の署名付き Cookie、Access の利用者に紐付け）。
  PIN の失敗は利用者ごと 5 回・全体 20 回／15 分で一時的に拒否する。`PARENT_PIN` / `ADMIN_SESSION_SECRET` が未設定なら管理機能は使えない。

## データの扱い

- 不明は `unknown` / `null` で持ち、検索の厳密な条件では一致として扱わない（「わからない ものも みる」で理由付きで後ろに並べる）。
- 親の編集は版番号付き。古い版での保存は 409 で拒否し、何も書き換えない。
- 所要時間は出発地の版・手段・取得元（manual / api）ごとに保存し、親の値を優先する。出発地を変えると古い値は使わない。
- 写真は実際のファイル内容で形式を判定し（JPEG・PNG・WebP、5MB まで）、`GET /media/:id` から認証後にだけ返す。

## 本番へ出す前に必要なこと（未実施）

- Cloudflare 上で D1 を作成し、`wrangler.jsonc` の `database_id` を設定
- R2 バケット `playland-media` を作成（公開アクセス・r2.dev・カスタムドメインは有効にしない）
- `wrangler secret put PARENT_PIN` / `wrangler secret put ADMIN_SESSION_SECRET`
- Access アプリケーションを作成し、`ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` を設定
- カスタムドメインを Access で保護し、未認証のアクセスが拒否されることを確認
