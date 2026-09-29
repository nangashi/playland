import type { PublicSettingsResponse } from "../../domain/api";
import { modeLabel } from "../../domain/labels";
import { transportModes, type TransportMode } from "../../domain/model";
import { CATEGORIES } from "../../domain/tags";
import { AGE_CHOICES, MINUTE_CHOICES, type SearchState } from "../searchState";

interface Props {
  state: SearchState;
  settings: PublicSettingsResponse;
  onChange: (next: Partial<SearchState>) => void;
}

/**
 * 絞り込み。「カテゴリ（何をするか・1 つ選ぶ）」と「条件（重ねて絞る）」の 2 段。
 */
export function FilterBar({ state, settings, onChange }: Props) {
  function toggleMode(mode: TransportMode) {
    onChange({ modes: state.modes.includes(mode) ? state.modes.filter((m) => m !== mode) : [...state.modes, mode] });
  }

  return (
    <section className="filters" aria-label="絞り込み">
      <div className="filter-row">
        <span className="filter-label">カテゴリ</span>
        <div className="chip-wrap" role="radiogroup" aria-label="カテゴリ">
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
          <label className={state.age !== null ? "select-chip is-active" : "select-chip"}>
            <span className="visually-hidden">参加できる年齢</span>
            <select
              value={state.age ?? ""}
              onChange={(e) => onChange({ age: e.target.value === "" ? null : Number(e.target.value) })}
            >
              <option value="">年齢：指定なし</option>
              {AGE_CHOICES.map((a) => (
                <option key={a} value={a}>
                  {a}歳が参加できる
                </option>
              ))}
            </select>
          </label>
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
        </div>
      </div>
    </section>
  );
}
