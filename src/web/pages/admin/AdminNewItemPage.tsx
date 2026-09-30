import { useState, type FormEvent } from "react";
import { Link, useLoaderData, useNavigate, type LoaderFunctionArgs } from "react-router";
import { createItem, fetchAdminPlaces } from "../../api";
import { AdminFrame, requireParentSession, SaveMessage, useSave } from "./common";

export async function adminNewItemLoader(args: LoaderFunctionArgs) {
  await requireParentSession(args);
  const { places } = await fetchAdminPlaces(args.request.signal);
  return { places };
}

export function AdminNewItemPage() {
  const { places } = useLoaderData<typeof adminNewItemLoader>();
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

  return (
    <AdminFrame title="候補を追加">
      <p className="muted">
        追加のしかたは 2 通りあります。1 件ずつならこの画面で、まとめて集めるなら Claude Code に頼みます。
      </p>

      <section className="section">
        <h3 className="admin-subtitle">1 件ずつ追加する</h3>
        <p className="muted">
          名前・URL・場所だけで追加でき、すぐに家族の画面に出ます。分からない項目は「未確認」のまま登録され、あとから編集できます。
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
          <button type="submit" className="link-button" disabled={status.kind === "saving"}>
            追加して編集へ
          </button>
          <SaveMessage status={status} onReload={() => navigate(0)} />
        </form>
      </section>

      <section className="section admin-note">
        <h3 className="admin-subtitle">まとめて集めて追加する</h3>
        <ol>
          <li>Claude Code に「お出かけ先を集めて」「この URL を候補に追加して」と頼む</li>
          <li>
            集めた候補は下書き、写真は採用待ちとして<Link to="/admin/inbox">「承認待ち」タブ</Link>に入る
          </li>
          <li>承認待ちで内容と写真を確かめ、「公開する」か「見送る」を選ぶ（公開するまで家族の画面には出ません）</li>
        </ol>
      </section>
    </AdminFrame>
  );
}
