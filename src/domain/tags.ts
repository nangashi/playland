import type { TagCategory } from "./model";

/**
 * タグ定義（Git で管理する正本）。
 * LLM や取り込みはここにある ID だけを選ぶ。未定義のタグは自動で増やさず、親への提案にする。
 * 施設分類（facility）と体験タグ（experience）を分けて持つが、画面ではカテゴリにまとめて見せる。
 */
export interface TagDefinition {
  id: string;
  category: TagCategory;
  label: string;
}

export const TAGS: readonly TagDefinition[] = [
  // 施設分類
  { id: "park", category: "facility", label: "公園" },
  { id: "indoor_playground", category: "facility", label: "屋内あそび場" },
  { id: "science_museum", category: "facility", label: "科学館" },
  { id: "museum", category: "facility", label: "博物館・美術館" },
  { id: "zoo", category: "facility", label: "動物園" },
  { id: "aquarium", category: "facility", label: "水族館" },
  { id: "library", category: "facility", label: "図書館" },
  { id: "childrens_center", category: "facility", label: "児童館" },
  { id: "farm", category: "facility", label: "農園・牧場" },
  { id: "sports_facility", category: "facility", label: "スポーツ施設" },
  { id: "workshop_studio", category: "facility", label: "工房・教室" },
  { id: "community_center", category: "facility", label: "公民館・地域施設" },
  { id: "character_theme", category: "facility", label: "キャラクター・テーマ施設" },
  { id: "amusement_park", category: "facility", label: "遊園地" },
  { id: "shop", category: "facility", label: "買い物" },

  // 体験
  { id: "crafting", category: "experience", label: "工作" },
  { id: "woodwork", category: "experience", label: "木工" },
  { id: "cooking", category: "experience", label: "料理" },
  { id: "art", category: "experience", label: "お絵かき・アート" },
  { id: "experiment", category: "experience", label: "実験" },
  { id: "microscope", category: "experience", label: "顕微鏡" },
  { id: "stargazing", category: "experience", label: "星空観察" },
  { id: "climbing", category: "experience", label: "クライミング" },
  { id: "athletic", category: "experience", label: "アスレチック" },
  { id: "hiking", category: "experience", label: "山歩き" },
  { id: "animals", category: "experience", label: "動物とのふれあい" },
  { id: "insects", category: "experience", label: "虫" },
  { id: "aquatic_life", category: "experience", label: "水の生きもの" },
  { id: "nature_observation", category: "experience", label: "自然観察" },
  { id: "harvesting", category: "experience", label: "収穫体験" },
  { id: "water_play", category: "experience", label: "水遊び" },
  { id: "ball_sports", category: "experience", label: "球技" },
  { id: "music", category: "experience", label: "音楽" },
  { id: "reading", category: "experience", label: "読み聞かせ・本" },
  { id: "rides", category: "experience", label: "アトラクション" },
  { id: "job_experience", category: "experience", label: "職業体験" },
];

/**
 * 画面で選ぶカテゴリ。1 つだけ選び、含まれるタグのどれかに当てはまれば一致とする。
 * 施設分類と体験をまたいでよい（例：生き物＝動物園・水族館・牧場・ふれあい体験）。
 * 画面の分け方（カテゴリ）と内部の分類（タグ）を分けて、あとから対応を変えられるようにする。
 */
export interface CategoryDefinition {
  id: string;
  label: string;
  tagIds: readonly string[];
}

export const CATEGORIES: readonly CategoryDefinition[] = [
  // 画面では「すべて」を先頭に、この順で 3 個ずつ 3 行に並ぶ。順番やラベルの長さを変えるときは
  // styles.css の .chip-wrap.is-category の見積もり（画面幅 360〜430px で 3 個 × 3 行）を確かめること。
  {
    id: "active",
    label: "運動あそび",
    tagIds: ["athletic", "climbing", "ball_sports", "water_play", "hiking", "sports_facility", "indoor_playground"],
  },
  { id: "nature", label: "自然遊び", tagIds: ["nature_observation", "hiking", "insects", "stargazing", "harvesting"] },
  { id: "attractions", label: "アトラクション", tagIds: ["rides", "amusement_park"] },
  {
    id: "animals",
    label: "生き物",
    tagIds: ["zoo", "aquarium", "farm", "animals", "insects", "aquatic_life"],
  },
  { id: "museum", label: "展示見学", tagIds: ["science_museum", "museum", "stargazing", "character_theme"] },
  {
    id: "make",
    label: "体験ものづくり",
    tagIds: [
      "crafting",
      "woodwork",
      "cooking",
      "art",
      "experiment",
      "microscope",
      "harvesting",
      "job_experience",
      "workshop_studio",
    ],
  },
  { id: "music-books", label: "絵本音楽", tagIds: ["music", "reading", "library"] },
  { id: "shopping", label: "買い物", tagIds: ["shop", "character_theme"] },
];

const tagById = new Map(TAGS.map((t) => [t.id, t]));
const categoryById = new Map(CATEGORIES.map((c) => [c.id, c]));

export function getTag(id: string): TagDefinition | undefined {
  return tagById.get(id);
}

export function isKnownTagId(id: string): boolean {
  return tagById.has(id);
}

export function getCategory(id: string): CategoryDefinition | undefined {
  return categoryById.get(id);
}
