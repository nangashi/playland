import { Link } from "react-router";
import type { ItemCard as ItemCardData } from "../../domain/api";
import { kindLabel, rainLabel, scheduleLabel, unknownReasonLabel } from "../../domain/labels";
import type { Purpose } from "../../domain/search";
import { getTag } from "../../domain/tags";
import { FavoriteButton } from "./FavoriteButton";
import { Photo } from "./Photo";
import { TravelSummary } from "./TravelSummary";

interface Props {
  item: ItemCardData;
  purpose: Purpose;
  profileId: string | null;
  profileNames: Map<string, string>;
  onSavedChange: (itemId: string, saved: boolean) => void;
}

export function ItemCard({ item, purpose, profileId, profileNames, onSavedChange }: Props) {
  const saved = profileId !== null && item.saved_by_profile_ids.includes(profileId);
  const savers = item.saved_by_profile_ids
    .map((id) => profileNames.get(id))
    .filter((name): name is string => name !== undefined);
  const experiences = item.tag_ids
    .map(getTag)
    .filter((t) => t?.category === "experience")
    .slice(0, 3);

  return (
    <article className={item.finished ? "card is-finished" : "card"}>
      <Link to={`/items/${encodeURIComponent(item.id)}`} className="card-link">
        <Photo media={item.cover} kind={item.kind} alt={item.title} />
        <div className="card-body">
          <div className="badges">
            <span className={`badge badge-${item.kind}`}>{kindLabel[item.kind]}</span>
            {/* 常設の「いつでも」は種別と重なるので、今日の確認を促すときだけ出す */}
            {!(item.schedule.state === "always" && purpose === "someday") && (
              <span className={`badge badge-schedule-${item.schedule.state}`}>{scheduleLabel(item.schedule, purpose)}</span>
            )}
            <span className={`badge badge-rain-${item.rain_policy}`}>☂ {rainLabel[item.rain_policy]}</span>
          </div>
          {item.child_description && <p className="card-desc">{item.child_description}</p>}
          <h2 className={item.child_description ? "card-title" : "card-title is-primary"}>{item.title}</h2>
          {item.place && item.place.name !== item.title && <p className="card-place">{item.place.name}</p>}
          {experiences.length > 0 && (
            <p className="card-tags">{experiences.map((t) => `#${t!.childLabel}`).join(" ")}</p>
          )}
          <TravelSummary travel={item.travel} matched={item.matched_modes} />
          {item.unknown.length > 0 && (
            <p className="unknown-note">
              わからない：{item.unknown.map((r) => unknownReasonLabel[r]).join("・")}
            </p>
          )}
        </div>
      </Link>
      <div className="card-actions">
        {savers.length > 0 && <p className="savers">★ {savers.join("・")}</p>}
        <FavoriteButton
          itemId={item.id}
          profileId={profileId}
          saved={saved}
          onChange={(next) => onSavedChange(item.id, next)}
        />
      </div>
    </article>
  );
}
