/**
 * 取り込みコマンド。LLM が作った登録用 JSON を、固定コードで検証・照合・登録する。
 *
 *   pnpm ingest tags                                  タグと入口の一覧
 *   pnpm ingest sources                               config/sources.yaml の検証
 *   pnpm ingest export-known --target local           照合用の既存データを書き出す
 *   pnpm ingest validate <bundle.json>                形式・根拠・整合の検証（DB を見ない）
 *   pnpm ingest run      <bundle.json> --target local [--photos <photos.json>]
 *                                                     検証→下書きで登録→座標→距離→写真を採用待ちで保存（通常はこれだけ）
 *   pnpm ingest preview  <bundle.json> --target local 新規・既存・要確認・エラーの一覧
 *   pnpm ingest apply    <bundle.json> --target local [--accept 1,3|all]  下書きで登録
 *   pnpm ingest geocode  --target local [--apply]      住所から座標を取得（国土地理院 住所検索）
 *   pnpm ingest distances --target local               すべての場所の自宅からの距離を計算し直す
 *   pnpm ingest photos-fetch <photos.json> --target local           写真の候補を取得し、採用待ちで保存
 *   pnpm ingest enrich-export  --target local [--all]  空欄の残る候補を書き出す（既定は管理画面で追加した候補）
 *   pnpm ingest enrich-validate <enrich.json>          補足用 JSON の検証（DB を見ない）
 *   pnpm ingest enrich-preview  <enrich.json> --target local   埋める項目・変えない項目の一覧
 *   pnpm ingest enrich-apply    <enrich.json> --target local --accept 0,2|all  空欄だけを埋める
 *   pnpm ingest retag-export   --target local           既存の候補の今のタグ・カテゴリ・出典キーを書き出す
 *   pnpm ingest retag-validate <retag.json>             付け直し用 JSON の検証（DB を見ない）
 *   pnpm ingest retag-preview  <retag.json> --target local   今のタグ → 変更後のタグ・カテゴリの一覧
 *   pnpm ingest retag-apply    <retag.json> --target local [--accept 0,2|all]  タグだけを付け直す
 *                                                     （本番は --confirm と --accept が必須。結果と戻し用 JSON を書き出す）
 *
 * --target production は、環境変数 CLOUDFLARE_API_TOKEN があれば HTTP API で、なければ wrangler login の認証
 * （リモートバインディング）で本番の D1・R2 に接続する。
 * 本番への書き込み（run / apply / geocode --apply / distances / photos-fetch / enrich-apply / retag-apply）には --confirm が必要。
 * 終了コードは README.md の「候補の取り込み」を参照。
 *
 * 取り込んだ候補は下書き、写真は採用待ちで保存され、家族の画面には出ない。
 * 親は管理画面の「承認待ち」（/admin/inbox）で内容と写真を確認し、公開・見送りを決める。
 */
import { createHash } from "node:crypto";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { CATEGORIES, getTag, TAGS } from "../../src/domain/tags";
import { applyBundle, previewBundle } from "../../src/ingest/apply";
import { validateBundle, type BundleValidation } from "../../src/ingest/bundle";
import {
  applyEnrich,
  loadIncomplete,
  previewEnrich,
  validateEnrichBundle,
  type EnrichValidation,
} from "../../src/ingest/enrich";
import { geocodePlaces, gsiGeocoder } from "../../src/ingest/geocode";
import { loadKnown } from "../../src/ingest/known";
import {
  applyRetag,
  buildUndo,
  loadRetagCandidates,
  previewRetag,
  validateRetagBundle,
  type RetagApplyResult,
  type RetagPlan,
  type RetagValidation,
} from "../../src/ingest/retag";
import { getOrigin, refreshHomeDistances } from "../../src/server/repo";
import { openTarget, parseTarget, requireConfirm, UsageError, type TargetEnv } from "../lib/target";
import { fetchAndStagePhotos, readPhotoList } from "./photos";
import { loadSources } from "./sources";

