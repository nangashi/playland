import { Link } from "react-router";
import type { ItemCard as ItemCardData } from "../../domain/api";
import { kindLabel, rainLabel } from "../../domain/labels";
import { FavoriteButton } from "./FavoriteButton";
import { Placeholder } from "./Placeholder";

interface Props {
  item: ItemCardData;
  profileId: string | null;
  profileNames: Map<string, string>;
  onSavedChange: (itemId: string, saved: boolean) => void;
}

export function ItemCard({ item, profileId, profileNames, onSavedChange }: Props) {
  const saved = profileId !== null && item.saved_by_profile_ids.includes(profileId);
  const savers = item.saved_by_profile_ids
    .map((id) => profileNames.get(id))
    .filter((name): name is string => name !== undefined);

  return (
    <article className="card">
      <Link to={`/items/${encodeURIComponent(item.id)}`} className="card-link">
        <Placeholder kind={item.kind} />
        <div className="card-body">
          <div className="badges">
            <span className={`badge badge-${item.kind}`}>{kindLabel[item.kind]}</span>
            <span className={`badge badge-rain-${item.rain_policy}`}>☂ {rainLabel[item.rain_policy]}</span>
          </div>
          {item.child_description && <p className="card-desc">{item.child_description}</p>}
          <h2 className={item.child_description ? "card-title" : "card-title is-primary"}>{item.title}</h2>
          {item.place && item.place.name !== item.title && <p className="card-place">{item.place.name}</p>}
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
