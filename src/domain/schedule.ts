import type { ItemRecord, OccurrenceRecord } from "./model";

export const TIME_ZONE = "Asia/Tokyo";

const tokyoDateFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Asia/Tokyo の暦日（YYYY-MM-DD） */
export function tokyoDate(now: Date): string {
  return tokyoDateFormat.format(now);
}

/**
 * 候補の日程上の状態（登録情報上の判定。開催の確定ではない）。
 * - always: 常設スポット（今日の営業は別途確認）
 * - today: 今日の開催がある（時刻が分かり全回が終わったものは除く）
 * - upcoming: 今後の開催がある
 * - ended: 登録された開催がすべて過去
 * - cancelled: 登録された開催がすべて中止
 * - unknown: 開催日が分からない
 */
export type ScheduleState = "always" | "today" | "upcoming" | "ended" | "cancelled" | "unknown";

export interface ScheduleSummary {
  state: ScheduleState;
  /** 今日以降で最も近い開催日（開催中なら今日） */
  next_date: string | null;
  /** 登録された開催日（中止を除く）の件数 */
  occurrence_count: number;
}

export function summarizeSchedule(
  item: Pick<ItemRecord, "kind" | "schedule_status">,
  occurrences: readonly OccurrenceRecord[],
  now: Date,
): ScheduleSummary {
  if (item.kind === "spot") return { state: "always", next_date: null, occurrence_count: 0 };
  const scheduled = occurrences.filter((o) => o.status === "scheduled");
  if (item.schedule_status !== "known" || occurrences.length === 0) {
    return { state: "unknown", next_date: null, occurrence_count: scheduled.length };
  }
  if (scheduled.length === 0) return { state: "cancelled", next_date: null, occurrence_count: 0 };

  const today = tokyoDate(now);
  const nowMs = now.getTime();
  const runningToday = scheduled.some(
    (o) =>
      o.start_date <= today &&
      today <= o.end_date &&
      // 時刻まで分かり、すでに終わっている回だけを除く。日付だけの回は今日いっぱい有効
      !(o.precision === "datetime" && o.ends_at !== null && Date.parse(o.ends_at) <= nowMs),
  );
  if (runningToday) return { state: "today", next_date: today, occurrence_count: scheduled.length };

  const future = scheduled
    .filter((o) => o.start_date > today)
    .map((o) => o.start_date)
    .sort();
  if (future.length > 0) {
    return { state: "upcoming", next_date: future[0] ?? null, occurrence_count: scheduled.length };
  }
  return { state: "ended", next_date: null, occurrence_count: scheduled.length };
}

export function isFinished(state: ScheduleState): boolean {
  return state === "ended" || state === "cancelled";
}