const MAX_BUNDLE_BYTES = 5 * 1024 * 1024;
const DEFAULT_KNOWN_PATH = ".local/ingest/known.json";
const DEFAULT_INCOMPLETE_PATH = ".local/ingest/incomplete.json";
const DEFAULT_RETAG_EXPORT_PATH = ".local/ingest/retag-candidates.json";
const INGEST_DIR = ".local/ingest";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    target: { type: "string" },
    accept: { type: "string" },
    out: { type: "string" },
    json: { type: "boolean", default: false },
    apply: { type: "boolean", default: false },
    confirm: { type: "boolean", default: false },
    all: { type: "boolean", default: false },
    photos: { type: "string" },
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
    case "run":
      return withDb((db, env) => runAll(db, env.MEDIA, requireFile()), "候補の登録（下書き）");
    case "apply":
      return withDb((db) => apply(db, requireFile()), "候補の登録");
    case "geocode":
      return withDb((db) => geocode(db), values.apply ? "座標の保存" : undefined);
    case "distances":
      return withDb((db) => distances(db), "自宅からの距離の保存");
    case "photos-fetch":
      return withDb((db, env) => photosFetch(db, env.MEDIA, requireFile()), "写真の保存（採用待ち）");
    case "enrich-export":
      return withDb((db) => enrichExport(db));
    case "enrich-validate":
      return enrichValidate(requireFile());
    case "enrich-preview":
      return withDb((db) => enrichPreview(db, requireFile()));
    case "enrich-apply":
      return withDb((db) => enrichApply(db, requireFile()), "候補の補足");
    case "retag-export":
      return withDb((db) => retagExport(db));
    case "retag-validate":
      return retagValidate(requireFile());
    case "retag-preview":
      return withDb((db) => retagPreview(db, requireFile()));
    case "retag-apply": {
      const path = requireFile();
      requireAccept(parseTarget(values.target));
      return withDb((db) => retagApply(db, path), "タグの付け直し");
    }
    default:
      console.error(
        "使い方: pnpm ingest <tags|sources|export-known|validate|run|preview|apply|geocode|distances|photos-fetch|enrich-export|enrich-validate|enrich-preview|enrich-apply|retag-export|retag-validate|retag-preview|retag-apply> [file] --target local",
      );
      return 2;
  }
}

function requireFile(): string {
  if (!file) throw new UsageError("登録用 JSON のパスを指定してください");
  return file;
}


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
  console.log("run（または apply --accept all）では要確認も含めて下書きで登録し、親が承認待ちの画面で確認します。");
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
  const accept = values.accept?.trim() === "all" ? "all" : parseAccept();
  const result = await applyBundle(db, raw, { target: parseTarget(values.target), inputHash: hash, accept });
  if (values.json) console.log(JSON.stringify(result, null, 2));
  else printApplyResult(result);
  return result.status === "failed" ? 1 : 0;
}

function printApplyResult(result: Awaited<ReturnType<typeof applyBundle>>) {
  const label = { inserted: "下書きで登録", skipped_existing: "既存のため変更なし", skipped_review: "要確認のため未登録", error: "失敗" };
  for (const o of result.outcomes) {
    console.log(`[${label[o.result]}] #${o.index} ${o.title}${o.item_id ? ` (${o.item_id})` : ""}`);
    if (o.reason) console.log(`    ${o.reason}`);
  }
  console.log(`\n結果: ${result.status}（実行 ID ${result.run_id}）`);
  if (result.status !== "completed") console.log("失敗した候補は、原因を直して同じコマンドを再実行すると登録されます（登録済みの候補はスキップ）。");
}

/**
 * 取り込みの一連の処理をまとめて行う。候補はすべて下書き・写真は採用待ちで保存するので、家族の画面には出ない。
 * 途中で失敗しても、同じコマンドの再実行で続きから完了できる（登録済みの候補・保存済みの写真はスキップ）。
 */
async function runAll(db: D1Database, bucket: R2Bucket, path: string): Promise<number> {
  const { raw, hash } = await readBundle(path);
  const v = validateBundle(raw);
  const sourceErrors = await checkSourceIds(v);
  if (!v.ok || sourceErrors.length > 0) {
    printValidation(v, sourceErrors);
    return 1;
  }
  const photoList = values.photos ? await readPhotoList(values.photos) : null;

  console.log("## 候補の登録（下書き）");
  const result = await applyBundle(db, raw, { target: parseTarget(values.target), inputHash: hash, accept: "all" });
  printApplyResult(result);

  console.log("\n## 座標（住所検索）");
  const geo = await geocodePlaces(db, gsiGeocoder(), { apply: true, delayMs: 1000 });
  for (const o of geo) {
    console.log(o.status === "found" ? `[保存] ${o.name}（一致: ${o.matched}）` : `[${o.status === "error" ? "失敗" : "見つからない"}] ${o.name}  検索語: ${o.query}`);
  }
  if (geo.length === 0) console.log("対象なし");

  console.log("\n## 自宅からの距離");
  console.log((await getOrigin(db)) ? `${await refreshHomeDistances(db)} か所を更新` : "自宅の座標が未設定のため省略");

  let photoErrors = 0;
  if (photoList) {
    console.log("\n## 写真（採用待ち）");
    const outcomes = await fetchAndStagePhotos(db, bucket, photoList);
    photoErrors = outcomes.filter((o) => o.result === "error").length;
  }
  console.log("\n親の確認: 管理画面の「承認待ち」 /admin/inbox");
  return result.status === "failed" ? 1 : result.status === "partial" || photoErrors > 0 ? 3 : 0;
}

