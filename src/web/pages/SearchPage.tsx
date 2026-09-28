import { useEffect, useMemo, useState } from "react";
import { Link, redirect, useLoaderData, useSearchParams, type LoaderFunctionArgs } from "react-router";
import type { ItemCard as ItemCardData } from "../../domain/api";
import { favoritesLabel } from "../../domain/labels";
import { DEFAULT_PAGE_SIZE, favoritesFilters, type FavoritesFilter } from "../../domain/search";
import { fetchItems, fetchProfiles } from "../api";
import { ItemCard } from "../components/ItemCard";
import { getSelectedProfileId } from "../profile";

const MAX_PAGES = 20;

function readParams(params: URLSearchParams) {
  const f = params.get("favorites");
  const favorites: FavoritesFilter = favoritesFilters.includes(f as FavoritesFilter)
    ? (f as FavoritesFilter)
    : "all";
  const pages = Math.min(Math.max(Number.parseInt(params.get("pages") ?? "1", 10) || 1, 1), MAX_PAGES);
  return { favorites, pages };
}

export async function searchLoader({ request }: LoaderFunctionArgs) {
  const profileId = getSelectedProfileId();
  if (!profileId) throw redirect("/profiles");
  const { favorites, pages } = readParams(new URL(request.url).searchParams);

  // 「もっと みる」で読んだページも含めて取り直すことで、詳細から戻ったときに同じ一覧になる
  const [profiles, ...results] = await Promise.all([
    fetchProfiles(request.signal),
    ...Array.from({ length: pages }, (_, i) =>
      fetchItems(
        { favorites, profileId, limit: DEFAULT_PAGE_SIZE, offset: i * DEFAULT_PAGE_SIZE },
        request.signal,
      ),
    ),
  ]);
  const profile = profiles.profiles.find((p) => p.id === profileId);
  if (!profile) throw redirect("/profiles");
  return {
    favorites,
    pages,
    profile,
    profiles: profiles.profiles,
    items: results.flatMap((r) => r.items),
    total: results[0]?.total ?? 0,
  };
}

export function SearchPage() {
  const data = useLoaderData<typeof searchLoader>();
  const [, setSearchParams] = useSearchParams();
  const [items, setItems] = useState<ItemCardData[]>(data.items);
  useEffect(() => setItems(data.items), [data.items]);

  const profileNames = useMemo(
    () => new Map(data.profiles.map((p) => [p.id, p.display_name])),
    [data.profiles],
  );

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

  function selectFavorites(next: FavoritesFilter) {
    setSearchParams(next === "all" ? {} : { favorites: next });
  }

  function loadMore() {
    const next = new URLSearchParams();
    if (data.favorites !== "all") next.set("favorites", data.favorites);
    next.set("pages", String(data.pages + 1));
    setSearchParams(next, { replace: true, preventScrollReset: true });
  }

  const hasMore = items.length < data.total && data.pages < MAX_PAGES;

  return (
    <main className="page">
      <header className="topbar">
        <h1 className="app-title">おでかけ みつけた</h1>
        <Link to="/profiles" className="profile-chip" aria-label="さがす ひとを かえる">
          {data.profile.display_name}
        </Link>
      </header>

      <nav className="segmented" aria-label="ほぞんした ばしょで しぼる">
        {favoritesFilters.map((f) => (
          <button
            key={f}
            type="button"
            className={f === data.favorites ? "is-active" : ""}
            aria-pressed={f === data.favorites}
            onClick={() => selectFavorites(f)}
          >
            {favoritesLabel[f]}
          </button>
        ))}
      </nav>

      <p className="result-count" aria-live="polite">
        {data.total} けん
      </p>

      {items.length === 0 ? (
        <EmptyResult favorites={data.favorites} onReset={() => selectFavorites("all")} />
      ) : (
        <div className="card-list">
          {items.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              profileId={data.profile.id}
              profileNames={profileNames}
              onSavedChange={onSavedChange}
            />
          ))}
        </div>
      )}

      {hasMore && (
        <button type="button" className="more-button" onClick={loadMore}>
          もっと みる
        </button>
      )}
      {items.length < data.total && !hasMore && (
        <p className="result-note">ここまで {items.length} けんを ひょうじ しています</p>
      )}
    </main>
  );
}

/** 条件を勝手に外さず、変える条件を選べるようにする */
function EmptyResult({ favorites, onReset }: { favorites: FavoritesFilter; onReset: () => void }) {
  return (
    <div className="empty">
      {favorites === "all" ? (
        <p>まだ ばしょが とうろく されていないよ</p>
      ) : (
        <>
          <p>
            {favorites === "mine" ? "まだ「いきたい」に いれた ばしょは ないよ" : "かぞくの「いきたい」は まだ ないよ"}
          </p>
          <button type="button" className="secondary-button" onClick={onReset}>
            ぜんぶから さがす
          </button>
        </>
      )}
    </div>
  );
}
