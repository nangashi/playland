import { useState, type FormEvent } from "react";
import { Link, useLoaderData, useNavigate, type LoaderFunctionArgs } from "react-router";
import { createItem, endAdminSession, fetchAdminInbox, fetchAdminPlaces } from "../../api";
import { AdminFrame, requireParentSession, SaveMessage, useSave } from "./common";

export async function adminHomeLoader(args: LoaderFunctionArgs) {
  const session = await requireParentSession(args);
  const [{ places }, inbox] = await Promise.all([fetchAdminPlaces(args.request.signal), fetchAdminInbox(args.request.signal)]);
  return { session, places, inboxCount: inbox.entries.length };
}

export function AdminHomePage() {
  const { session, places, inboxCount } = useLoaderData<typeof adminHomeLoader>();
  const navigate = useNavigate();
  const { status, run } = useSave();
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [placeMode, setPlaceMode] = useState<"existing" | "new">("new");
  const [placeId, setPlaceId] = useState(places[0]?.id ?? "");
  const [newPlaceName, setNewPlaceName] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    let created: { id: string } | null = null;
    const ok = await run(async () => {
      created = await createItem({
        title,
        official_url: url || null,
        ...(placeMode === "existing" ? { place_id: placeId } : {}),
        ...(placeMode === "new" ? { new_place_name: newPlaceName } : {}),
      });
    });
    if (ok && created) navigate(`/admin/items/${encodeURIComponent((created as { id: string }).id)}`);
  }

  async function logout() {
    await endAdminSession().catch(() => undefined);
    navigate("/search");
  }

  return (
    <AdminFrame title="管理">
      <p className="muted">
        親の確認は {session.expires_at ? new Date(session.expires_at).toLocaleTimeString("ja-JP") : "-"} まで有効です。
      </p>
      <div className="admin-menu">
        <Link className={inboxCount > 0 ? "link-button" : "secondary-button"} to="/admin/inbox">
          承認待ち（{inboxCount} 件）
        </Link>
        <Link className="secondary-button" to="/admin/settings">
          家族の設定（出発地・自転車の上限）
        </Link>
        <button type="button" className="secondary-button" onClick={logout}>
          親の確認を終える
        </button>
      </div>

      <section className="section">
        <h2 className="section-title">候補を手動で追加</h2>
        <p className="muted">
          名前・URL・場所だけで追加できます。分からない項目は「未確認」のまま登録され、あとから編集できます。
          （イベントは次のフェーズで対応します）
        </p>
        <form className="form" onSubmit={submit}>
          <label>
            名前
            <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />
          </label>
          <label>
            公式ページの URL
            <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
          </label>
          <fieldset>
            <legend>場所</legend>
            <label className="check">
              <input type="radio" checked={placeMode === "existing"} onChange={() => setPlaceMode("existing")} />
              登録済みの場所
            </label>
            {placeMode === "existing" && (
              <select value={placeId} onChange={(e) => setPlaceId(e.target.value)}>
                {places.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
            <label className="check">
              <input type="radio" checked={placeMode === "new"} onChange={() => setPlaceMode("new")} />
              新しい場所
            </label>
            {placeMode === "new" && (
              <input value={newPlaceName} onChange={(e) => setNewPlaceName(e.target.value)} placeholder="場所の名前" required />
            )}
          </fieldset>
          <button
            type="submit"
            className="link-button"
            disabled={status.kind === "saving"}
          >
            追加して編集へ
          </button>
          <SaveMessage status={status} onReload={() => navigate(0)} />
        </form>
      </section>
    </AdminFrame>
  );
}
