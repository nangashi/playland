import { useState, type FormEvent } from "react";
import { Link, useLoaderData, useNavigate, type LoaderFunctionArgs } from "react-router";
import type { ItemKind } from "../../../domain/model";
import { createItem, endAdminSession, fetchAdminPlaces } from "../../api";
import { AdminFrame, requireParentSession, SaveMessage, useSave } from "./common";

export async function adminHomeLoader(args: LoaderFunctionArgs) {
  const session = await requireParentSession(args);
  const { places } = await fetchAdminPlaces(args.request.signal);
  return { session, places };
}

export function AdminHomePage() {
  const { session, places } = useLoaderData<typeof adminHomeLoader>();
  const navigate = useNavigate();
  const { status, run } = useSave();
  const [kind, setKind] = useState<ItemKind>("event");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [placeMode, setPlaceMode] = useState<"none" | "existing" | "new">("none");
  const [placeId, setPlaceId] = useState(places[0]?.id ?? "");
  const [newPlaceName, setNewPlaceName] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    let created: { id: string } | null = null;
    const ok = await run(async () => {
      created = await createItem({
        kind,
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
          URL とタイトルだけで追加できます。分からない項目は「未確認」のまま登録され、あとから編集できます。
        </p>
        <form className="form" onSubmit={submit}>
          <label>
            種類
            <select value={kind} onChange={(e) => setKind(e.target.value as ItemKind)}>
              <option value="event">イベント（開催日がある）</option>
              <option value="spot">常設スポット（施設そのもの）</option>
            </select>
          </label>
          <label>
            正式名称
            <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />
          </label>
          <label>
            公式ページの URL
            <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
          </label>
          <fieldset>
            <legend>場所</legend>
            {kind === "event" && (
              <label className="check">
                <input type="radio" checked={placeMode === "none"} onChange={() => setPlaceMode("none")} />
                会場は未確認
              </label>
            )}
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
            disabled={status.kind === "saving" || (kind === "spot" && placeMode === "none")}
          >
            追加して編集へ
          </button>
          <SaveMessage status={status} onReload={() => navigate(0)} />
        </form>
      </section>
    </AdminFrame>
  );
}
