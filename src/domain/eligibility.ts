import type { ItemRecord } from "./model";

/** 条件への適合。unknown を match として扱わない */
export type Fit = "match" | "mismatch" | "unknown";

/**
 * 主催者が定めた年齢の参加資格に、指定した年齢が入るか。
 * 上限の「記載なし（unknown）」と「制限なしと明記（none）」を区別する。
 */
export function ageFit(
  item: Pick<ItemRecord, "age_min_kind" | "age_min" | "age_max_kind" | "age_max">,
  age: number,
): Fit {
  const lower = boundFit(item.age_min_kind, item.age_min, (min) => age >= min);
  const upper = boundFit(item.age_max_kind, item.age_max, (max) => age <= max);
  return combineFits([lower, upper]);
}

function boundFit(kind: ItemRecord["age_min_kind"], value: number | null, test: (v: number) => boolean): Fit {
  if (kind === "none") return "match";
  if (kind === "value" && value !== null) return test(value) ? "match" : "mismatch";
  return "unknown";
}

/** 1 つでも mismatch なら mismatch、次に unknown、すべて match なら match */
export function combineFits(fits: readonly Fit[]): Fit {
  if (fits.includes("mismatch")) return "mismatch";
  if (fits.includes("unknown")) return "unknown";
  return "match";
}
