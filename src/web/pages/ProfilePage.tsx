import { useLoaderData, useNavigate, type LoaderFunctionArgs } from "react-router";
import { fetchProfiles } from "../api";
import { getSelectedProfileId, setSelectedProfileId } from "../profile";

export async function profilesLoader({ request }: LoaderFunctionArgs) {
  const { profiles } = await fetchProfiles(request.signal);
  return { profiles, selectedId: getSelectedProfileId() };
}

export function ProfilePage() {
  const { profiles, selectedId } = useLoaderData<typeof profilesLoader>();
  const navigate = useNavigate();

  function choose(id: string) {
    setSelectedProfileId(id);
    navigate("/search", { replace: true });
  }

  return (
    <main className="page">
      <h1 className="page-title">だれが さがす？</h1>
      {profiles.length === 0 ? (
        <p className="empty">プロフィールが まだ ありません。おうちのひとに きいてね。</p>
      ) : (
        <ul className="profile-list">
          {profiles.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className={p.id === selectedId ? "profile-button is-active" : "profile-button"}
                onClick={() => choose(p.id)}
              >
                {p.display_name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
