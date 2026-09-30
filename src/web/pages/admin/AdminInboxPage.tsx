import { useState } from "react";
import { Link, useLoaderData, useRevalidator, type LoaderFunctionArgs } from "react-router";
import type { AdminInboxEntry } from "../../../domain/api";
import {
  ageRuleText,
  mediaKindLabel,
  priceLabel,
  rainLabel,
  reservationLabel,
  tripLabel,
} from "../../../domain/labels";
import { getTag } from "../../../domain/tags";
import { tripKindOf } from "../../../domain/trip";
import { adminMediaUrl, decideInbox, fetchAdminInbox } from "../../api";
import { AdminFrame, requireParentSession, SaveMessage, useSave } from "./common";

export async function adminInboxLoader(args: LoaderFunctionArgs) {
  await requireParentSession(args);
  return fetchAdminInbox(args.request.signal);
}

/** 取り込みの下書きと採用待ちの写真を確認し、公開・見送りを決める */
export function AdminInboxPage() {
  const { entries } = useLoaderData<typeof adminInboxLoader>();
  return (
    <AdminFrame title="承認待ち">
      <p className="muted">
        集めた候補は下書き、写真は採用待ちです。家族の画面には、ここで「公開する」まで出ません。
        写真はチェックを付けたものだけを残し、外したものは消します。
      </p>
      {entries.length === 0 ? (
        <p className="inbox-empty">承認待ちはありません。</p>
      ) : (
        entries.map((e) => <InboxCard key={e.item.id} entry={e} />)
      )}
    </AdminFrame>
  );
}

function InboxCard({ entry }: { entry: AdminInboxEntry }) {
  const { item, place, sources, media, tag_ids } = entry;
  const revalidator = useRevalidator();
  const { status, run } = useSave();
  const pending = media.filter((m) => m.status === "pending");
  const [accepted, setAccepted] = useState(() => new Set(pending.map((m) => m.id)));
  const isDraft = item.publish_status === "draft";
  const trip = tripKindOf(place?.home_distance_km);
  const needsReview = sources.flatMap((s) => s.needs_review);
  const suggested = [...new Set(sources.flatMap((s) => s.suggested_tags))];
  const evidence = sources.flatMap((s) => s.evidence);

  function toggle(id: string) {
    setAccepted((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function decide(decision: "publish" | "reject" | "photos") {
    const ok = await run(() =>
      decideInbox(item.id, { version: item.version, decision, accept_media_ids: [...accepted] }),
    );
    if (ok) revalidator.revalidate();
  }

  const saving = status.kind === "saving";
  return (
    <section className="section inbox-card">
      <div className="inbox-head">
        <h2 className="section-title">{item.title}</h2>
        <span className={isDraft ? "tag tag-warn" : "tag"}>{isDraft ? "下書き" : "公開中・写真だけ確認"}</span>
      </div>
      <p className="card-place">
        {place?.name ?? "場所なし"}
        {place?.address_text ? `（${place.address_text}）` : ""}
      </p>
      <div className="tag-line">
        {trip && (
          <span className="tag tag-ok">
            {tripLabel[trip]}・約{Math.round(place!.home_distance_km!)}km
          </span>
        )}
        {place && place.latitude === null && (
          <Link className="tag tag-warn" to={`/admin/places/${encodeURIComponent(place.id)}`}>
            位置が未設定（地図で指定）
          </Link>
        )}
        {tag_ids.map((t) => (
          <span key={t} className="tag">
            {getTag(t)?.label ?? t}
          </span>
        ))}
        {suggested.map((t) => (
          <span key={t} className="tag tag-muted">
            タグの提案：{t}
          </span>
        ))}
      </div>
      {item.child_description && <p>{item.child_description}</p>}
      <ul className="inbox-facts">
        <li>
          {priceLabel[item.price_status]}
          {item.price_text ? `：${item.price_text}` : ""}
        </li>
        <li>
          {reservationLabel[item.reservation_requirement]}
          {item.reservation_note ? `：${item.reservation_note}` : ""}
        </li>
        <li>{rainLabel[item.rain_policy]}</li>
        <li>{ageRuleText(item.age_min_kind, item.age_min, item.age_max_kind, item.age_max)}</li>
        {item.official_url && (
          <li>
            <a href={item.official_url} target="_blank" rel="noopener noreferrer">
              公式ページ
            </a>
          </li>
        )}
      </ul>
      {needsReview.length > 0 && (
        <div className="inbox-review">
          <strong>確認してほしい点</strong>
          <ul>
            {needsReview.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      )}
      {evidence.length > 0 && (
        <details className="inbox-evidence">
          <summary>根拠（公式ページの引用 {evidence.length} 件）</summary>
          <ul>
            {evidence.map((ev, i) => (
              <li key={i}>
                <span className="muted">{ev.field}</span>「{ev.text}」{" "}
                <a href={ev.source_url} target="_blank" rel="noopener noreferrer">
                  出典
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}

      {pending.length > 0 && (
        <div className="inbox-photos">
          {pending.map((m) => (
            <label key={m.id} className={accepted.has(m.id) ? "inbox-photo is-on" : "inbox-photo"}>
              <input type="checkbox" checked={accepted.has(m.id)} onChange={() => toggle(m.id)} />
              <img src={adminMediaUrl(m.id)} alt="" loading="lazy" />
              <span className="inbox-photo-caption">
                {m.caption ?? mediaKindLabel[m.kind]}
                {m.credit ? `（${m.credit}）` : ""}
              </span>
            </label>
          ))}
        </div>
      )}

      <div className="form-actions inbox-actions">
        {isDraft ? (
          <>
            <button type="button" className="link-button" disabled={saving} onClick={() => decide("publish")}>
              公開する{pending.length > 0 ? `（写真 ${accepted.size} 枚）` : ""}
            </button>
            <button type="button" className="secondary-button" disabled={saving} onClick={() => decide("reject")}>
              見送る
            </button>
          </>
        ) : (
          <button type="button" className="link-button" disabled={saving} onClick={() => decide("photos")}>
            写真を確定（{accepted.size} 枚を採用）
          </button>
        )}
        <Link className="text-button" to={`/admin/items/${encodeURIComponent(item.id)}`}>
          内容を直す
        </Link>
      </div>
      <SaveMessage status={status} onReload={() => revalidator.revalidate()} />
    </section>
  );
}