function parseAccept(): Set<number> {
  return new Set(
    (values.accept ?? "")
      .split(",")
      .filter((s) => s.trim() !== "")
      .map((s) => Number.parseInt(s, 10))
      .filter((n) => Number.isInteger(n)),
  );
}

async function geocode(db: D1Database): Promise<number> {
  const outcomes = await geocodePlaces(db, gsiGeocoder(), { apply: values.apply, delayMs: 1000 });
  if (outcomes.length === 0) {
    console.log("座標を取得する対象の場所はありません（住所があり、座標がなく、親が指定していない場所が対象）");
    return 0;
  }
  for (const o of outcomes) {
    if (o.status === "found") {
      console.log(`${o.applied ? "[保存]" : "[取得]"} ${o.name}  ${o.latitude}, ${o.longitude}  （一致: ${o.matched}）`);
    } else {
      console.log(`[${o.status === "error" ? "失敗" : "見つからない"}] ${o.name}  検索語: ${o.query}${o.error ? `  ${o.error}` : ""}`);
    }
  }
  if (!values.apply) console.log("\n確認のみです。保存するには --apply を付けて再実行してください（位置は「おおよそ」として保存）。");
  return 0;
}

async function distances(db: D1Database): Promise<number> {
  if (!(await getOrigin(db))) {
    console.error("自宅の座標が未設定です。管理画面の設定で自宅の位置を入れてください");
    return 1;
  }
  const changed = await refreshHomeDistances(db);
  console.log(`${changed} か所の距離を更新しました`);
  return 0;
}

async function photosFetch(db: D1Database, bucket: R2Bucket, path: string): Promise<number> {
  const outcomes = await fetchAndStagePhotos(db, bucket, await readPhotoList(path));
  const staged = outcomes.filter((o) => o.result === "staged").length;
  console.log(`\n${staged} / ${outcomes.length} 件を採用待ちで保存しました。親の確認: 管理画面の「承認待ち」 /admin/inbox`);
  return outcomes.some((o) => o.result === "error") ? 1 : 0;
}

async function enrichExport(db: D1Database): Promise<number> {
  const items = await loadIncomplete(db, { all: values.all });
  const out = values.out ?? DEFAULT_INCOMPLETE_PATH;
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify({ exported_at: new Date().toISOString(), items }, null, 2));
  console.log(`${out} に書き出しました（空欄の残る候補 ${items.length} 件${values.all ? "・取り込み済みの候補を含む" : ""}）`);
  for (const i of items) {
    const photos = i.photo_count === 0 ? "写真なし" : `写真 ${i.photo_count} 枚`;
    console.log(`  ${i.title}（${i.item_id}）${photos}  空欄: ${i.missing.length > 0 ? i.missing.join(", ") : "なし"}`);
  }
  return 0;
}

async function checkEnrichSourceIds(v: EnrichValidation): Promise<string[]> {
  if (!v.bundle) return [];
  const ids = new Set((await loadSources()).map((s) => s.id));
  return v.bundle.updates.flatMap((u, i) =>
    ids.has(u.source.source_id) ? [] : [`#${i} 収集元 ${u.source.source_id} が config/sources.yaml にありません`],
  );
}

function printEnrichValidation(v: EnrichValidation, sourceErrors: string[]) {
  if (v.bundle === null) {
    console.log("✗ 形式エラー");
    for (const e of v.formatErrors) console.log(`  - ${e}`);
    return;
  }
  for (const issue of v.issues) {
    const mark = issue.errors.length > 0 ? "✗" : "✓";
    console.log(`${mark} #${issue.index} ${issue.item_id}`);
    for (const e of issue.errors) console.log(`    エラー: ${e}`);
    for (const w of issue.warnings) console.log(`    確認: ${w}`);
  }
  for (const e of sourceErrors) console.log(`✗ ${e}`);
}

