import { useEffect, useRef, useState } from "react";
import { Link, useLoaderData, useRevalidator, type LoaderFunctionArgs } from "react-router";
import type { ItemCard as ItemCardData } from "../../domain/api";
import { ApiError, fetchRanking, saveRanking } from "../api";
import { ItemCard } from "../components/ItemCard";
import { MainTabs } from "../components/MainTabs";
import { useDragReorder } from "../components/useDragReorder";

export async function rankingLoader({ request }: LoaderFunctionArgs) {
  return fetchRanking(request.signal);
}

/** 並べ替えの対象（その場で保存を外した・興味なしにしたものは順位から外す） */
const isRanked = (item: ItemCardData) => item.saved && !item.hidden;

/**
 * 保存したものを家族で並べ替える。上位を見て行き先を選べるように。
 * 押した直後に並びを変え、失敗したら元に戻して知らせる。
 */
export function RankingPage() {
  const data = useLoaderData<typeof rankingLoader>();
  const revalidator = useRevalidator();
  const [items, setItems] = useState<ItemCardData[]>(data.items);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  useEffect(() => setItems(data.items), [data.items]);
  // キーボードで動かした行は DOM 上で移動するので、つまみにフォーカスを戻す
  const refocus = useRef<string | null>(null);
  useEffect(() => {
    if (!refocus.current) return;
    document.querySelector<HTMLElement>(`[data-handle="${CSS.escape(refocus.current)}"]`)?.focus();
    refocus.current = null;
  }, [items]);

  // 保存・興味なしを変えても、その場ではカードを消さない（押した場所から消えないように）
  function patchItem(itemId: string, change: Partial<ItemCardData>) {
    setItems((current) => current.map((item) => (item.id === itemId ? { ...item, ...change } : item)));
  }

  const rankedIds = items.filter(isRanked).map((i) => i.id);
  const { drag, rowRef, handleProps, offsetOf } = useDragReorder({
    ids: rankedIds,
    disabled: pending,
    onDrop: (id, target) => void moveTo(id, target),
  });

  async function moveTo(itemId: string, target: number) {
    if (pending) return;
    const ranked = items.filter(isRanked);
    const from = ranked.findIndex((i) => i.id === itemId);
    if (from < 0 || target < 0 || target >= ranked.length || target === from) return;

    const reordered = [...ranked];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(target, 0, moved!);
    // 順位から外れたカードは表示位置をそのままにする
    let next = 0;
    const nextItems = items.map((item) => (isRanked(item) ? reordered[next++]! : item));

    const previous = items;
    setItems(nextItems);
    setPending(true);
    setMessage({ text: `${moved!.title}を${target + 1}位にしました`, error: false });
    try {
      await saveRanking(reordered.map((i) => i.id));
    } catch (e) {
      setItems(previous);
      if (e instanceof ApiError && e.isConflict) {
        setMessage({ text: "別の端末で保存が変わったため、最新の並びを読み直しました。もう一度操作してください。", error: true });
        revalidator.revalidate();
      } else {
        setMessage({ text: "並べ替えを保存できませんでした", error: true });
      }
    } finally {
      setPending(false);
    }
  }

  let rank = 0;
  const rankedCount = rankedIds.length;

  return (
    <main className="page">
      <header className="topbar">
        <h1 className="app-title">おでかけ候補</h1>
        <MainTabs />
        <Link to="/admin" className="topbar-link">
          管理
        </Link>
      </header>

      <p className="ranking-lead">保存したもの（★）を、右の ⠿ をつかんで行きたい順に並べ替えられます。</p>
      <p className={message?.error ? "ranking-message is-error" : "visually-hidden"} role="status" aria-live="polite">
        {message?.text}
      </p>

      {items.length === 0 ? (
        <div className="empty">
          <p>まだ保存したものがありません。「さがす」で☆を押すと、ここに並びます。</p>
          <Link to="/search" className="secondary-button">
            さがす
          </Link>
        </div>
      ) : (
        <ol className={drag ? "ranking-list is-dragging" : "ranking-list"}>
          {items.map((item) => {
            const ranked = isRanked(item);
            const index = ranked ? rank++ : -1;
            const offset = offsetOf(item.id);
            const classes = ["ranking-row", index >= 0 && index < 3 ? "is-top" : "", drag?.id === item.id ? "is-dragged" : ""];
            return (
              <li
                key={item.id}
                ref={ranked ? rowRef(item.id) : undefined}
                className={classes.filter(Boolean).join(" ")}
                style={offset !== 0 ? { transform: `translateY(${offset}px)` } : undefined}
              >
                <ItemCard
                  item={item}
                  onSavedChange={(id, saved) => patchItem(id, { saved })}
                  onHiddenChange={(id, hidden) => patchItem(id, { hidden })}
                  badge={
                    ranked ? (
                      <span className={`rank-badge rank-${index + 1}`}>
                        {index + 1}
                        <span className="visually-hidden">位</span>
                      </span>
                    ) : null
                  }
                />
                <div className="ranking-controls" role="group" aria-label={`${item.title}の順位`}>
                  {ranked ? (
                    <>
                      <button
                        type="button"
                        className="rank-button"
                        aria-label={`${item.title}をいちばん上へ`}
                        title="いちばん上へ"
                        disabled={index === 0}
                        onClick={() => moveTo(item.id, 0)}
                      >
                        <span aria-hidden>⤒</span>
                      </button>
                      <button
                        type="button"
                        className="drag-handle"
                        data-handle={item.id}
                        aria-label={`${item.title}（${index + 1}位）を並べ替え。上下の矢印キーで移動`}
                        title="つかんで上下に動かす"
                        disabled={rankedCount < 2}
                        onKeyDown={(e) => {
                          const target = e.key === "ArrowUp" ? index - 1 : e.key === "ArrowDown" ? index + 1 : null;
                          if (target === null) return;
                          e.preventDefault();
                          refocus.current = item.id;
                          void moveTo(item.id, target);
                        }}
                        {...handleProps(item.id)}
                      >
                        <span aria-hidden>⠿</span>
                      </button>
                    </>
                  ) : (
                    <span className="ranking-out">{item.hidden ? "興味なし" : "保存を解除"}</span>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </main>
  );
}
