import { useEffect, useMemo, useState } from "react";
import { Link, redirect, useLoaderData, useSearchParams, type LoaderFunctionArgs } from "react-router";
import type { ItemCard as ItemCardData } from "../../domain/api";
import { favoritesLabel, purposeLabel } from "../../domain/labels";
import { favoritesFilters, purposes } from "../../domain/search";
import { ENTRANCES } from "../../domain/tags";
import { fetchItems, fetchProfiles, fetchSettings } from "../api";
import { FilterPanel } from "../components/FilterPanel";
import { ItemCard } from "../components/ItemCard";
import { getSelectedProfileId } from "../profile";
import {
  activeConditions,
  conditionLabel,
  MAX_PAGES,
  readSearchState,
  toApiParams,
  writeSearchState,
  type SearchState,
} from "../searchState";

export async function searchLoader({ request }: LoaderFunctionArgs) {
  const profileId = getSelectedProfileId();
  if (!profileId) throw redirect("/profiles");
  const state = readSearchState(new URL(request.url).searchParams);

  const [{ profiles }, settings] = await Promise.all([fetchProfiles(request.signal), fetchSettings(request.signal)]);
  const profile = profiles.find((p) => p.id === profileId);
  if (!profile) throw redirect("/profiles");

  // 「もっと みる」で読んだページも含めて取り直すことで、詳細から戻ったときに同じ一覧になる
  const results = await Promise.all(
    Array.from({ length: state.pages }, (_, i) => fetchItems(toApiParams(state, profile, i), request.signal)),
  );
  return {
    state,
    profile,
    profiles,
    settings,
    items: results.flatMap((r) => r.items),
    total: results[0]?.total ?? 0,
  };
}

export function SearchPage() {
  const data = useLoaderData<typeof searchLoader>();
  const { state } = data;
  const [, setSearchParams] = useSearchParams();
  const [items, setItems] = useState<ItemCardData[]>(data.items);
  useEffect(() => setItems(data.items), [data.items]);

  const profileNames = useMemo(
    () => new Map(data.profiles.map((p) => [p.id, p.display_name])),
    [data.profiles],
  );

  function update(next: Partial<SearchState>, options: { keepPages?: boolean } = {}) {
    const merged = { ...state, ...next, pages: options.keepPages ? (next.pages ?? state.pages) : 1 };
    setSearchParams(writeSearchState(merged), {
      replace: options.keepPages,
      preventScrollReset: options.keepPages,
    });
  }

  // 保存を外しても、その場ではカードを消さない（押した指の下から消えないように）
  function onSavedChange(itemId: string, saved: boolean) {
    setItems((current) =>
      current.map((item) => {
        if (item.id !== itemId) return item;
        const others = item.saved_by_profile_ids.filter((id) => id !== data.profile.id);
        return { ...item, saved_by_profile_ids: saved ? [...others, data.profile.id].sort() : others };
      }),
    );
  }

  function toggleEntrance(id: string) {
    const entrances = state.entrances.includes(id)
      ? state.entrances.filter((e) => e !== id)
      : [...state.entrances, id];
    update({ entrances });
  }

  const hasMore = items.length < data.total && state.pages < MAX_PAGES;
  const firstUnknown = items.findIndex((i) => i.unknown.length > 0);
  const firstFinished = items.findIndex((i) => i.finished);

  return (
    <main className="page">
      <header className="topbar">
        <h1 className="app-title">おでかけ みつけた</h1>
        <div className="topbar-actions">
          <Link to="/admin" className="parent-link">
            おうちのひと
          </Link>
          <Link to="/profiles" className="profile-chip" aria-label="さがす ひとを かえる">
            {data.profile.display_name}
          </Link>
        </div>
      </header>

      <nav className="segmented segmented-2" aria-label="いつ いく？">
        {purposes.map((p) => (
          <button
            key={p}
            type="button"
            className={p === state.purpose ? "is-active" : ""}
            aria-pressed={p === state.purpose}
            onClick={() => update({ purpose: p })}
          >
            {purposeLabel[p]}
          </button>
        ))}
      </nav>

      <div className="entrances" role="group" aria-label="なにを する？">
        {ENTRANCES.map((e) => {
          const active = state.entrances.includes(e.id);
          return (
            <button
              key={e.id}
              type="button"
              className={active ? "entrance is-active" : "entrance"}
              aria-pressed={active}
              onClick={() => toggleEntrance(e.id)}
            >
              <span className="entrance-icon" aria-hidden>
                {e.icon}
              </span>
              <span>{e.label}</span>
            </button>
          );
        })}
      </div>

      <nav className="segmented" aria-label="ほぞんした ばしょで しぼる">
        {favoritesFilters.map((f) => (
          <button
            key={f}
            type="button"
            className={f === state.favorites ? "is-active" : ""}
            aria-pressed={f === state.favorites}
            onClick={() => update({ favorites: f })}
          >
            {favoritesLabel[f]}
          </button>
        ))}
      </nav>

      <FilterPanel state={state} profile={data.profile} settings={data.settings} onChange={update} />

      <p className="result-count" aria-live="polite">
        {data.total} けん
      </p>

      {items.length === 0 ? (
        <EmptyResult state={state} onChange={update} />
      ) : (
        <div className="card-list">
          {items.map((item, index) => (
            <div key={item.id} className="card-slot">
              {index === firstUnknown && index !== firstFinished && (
                <h2 className="group-heading">わからない ところが ある ばしょ</h2>
              )}
              {index === firstFinished && <h2 className="group-heading">おわった イベント</h2>}
              <ItemCard
                item={item}
                purpose={state.purpose}
                profileId={data.profile.id}
                profileNames={profileNames}
                onSavedChange={onSavedChange}
              />
            </div>
          ))}
        </div>
      )}

      {hasMore && (
        <button type="button" className="more-button" onClick={() => update({ pages: state.pages + 1 }, { keepPages: true })}>
          もっと みる
        </button>
      )}
      {items.length < data.total && !hasMore && (
        <p className="result-note">ここまで {items.length} けんを ひょうじ しています</p>
      )}
    </main>
  );
}

/** 条件を勝手に外さず、どれを外すかを選べるようにする */
function EmptyResult({ state, onChange }: { state: SearchState; onChange: (next: Partial<SearchState>) => void }) {
  const conditions = activeConditions(state);
  return (
    <div className="empty">
      {conditions.length === 0 ? (
        <p>まだ ばしょが とうろく されていないよ</p>
      ) : (
        <>
          <p>この じょうけんに あう ばしょは みつからなかったよ。どれか はずしてみる？</p>
          <div className="chip-row">
            {conditions.map((c) => (
              <button key={c.key} type="button" className="secondary-button" onClick={() => onChange(c.reset)}>
                「{conditionLabel[c.key]}」を はずす
              </button>
            ))}
            {!state.includeUnknown && (
              <button type="button" className="secondary-button" onClick={() => onChange({ includeUnknown: true })}>
                わからない ものも みる
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
