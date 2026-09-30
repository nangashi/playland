import { useState } from "react";
import { Link, useLoaderData, useRevalidator, type LoaderFunctionArgs } from "react-router";
import type { AdminItemSummary } from "../../../domain/api";
import { publishStatuses, type PublishStatus } from "../../../domain/model";
import { fetchAdminItems, patchItem } from "../../api";
import { AdminFrame, requireParentSession, SaveMessage, useSave } from "./common";

export async function adminItemsLoader(args: LoaderFunctionArgs) {
  const session = await requireParentSession(args);
  const { items } = await fetchAdminItems(args.request.signal);
  return { session, items };
}

const STATUS_LABEL: Record<PublishStatus, string> = { draft: "下書き", published: "公開", hidden: "非表示" };
const STATUS_TAG: Record<PublishStatus, string> = { draft: "tag tag-warn", published: "tag tag-ok", hidden: "tag tag-muted" };

export function AdminItemsPage() {
  const { session, items } = useLoaderData<typeof adminItemsLoader>();
  const revalidator = useRevalidator();
  const save = useSave();
  const [filter, setFilter] = useState<PublishStatus | null>(null);
  const [query, setQuery] = useState("");

  const counts = Object.fromEntries(publishStatuses.map((s) => [s, items.filter((i) => i.publish_status === s).length]));
  const q = query.trim();
  const shown = items.filter(
    (i) => (filter === null || i.publish_status === filter) && (q === "" || i.title.includes(q) || i.place_name?.includes(q)),
  );

  async function publish(item: AdminItemSummary) {
    if (await save.run(() => patchItem(item.id, { version: item.version, publish_status: "published" }))) {
      revalidator.revalidate();
    }
  }

  return (
    <AdminFrame title="候補の一覧">
      <p className="muted">
        登録済みの候補すべてです。名前を押すと内容を、場所名を押すと地図の位置・移動の目安を直せます。
        「下書き」「非表示」は家族の画面に出ません。
        {session.expires_at && (
          <> 親の確認は {new Date(session.expires_at).toLocaleTimeString("ja-JP")} まで有効です。</>
        )}
      </p>

      <div className="admin-list-tools">
        <div className="chip-wrap" role="radiogroup" aria-label="公開の状態">
          <button
            type="button"
            role="radio"
            aria-checked={filter === null}
            className={filter === null ? "chip is-active" : "chip"}
            onClick={() => setFilter(null)}
          >
            すべて {items.length}
          </button>
          {publishStatuses.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={filter === s}
              className={filter === s ? "chip is-active" : "chip"}
              onClick={() => setFilter(filter === s ? null : s)}
            >
              {STATUS_LABEL[s]} {counts[s]}
            </button>
          ))}
        </div>
        <input
          type="search"
          className="admin-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="名前・場所でさがす"
          aria-label="名前・場所でさがす"
        />
      </div>

      <SaveMessage status={save.status} onReload={revalidator.revalidate} />

      {items.length === 0 ? (
        <p className="muted">
          まだ候補がありません。<Link to="/admin/new">「候補を追加」タブ</Link>から追加できます。
        </p>
      ) : shown.length === 0 ? (
        <p className="muted">条件に合う候補がありません。</p>
      ) : (
        <ul className="admin-list">
          {shown.map((item) => (
            <li key={item.id} className="admin-row">
              <div className="admin-row-main">
                <span className={STATUS_TAG[item.publish_status]}>{STATUS_LABEL[item.publish_status]}</span>
                <Link to={`/admin/items/${encodeURIComponent(item.id)}`} className="admin-row-title">
                  {item.title}
                </Link>
              </div>
              <div className="admin-row-sub">
                {item.place_id ? (
                  <Link to={`/admin/places/${encodeURIComponent(item.place_id)}`}>{item.place_name ?? "場所"}</Link>
                ) : (
                  <span className="muted">場所なし</span>
                )}
                <span className="muted">更新 {new Date(item.updated_at).toLocaleDateString("ja-JP")}</span>
                {item.publish_status === "draft" && (
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={save.status.kind === "saving"}
                    onClick={() => publish(item)}
                  >
                    公開する
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </AdminFrame>
  );
}