async function readValidEnrich(path: string): Promise<{ raw: unknown; hash: string; v: EnrichValidation; ok: boolean; sourceErrors: string[] }> {
  const { raw, hash } = await readBundle(path);
  const v = validateEnrichBundle(raw);
  const sourceErrors = await checkEnrichSourceIds(v);
  const ok = v.ok && sourceErrors.length === 0;
  if (!ok) printEnrichValidation(v, sourceErrors);
  return { raw, hash, v, ok, sourceErrors };
}

async function enrichValidate(path: string): Promise<number> {
  const { v, ok, sourceErrors } = await readValidEnrich(path);
  if (values.json) console.log(JSON.stringify({ ...v, sourceErrors }, null, 2));
  else if (ok) printEnrichValidation(v, sourceErrors);
  return ok ? 0 : 1;
}

const formatValue = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));

async function enrichPreview(db: D1Database, path: string): Promise<number> {
  const { v, ok } = await readValidEnrich(path);
  if (!ok || !v.bundle) {
    console.log("\n検証エラーがあるため照合していません。");
    return 1;
  }
  const result = await previewEnrich(db, v.bundle);
  if (values.json) {
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }
  const label = { update: "補足", nothing: "変更なし", stale: "書き出し後に変更あり", conflict: "要確認", not_found: "エラー" };
  for (const p of result.plans) {
    console.log(`[${label[p.status]}] #${p.index} ${p.title}（${p.item_id}）`);
    for (const f of p.fills) console.log(`    + ${f.field}: ${formatValue(f.value)}`);
    for (const k of p.kept) console.log(`    = ${k.field}: 値があるため変更しない（今の値: ${formatValue(k.current)}）`);
    for (const r of p.reasons) console.log(`    ${r}`);
    for (const w of v.issues[p.index]?.warnings ?? []) console.log(`    確認: ${w}`);
  }
  const updatable = result.plans.filter((p) => p.status === "update").map((p) => p.index);
  console.log(`\n補足できる候補: ${updatable.length > 0 ? updatable.join(",") : "なし"}`);
  console.log("親が確認した番号を enrich-apply の --accept に渡してください（すべてなら --accept all）。");
  return 0;
}

async function enrichApply(db: D1Database, path: string): Promise<number> {
  const { raw, hash, ok } = await readValidEnrich(path);
  if (!ok) return 1;
  if (!values.accept) throw new UsageError("補足する番号を --accept で指定してください（すべてなら --accept all）");
  const accept = values.accept.trim() === "all" ? "all" : parseAccept();
  const result = await applyEnrich(db, raw, { target: parseTarget(values.target), inputHash: hash, accept });
  if (values.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const label = {
      updated: "補足",
      skipped_not_accepted: "",
      skipped_nothing: "変更なし",
      skipped_stale: "書き出し後に変更ありのため未登録",
      skipped_conflict: "要確認のため未登録",
      error: "失敗",
    };
    for (const o of result.outcomes.filter((o) => o.result !== "skipped_not_accepted")) {
      console.log(`[${label[o.result]}] #${o.index} ${o.title}${o.fields.length > 0 ? `  ${o.fields.join(", ")}` : ""}`);
      if (o.reason) console.log(`    ${o.reason}`);
    }
    console.log(`\n結果: ${result.status}（実行 ID ${result.run_id}）`);
  }
  return result.status === "failed" ? 1 : 0;
}

// ---- タグの付け直し（retag） ----

/** 本番の付け直しは、親が承認した番号（--accept）も必須にする（--confirm と同じく、エージェントは承認後に付ける） */
function requireAccept(target: "local" | "production") {
  if (target === "production" && !values.accept) {
    throw new UsageError("本番のタグの付け直しには --accept（親が承認した番号。すべてなら all）が必要です");
  }
}

const tagLabel = (id: string) => getTag(id)?.label ?? "未定義";
const listTags = (ids: readonly string[]) => (ids.length > 0 ? ids.join(", ") : "（なし）");
const listCategories = (ids: readonly string[]) =>
  ids.length > 0 ? ids.map((id) => CATEGORIES.find((c) => c.id === id)?.label ?? id).join(", ") : "（なし）";

