# playland

家族向けお出かけ発見アプリ（家族限定・非公開）。
現在は常設スポット（施設・公園など）だけを扱う。イベント（開催日のある企画）は次のフェーズで対応する
（DB の `event_occurrences` 等は残してあり、開催日の処理はコミット `4e4a18b` までの履歴にある）。
保存は家族で 1 つを共有する（プロフィールはない）。

構成: React + Vite（画面） / Hono on Cloudflare Workers（API） / D1（データ） / 非公開 R2（写真） / Leaflet + 地理院タイル（地図）。
候補の取り込みは、リポジトリ内のスキルと固定の登録コマンドで手動実行する（本番への書き込みは未対応）。

## ローカル開発

```bash
pnpm install
cp .dev.vars.example .dev.vars   # AUTH_MODE=dev-mock（localhost に限り認証を省略）、管理 PIN=1234
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
| `src/domain/` | 画面と API で共有する型・検索・参加条件・移動の判定、タグとカテゴリの定義（`tags.ts`）、入力検証 |
| `src/server/` | Worker（認証境界、API、D1 アクセス） |
| `src/web/` | 画面 |
| `migrations/` | D1 マイグレーション |
| `fixtures/` | 架空のテストデータのみ（実在の施設・人物を入れない） |
| `test/` | テスト |

## 候補の取り込み

LLM（コードエージェント）が候補を調べて登録用 JSON を作り、固定コードが検証・照合・登録する。手順の原本は
[skills/collect-outings/SKILL.md](skills/collect-outings/SKILL.md)。収集元は `config/sources.yaml`、タグは `src/domain/tags.ts`。

```bash
pnpm ingest export-known --target local              # 照合用の既存データ（家族の情報は含めない）
pnpm ingest validate .local/ingest/<batch>.json      # 形式・根拠・整合（DB を見ない）
pnpm ingest preview  .local/ingest/<batch>.json --target local
pnpm ingest apply    .local/ingest/<batch>.json --target local [--accept 1,3]
pnpm ingest geocode --target local [--apply]         # 住所から座標（国土地理院 住所検索・おおよその位置）
pnpm ingest photos-fetch .local/ingest/<photos>.json --target local   # 写真候補を取得し確認ページを作る
pnpm ingest photos-apply .local/ingest/<photos>.json --target local --accept 0,3
```

- 写真は家族内の私的な利用として、掲載ページ・画像 URL・クレジットを記録して非公開 R2 に保存する。親が確認ページで採用したものだけを保存する。
- 画像の取得は https のみ・内部アドレス拒否（名前解決後に確認）・リダイレクト先も再検査・5MB まで・実際の内容で形式を判定。
- 座標は、住所があり座標がなく親が指定していない場所だけを埋める。親が地図で直した位置は上書きしない。

- 取り込みは新しい候補を INSERT するだけで、既存の候補・場所・親の修正・お気に入り・家族設定を変更しない（テストで確認）。
- 同じ出典キー（`source_id` + `source_key`）は登録済みとしてスキップ。タイトルや場所名だけの一致は要確認にする。
- 候補ごとに 1 トランザクション。途中で失敗しても、同じコマンドの再実行で残りを完了できる。
- `--target staging / production` は、収集用の環境と本番の認証情報を分ける方式を決めるまで無効。
- Claude Code から使うには `.claude/skills/collect-outings/SKILL.md` に原本へのリンクを置く（下記）。

```bash
mkdir -p .claude/skills/collect-outings && ln -s ../../../skills/collect-outings/SKILL.md .claude/skills/collect-outings/SKILL.md
```

## 認証

- すべてのリクエスト（画面・API・写真）を Worker で認証してから返す（`assets.run_worker_first`）。
- 本番は `AUTH_MODE=access`。Cloudflare Access の JWT を `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` で検証し、設定が欠けていれば拒否する。
- 公開 URL は `workers.dev`。Worker 単位の Access で保護し（workers.dev・プレビュー URL を含む）、プレビュー URL は無効にしている。
- Worker でも、Access が渡す検証済みの情報（`ctx.access` の aud 一致）か、`Cf-Access-Jwt-Assertion` の JWT を検証する。
- 親の編集はアプリ内 PIN で開始する 30 分のセッション（HttpOnly・Secure・SameSite=Strict の署名付き Cookie、Access の利用者に紐付け）。
  PIN の失敗は利用者ごと 5 回・全体 20 回／15 分で一時的に拒否する。`PARENT_PIN` / `ADMIN_SESSION_SECRET` が未設定なら管理機能は使えない。

## データの扱い

- 不明は `unknown` / `null` で持ち、検索の厳密な条件では一致として扱わない（「わからない ものも みる」で理由付きで後ろに並べる）。
- 親の編集は版番号付き。古い版での保存は 409 で拒否し、何も書き換えない。
- 所要時間は出発地の版・手段・取得元（manual / api）ごとに保存し、親の値を優先する。出発地を変えると古い値は使わない。
- 絞り込みは「カテゴリ（1 つ選ぶ。含まれるタグのどれかに当てはまれば一致）」と「条件（保存済み・雨の日でも遊べる・年齢・移動）」の 2 段。
- 家族で「興味なし」にした候補は、「興味なしも表示」を選んだときだけ一覧・地図に出る。
- 地図は一覧と同じ検索条件・検索関数を使い（`GET /api/map-items`、ページ分割なし・最大 500 か所）、同じ場所の候補を 1 つのマーカーにまとめる。
  座標のない候補は地図から消さず「ちずに だせない ○けん」と表示する。背景地図の設定は `src/web/map/tiles.ts` だけで差し替えられる。
- 写真は実際のファイル内容で形式を判定し（JPEG・PNG・WebP、5MB まで）、`GET /media/:id` から認証後にだけ返す。

## 本番

手順は [docs/production.md](docs/production.md)。workers.dev を Worker 単位の Cloudflare Access で保護し、ローカルのデータを `pnpm ops copy-to-production --confirm` で移す。

```bash
pnpm deploy                                   # vite build && wrangler deploy
pnpm db:migrate:remote
pnpm ops status  --target production
pnpm ops backup  --target production          # .local/backups へ（家族の情報を含む。Git に置かない）
pnpm ops restore <DIR> --target local --state <別の保存場所>   # 復元の確認
```
