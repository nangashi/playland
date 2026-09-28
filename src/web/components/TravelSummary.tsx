import type { ModeView } from "../../domain/transport";
import { modeIcon } from "../../domain/labels";
import type { TransportMode } from "../../domain/model";

/**
 * カード用の移動の目安。表示対象の手段だけを出す。
 * 運転時間だけの値は「自宅から○分」に見えないように書き分ける。
 */
export function TravelSummary({ travel, matched }: { travel: ModeView[] | null; matched: TransportMode[] | null }) {
  if (travel === null) return <p className="travel muted">いきかた：ばしょ みかくにん</p>;
  const visible = travel.filter((v) => v.visible);
  if (visible.length === 0) return null;
  const onlyCar = matched !== null && matched.length === 1 && matched[0] === "car";
  return (
    <p className="travel">
      {visible.map((v) => (
        <span key={v.mode} className="travel-mode">
          <span aria-hidden>{modeIcon[v.mode]}</span> {shortText(v)}
        </span>
      ))}
      {onlyCar && <span className="travel-note">くるま なら</span>}
    </p>
  );
}

function shortText(v: ModeView): string {
  const e = v.estimate;
  if (!e) return "みかくにん";
  if (e.route_status === "no_route") return "いけない";
  if (e.basis === "driving_only") return `うんてん${e.minutes}ぷん＋`;
  return `${e.minutes}ぷん`;
}
