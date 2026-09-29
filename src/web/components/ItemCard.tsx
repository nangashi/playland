import { Link } from "react-router";
import type { ItemCard as ItemCardData } from "../../domain/api";
import { rainLabel, unknownReasonLabel } from "../../domain/labels";
import { Photo } from "./Photo";
import { SaveButton } from "./SaveButton";
import { TravelSummary } from "./TravelSummary";

interface Props {
  item: ItemCardData;
  onSavedChange: (itemId: string, saved: boolean) => void;
}

/** 一覧のカード（横長・高密度）。細かな条件は詳細へ */
export function ItemCard({ item, onSavedChange }: Props) {
  const facts = [
    item.rain_policy === "ok" ? { text: rainLabel.ok, tone: "ok" } : null,
    item.reservation_requirement === "required" ? { text: "要予約", tone: "warn" } : null,
    item.price_status === "free" ? { text: "無料", tone: "plain" } : null,
    item.age_min_kind === "value" ? { text: `${item.age_min}歳〜`, tone: "plain" } : null,
  ].filter((f): f is { text: string; tone: string } => f !== null);

  return (
    <article className="card">
      <Link to={`/items/${encodeURIComponent(item.id)}`} className="card-link">
        <div className="card-thumb">
          <Photo media={item.cover} alt="" showKind={false} />
        </div>
        <div className="card-body">
          <h2 className="card-title">{item.title}</h2>
          {item.place && item.place.name !== item.title && <p className="card-place">{item.place.name}</p>}
          {item.child_description && <p className="card-desc">{item.child_description}</p>}
          <p className="card-meta">
            {facts.map((f) => (
              <span key={f.text} className={`tag tag-${f.tone}`}>
                {f.text}
              </span>
            ))}
            <TravelSummary travel={item.travel} matched={item.matched_modes} />
          </p>
          {item.unknown.length > 0 && (
            <p className="unknown-note">不明：{item.unknown.map((r) => unknownReasonLabel[r]).join("・")}</p>
          )}
        </div>
      </Link>
      <div className="card-save">
        <SaveButton itemId={item.id} saved={item.saved} onChange={(next) => onSavedChange(item.id, next)} />
      </div>
    </article>
  );
}
