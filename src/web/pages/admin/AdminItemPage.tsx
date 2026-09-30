import { useState, type FormEvent } from "react";
import { Link, useLoaderData, useRevalidator, type LoaderFunctionArgs } from "react-router";
import type { ItemPatchInput } from "../../../domain/admin";
import type { AdminItemResponse } from "../../../domain/api";
import { mediaKindLabel } from "../../../domain/labels";
import {
  ageBoundKinds,
  guardianRules,
  mediaKinds,
  priceStatuses,
  publishStatuses,
  rainPolicies,
  reservationRequirements,
  siblingRules,
  tagAssessments,
  tagCategories,
  type ItemRecord,
  type MediaKind,
} from "../../../domain/model";
import { TAGS } from "../../../domain/tags";
import { adminMediaUrl, fetchAdminItem, fetchAdminPlaces, patchItem, setMediaStatus, uploadMedia } from "../../api";
import { AdminFrame, numberField, numberOrNull, requireParentSession, SaveMessage, useSave } from "./common";

export async function adminItemLoader(args: LoaderFunctionArgs) {
  await requireParentSession(args);
  const [data, { places }] = await Promise.all([
    fetchAdminItem(args.params.id ?? "", args.request.signal),
    fetchAdminPlaces(args.request.signal),
  ]);
  return { data, places };
}

const LABELS = {
  rain_policy: { ok: "雨でもできる根拠あり", conditional: "条件付き（小雨のみ・内容変更等）", not_suitable: "雨天中止・雨に不向き", unknown: "未確認" },
  publish_status: { published: "公開", draft: "下書き", hidden: "非表示" },
  tag_status: { assessed: "判定済み（該当なしを含む）", unassessed: "未判定" },
  age_kind: { value: "数値あり", none: "制限なしと明記", unknown: "記載なし・未確認" },
  guardian_rule: { required: "同伴が必要", not_required: "同伴不要", unknown: "未確認" },
  sibling_rule: { allowed: "同伴できる", not_allowed: "同伴できない", unknown: "未確認" },
  reservation: { required: "必要", not_required: "不要", unknown: "未確認" },
  price: { free: "無料", paid: "有料", unknown: "未確認" },
} as const;

interface FormState {
  item: ItemRecord;
  tagIds: string[];
}

const ITEM_FIELDS = [
  "title",
  "child_description",
  "rain_policy",
  "publish_status",
  "official_url",
  "place_id",
  "facility_tags_status",
  "experience_tags_status",
  "age_min_kind",
  "age_min",
  "age_max_kind",
  "age_max",
  "eligibility_raw_text",
  "guardian_rule",
  "sibling_rule",
  "recommended_age_min",
  "recommended_age_max",
  "reservation_requirement",
  "reservation_note",
  "price_status",
  "price_text",
] as const;

export function AdminItemPage() {
  const { data, places } = useLoaderData<typeof adminItemLoader>();
  const revalidator = useRevalidator();
  // 保存結果の表示は、作り直されるフォームの外で保持する
  const save = useSave();
  // 読み込み直したら、フォームを最新の値で作り直す
  return (
    <ItemForm
      key={`${data.item.id}:${data.item.version}`}
      data={data}
      places={places}
      save={save}
      reload={revalidator.revalidate}
    />
  );
}

