import type { ProfileResponse, PublicSettingsResponse } from "../../domain/api";
import { modeIcon, modeLabel, rainFilterLabel } from "../../domain/labels";
import { transportModes, type TransportMode } from "../../domain/model";
import { rainFilters } from "../../domain/search";
import { MINUTE_CHOICES, type SearchState } from "../searchState";

interface Props {
  state: SearchState;
  profile: ProfileResponse;
  settings: PublicSettingsResponse;
  onChange: (next: Partial<SearchState>) => void;
}

/** 雨・年齢・移動・不明の扱い。子どもは開かなくても探せるよう、たたんでおく */
export function FilterPanel({ state, profile, settings, onChange }: Props) {
  const activeCount =
    (state.rain !== "any" ? 1 : 0) +
    (state.byAge ? 1 : 0) +
    (state.modes.length > 0 || state.maxMinutes !== null ? 1 : 0) +
    (state.includeUnknown ? 1 : 0);

  function toggleMode(mode: TransportMode) {
    const modes = state.modes.includes(mode) ? state.modes.filter((m) => m !== mode) : [...state.modes, mode];
    onChange({ modes });
  }

  return (
    <details className="filters" open={activeCount > 0}>
      <summary>
        しぼりこみ{activeCount > 0 && <span className="filter-count">{activeCount}</span>}
      </summary>

      <fieldset>
        <legend>あめの ひ</legend>
        <div className="chip-row">
          {rainFilters.map((r) => (
            <button
              key={r}
              type="button"
              className={state.rain === r ? "chip is-active" : "chip"}
              aria-pressed={state.rain === r}
              onClick={() => onChange({ rain: r })}
            >
              {rainFilterLabel[r]}
            </button>
          ))}
        </div>
      </fieldset>

      {profile.age_hint !== null && (
        <fieldset>
          <legend>ねんれい</legend>
          <label className="check">
            <input type="checkbox" checked={state.byAge} onChange={(e) => onChange({ byAge: e.target.checked })} />
            {profile.display_name}（{profile.age_hint}さい）が さんか できる
          </label>
        </fieldset>
      )}

      <fieldset>
        <legend>いきかた</legend>
        <div className="chip-row">
          {transportModes.map((m) => (
            <button
              key={m}
              type="button"
              className={state.modes.includes(m) ? "chip is-active" : "chip"}
              aria-pressed={state.modes.includes(m)}
              onClick={() => toggleMode(m)}
            >
              <span aria-hidden>{modeIcon[m]}</span> {modeLabel[m]}
            </button>
          ))}
        </div>
        <p className="hint">じてんしゃは かたみち {settings.bicycle_max_minutes}ぷん いないの ばしょ だけ</p>
      </fieldset>

      <fieldset>
        <legend>{settings.origin_label}から かたみち</legend>
        <div className="chip-row">
          <button
            type="button"
            className={state.maxMinutes === null ? "chip is-active" : "chip"}
            aria-pressed={state.maxMinutes === null}
            onClick={() => onChange({ maxMinutes: null })}
          >
            きにしない
          </button>
          {MINUTE_CHOICES.map((m) => (
            <button
              key={m}
              type="button"
              className={state.maxMinutes === m ? "chip is-active" : "chip"}
              aria-pressed={state.maxMinutes === m}
              onClick={() => onChange({ maxMinutes: m })}
            >
              {m}ぷん まで
            </button>
          ))}
        </div>
      </fieldset>

      <label className="check">
        <input
          type="checkbox"
          checked={state.includeUnknown}
          onChange={(e) => onChange({ includeUnknown: e.target.checked })}
        />
        わからない ものも みる（うしろに ならべるよ）
      </label>
    </details>
  );
}
