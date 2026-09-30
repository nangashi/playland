import { useState, type ReactNode } from "react";
import { Link, Outlet, redirect, useLocation, useNavigate, type LoaderFunctionArgs } from "react-router";
import { ApiError, endAdminSession, fetchAdminSession } from "../../api";

/** 親セッションがなければ PIN 入力へ。画面側の確認は案内のためで、権限はサーバーで検証する */
export async function requireParentSession({ request }: LoaderFunctionArgs) {
  const session = await fetchAdminSession(request.signal);
  if (!session.active) {
    const url = new URL(request.url);
    throw redirect(`/admin/login?next=${encodeURIComponent(url.pathname + url.search)}`);
  }
  return session;
}

/** 管理画面の共通の枠：目的の説明と、やれることごとのタブ。各タブの中身は Outlet に入る */
export function AdminLayout() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // 候補・場所の編集は一覧から開くので、一覧のタブを選択中として扱う
  const inList = pathname === "/admin" || pathname.startsWith("/admin/items/") || pathname.startsWith("/admin/places/");
  const tabs = [
    { to: "/admin", label: "候補の一覧", active: inList },
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
        <button type="button" className="text-button" onClick={logout}>
          親の確認を終える
        </button>
      </header>
      <h1 className="page-title admin-title">管理（親だけが使う画面）</h1>
      <p className="muted admin-lead">
        お出かけ候補の追加・内容の修正と、家族の設定（出発地など）を行います。ここでの変更は家族の画面にそのまま反映されます。
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
          <Link to="/admin">← 候補の一覧へ</Link>
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
