import type { TagCategory } from "./model";

/**
 * タグ定義（Git で管理する正本）。
 * LLM や取り込みはここにある ID だけを選ぶ。未定義のタグは自動で増やさず、親への提案にする。
 * 施設分類（facility）と体験タグ（experience）を分ける。
 */
export interface TagDefinition {
  id: string;
  category: TagCategory;
  /** 親向けの名称 */
  label: string;
  /** 子ども向けの表記（ひらがな中心） */
  childLabel: string;
}

export const TAGS: readonly TagDefinition[] = [
  // 施設分類
  { id: "park", category: "facility", label: "公園", childLabel: "こうえん" },
  { id: "indoor_playground", category: "facility", label: "屋内あそび場", childLabel: "おへやの あそびば" },
  { id: "science_museum", category: "facility", label: "科学館", childLabel: "かがくかん" },
  { id: "museum", category: "facility", label: "博物館・美術館", childLabel: "はくぶつかん" },
  { id: "zoo", category: "facility", label: "動物園", childLabel: "どうぶつえん" },
  { id: "aquarium", category: "facility", label: "水族館", childLabel: "すいぞくかん" },
  { id: "library", category: "facility", label: "図書館", childLabel: "としょかん" },
  { id: "childrens_center", category: "facility", label: "児童館", childLabel: "じどうかん" },
  { id: "farm", category: "facility", label: "農園・牧場", childLabel: "のうじょう" },
  { id: "sports_facility", category: "facility", label: "スポーツ施設", childLabel: "スポーツの ばしょ" },
  { id: "workshop_studio", category: "facility", label: "工房・教室", childLabel: "こうぼう" },
  { id: "community_center", category: "facility", label: "公民館・地域施設", childLabel: "こうみんかん" },

  // 体験
  { id: "crafting", category: "experience", label: "工作", childLabel: "こうさく" },
  { id: "woodwork", category: "experience", label: "木工", childLabel: "きの こうさく" },
  { id: "cooking", category: "experience", label: "料理", childLabel: "りょうり" },
  { id: "art", category: "experience", label: "お絵かき・アート", childLabel: "おえかき" },
  { id: "experiment", category: "experience", label: "実験", childLabel: "じっけん" },
  { id: "microscope", category: "experience", label: "顕微鏡", childLabel: "けんびきょう" },
  { id: "stargazing", category: "experience", label: "星空観察", childLabel: "ほし" },
  { id: "climbing", category: "experience", label: "クライミング", childLabel: "クライミング" },
  { id: "athletic", category: "experience", label: "アスレチック", childLabel: "アスレチック" },
  { id: "hiking", category: "experience", label: "山歩き", childLabel: "やまのぼり" },
  { id: "animals", category: "experience", label: "動物とのふれあい", childLabel: "どうぶつ" },
  { id: "insects", category: "experience", label: "虫", childLabel: "むし" },
  { id: "aquatic_life", category: "experience", label: "水の生きもの", childLabel: "さかな" },
  { id: "nature_observation", category: "experience", label: "自然観察", childLabel: "しぜん" },
  { id: "harvesting", category: "experience", label: "収穫体験", childLabel: "しゅうかく" },
  { id: "water_play", category: "experience", label: "水遊び", childLabel: "みずあそび" },
  { id: "ball_sports", category: "experience", label: "球技", childLabel: "ボール" },
  { id: "music", category: "experience", label: "音楽", childLabel: "おんがく" },
  { id: "reading", category: "experience", label: "読み聞かせ・本", childLabel: "えほん" },
  { id: "vehicles", category: "experience", label: "乗りもの", childLabel: "のりもの" },
];

/**
 * 子どもが選ぶ入口。1 つの入口が複数の内部タグに対応する。
 * 画面の表現（入口）と内部の分類（タグ）を分けて、あとから対応を変えられるようにする。
 */
export interface Entrance {
  id: string;
  category: TagCategory;
  label: string;
  icon: string;
  tagIds: readonly string[];
}

export const ENTRANCES: readonly Entrance[] = [
  { id: "make", category: "experience", label: "つくる", icon: "✂️", tagIds: ["crafting", "woodwork", "cooking", "art"] },
  { id: "climb", category: "experience", label: "のぼる", icon: "🧗", tagIds: ["climbing", "athletic", "hiking"] },
  { id: "creatures", category: "experience", label: "いきもの", icon: "🐞", tagIds: ["animals", "insects", "aquatic_life"] },
  { id: "discover", category: "experience", label: "しらべる", icon: "🔬", tagIds: ["experiment", "microscope", "stargazing", "nature_observation"] },
  { id: "move", category: "experience", label: "からだを うごかす", icon: "⚽", tagIds: ["athletic", "ball_sports", "water_play"] },
  { id: "nature", category: "experience", label: "そとで あそぶ", icon: "🌳", tagIds: ["nature_observation", "harvesting", "hiking", "water_play"] },
  { id: "sound-book", category: "experience", label: "おと・えほん", icon: "🎵", tagIds: ["music", "reading"] },
  { id: "ride", category: "experience", label: "のりもの", icon: "🚃", tagIds: ["vehicles"] },
  { id: "park", category: "facility", label: "こうえん", icon: "🛝", tagIds: ["park"] },
  { id: "indoor", category: "facility", label: "おへやの あそびば", icon: "🏠", tagIds: ["indoor_playground", "childrens_center"] },
  { id: "museum", category: "facility", label: "かがくかん・はくぶつかん", icon: "🏛️", tagIds: ["science_museum", "museum"] },
  { id: "zoo", category: "facility", label: "どうぶつえん・すいぞくかん", icon: "🐘", tagIds: ["zoo", "aquarium", "farm"] },
  { id: "library", category: "facility", label: "としょかん", icon: "📚", tagIds: ["library"] },
];

const tagById = new Map(TAGS.map((t) => [t.id, t]));

export function getTag(id: string): TagDefinition | undefined {
  return tagById.get(id);
}

export function isKnownTagId(id: string): boolean {
  return tagById.has(id);
}