function ItemForm({
  data,
  places,
  save,
  reload,
}: {
  data: AdminItemResponse;
  places: { id: string; name: string }[];
  save: ReturnType<typeof useSave>;
  reload: () => void;
}) {
  const [form, setForm] = useState<FormState>({ item: data.item, tagIds: data.tag_ids });
  const { status, run } = save;
  const item = form.item;
  const set = <K extends keyof ItemRecord>(key: K, value: ItemRecord[K]) =>
    setForm((f) => ({ ...f, item: { ...f.item, [key]: value } }));

  function buildPatch(): ItemPatchInput {
    const patch: Record<string, unknown> = { version: data.item.version };
    for (const key of ITEM_FIELDS) {
      if (form.item[key] !== data.item[key]) patch[key] = form.item[key];
    }
    // 年齢の種別が「数値あり」以外なら値は消す
    if (patch.age_min_kind !== undefined && form.item.age_min_kind !== "value") patch.age_min = null;
    if (patch.age_max_kind !== undefined && form.item.age_max_kind !== "value") patch.age_max = null;
    if (JSON.stringify([...form.tagIds].sort()) !== JSON.stringify(data.tag_ids)) patch.tag_ids = form.tagIds;
    return patch as ItemPatchInput;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const patch = buildPatch();
    if (Object.keys(patch).length === 1) return;
    if (await run(() => patchItem(data.item.id, patch))) reload();
  }

  function toggleTag(id: string) {
    setForm((f) => ({
      ...f,
      tagIds: f.tagIds.includes(id) ? f.tagIds.filter((t) => t !== id) : [...f.tagIds, id],
    }));
  }

  return (
    <AdminFrame title="候補の編集">
      <p>
        <Link to={`/items/${encodeURIComponent(data.item.id)}`}>表示を確認</Link>
        {item.place_id && (
          <>
            {" ・ "}
            <Link to={`/admin/places/${encodeURIComponent(item.place_id)}`}>場所・移動を編集</Link>
          </>
        )}
      </p>
      <p className="muted">
        版 {data.item.version}・初回登録 {data.item.initialized_at?.slice(0, 10) ?? "-"}・親の確認{" "}
        {data.item.parent_reviewed_at?.slice(0, 10) ?? "-"}。ここで変更した値は、あとから取り込みを行っても上書きされません。
      </p>

      <form className="form" onSubmit={submit}>
        <fieldset>
          <legend>基本</legend>
          <label>
            名前
            <input value={item.title} onChange={(e) => set("title", e.target.value)} required maxLength={200} />
          </label>
          <label>
            紹介文（一覧に出る短い説明）
            <textarea
              value={item.child_description ?? ""}
              onChange={(e) => set("child_description", e.target.value)}
              maxLength={300}
            />
          </label>
          <label>
            公式ページの URL
            <input type="url" value={item.official_url ?? ""} onChange={(e) => set("official_url", e.target.value)} />
          </label>
          <label>
            公開状態
            <select value={item.publish_status} onChange={(e) => set("publish_status", e.target.value as ItemRecord["publish_status"])}>
              {publishStatuses.map((v) => (
                <option key={v} value={v}>
                  {LABELS.publish_status[v]}
                </option>
              ))}
            </select>
          </label>
          <label>
            場所
            <select
              value={item.place_id ?? ""}
              onChange={(e) => set("place_id", e.target.value || null)}
            >
              {places.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </fieldset>

        <fieldset>
          <legend>雨の日</legend>
          <p className="hint">施設に屋内があるかではなく、この体験を雨でもできるかで選びます。道中の濡れやすさは含めません。</p>
          <select value={item.rain_policy} onChange={(e) => set("rain_policy", e.target.value as ItemRecord["rain_policy"])}>
            {rainPolicies.map((v) => (
              <option key={v} value={v}>
                {LABELS.rain_policy[v]}
              </option>
            ))}
          </select>
        </fieldset>

        <fieldset>
          <legend>タグ</legend>
          {tagCategories.map((category) => {
            const statusKey = category === "facility" ? "facility_tags_status" : "experience_tags_status";
            return (
              <div key={category} className="tag-group">
                <div className="tag-group-head">
                  <strong>{category === "facility" ? "施設分類" : "体験"}</strong>
                  <select value={item[statusKey]} onChange={(e) => set(statusKey, e.target.value as ItemRecord[typeof statusKey])}>
                    {tagAssessments.map((v) => (
                      <option key={v} value={v}>
                        {LABELS.tag_status[v]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="chip-row">
                  {TAGS.filter((t) => t.category === category).map((t) => (
                    <label key={t.id} className={form.tagIds.includes(t.id) ? "chip is-active" : "chip"}>
                      <input
                        type="checkbox"
                        className="visually-hidden"
                        checked={form.tagIds.includes(t.id)}
                        onChange={() => toggleTag(t.id)}
                      />
                      {t.label}
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </fieldset>

        <fieldset>
          <legend>参加条件（主催者の記載）</legend>
          <div className="inline-fields">
            <label>
              下限
              <select value={item.age_min_kind} onChange={(e) => set("age_min_kind", e.target.value as ItemRecord["age_min_kind"])}>
                {ageBoundKinds.map((v) => (
                  <option key={v} value={v}>
                    {LABELS.age_kind[v]}
                  </option>
                ))}
              </select>
            </label>
            {item.age_min_kind === "value" && (
              <label>
                歳から
                <input type="number" min={0} max={120} value={numberField(item.age_min)} onChange={(e) => set("age_min", numberOrNull(e.target.value))} />
              </label>
            )}
            <label>
              上限
              <select value={item.age_max_kind} onChange={(e) => set("age_max_kind", e.target.value as ItemRecord["age_max_kind"])}>
                {ageBoundKinds.map((v) => (
                  <option key={v} value={v}>
                    {LABELS.age_kind[v]}
                  </option>
                ))}
              </select>
            </label>
            {item.age_max_kind === "value" && (
              <label>
                歳まで
                <input type="number" min={0} max={120} value={numberField(item.age_max)} onChange={(e) => set("age_max", numberOrNull(e.target.value))} />
              </label>
            )}
          </div>
          <label>
            保護者の同伴
            <select value={item.guardian_rule} onChange={(e) => set("guardian_rule", e.target.value as ItemRecord["guardian_rule"])}>
              {guardianRules.map((v) => (
                <option key={v} value={v}>
                  {LABELS.guardian_rule[v]}
                </option>
              ))}
            </select>
          </label>
          <label>
            未就学のきょうだいの同伴
            <select value={item.sibling_rule} onChange={(e) => set("sibling_rule", e.target.value as ItemRecord["sibling_rule"])}>
              {siblingRules.map((v) => (
                <option key={v} value={v}>
                  {LABELS.sibling_rule[v]}
                </option>
              ))}
            </select>
          </label>
          <label>
            条件の原文（学年・身長・居住地など、解釈できないものも残す）
            <textarea value={item.eligibility_raw_text ?? ""} onChange={(e) => set("eligibility_raw_text", e.target.value)} />
          </label>
          <div className="inline-fields">
            <label>
              おすすめ年齢（目安）
              <input
                type="number"
                min={0}
                max={120}
                value={numberField(item.recommended_age_min)}
                onChange={(e) => set("recommended_age_min", numberOrNull(e.target.value))}
              />
            </label>
            <label>
              〜
              <input
                type="number"
                min={0}
                max={120}
                value={numberField(item.recommended_age_max)}
                onChange={(e) => set("recommended_age_max", numberOrNull(e.target.value))}
              />
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend>予約・料金</legend>
          <label>
            予約
            <select
              value={item.reservation_requirement}
              onChange={(e) => set("reservation_requirement", e.target.value as ItemRecord["reservation_requirement"])}
            >
              {reservationRequirements.map((v) => (
                <option key={v} value={v}>
                  {LABELS.reservation[v]}
                </option>
              ))}
            </select>
          </label>
          <label>
            申込方法・期間（抽選／先着など）
            <textarea value={item.reservation_note ?? ""} onChange={(e) => set("reservation_note", e.target.value)} />
          </label>
          <label>
            料金
            <select value={item.price_status} onChange={(e) => set("price_status", e.target.value as ItemRecord["price_status"])}>
              {priceStatuses.map((v) => (
                <option key={v} value={v}>
                  {LABELS.price[v]}
                </option>
              ))}
            </select>
          </label>
          <label>
            料金の詳細
            <input value={item.price_text ?? ""} onChange={(e) => set("price_text", e.target.value)} />
          </label>
        </fieldset>

        <div className="form-actions">
          <button type="submit" className="link-button" disabled={status.kind === "saving"}>
            保存する
          </button>
          <SaveMessage status={status} onReload={reload} />
        </div>
      </form>

      <MediaSection data={data} reload={reload} />
    </AdminFrame>
  );
}

function MediaSection({ data, reload }: { data: AdminItemResponse; reload: () => void }) {
  const { status, run } = useSave();
  const [kind, setKind] = useState<MediaKind>("venue");

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    form.set("item_id", data.item.id);
    form.set("kind", kind);
    if (await run(() => uploadMedia(form))) {
      e.currentTarget?.reset();
      reload();
    }
  }

  return (
    <section className="section">
      <h2 className="section-title">写真</h2>
      <p className="hint">
        家族内だけで表示します。利用条件を確認できた写真だけを登録し、出典・撮影者を残してください。
        「施設の写真」「過去の様子」「イメージ」を選び、実際の様子と区別します。
      </p>
      <div className="gallery">
        {data.media.map((m) => (
          <figure key={m.id} className={m.status === "active" ? "photo" : "photo is-hidden"}>
            <img src={adminMediaUrl(m.id)} alt="" loading="lazy" />
            <figcaption className="photo-kind">
              {m.caption ?? mediaKindLabel[m.kind]}
              {m.status === "hidden" && "（非表示）"}
              {m.status === "pending" && "（採用待ち）"}
            </figcaption>
            {m.status === "pending" ? (
              <Link className="text-button" to="/admin/inbox">
                承認待ちで選ぶ
              </Link>
            ) : (
              <button
                type="button"
                className="text-button"
                onClick={() => run(() => setMediaStatus(m.id, m.status === "hidden" ? "active" : "hidden")).then((ok) => ok && reload())}
              >
                {m.status === "hidden" ? "表示に戻す" : "非表示にする"}
              </button>
            )}
          </figure>
        ))}
      </div>
      <form className="form" onSubmit={submit}>
        <label>
          画像ファイル（JPEG・PNG・WebP、5MB まで）
          <input type="file" name="file" accept="image/jpeg,image/png,image/webp" required />
        </label>
        <label>
          写真の種類
          <select value={kind} onChange={(e) => setKind(e.target.value as MediaKind)}>
            {mediaKinds.map((k) => (
              <option key={k} value={k}>
                {mediaKindLabel[k]}
              </option>
            ))}
          </select>
        </label>
        <label>
          写っているもの（拡大表示で出る説明）
          <input name="caption" maxLength={200} />
        </label>
        <label>
          撮影者・出典の表示
          <input name="credit" maxLength={200} />
        </label>
        <label>
          元の URL
          <input name="source_url" type="url" />
        </label>
        <label>
          利用条件のメモ
          <textarea name="license_note" />
        </label>
        <button type="submit" className="secondary-button" disabled={status.kind === "saving"}>
          写真を追加
        </button>
        <SaveMessage status={status} onReload={reload} />
      </form>
    </section>
  );
}
