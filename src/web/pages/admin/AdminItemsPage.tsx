import { useState } from "react";
import { Link, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { publishStatuses, type PublishStatus } from "../../../domain/model";
import { fetchAdminItems } from "../../api";
import { AdminFrame, requireParentSession } from "./common";

export async function adminItemsLoader(args: LoaderFunctionArgs) {
  await requireParentSession(args);
  return fetchAdminItems(args.request.signal);
}

const STATUS_LABEL: Record<PublishStatus, string> = { draft: "下書き", published: "公開", hidden: "非表示" };
const STATUS_TAG: Record<PublishStatus, string> = { draft: "tag tag-warn", published: "tag tag-ok", hidden: "tag tag-muted" };

export function AdminItemsPage() {
  const { items } = useLoaderData<typeof adminItemsLoader>();
  const [filter, setFilter] = useState<PublishStatus | null>(null);
  const [query, setQuery] = useState("");

  const counts = Object.fromEntries(publishStatuses.map((s) => [s, items.filter((i) => i.publish_status === s).length]));
  const q = query.trim();
  const shown = items.filter(
    (i) => (filter === null || i.publish_status === filter) && (q === "" || i.title.includes(q) || i.place_name?.includes(q)),
  );

  return (
    <AdminFrame title="候補の一覧">
      <p className="muted">
        登録済みの候補すべてです。名前を押すと内容を、場所名を押すと地図の位置・移動の目安を直せます。
        「下書き」（承認待ち）と「非表示」（見送ったものを含む）は家族の画面に出ません。
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
                {item.publish_status === "draft" && <Link to="/admin/inbox">承認待ちで公開・見送り</Link>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </AdminFrame>
  );
}
