import { useEffect, useState } from "react";
import { useLoaderData, useNavigate, type LoaderFunctionArgs } from "react-router";
import { kindLabel, rainLabel } from "../../domain/labels";
import { googleMapsSearchUrl, safeExternalUrl } from "../../domain/links";
import { fetchItem } from "../api";
import { FavoriteButton } from "../components/FavoriteButton";
import { Placeholder } from "../components/Placeholder";
import { getSelectedProfileId } from "../profile";

export async function itemLoader({ params, request }: LoaderFunctionArgs) {
  const item = await fetchItem(params.id ?? "", request.signal);
  return { item, profileId: getSelectedProfileId() };
}

export function ItemPage() {
  const { item, profileId } = useLoaderData<typeof itemLoader>();
  const navigate = useNavigate();
  const [saved, setSaved] = useState(profileId !== null && item.saved_by_profile_ids.includes(profileId));
  useEffect(
    () => setSaved(profileId !== null && item.saved_by_profile_ids.includes(profileId)),
    [item, profileId],
  );

  const officialUrl = safeExternalUrl(item.official_url);
  const place = item.place;
  const confirmedMapUrl = safeExternalUrl(place?.google_maps_url);

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
      <Placeholder kind={item.kind} />
      <div className="badges">
        <span className={`badge badge-${item.kind}`}>{kindLabel[item.kind]}</span>
      </div>
      {item.child_description && <p className="detail-desc">{item.child_description}</p>}
      <h1 className="detail-title">{item.title}</h1>

      <FavoriteButton itemId={item.id} profileId={profileId} saved={saved} onChange={setSaved} size="large" />

      <dl className="facts">
        <dt>あめの ひ</dt>
        <dd className={`rain-${item.rain_policy}`}>{rainLabel[item.rain_policy]}</dd>

        <dt>ばしょ</dt>
        <dd>
          {place ? (
            <>
              <div>{place.name}</div>
              {place.address_text ? <div className="muted">{place.address_text}</div> : <div className="muted">住所は未確認</div>}
              {place.position_accuracy === "approximate" && <div className="muted">地図上の位置はおおよそです</div>}
            </>
          ) : (
            <span className="muted">会場は未確認</span>
          )}
        </dd>
      </dl>

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
    </main>
  );
}
