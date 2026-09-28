import type { Fit } from "./eligibility";
import type {
  DurationBasis,
  EstimateSource,
  FamilySettingsRecord,
  RouteStatus,
  TransportMode,
  TransportPreferenceRecord,
  TravelEstimateRecord,
} from "./model";
import { transportModes } from "./model";

export interface TravelEstimateView {
  route_status: RouteStatus;
  minutes: number | null;
  basis: DurationBasis | null;
  walk_minutes: number | null;
  transfers: number | null;
  source: EstimateSource;
  note: string | null;
}

export interface ModeView {
  mode: TransportMode;
  /** 親の設定と時間条件を反映した、選択肢として表示するか */
  visible: boolean;
  visibility: TransportPreferenceRecord["visibility"];
  /** 現在の出発地点の版での目安。なければ null（未確認） */
  estimate: TravelEstimateView | null;
  /** 別の出発地点の版の値しかない */
  stale_only: boolean;
  note: string | null;
}

export type TransportSettings = Pick<FamilySettingsRecord, "origin_version" | "bicycle_max_minutes">;

/**
 * 1 つの場所について、手段ごとの表示と目安をまとめる。
 * - 公共交通・車の default は表示（LLM の判定や不明を理由に消さない）
 * - 自転車の default は、現在の出発地点からの片道 door_to_door の目安が上限以内のときだけ表示
 * - 同じ手段では親の値（manual）を経路サービスの値（api）より優先する
 */
export function buildModeViews(
  placeId: string,
  preferences: readonly TransportPreferenceRecord[],
  estimates: readonly TravelEstimateRecord[],
  settings: TransportSettings,
): ModeView[] {
  return transportModes.map((mode) => {
    const pref = preferences.find((p) => p.place_id === placeId && p.mode === mode);
    const forMode = estimates.filter((e) => e.place_id === placeId && e.mode === mode);
    const current = forMode.filter((e) => e.origin_version === settings.origin_version);
    const chosen = current.find((e) => e.source === "manual") ?? current.find((e) => e.source === "api") ?? null;
    const estimate: TravelEstimateView | null = chosen
      ? {
          route_status: chosen.route_status,
          minutes: chosen.minutes,
          basis: chosen.basis,
          walk_minutes: chosen.walk_minutes,
          transfers: chosen.transfers,
          source: chosen.source,
          note: chosen.note,
        }
      : null;
    const visibility = pref?.visibility ?? "default";
    return {
      mode,
      visible: isVisible(mode, visibility, estimate, settings),
      visibility,
      estimate,
      stale_only: chosen === null && forMode.length > 0,
      note: pref?.note ?? null,
    };
  });
}

function isVisible(
  mode: TransportMode,
  visibility: TransportPreferenceRecord["visibility"],
  estimate: TravelEstimateView | null,
  settings: TransportSettings,
): boolean {
  if (visibility === "hide") return false;
  if (visibility === "show") return true;
  if (mode !== "bicycle") return true;
  const minutes = comparableMinutes(estimate);
  return minutes !== null && minutes <= settings.bicycle_max_minutes;
}

/** 「自宅から○分」と比較できる時間。運転時間だけ・経路なし・未確認は null */
export function comparableMinutes(estimate: TravelEstimateView | null): number | null {
  if (!estimate || estimate.route_status !== "estimated" || estimate.basis !== "door_to_door") return null;
  return estimate.minutes;
}

export interface TravelFit {
  fit: Fit;
  /** 条件を満たした手段 */
  matched_modes: TransportMode[];
}

/**
 * 選んだ手段と片道の上限時間で絞り込む。
 * 選んだ手段のいずれかで、比較できる時間が上限以内なら一致。
 * 時間未確認・運転時間だけの値は一致としない（unknown）。
 */
export function travelFit(
  views: readonly ModeView[] | null,
  modes: ReadonlySet<TransportMode>,
  maxMinutes: number | undefined,
): TravelFit {
  if (views === null) return { fit: "unknown", matched_modes: [] };
  const candidates = views.filter((v) => modes.has(v.mode) && v.visible);
  if (candidates.length === 0) return { fit: "mismatch", matched_modes: [] };
  if (maxMinutes === undefined) return { fit: "match", matched_modes: candidates.map((v) => v.mode) };

  const matched = candidates.filter((v) => {
    const minutes = comparableMinutes(v.estimate);
    return minutes !== null && minutes <= maxMinutes;
  });
  if (matched.length > 0) return { fit: "match", matched_modes: matched.map((v) => v.mode) };

  const undetermined = candidates.some((v) => comparableMinutes(v.estimate) === null && v.estimate?.route_status !== "no_route");
  return { fit: undetermined ? "unknown" : "mismatch", matched_modes: [] };
}
