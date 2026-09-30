import { useState, type ReactNode } from "react";
import { Link, Outlet, redirect, useLoaderData, useLocation, useNavigate, type LoaderFunctionArgs } from "react-router";
import { ApiError, endAdminSession, fetchAdminInbox, fetchAdminSession } from "../../api";

/** 親セッションがなければ PIN 入力へ。画面側の確認は案内のためで、権限はサーバーで検証する */
export async function requireParentSession({ request }: LoaderFunctionArgs) {
  const session = await fetchAdminSession(request.signal);
  if (!session.active) {
    const url = new URL(request.url);
    throw redirect(`/admin/login?next=${encodeURIComponent(url.pathname + url.search)}`);
  }
  return session;
}

/** タブに承認待ちの件数を出す。公開・見送りのあとは再読み込みで件数も更新される */
export async function adminLayoutLoader(args: LoaderFunctionArgs) {
  const session = await requireParentSession(args);
  const inbox = await fetchAdminInbox(args.request.signal);
  return { session, inboxCount: inbox.entries.length };
}

/** 管理画面の共通の枠：目的の説明と、やれることごとのタブ。各タブの中身は Outlet に入る */
export function AdminLayout() {
  const { session, inboxCount } = useLoaderData<typeof adminLayoutLoader>();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // 候補・場所の編集は一覧から開くので、一覧のタブを選択中として扱う
  const inList = pathname.startsWith("/admin/items") || pathname.startsWith("/admin/places/");
  const tabs = [
    { to: "/admin/inbox", label: "承認待ち", count: inboxCount, active: pathname === "/admin/inbox" },
    { to: "/admin/items", label: "候補の一覧", active: inList },
    { to: "/admin/new", label: "候補を追加", active: pathname === "/admin/new" },
    { to: "/admin/settings", label: "家族の設定", active: pathname === "/admin/settings" },
  ];

  async function logout() {
    await endAdminSession().catch(() => undefined);
    navigate("/search");
  }

  return (
    <main className="page admin">
      <header className="admin-header">
        <Link to="/search" className="topbar-link">
          ← 家族の画面へ
        </Link>
        <span className="admin-session">
          {session.expires_at && (
            <span className="muted">{new Date(session.expires_at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })} まで有効</span>
          )}
          <button type="button" className="text-button" onClick={logout}>
            親の確認を終える
          </button>
        </span>
      </header>
      <h1 className="page-title admin-title">管理（親だけが使う画面）</h1>
      <p className="muted admin-lead">
        集めた候補の公開・見送り、候補の追加・内容の修正、家族の設定（出発地など）を行います。ここでの変更は家族の画面にそのまま反映されます。
      </p>
      <nav className="admin-tabs" aria-label="管理のメニュー">
        {tabs.map((t) => (
          <Link
            key={t.to}
            to={t.to}
            className={t.active ? "admin-tab is-active" : "admin-tab"}
            aria-current={t.active ? "page" : undefined}
          >
            {t.label}
            {t.count !== undefined && (
              <span className={t.count > 0 ? "admin-tab-count is-alert" : "admin-tab-count"}>{t.count}</span>
            )}
          </Link>
        ))}
      </nav>
      <Outlet />
    </main>
  );
}

/** タブの中の 1 画面。見出しと、必要なら一覧へ戻るリンク */
export function AdminFrame({ title, back, children }: { title: string; back?: boolean; children: ReactNode }) {
  return (
    <>
      {back && (
        <p className="admin-back">
          <Link to="/admin/items">← 候補の一覧へ</Link>
        </p>
      )}
      <h2 className="section-title admin-section-title">{title}</h2>
      {children}
    </>
  );
}

export type SaveStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "conflict" }
  | { kind: "error"; message: string };

/** 保存の成功・失敗・競合を必ず画面に出す */
export function useSave() {
  const [status, setStatus] = useState<SaveStatus>({ kind: "idle" });
  async function run(action: () => Promise<unknown>): Promise<boolean> {
    setStatus({ kind: "saving" });
    try {
      await action();
      setStatus({ kind: "saved" });
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.isConflict) setStatus({ kind: "conflict" });
      else if (err instanceof ApiError && err.status === 401) {
        setStatus({ kind: "error", message: "親の確認が切れました。PIN を入れ直してください" });
      } else if (err instanceof ApiError && err.status === 400) {
        setStatus({ kind: "error", message: "入力内容を確認してください（矛盾する値や形式の誤りがあります）" });
      } else setStatus({ kind: "error", message: "保存できませんでした。通信状態を確認してください" });
      return false;
    }
  }
  return { status, run };
}

export function SaveMessage({ status, onReload }: { status: SaveStatus; onReload: () => void }) {
  switch (status.kind) {
    case "idle":
      return null;
    case "saving":
      return <p className="save-status">保存しています…</p>;
    case "saved":
      return <p className="save-status is-ok" role="status">保存しました</p>;
    case "conflict":
      return (
        <div className="save-status is-error" role="alert">
          <p>他の端末で先に変更されたため、保存しませんでした。最新の内容を読み込んでから、もう一度編集してください。</p>
          <button type="button" className="secondary-button" onClick={onReload}>
            最新を読み込む（入力中の変更は破棄）
          </button>
        </div>
      );
    case "error":
      return <p className="save-status is-error" role="alert">{status.message}</p>;
  }
}

/** 空欄は null（未確認）。0 と未入力を混同しない */
export function numberOrNull(v: string): number | null {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function numberField(v: number | null | undefined): string {
  return v === null || v === undefined ? "" : String(v);
}
