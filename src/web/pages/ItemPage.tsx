import { useEffect, useState } from "react";
import { Link, useLoaderData, useNavigate, type LoaderFunctionArgs } from "react-router";
import type { ItemDetailResponse } from "../../domain/api";
import {
  ageRuleText,
  childDate,
  guardianLabel,
  kindLabel,
  mediaKindLabel,
  modeIcon,
  modeLabel,
  priceLabel,
  rainLabel,
  reservationLabel,
  scheduleLabel,
  siblingLabel,
  tokyoTime,
} from "../../domain/labels";
import { googleMapsDirectionsUrl, googleMapsSearchUrl, safeExternalUrl } from "../../domain/links";
import { getTag } from "../../domain/tags";
import type { ModeView } from "../../domain/transport";
import { fetchAdminSession, fetchItem } from "../api";
import { FavoriteButton } from "../components/FavoriteButton";
import { Photo } from "../components/Photo";
import { getSelectedProfileId } from "../profile";

export async function itemLoader({ params, request }: LoaderFunctionArgs) {
  const [item, session] = await Promise.all([
    fetchItem(params.id ?? "", request.signal),
    fetchAdminSession(request.signal).catch(() => ({ active: false, expires_at: null })),
  ]);
  return { item, profileId: getSelectedProfileId(), isParent: session.active };
}

