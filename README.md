# playland

家族向けお出かけ発見アプリ（家族限定・非公開）。

構成: React + Vite（画面） / Hono on Cloudflare Workers（API） / D1（データ）。
写真（R2）・地図・取り込みスキルは後続フェーズで追加する。

## ローカル開発

```bash
pnpm install
cp .dev.vars.example .dev.vars   # AUTH_MODE=dev-mock（localhost からのアクセスに限り認証を省略）
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
| `src/domain/` | 画面と API で共有する型・検索条件・表記 |
| `src/server/` | Worker（認証境界、API、D1 アクセス） |
| `src/web/` | 画面 |
| `migrations/` | D1 マイグレーション |
| `fixtures/` | 架空のテストデータのみ（実在の施設・人物を入れない） |
| `test/` | テスト |

## 認証

- すべてのリクエスト（画面・API・写真）を Worker で認証してから返す（`assets.run_worker_first`）。
- 本番は `AUTH_MODE=access`。Cloudflare Access の JWT を `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` で検証し、設定が欠けていれば拒否する。
- `workers.dev` とプレビュー URL は無効化している（Access を迂回する経路を作らない）。
- プロフィールの選択は表示の切り替えで、権限ではない。親の編集権限はアプリ内 PIN で判定する予定（Phase 2）。

## 本番へ出す前に必要なこと（未実施）

- Cloudflare 上で D1 を作成し、`wrangler.jsonc` の `database_id` を設定
- Access アプリケーションを作成し、`ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` を設定
- カスタムドメインを Access で保護し、未認証のアクセスが拒否されることを確認
