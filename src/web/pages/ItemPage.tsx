import { useEffect, useState } from "react";
import { Link, useLoaderData, useNavigate, type LoaderFunctionArgs } from "react-router";
import type { ItemDetailResponse } from "../../domain/api";
import {
  ageRuleText,
  guardianLabel,
  mediaKindLabel,
  modeLabel,
  priceLabel,
  rainLabel,
  reservationLabel,
  siblingLabel,
} from "../../domain/labels";
import { googleMapsDirectionsUrl, googleMapsSearchUrl, safeExternalUrl } from "../../domain/links";
import { getTag } from "../../domain/tags";
import type { ModeView } from "../../domain/transport";
import { fetchAdminSession, fetchItem } from "../api";
import { HideButton } from "../components/HideButton";
import { Photo } from "../components/Photo";
import { SaveButton } from "../components/SaveButton";

export async function itemLoader({ params, request }: LoaderFunctionArgs) {
  const [item, session] = await Promise.all([
    fetchItem(params.id ?? "", request.signal),
    fetchAdminSession(request.signal).catch(() => ({ active: false, expires_at: null })),
  ]);
  return { item, isParent: session.active };
}

export function ItemPage() {
  const { item, isParent } = useLoaderData<typeof itemLoader>();
  const navigate = useNavigate();
  const [saved, setSaved] = useState(item.saved);
  const [hidden, setHiddenState] = useState(item.hidden);
  useEffect(() => {
    setSaved(item.saved);
    setHiddenState(item.hidden);
  }, [item]);

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
      <nav className="detail-nav">
        <button type="button" className="text-button" onClick={back}>
          ← 一覧に戻る
        </button>
        {isParent && (
          <span className="detail-admin">
            <Link to={`/admin/items/${encodeURIComponent(item.id)}`}>候補を編集</Link>
            {place && <Link to={`/admin/places/${encodeURIComponent(place.id)}`}>場所・移動を編集</Link>}
          </span>
        )}
      </nav>

      <div className={item.cover ? "detail-layout has-media" : "detail-layout"}>
        {/* 写真がないときは場所を取らない */}
        {item.cover && (
          <div className="detail-media">
            <Photo media={item.cover} alt={item.title} />
          </div>
        )}
        <div className="detail-main">
          <header className="detail-head">
            <h1 className="detail-title">{item.title}</h1>
            <span className="detail-actions">
              <SaveButton itemId={item.id} saved={saved} onChange={setSaved} variant="full" />
              <HideButton itemId={item.id} hidden={hidden} onChange={setHiddenState} variant="full" />
            </span>
          </header>
          {hidden && <p className="muted">興味なしにしています。一覧には「興味なしも表示」を選んだときだけ出ます。</p>}
          {place && place.name !== item.title && <p className="muted">{place.name}</p>}
          {item.child_description && <p className="detail-desc">{item.child_description}</p>}
          {tags.length > 0 && (
            <p className="tag-line">
              {tags.map((t) => (
                <span key={t.id} className="tag tag-plain">
                  {t.label}
                </span>
              ))}
            </p>
          )}

          <div className="links">
            {officialUrl && (
              <a className="link-button" href={officialUrl} target="_blank" rel="noopener noreferrer">
                公式サイト
              </a>
            )}
            {place && confirmedMapUrl && (
              <a className="link-button secondary" href={confirmedMapUrl} target="_blank" rel="noopener noreferrer">
                Googleマップで見る
              </a>
            )}
            {place && !confirmedMapUrl && (
              <a
                className="link-button secondary"
                href={googleMapsSearchUrl(place.name, place.address_text)}
                target="_blank"
                rel="noopener noreferrer"
                title="同じ施設かは未確認です"
              >
                Googleマップで名前を検索
              </a>
            )}
          </div>
        </div>
      </div>

      <div className="detail-sections">
        <section className="section">
          <h2 className="section-title">利用条件</h2>
          <dl className="facts">
            <dt>雨の日</dt>
            <dd className={`rain-${item.rain_policy}`}>{rainLabel[item.rain_policy]}</dd>

            <dt>対象</dt>
            <dd>
              {ageRuleText(
                item.eligibility.age_min_kind,
                item.eligibility.age_min,
                item.eligibility.age_max_kind,
                item.eligibility.age_max,
              )}
              <div className="muted">
                {guardianLabel[item.eligibility.guardian_rule]}／{siblingLabel[item.eligibility.sibling_rule]}
              </div>
              {item.eligibility.eligibility_raw_text && (
                <div className="raw-text">原文：{item.eligibility.eligibility_raw_text}</div>
              )}
            </dd>

            {(item.recommended_age_min !== null || item.recommended_age_max !== null) && (
              <>
                <dt>目安</dt>
                <dd>
                  {item.recommended_age_min ?? "?"}〜{item.recommended_age_max ?? "?"}歳くらい
                  <span className="muted">（楽しめそうな年齢。参加資格ではありません）</span>
                </dd>
              </>
            )}

            <dt>予約</dt>
            <dd>
              {reservationLabel[item.reservation_requirement]}
              {item.reservation_note && <span className="muted">（{item.reservation_note}）</span>}
            </dd>

            <dt>料金</dt>
            <dd>
              {priceLabel[item.price_status]}
              {item.price_text && <span className="muted">（{item.price_text}）</span>}
            </dd>

            <dt>営業</dt>
            <dd className="muted">営業時間・休業日は公式サイトで確認してください</dd>

            <dt>場所</dt>
            <dd>
              {place ? (
                <>
                  {place.address_text ?? <span className="muted">住所未確認</span>}
                  {place.position_accuracy === "approximate" && <span className="muted">（地図の位置はおおよそ）</span>}
                </>
              ) : (
                <span className="muted">未確認</span>
              )}
            </dd>
          </dl>
        </section>

        {place && (
          <section className="section">
            <h2 className="section-title">移動</h2>
            <Travel travel={item.travel} place={place} />
          </section>
        )}
      </div>

      {item.media.length > 1 && (
        <section className="section">
          <h2 className="section-title">写真</h2>
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
        <p>登録された情報に基づく候補です。営業状況・混雑・空きは公式情報で確認してください。</p>
        <p>
          {item.initialized_at && `初回登録 ${item.initialized_at.slice(0, 10)}`}
          {item.parent_reviewed_at && `／確認・修正 ${item.parent_reviewed_at.slice(0, 10)}`}
          {item.media.some((m) => m.credit) &&
            `／写真 ${[...new Set(item.media.flatMap((m) => (m.credit ? [m.credit] : [])))].join("、")}`}
        </p>
      </footer>
    </main>
  );
}

function Travel({ travel, place }: { travel: ModeView[] | null; place: NonNullable<ItemDetailResponse["place"]> }) {
  const visible = (travel ?? []).filter((v) => v.visible);
  if (visible.length === 0) return <p className="muted">表示する移動手段がありません</p>;
  return (
    <table className="travel-table">
      <tbody>
        {visible.map((v) => (
          <tr key={v.mode}>
            <th scope="row">{modeLabel[v.mode]}</th>
            <td>
              {travelText(v)}
              {v.mode === "car" && <div className="muted">車の手配が必要</div>}
              {v.stale_only && <div className="muted">前の出発地での目安しかないため表示していません</div>}
              {v.estimate?.note && <div className="muted">{v.estimate.note}</div>}
              {v.note && <div className="muted">{v.note}</div>}
            </td>
            <td className="travel-link">
              <a
                href={googleMapsDirectionsUrl(
                  { name: place.name, address: place.address_text, latitude: place.latitude, longitude: place.longitude },
                  v.mode,
                )}
                target="_blank"
                rel="noopener noreferrer"
              >
                経路
              </a>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function travelText(v: ModeView): string {
  const e = v.estimate;
  if (!e) return "時間は未確認";
  if (e.route_status === "no_route") return "この手段では行けません（確認済み）";
  if (e.basis === "driving_only") return `運転${e.minutes}分（手配・駐車後の移動は含まない）`;
  const extras = [
    e.walk_minutes !== null ? `徒歩${e.walk_minutes}分` : null,
    e.transfers !== null ? `乗換${e.transfers}回` : null,
  ].filter(Boolean);
  return `片道${e.minutes}分${extras.length ? `（${extras.join("・")}）` : ""}`;
}
