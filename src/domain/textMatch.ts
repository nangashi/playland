/**
 * 画面での文字列検索（表記ゆれの吸収）。
 * 全角・半角、大文字・小文字、カタカナ・ひらがな、空白・記号の有無の違いを同じに扱う。
 * 読み（ひらがな）を検索対象に含めれば、漢字の名前もかなで探せる。
 */

/** カタカナ（ァ〜ヶ、ヽヾ）をひらがなに */
function katakanaToHiragana(s: string): string {
  return s.replace(/[ァ-ヶヽヾ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

/**
 * 検索用に正規化する: NFKC → 小文字化 → カタカナをひらがなに → 空白・記号類を除去。
 * 長音「ー」は文字（\p{L}）として残す（「ぱーく」と「ぱく」を区別する）。
 */
export function normalizeForSearch(s: string): string {
  return katakanaToHiragana(s.normalize("NFKC").toLowerCase()).replace(/[^\p{L}\p{N}\p{M}]/gu, "");
}

/** 検索語を空白（全角を含む）で分け、それぞれ正規化する。正規化して空になった語は捨てる */
export function searchTerms(query: string): string[] {
  return query
    .normalize("NFKC")
    .split(/\s+/u)
    .map(normalizeForSearch)
    .filter((t) => t !== "");
}

/**
 * すべての語が、どれかの項目に部分一致するか（複数語は AND）。
 * 語が 0 個なら常に一致。項目ごとに判定する（項目をまたいだ連結では一致させない）。
 */
export function matchesAllTerms(fields: readonly (string | null | undefined)[], terms: readonly string[]): boolean {
  if (terms.length === 0) return true;
  const normalized = fields.flatMap((f) => (f ? [normalizeForSearch(f)] : []));
  return terms.every((term) => normalized.some((f) => f.includes(term)));
}

/** 検索文字列で判定する（searchTerms + matchesAllTerms） */
export function matchesQuery(fields: readonly (string | null | undefined)[], query: string): boolean {
  return matchesAllTerms(fields, searchTerms(query));
}

/** 読み（ひらがな）として受け付ける文字: ひらがな・ゝゞ・長音・空白 */
const READING_RE = /^[ぁ-ゖゝゞー\s]+$/u;
export const READING_ERROR = "読みはひらがなで入力してください";

export function isReading(s: string): boolean {
  return READING_RE.test(s);
}
