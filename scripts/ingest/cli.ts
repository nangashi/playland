/**
 * 取り込みコマンド。LLM が作った登録用 JSON を、固定コードで検証・照合・登録する。
 *
 *   pnpm ingest tags                                  タグと入口の一覧
 *   pnpm ingest sources                               config/sources.yaml の検証
 *   pnpm ingest export-known --target local           照合用の既存データを書き出す
 *   pnpm ingest validate <bundle.json>                形式・根拠・整合の検証（DB を見ない）
 *   pnpm ingest preview  <bundle.json> --target local 新規・既存・要確認・エラーの一覧
 *   pnpm ingest apply    <bundle.json> --target local [--accept 1,3]
 *
 * 本番（production）・検証環境（staging）への書き込みは、収集用エージェントの実行環境と
 * 本番の認証情報を分ける方式を決めるまで無効にしている。
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { ENTRANCES, TAGS } from "../../src/domain/tags";
import { applyBundle, previewBundle } from "../../src/ingest/apply";
import { validateBundle, type BundleValidation } from "../../src/ingest/bundle";
import { loadKnown } from "../../src/ingest/known";
import { loadSources } from "./sources";

const MAX_BUNDLE_BYTES = 5 * 1024 * 1024;
const DEFAULT_KNOWN_PATH = ".local/ingest/known.json";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    target: { type: "string" },
    accept: { type: "string" },
    out: { type: "string" },
    json: { type: "boolean", default: false },
  },
});
const [command, file] = positionals;

async function main(): Promise<number> {
  switch (command) {
    case "tags":
      return printTags();
    case "sources":
      return checkSources();
    case "validate":
      return validate(requireFile());
    case "export-known":
      return withDb((db) => exportKnown(db));
    case "preview":
      return withDb((db) => preview(db, requireFile()));
    case "apply":
      return withDb((db) => apply(db, requireFile()));
    default:
      console.error("使い方: pnpm ingest <tags|sources|export-known|validate|preview|apply> [bundle.json] --target local");
      return 2;
  }
}

function requireFile(): string {
  if (!file) throw new UsageError("登録用 JSON のパスを指定してください");
  return file;
}

class UsageError extends Error {}

async function readBundle(path: string): Promise<{ raw: unknown; hash: string }> {
  const info = await stat(path);
  if (info.size > MAX_BUNDLE_BYTES) throw new UsageError(`ファイルが大きすぎます（${info.size} bytes）`);
  const text = await readFile(path, "utf8");
  const hash = createHash("sha256").update(text).digest("hex");
  try {
    return { raw: JSON.parse(text), hash };
  } catch {
    throw new UsageError("JSON として読めません");
  }
}

async function checkSourceIds(validation: BundleValidation): Promise<string[]> {
  if (!validation.bundle) return [];
  const sources = await loadSources();
  const ids = new Set(sources.map((s) => s.id));
  return validation.bundle.candidates.flatMap((c, i) =>
    ids.has(c.source.source_id) ? [] : [`#${i} 収集元 ${c.source.source_id} が config/sources.yaml にありません`],
  );
}

function printValidation(v: BundleValidation, sourceErrors: string[]) {
  if (v.bundle === null) {
    console.log("✗ 形式エラー");
    for (const e of v.formatErrors) console.log(`  - ${e}`);
    return;
  }
  for (const issue of v.issues) {
    const mark = issue.errors.length > 0 ? "✗" : "✓";
    console.log(`${mark} #${issue.index} ${issue.title}`);
    for (const e of issue.errors) console.log(`    エラー: ${e}`);
    for (const w of issue.warnings) console.log(`    確認: ${w}`);
  }
  for (const e of sourceErrors) console.log(`✗ ${e}`);
}

async function validate(path: string): Promise<number> {
  const { raw } = await readBundle(path);
  const v = validateBundle(raw);
  const sourceErrors = await checkSourceIds(v);
  if (values.json) console.log(JSON.stringify({ ...v, sourceErrors }, null, 2));
  else printValidation(v, sourceErrors);
  return v.ok && sourceErrors.length === 0 ? 0 : 1;
}

async function preview(db: D1Database, path: string): Promise<number> {
  const { raw } = await readBundle(path);
  const v = validateBundle(raw);
  const sourceErrors = await checkSourceIds(v);
  if (!v.ok || sourceErrors.length > 0) {
    printValidation(v, sourceErrors);
    console.log("\n検証エラーがあるため照合していません。");
    return 1;
  }
  const result = await previewBundle(db, v.bundle);
  if (values.json) {
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }
  const label = { new: "新規", existing: "既存（変更しない）", review: "要確認", error: "エラー" };
  for (const m of result.matches) {
    console.log(`[${label[m.status]}] #${m.index} ${m.title}`);
    for (const r of m.reasons) console.log(`    ${r}`);
    // 要確認の事項は照合結果の理由に含まれるので、ここでは重ねて出さない
    for (const w of v.issues[m.index]?.warnings ?? []) {
      if (!w.startsWith("要確認: ")) console.log(`    確認: ${w}`);
    }
  }
  console.log(
    `\n新規 ${result.counts.new} / 既存 ${result.counts.existing} / 要確認 ${result.counts.review} / エラー ${result.counts.error}`,
  );
  console.log("要確認の候補を登録する場合は、確認したうえで apply に --accept 番号 を付けてください。");
  return 0;
}

async function apply(db: D1Database, path: string): Promise<number> {
  const { raw, hash } = await readBundle(path);
  const v = validateBundle(raw);
  const sourceErrors = await checkSourceIds(v);
  if (!v.ok || sourceErrors.length > 0) {
    printValidation(v, sourceErrors);
    return 1;
  }
  const accept = new Set(
    (values.accept ?? "")
      .split(",")
      .filter((s) => s.trim() !== "")
      .map((s) => Number.parseInt(s, 10)),
  );
  const result = await applyBundle(db, raw, { target: values.target!, inputHash: hash, accept });
  if (values.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const label = { inserted: "登録", skipped_existing: "既存のため変更なし", skipped_review: "要確認のため未登録", error: "失敗" };
    for (const o of result.outcomes) {
      console.log(`[${label[o.result]}] #${o.index} ${o.title}${o.item_id ? ` (${o.item_id})` : ""}`);
      if (o.reason) console.log(`    ${o.reason}`);
    }
    console.log(`\n結果: ${result.status}（実行 ID ${result.run_id}）`);
    if (result.status !== "completed") console.log("失敗した候補は、原因を直して同じコマンドを再実行すると登録されます（登録済みの候補はスキップ）。");
  }
  return result.status === "failed" ? 1 : 0;
}

async function exportKnown(db: D1Database): Promise<number> {
  const known = await loadKnown(db);
  const out = values.out ?? DEFAULT_KNOWN_PATH;
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify({ exported_at: new Date().toISOString(), ...known }, null, 2));
  console.log(`${out} に書き出しました（場所 ${known.places.length} / 候補 ${known.items.length} / 出典 ${known.sources.length}）`);
  return 0;
}

function printTags(): number {
  if (values.json) {
    console.log(JSON.stringify({ tags: TAGS, entrances: ENTRANCES }, null, 2));
    return 0;
  }
  for (const category of ["facility", "experience"] as const) {
    console.log(category === "facility" ? "## 施設分類" : "## 体験");
    for (const t of TAGS.filter((t) => t.category === category)) console.log(`  ${t.id}\t${t.label}`);
  }
  return 0;
}

async function checkSources(): Promise<number> {
  const sources = await loadSources();
  console.log(`config/sources.yaml: ${sources.length} 件の収集元`);
  for (const s of sources) console.log(`  ${s.id}\t${s.name}\t画像: ${s.images}`);
  return 0;
}

async function withDb(run: (db: D1Database) => Promise<number>): Promise<number> {
  const target = values.target;
  if (target !== "local") {
    throw new UsageError(
      target === "staging" || target === "production"
        ? `--target ${target} はまだ有効にしていません。収集用の環境と本番の認証情報を分ける接続方式を決めてから追加します。`
        : "--target local を指定してください",
    );
  }
  const { getPlatformProxy } = await import("wrangler");
  // wrangler dev / wrangler d1 --local と同じローカルの D1 を使う
  const proxy = await getPlatformProxy<{ DB: D1Database }>({ configPath: "wrangler.jsonc", persist: true });
  try {
    return await run(proxy.env.DB);
  } finally {
    await proxy.dispose();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err instanceof UsageError ? err.message : err);
    process.exit(err instanceof UsageError ? 2 : 1);
  });
