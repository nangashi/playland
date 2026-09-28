import type { ItemKind, RainPolicy } from "./model";
import type { FavoritesFilter } from "./search";

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