async function retagExport(db: D1Database): Promise<number> {
  const items = await loadRetagCandidates(db);
  const out = values.out ?? DEFAULT_RETAG_EXPORT_PATH;
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify({ exported_at: new Date().toISOString(), tags: TAGS, categories: CATEGORIES, items }, null, 2));
  console.log(`${out} に書き出しました（候補 ${items.length} 件・非表示を除く）`);
  const unknown = new Map<string, number>();
  for (const i of items) for (const t of i.unknown_tag_ids) unknown.set(t, (unknown.get(t) ?? 0) + 1);
  if (unknown.size > 0) console.log(`未定義のタグ: ${[...unknown].map(([t, n]) => `${t}（${n} 件）`).join(", ")}`);
  const noCategory = items.filter((i) => i.categories.length === 0).length;
  if (noCategory > 0) console.log(`どのカテゴリにも入らない候補: ${noCategory} 件`);
  return 0;
}

function printRetagValidation(v: RetagValidation) {
  if (v.bundle === null) {
    console.log("✗ 形式エラー");
    for (const e of v.formatErrors) console.log(`  - ${e}`);
    return;
  }
  for (const issue of v.issues) {
    const mark = issue.errors.length > 0 ? "✗" : "✓";
    console.log(`${mark} #${issue.index} ${v.bundle.entries[issue.index]!.title}（${issue.ref}）`);
    for (const e of issue.errors) console.log(`    エラー: ${e}`);
    for (const w of issue.warnings) console.log(`    確認: ${w}`);
  }
}

async function readValidRetag(path: string) {
  const { raw, hash } = await readBundle(path);
  const v = validateRetagBundle(raw);
  if (!v.ok && !values.json) printRetagValidation(v);
  return { raw, hash, v };
}

async function retagValidate(path: string): Promise<number> {
  const { v } = await readValidRetag(path);
  if (values.json) console.log(JSON.stringify(v, null, 2));
  else if (v.ok) printRetagValidation(v);
  return v.ok ? 0 : 1;
}

const RETAG_LABEL: Record<RetagPlan["status"], string> = {
  update: "変更",
  unchanged: "変更なし",
  stale: "書き出し後に変更あり",
  mismatch: "タイトル不一致",
  not_found: "エラー",
};

/** 候補の ID と、JSON での指定（出典キー）。同じなら 1 つだけ */
const idAndRef = (p: { item_id: string | null; ref: string }) =>
  p.item_id === null ? `${p.ref}・見つからない` : p.item_id === p.ref ? p.ref : `${p.item_id} / ${p.ref}`;

interface TagChangeView {
  before: string[];
  after: string[];
  added: string[];
  removed: string[];
  categories_before: string[];
  categories_after: string[];
}

function printTagChange(p: TagChangeView) {
  console.log(`    タグ: ${listTags(p.before)} → ${listTags(p.after)}`);
  for (const t of p.added) console.log(`    + ${t}（${tagLabel(t)}）`);
  for (const t of p.removed) console.log(`    - ${t}（${tagLabel(t)}）`);
  console.log(`    カテゴリ: ${listCategories(p.categories_before)} → ${listCategories(p.categories_after)}`);
}

async function retagPreview(db: D1Database, path: string): Promise<number> {
  const { v } = await readValidRetag(path);
  if (!v.ok) {
    if (values.json) console.log(JSON.stringify(v, null, 2));
    else console.log("\n検証エラーがあるため照合していません。");
    return 1;
  }
  const result = await previewRetag(db, v.bundle);
  const validationWarnings = new Map(v.issues.map((i) => [i.index, i.warnings]));
  if (values.json) {
    const plans = result.plans.map((p) => ({ ...p, warnings: [...(validationWarnings.get(p.index) ?? []), ...p.warnings] }));
    console.log(JSON.stringify({ ...result, plans }, null, 2));
    return 0;
  }
  for (const p of result.plans) {
    console.log(`[${RETAG_LABEL[p.status]}] #${p.index} ${p.title}（${idAndRef(p)}）`);
    if (p.status === "update" || p.status === "unchanged") printTagChange(p);
    if (p.reason) console.log(`    理由: ${p.reason}`);
    for (const r of p.reasons) console.log(`    ${r}`);
    for (const w of [...(validationWarnings.get(p.index) ?? []), ...p.warnings]) console.log(`    確認: ${w}`);
  }
  const s = result.summary;
  console.log(
    `\n対象 ${s.entries} 件: 変更 ${s.update} / 変更なし ${s.unchanged} / 書き出し後に変更あり ${s.stale} / タイトル不一致 ${s.mismatch} / エラー ${s.not_found}`,
  );
  console.log(`item_tags: +${s.item_tags_added} / -${s.item_tags_removed}`);
  const updatable = result.plans.filter((p) => p.status === "update").map((p) => p.index);
  console.log(`付け直す候補: ${updatable.length > 0 ? updatable.join(",") : "なし"}`);
  if (updatable.length > 0) console.log("親が確認した番号を retag-apply の --accept に渡してください（すべてなら --accept all）。");
  return 0;
}

