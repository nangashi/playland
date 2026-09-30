import type {
  AgeBoundKind,
  GuardianRule,
  MediaKind,
  PriceStatus,
  RainPolicy,
  ReservationRequirement,
  SiblingRule,
  TransportMode,
} from "./model";
import type { UnknownReason } from "./search";
import type { TripKind } from "./trip";

/** 画面の表記。内部の値と画面の表現を分ける */

export const rainLabel: Record<RainPolicy, string> = {
  ok: "雨の日OK",
  conditional: "雨は条件付き",
  not_suitable: "雨の日は不向き",
  unknown: "雨天：不明",
};

export const modeLabel: Record<TransportMode, string> = {
  transit: "電車・バス",
  car: "車",
  bicycle: "自転車",
};

export const modeShortLabel: Record<TransportMode, string> = {
  transit: "電車",
  car: "車",
  bicycle: "自転車",
};

export const unknownReasonLabel: Record<UnknownReason, string> = {
  category: "カテゴリ",
  rain: "雨天対応",
  age: "対象年齢",
  travel: "移動時間",
  trip: "距離",
};

export const tripLabel: Record<TripKind, string> = {
  day_trip: "日帰り",
  trip: "旅行",
};

/** 写真が施設そのものか、過去の様子か、イメージかを区別する */
export const mediaKindLabel: Record<MediaKind, string> = {
  venue: "施設の写真",
  past_event: "過去の様子",
  image: "イメージ",
};

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
  required: "要予約",
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
