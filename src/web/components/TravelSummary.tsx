import { modeShortLabel } from "../../domain/labels";
import type { TransportMode } from "../../domain/model";
import type { ModeView } from "../../domain/transport";

/**
 * カード用の移動の目安（表示対象で、時間が登録されている手段だけ）。
 * 運転時間だけの値は「自宅から○分」に見えないように書き分ける。
 */
export function TravelSummary({ travel, matched }: { travel: ModeView[] | null; matched: TransportMode[] | null }) {
  if (travel === null) return null;
  // 一覧では時間が登録されている手段だけを出す（未確認は詳細で）
  const parts = travel
    .filter((v) => v.visible && v.estimate !== null)
    .map((v) => `${modeShortLabel[v.mode]} ${shortText(v)}`);
  if (parts.length === 0) return null;
  const onlyCar = matched !== null && matched.length === 1 && matched[0] === "car";
  return (
    <span className="travel">
      {parts.join("・")}
      {onlyCar && <span className="travel-note">（条件に合うのは車のみ）</span>}
    </span>
  );
}

function shortText(v: ModeView): string {
  const e = v.estimate!;
  if (e.route_status === "no_route") return "不可";
  if (e.basis === "driving_only") return `運転${e.minutes}分+`;
  return `${e.minutes}分`;
}