/** 既存のファイルは上書きしない（前の実行の結果・戻し用 JSON を残す）。あれば .2, .3 … を付ける */
async function freshPath(base: string, ext: string): Promise<string> {
  for (let n = 1; ; n++) {
    const path = n === 1 ? `${base}${ext}` : `${base}.${n}${ext}`;
    try {
      await access(path);
    } catch {
      return path;
    }
  }
}

async function retagApply(db: D1Database, path: string): Promise<number> {
  const { raw, hash, v } = await readValidRetag(path);
  if (!v.ok) {
    if (values.json) console.log(JSON.stringify(v, null, 2));
    return 1;
  }
  const accept = !values.accept || values.accept.trim() === "all" ? "all" : parseAccept();
  const result = await applyRetag(db, raw, { target: parseTarget(values.target), inputHash: hash, accept });

  await mkdir(INGEST_DIR, { recursive: true });
  const base = join(INGEST_DIR, `retag-${result.batch_id}`);
  const resultPath = await freshPath(base, ".result.json");
  await writeFile(resultPath, JSON.stringify(result, null, 2));
  const undo = buildUndo(v.bundle, result, new Date().toISOString());
  const undoPath = undo.bundle ? await freshPath(base, ".undo.json") : null;
  if (undo.bundle && undoPath) await writeFile(undoPath, JSON.stringify(undo.bundle, null, 2));

  if (values.json) {
    console.log(JSON.stringify({ ...result, result_path: resultPath, undo_path: undoPath, undo_omitted: undo.omitted }, null, 2));
  } else {
    printRetagApplyResult(result);
    console.log(`結果ファイル: ${resultPath}`);
    console.log(undoPath ? `戻し用: ${undoPath}（retag-preview → retag-apply で戻せる）` : "戻し用: なし（付け直した候補がない）");
    for (const o of undo.omitted) {
      console.log(`  ※ #${o.index} の未定義のタグ ${o.tags.join(", ")} は戻し用に含めていません（戻すには事前のバックアップから復元）`);
    }
  }
  return result.status === "failed" ? 1 : result.status === "partial" ? 3 : 0;
}

function printRetagApplyResult(result: RetagApplyResult) {
  const label = {
    updated: "付け直し",
    unchanged: "変更なし",
    skipped_not_accepted: "",
    skipped_stale: "書き出し後に変更ありのため未適用",
    skipped_mismatch: "タイトル不一致のため未適用",
    error: "失敗",
  };
  for (const o of result.outcomes.filter((o) => o.result !== "skipped_not_accepted")) {
    console.log(`[${label[o.result]}] #${o.index} ${o.title}（${idAndRef(o)}）`);
    if (o.result === "updated") printTagChange(o);
    if (o.reason) console.log(`    理由: ${o.reason}`);
    if (o.message) console.log(`    ${o.message}`);
    for (const w of o.warnings) console.log(`    確認: ${w}`);
  }
  const s = result.summary;
  console.log(
    `\n結果: ${result.status}（実行 ID ${result.run_id}）付け直し ${s.updated} / 変更なし ${s.unchanged} / 未承認 ${s.not_accepted} / ` +
      `書き出し後に変更あり ${s.stale} / タイトル不一致 ${s.mismatch} / 失敗 ${s.error}`,
  );
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
    console.log(JSON.stringify({ tags: TAGS, categories: CATEGORIES }, null, 2));
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

/** 対象の DB を開いて実行する。書き込みを伴う操作は writeAction を渡す（本番では --confirm 必須） */
async function withDb(
  run: (db: D1Database, env: TargetEnv) => Promise<number>,
  writeAction?: string,
): Promise<number> {
  const target = parseTarget(values.target);
  if (writeAction) requireConfirm(target, values.confirm, writeAction);
  const opened = await openTarget(target);
  if (target === "production") console.log("※ 本番（production）の D1・R2 に接続しています");
  try {
    return await run(opened.env.DB, opened.env);
  } finally {
    await opened.dispose();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err instanceof UsageError ? err.message : err);
    process.exit(err instanceof UsageError ? 2 : 1);
  });
