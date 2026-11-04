import { describe, expect, it } from "vitest";
import {
  activeConditions,
  CLEARED,
  readSearchState,
  toApiParams,
  toMapApiParams,
  writeSearchState,
} from "../src/web/searchState";

describe("画面の検索条件（文字列検索）", () => {
  it("URL の q に保持し、読み直すと同じ条件になる（ほかの条件と並ぶ）", () => {
    const state = readSearchState(new URLSearchParams("cat=animals&rain=1&q=すいぞく"));
    expect(state).toMatchObject({ category: "animals", rainOk: true, query: "すいぞく" });
    const written = writeSearchState(state);
    expect(written.get("q")).toBe("すいぞく");
    expect(readSearchState(written)).toEqual(state);
  });

  it("前後の空白は除き、空なら URL・API に載せない", () => {
    expect(readSearchState(new URLSearchParams("q=%20%E3%80%80")).query).toBe("");
    expect(readSearchState(new URLSearchParams("q=%20a%20b%20")).query).toBe("a b");
    const empty = readSearchState(new URLSearchParams(""));
    expect(writeSearchState(empty).has("q")).toBe(false);
    expect(toApiParams(empty, 0).has("q")).toBe(false);
  });

  it("一覧・地図の API にも同じ文字列を渡す", () => {
    const state = readSearchState(new URLSearchParams("q=さんぷる みなと&cat=animals"));
    expect(toApiParams(state, 1).get("q")).toBe("さんぷる みなと");
    expect(toApiParams(state, 1).get("category")).toBe("animals");
    expect(toMapApiParams(state).get("q")).toBe("さんぷる みなと");
  });

  it("結果ゼロのときに外せる条件に入り、条件のクリアで外れる", () => {
    const state = readSearchState(new URLSearchParams("q=すいぞく"));
    expect(activeConditions(state)).toEqual([{ label: "すいぞく", reset: { query: "" } }]);
    expect({ ...state, ...CLEARED }.query).toBe("");
  });
});
