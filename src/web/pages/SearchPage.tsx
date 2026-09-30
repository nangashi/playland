import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { Link, useLoaderData, useSearchParams, type LoaderFunctionArgs } from "react-router";
import type { ItemCard as ItemCardData, MapItemsResponse } from "../../domain/api";
import { fetchItems, fetchMapItems, fetchSettings } from "../api";
import { FilterBar } from "../components/FilterBar";
import { ItemCard } from "../components/ItemCard";
import { MainTabs } from "../components/MainTabs";
import {
  activeConditions,
  CLEARED,
  MAX_PAGES,
  mapViewKey,
  readSearchState,
  toApiParams,
  toMapApiParams,
  writeSearchState,
  type SearchState,
} from "../searchState";

// 地図のライブラリは地図を開いたときだけ読み込む
const MapView = lazy(() => import("../map/MapView").then((m) => ({ default: m.MapView })));

export async function searchLoader({ request }: LoaderFunctionArgs) {
  const state = readSearchState(new URL(request.url).searchParams);
  const settings = await fetchSettings(request.signal);
  if (state.view === "map") {
    const map = await fetchMapItems(toMapApiParams(state), request.signal);
    return { state, settings, items: [] as ItemCardData[], total: map.total, map };
  }
  // 「もっと見る」で読んだページも含めて取り直すことで、詳細から戻ったときに同じ一覧になる
  const results = await Promise.all(
    Array.from({ length: state.pages }, (_, i) => fetchItems(toApiParams(state, i), request.signal)),
  );
  return {
    state,
    settings,
    items: results.flatMap((r) => r.items),
    total: results[0]?.total ?? 0,
    map: null as MapItemsResponse | null,
  };
}

export function SearchPage() {
  const data = useLoaderData<typeof searchLoader>();
  const { state } = data;
  const [, setSearchParams] = useSearchParams();
  const [items, setItems] = useState<ItemCardData[]>(data.items);
  const [map, setMap] = useState(data.map);
  useEffect(() => setItems(data.items), [data.items]);
  useEffect(() => setMap(data.map), [data.map]);

  function update(next: Partial<SearchState>, options: { keepPages?: boolean } = {}) {
    const merged = { ...state, ...next, pages: options.keepPages ? (next.pages ?? state.pages) : 1 };
    setSearchParams(writeSearchState(merged), { replace: options.keepPages, preventScrollReset: options.keepPages });
  }

  // 保存・興味なしを変えても、その場ではカードを消さない（押した場所から消えないように）
  function patchItem(itemId: string, change: Partial<ItemCardData>) {
    const patch = (item: ItemCardData) => (item.id === itemId ? { ...item, ...change } : item);
    setItems((current) => current.map(patch));
    setMap((current) =>
      current ? { ...current, venues: current.venues.map((v) => ({ ...v, items: v.items.map(patch) })) } : current,
    );
  }
  const onSavedChange = (itemId: string, saved: boolean) => patchItem(itemId, { saved });
  const onHiddenChange = (itemId: string, hidden: boolean) => patchItem(itemId, { hidden });

  const conditions = activeConditions(state);
  const hasMore = items.length < data.total && state.pages < MAX_PAGES;
  const firstUnknown = items.findIndex((i) => !i.hidden && i.unknown.length > 0);
  const firstHidden = items.findIndex((i) => i.hidden);

  return (
    <main className="page">
      <header className="topbar">
        <h1 className="app-title">おでかけ候補</h1>
        <MainTabs />
        <Link to="/admin" className="topbar-link">
          管理
        </Link>
      </header>

      <FilterBar state={state} settings={data.settings} onChange={update} />

      <div className="result-bar">
        <div className="result-count">
          <span aria-live="polite">
            <strong>{data.total}</strong> 件
          </span>
          <label className="inline-check" title="雨・移動・距離などの情報が未登録で、条件に合うか分からない候補も後ろに表示します">
            <input
              type="checkbox"
              checked={state.includeUnknown}
              onChange={(e) => update({ includeUnknown: e.target.checked })}
            />
            不明も表示
          </label>
          <label className="inline-check" title="家族で「興味なし」にした候補も後ろに表示します">
            <input
              type="checkbox"
              checked={state.includeHidden}
              onChange={(e) => update({ includeHidden: e.target.checked })}
            />
            興味なしも表示
          </label>
          {(conditions.length > 0 || state.includeUnknown || state.includeHidden) && (
            <button type="button" className="text-button" onClick={() => update(CLEARED)}>
              条件をクリア
            </button>
          )}
        </div>
        <div className="view-toggle" role="group" aria-label="表示形式">
          <button
            type="button"
            className={state.view === "list" ? "is-active" : ""}
            aria-pressed={state.view === "list"}
            onClick={() => update({ view: "list" })}
          >
            リスト
          </button>
          <button
            type="button"
            className={state.view === "map" ? "is-active" : ""}
            aria-pressed={state.view === "map"}
            onClick={() => update({ view: "map" })}
          >
            地図
          </button>
        </div>
      </div>

      {data.total === 0 ? (
        <EmptyResult state={state} onChange={update} />
      ) : state.view === "map" && map ? (
        <>
          <MapNotes map={map} onShowList={() => update({ view: "list" })} />
          <MapBoundary onShowList={() => update({ view: "list" })}>
            <Suspense fallback={<div className="map map-loading">地図を読み込んでいます…</div>}>
              <MapView
                venues={map.venues}
                viewKey={mapViewKey(state)}
                onSavedChange={onSavedChange}
                onHiddenChange={onHiddenChange}
              />
            </Suspense>
          </MapBoundary>
        </>
      ) : (
        <>
          <div className="card-list">
            {items.map((item, index) => (
              <div key={item.id} className="card-slot">
                {index === firstUnknown && <h2 className="group-heading">条件に合うか不明な候補</h2>}
                {index === firstHidden && <h2 className="group-heading">興味なしにした候補</h2>}
                <ItemCard item={item} onSavedChange={onSavedChange} onHiddenChange={onHiddenChange} />
              </div>
            ))}
          </div>
          {hasMore && (
            <button
              type="button"
              className="more-button"
              onClick={() => update({ pages: state.pages + 1 }, { keepPages: true })}
            >
              もっと見る（残り {data.total - items.length} 件）
            </button>
          )}
          {items.length < data.total && !hasMore && (
            <p className="result-note">{items.length} 件まで表示しています。条件を絞ってください。</p>
          )}
        </>
      )}
    </main>
  );
}

