import { useEffect, useState } from "react";
import type { PublicSettingsResponse } from "../../domain/api";
import { modeLabel, tripLabel } from "../../domain/labels";
import { transportModes, type TransportMode } from "../../domain/model";
import { MAX_QUERY_LENGTH } from "../../domain/search";
import { CATEGORIES } from "../../domain/tags";
import { DAY_TRIP_MAX_KM, tripKinds } from "../../domain/trip";
import { MINUTE_CHOICES, normalizeQueryInput, type SearchState } from "../searchState";

interface Props {
  state: SearchState;
  settings: PublicSettingsResponse;
  onChange: (next: Partial<SearchState>) => void;
}

/**
 * 絞り込み。「ことば（文字列検索）」「カテゴリ（何をするか・1 つ選ぶ）」「条件（重ねて絞る）」の 3 段。
 * どれも AND で重なる。
 */
export function FilterBar({ state, settings, onChange }: Props) {
  function toggleMode(mode: TransportMode) {
    onChange({ modes: state.modes.includes(mode) ? state.modes.filter((m) => m !== mode) : [...state.modes, mode] });
  }

  return (
    <section className="filters" aria-label="絞り込み">
      <QueryRow query={state.query} onChange={(query) => onChange({ query })} />

      <div className="filter-row">
        <span className="filter-label">カテゴリ</span>
        <div className="chip-wrap is-category" role="radiogroup" aria-label="カテゴリ">
          <button
            type="button"
            role="radio"
            aria-checked={state.category === null}
            className={state.category === null ? "chip is-active" : "chip"}
            onClick={() => onChange({ category: null })}
          >
            すべて
          </button>
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={state.category === c.id}
              className={state.category === c.id ? "chip is-active" : "chip"}
              onClick={() => onChange({ category: state.category === c.id ? null : c.id })}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="filter-row">
        <span className="filter-label">条件</span>
        <div className="chip-wrap">
          <button
            type="button"
            aria-pressed={state.saved}
            className={state.saved ? "chip is-active" : "chip"}
            onClick={() => onChange({ saved: !state.saved })}
          >
            ★ 保存済み
          </button>
          <button
            type="button"
            aria-pressed={state.rainOk}
            className={state.rainOk ? "chip is-active" : "chip"}
            onClick={() => onChange({ rainOk: !state.rainOk })}
          >
            雨の日でも遊べる
          </button>
          {transportModes.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={state.modes.includes(m)}
              className={state.modes.includes(m) ? "chip is-active" : "chip"}
              onClick={() => toggleMode(m)}
              title={m === "bicycle" ? `片道${settings.bicycle_max_minutes}分以内の場所だけ` : undefined}
            >
              {modeLabel[m]}
            </button>
          ))}
          <label className={state.maxMinutes !== null ? "select-chip is-active" : "select-chip"}>
            <span className="visually-hidden">片道の時間</span>
            <select
              value={state.maxMinutes ?? ""}
              onChange={(e) => onChange({ maxMinutes: e.target.value === "" ? null : Number(e.target.value) })}
            >
              <option value="">片道：指定なし</option>
              {MINUTE_CHOICES.map((m) => (
                <option key={m} value={m}>
                  {settings.origin_label}から{m}分以内
                </option>
              ))}
            </select>
          </label>
          {tripKinds.map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={state.trip === t}
              className={state.trip === t ? "chip is-active" : "chip"}
              onClick={() => onChange({ trip: state.trip === t ? null : t })}
              title={`${settings.origin_label}から直線で${DAY_TRIP_MAX_KM}km${t === "day_trip" ? "以内" : "より遠い"}場所`}
            >
              {tripLabel[t]}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

const QUERY_LABEL = "名前・読み・場所・住所でさがす";

/**
 * 文字列での絞り込み。入力のたびに一覧を取り直さないよう、確定（Enter・「さがす」）で URL に反映する。
 * 空にしたとき（消去ボタンを含む）はすぐに外す。
 */
function QueryRow({ query, onChange }: { query: string; onChange: (query: string) => void }) {
  const [draft, setDraft] = useState(query);
  // 戻る・条件をクリアなどで URL 側が変わったら入力欄も合わせる
  useEffect(() => setDraft(query), [query]);

  function commit(raw: string) {
    const next = normalizeQueryInput(raw);
    if (next !== query) onChange(next);
  }

  return (
    <form
      className="filter-row"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        commit(draft);
      }}
    >
      <label className="filter-label" htmlFor="filter-query">
        ことば
      </label>
      <div className="query-wrap">
        <input
          id="filter-query"
          type="search"
          enterKeyHint="search"
          className={query ? "query-input is-active" : "query-input"}
          value={draft}
          maxLength={MAX_QUERY_LENGTH}
          onChange={(e) => {
            setDraft(e.target.value);
            if (e.target.value.trim() === "") commit("");
          }}
          placeholder={QUERY_LABEL}
          aria-label={QUERY_LABEL}
        />
        <button type="submit" className="chip">
          さがす
        </button>
      </div>
    </form>
  );
}
