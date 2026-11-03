import { describe, expect, it } from "vitest";
import { isReading, matchesAllTerms, matchesQuery, normalizeForSearch, searchTerms } from "../src/domain/textMatch";

describe("normalizeForSearch（表記ゆれの吸収）", () => {
  it("全角・半角、大文字・小文字、カタカナ・ひらがなを同じにする", () => {
    expect(normalizeForSearch("ＡＢＣパーク")).toBe("abcぱーく");
    expect(normalizeForSearch("abcﾊﾟｰｸ")).toBe("abcぱーく");
    expect(normalizeForSearch("サンプル１２３")).toBe("さんぷる123");
    expect(normalizeForSearch("ヴァイオリン")).toBe("ゔぁいおりん");
  });

  it("空白・記号を除き、長音「ー」は残す", () => {
    expect(normalizeForSearch("サンプル森林公園 じゃぶじゃぶ池")).toBe("さんぷる森林公園じゃぶじゃぶ池");
    expect(normalizeForSearch("こども・科学館（本館）！")).toBe("こども科学館本館");
    expect(normalizeForSearch("みどり町1-2-3")).toBe("みどり町123");
    expect(normalizeForSearch("パーク")).not.toBe(normalizeForSearch("パク"));
  });
});

describe("searchTerms / matchesAllTerms", () => {
  it("全角を含む空白で語に分け、記号だけの語は捨てる", () => {
    expect(searchTerms("  サンプル　公園 ・ ")).toEqual(["さんぷる", "公園"]);
    expect(searchTerms("")).toEqual([]);
  });

  it("複数語は AND。どの項目に含まれてもよいが、項目をまたいだ連結では一致させない", () => {
    const fields = ["サンプル湾水族館", "さんぷるわんすいぞくかん", "サンプル市みなと町5"];
    expect(matchesQuery(fields, "水族館 みなと")).toBe(true);
    expect(matchesQuery(fields, "水族館 もり町")).toBe(false);
    expect(matchesQuery(["あい", "うえ"], "いう")).toBe(false);
    expect(matchesAllTerms(fields, [])).toBe(true);
    expect(matchesQuery([null, undefined, "公園"], "公園")).toBe(true);
  });

  it("読みで、漢字の名前をかな・カタカナで探せる", () => {
    const fields = ["サンプル湾水族館", "さんぷるわんすいぞくかん"];
    expect(matchesQuery(fields, "すいぞくかん")).toBe(true);
    expect(matchesQuery(fields, "スイゾクカン")).toBe(true);
    expect(matchesQuery(["サンプル湾水族館", null], "すいぞくかん")).toBe(false);
  });
});

describe("isReading", () => {
  it("ひらがな・長音・空白だけを読みとして受け付ける", () => {
    expect(isReading("さんぷる ぱーく")).toBe(true);
    expect(isReading("サンプル")).toBe(false);
    expect(isReading("公園")).toBe(false);
    expect(isReading("abc")).toBe(false);
  });
});