/** 地図に出せない候補・出さなかった場所を必ず知らせる（地図のために候補を消さない） */
function MapNotes({ map, onShowList }: { map: MapItemsResponse; onShowList: () => void }) {
  if (map.unpositioned === 0 && map.omitted_venues === 0) return null;
  return (
    <div className="notice">
      {map.unpositioned > 0 && (
        <p>
          位置が未登録のため地図に表示できない候補が {map.unpositioned} 件あります。
          <button type="button" className="text-button" onClick={onShowList}>
            リストで見る
          </button>
        </p>
      )}
      {map.omitted_venues > 0 && (
        <p>
          地図には {map.max_markers} か所まで表示しています（残り {map.omitted_venues} か所）。条件を絞るか、リストで確認してください。
        </p>
      )}
    </div>
  );
}

/** 地図の読み込み・表示に失敗しても、一覧と保存は使えるようにする */
class MapBoundary extends Component<{ children: ReactNode; onShowList: () => void }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("map failed", error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="empty">
        <p>地図を表示できませんでした。</p>
        <button type="button" className="secondary-button" onClick={this.props.onShowList}>
          リストで見る
        </button>
      </div>
    );
  }
}

/** 条件を勝手に外さず、どれを外すかを選べるようにする */
function EmptyResult({ state, onChange }: { state: SearchState; onChange: (next: Partial<SearchState>) => void }) {
  const conditions = activeConditions(state);
  if (conditions.length === 0) return <p className="empty">まだ候補が登録されていません。</p>;
  return (
    <div className="empty">
      <p>条件に合う候補がありません。外す条件を選んでください。</p>
      <div className="chip-wrap is-centered">
        {conditions.map((c) => (
          <button key={c.label} type="button" className="chip" onClick={() => onChange(c.reset)}>
            「{c.label}」を外す
          </button>
        ))}
        {!state.includeUnknown && (
          <button type="button" className="chip" onClick={() => onChange({ includeUnknown: true })}>
            情報が不明なものも表示
          </button>
        )}
      </div>
    </div>
  );
}