export function ItemPage() {
  const { item, profileId, isParent } = useLoaderData<typeof itemLoader>();
  const navigate = useNavigate();
  const [saved, setSaved] = useState(profileId !== null && item.saved_by_profile_ids.includes(profileId));
  useEffect(
    () => setSaved(profileId !== null && item.saved_by_profile_ids.includes(profileId)),
    [item, profileId],
  );

  const officialUrl = safeExternalUrl(item.official_url);
  const place = item.place;
  const confirmedMapUrl = safeExternalUrl(place?.google_maps_url);
  const tags = item.tag_ids.map(getTag).filter((t) => t !== undefined);

  function back() {
    // 一覧から来ていれば戻り、直接開いた場合は一覧へ
    if (window.history.state?.idx > 0) navigate(-1);
    else navigate("/search");
  }

  return (
    <main className="page detail">
      <button type="button" className="back-button" onClick={back}>
        ← もどる
      </button>
      <Photo media={item.cover} kind={item.kind} alt={item.title} />
      <div className="badges">
        <span className={`badge badge-${item.kind}`}>{kindLabel[item.kind]}</span>
        {item.kind === "event" && (
          <span className={`badge badge-schedule-${item.schedule.state}`}>{scheduleLabel(item.schedule, "someday")}</span>
        )}
      </div>
      {item.child_description && <p className="detail-desc">{item.child_description}</p>}
      <h1 className="detail-title">{item.title}</h1>
      {tags.length > 0 && <p className="card-tags">{tags.map((t) => `#${t.childLabel}`).join(" ")}</p>}

      <FavoriteButton itemId={item.id} profileId={profileId} saved={saved} onChange={setSaved} size="large" />

      {isParent && (
        <div className="parent-actions">
          <Link className="secondary-button" to={`/admin/items/${encodeURIComponent(item.id)}`}>
            この候補を編集
          </Link>
          {place && (
            <Link className="secondary-button" to={`/admin/places/${encodeURIComponent(place.id)}`}>
              場所・移動を編集
            </Link>
          )}
        </div>
      )}

      <section className="section">
        <h2 className="section-title">いつ</h2>
        <Schedule item={item} />
      </section>

      <section className="section">
        <h2 className="section-title">さんかの じょうけん</h2>
        <dl className="facts">
          <dt>あめの ひ</dt>
          <dd className={`rain-${item.rain_policy}`}>{rainLabel[item.rain_policy]}</dd>

          <dt>対象</dt>
          <dd>
            <div>
              {ageRuleText(
                item.eligibility.age_min_kind,
                item.eligibility.age_min,
                item.eligibility.age_max_kind,
                item.eligibility.age_max,
              )}
            </div>
            <div className="muted">{guardianLabel[item.eligibility.guardian_rule]}</div>
            <div className="muted">{siblingLabel[item.eligibility.sibling_rule]}</div>
            {item.eligibility.eligibility_raw_text && (
              <div className="raw-text">原文：{item.eligibility.eligibility_raw_text}</div>
            )}
          </dd>

          {(item.recommended_age_min !== null || item.recommended_age_max !== null) && (
            <>
              <dt>おすすめ</dt>
              <dd>
                {item.recommended_age_min ?? "?"}〜{item.recommended_age_max ?? "?"}さいくらい
                <div className="muted">楽しめそうな目安で、参加資格ではありません</div>
              </dd>
            </>
          )}

          <dt>予約</dt>
          <dd>
            {reservationLabel[item.reservation_requirement]}
            {item.reservation_note && <div className="muted">{item.reservation_note}</div>}
          </dd>

          <dt>料金</dt>
          <dd>
            {priceLabel[item.price_status]}
            {item.price_text && <div className="muted">{item.price_text}</div>}
          </dd>

          <dt>ばしょ</dt>
          <dd>
            {place ? (
              <>
                <div>{place.name}</div>
                {place.address_text ? (
                  <div className="muted">{place.address_text}</div>
                ) : (
                  <div className="muted">住所は未確認</div>
                )}
                {place.position_accuracy === "approximate" && <div className="muted">地図上の位置はおおよそです</div>}
              </>
            ) : (
              <span className="muted">会場は未確認</span>
            )}
          </dd>
        </dl>
      </section>

      {place && (
        <section className="section">
          <h2 className="section-title">いきかた</h2>
          <Travel travel={item.travel} place={place} />
        </section>
      )}

      <div className="links">
        {officialUrl && (
          <a className="link-button" href={officialUrl} target="_blank" rel="noopener noreferrer">
            公式情報を見る
          </a>
        )}
        {place && confirmedMapUrl && (
          <a className="link-button" href={confirmedMapUrl} target="_blank" rel="noopener noreferrer">
            Googleマップで施設を見る
          </a>
        )}
        {place && !confirmedMapUrl && (
          <a
            className="link-button secondary"
            href={googleMapsSearchUrl(place.name, place.address_text)}
            target="_blank"
            rel="noopener noreferrer"
          >
            Googleマップで名前を検索（同じ施設か未確認）
          </a>
        )}
      </div>

      {item.media.length > 1 && (
        <section className="section">
          <h2 className="section-title">しゃしん</h2>
          <div className="gallery">
            {item.media.map((m) => (
              <figure key={m.id} className="photo">
                <img src={`/media/${encodeURIComponent(m.id)}`} alt="" loading="lazy" />
                <figcaption className="photo-kind">{mediaKindLabel[m.kind]}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}

      <footer className="provenance">
        <p>登録された情報をもとにした候補です。開催・営業・空きは公式情報で確認してください。</p>
        {item.initialized_at && <p>初回登録：{item.initialized_at.slice(0, 10)}</p>}
        {item.parent_reviewed_at && <p>おうちのひとが確認：{item.parent_reviewed_at.slice(0, 10)}</p>}
        {item.media.some((m) => m.credit) && (
          <p>写真：{item.media.flatMap((m) => (m.credit ? [m.credit] : [])).join("、")}</p>
        )}
      </footer>
    </main>
  );
}

function Schedule({ item }: { item: ItemDetailResponse }) {
  if (item.kind === "spot") {
    return <p>いつでも（その日に あいているかは こうしきで かくにんしてね）</p>;
  }
  if (item.schedule.state === "unknown" || item.occurrences.length === 0) {
    return <p className="muted">ひにちは かくにんちゅう</p>;
  }
  return (
    <ul className="occurrences">
      {item.occurrences.map((o) => (
        <li key={o.id} className={o.status === "cancelled" ? "is-cancelled" : ""}>
          {childDate(o.start_date)}
          {o.end_date !== o.start_date && ` 〜 ${childDate(o.end_date)}`}
          {o.starts_at && ` ${tokyoTime(o.starts_at)}`}
          {o.ends_at && `〜${tokyoTime(o.ends_at)}`}
          {o.status === "cancelled" && "（ちゅうし）"}
        </li>
      ))}
    </ul>
  );
}

function Travel({
  travel,
  place,
}: {
  travel: ModeView[] | null;
  place: NonNullable<ItemDetailResponse["place"]>;
}) {
  const visible = (travel ?? []).filter((v) => v.visible);
  if (visible.length === 0) return <p className="muted">表示する移動手段がありません</p>;
  return (
    <ul className="travel-list">
      {visible.map((v) => (
        <li key={v.mode}>
          <div className="travel-head">
            <span aria-hidden>{modeIcon[v.mode]}</span> {modeLabel[v.mode]}
            <span className="travel-time">{travelText(v)}</span>
          </div>
          {v.mode === "car" && <div className="muted">くるまを かりる ひつようが あります</div>}
          {v.stale_only && <div className="muted">前の出発地点での目安しかないため、表示していません</div>}
          {v.estimate?.note && <div className="muted">{v.estimate.note}</div>}
          {v.note && <div className="muted">{v.note}</div>}
          <a
            className="inline-link"
            href={googleMapsDirectionsUrl(
              { name: place.name, address: place.address_text, latitude: place.latitude, longitude: place.longitude },
              v.mode,
            )}
            target="_blank"
            rel="noopener noreferrer"
          >
            行き方を調べる（Googleマップ）
          </a>
        </li>
      ))}
    </ul>
  );
}

function travelText(v: ModeView): string {
  const e = v.estimate;
  if (!e) return "時間は未確認";
  if (e.route_status === "no_route") return "この手段では行けません（確認済み）";
  if (e.basis === "driving_only") return `運転${e.minutes}分＋手配・駐車後の移動は未計算`;
  const extras = [
    e.walk_minutes !== null ? `徒歩${e.walk_minutes}分` : null,
    e.transfers !== null ? `乗換${e.transfers}回` : null,
  ].filter(Boolean);
  return `出発地から${e.minutes}分${extras.length ? `（${extras.join("・")}）` : ""}`;
}
