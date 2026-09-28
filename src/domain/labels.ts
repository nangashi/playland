import type {
  AgeBoundKind,
  GuardianRule,
  ItemKind,
  MediaKind,
  PriceStatus,
  RainPolicy,
  ReservationRequirement,
  SiblingRule,
  TransportMode,
} from "./model";
import { TIME_ZONE, type ScheduleSummary } from "./schedule";
import type { FavoritesFilter, Purpose, RainFilter, UnknownReason } from "./search";

/** 子ども向けの表記（ひらがな中心）。内部の値と画面の表現を分ける */

export const kindLabel: Record<ItemKind, string> = {
  spot: "いつでも",
  event: "イベント",
};

export const rainLabel: Record<RainPolicy, string> = {
  ok: "あめでも できる",
  conditional: "あめは じょうけん つき",
  not_suitable: "あめの ひは むかない",
  unknown: "あめの ひは わからない",
};

export const favoritesLabel: Record<FavoritesFilter, string> = {
  all: "ぜんぶ",
  mine: "じぶんの いきたい",
  family: "かぞくの いきたい",
};

export const purposeLabel: Record<Purpose, string> = {
  today: "きょう",
  someday: "そのうち",
};

export const rainFilterLabel: Record<RainFilter, string> = {
  any: "きにしない",
  ok: "あめでも できる",
  ok_or_conditional: "じょうけん つきも",
};

export const modeLabel: Record<TransportMode, string> = {
  transit: "でんしゃ・バス",
  car: "くるま",
  bicycle: "じてんしゃ",
};

export const modeIcon: Record<TransportMode, string> = {
  transit: "🚃",
  car: "🚗",
  bicycle: "🚲",
};

export const unknownReasonLabel: Record<UnknownReason, string> = {
  schedule: "ひにち",
  tags: "あそびの しゅるい",
  rain: "あめ",
  age: "ねんれい",
  travel: "いきかた",
};

/** 写真が実際の開催内容か区別する */
export const mediaKindLabel: Record<MediaKind, string> = {
  venue: "かいじょうの しゃしん",
  past_event: "まえの ようす",
  image: "イメージ",
};

// ---- 親向け（漢字あり） ----

export const guardianLabel: Record<GuardianRule, string> = {
  required: "保護者の同伴が必要",
  not_required: "保護者の同伴は不要",
  unknown: "保護者同伴：未確認",
};

export const siblingLabel: Record<SiblingRule, string> = {
  allowed: "未就学のきょうだいの同伴：可",
  not_allowed: "未就学のきょうだいの同伴：不可",
  unknown: "未就学のきょうだいの同伴：未確認",
};

export const reservationLabel: Record<ReservationRequirement, string> = {
  required: "予約が必要",
  not_required: "予約不要",
  unknown: "予約：未確認",
};

export const priceLabel: Record<PriceStatus, string> = {
  free: "無料",
  paid: "有料",
  unknown: "料金：未確認",
};

export function ageRuleText(minKind: AgeBoundKind, min: number | null, maxKind: AgeBoundKind, max: number | null) {
  if (minKind === "unknown" && maxKind === "unknown") return "対象年齢：未確認";
  const lower = minKind === "value" ? `${min}歳から` : minKind === "none" ? "下限なし" : "下限は未確認";
  const upper = maxKind === "value" ? `${max}歳まで` : maxKind === "none" ? "上限なし" : "上限は記載なし（未確認）";
  return `${lower}・${upper}`;
}

const WEEKDAYS = ["にち", "げつ", "か", "すい", "もく", "きん", "ど"];

/** YYYY-MM-DD を「10がつ10にち（ど）」に */
export function childDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const weekday = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
  return `${m}がつ${d}にち（${WEEKDAYS[weekday]}）`;
}

const timeFormat = new Intl.DateTimeFormat("ja-JP", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit" });

/** UTC の ISO 時刻を日本時間の HH:MM に */
export function tokyoTime(iso: string): string {
  return timeFormat.format(new Date(iso));
}

export function scheduleLabel(schedule: ScheduleSummary, purpose: Purpose): string {
  switch (schedule.state) {
    case "always":
      return purpose === "today" ? "きょう あいているか かくにんしてね" : "いつでも";
    case "today":
      return "きょう やってる";
    case "upcoming":
      return schedule.next_date ? `つぎは ${childDate(schedule.next_date)}` : "これから";
    case "ended":
      return "おわりました";
    case "cancelled":
      return "ちゅうし";
    case "unknown":
      return "ひにちは かくにんちゅう";
  }
}
