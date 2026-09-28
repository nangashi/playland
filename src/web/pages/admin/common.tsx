import { useState, type ReactNode } from "react";
import { Link, redirect, type LoaderFunctionArgs } from "react-router";
import { ApiError, fetchAdminSession } from "../../api";

/** 親セッションがなければ PIN 入力へ。画面側の確認は案内のためで、権限はサーバーで検証する */
export async function requireParentSession({ request }: LoaderFunctionArgs) {
  const session = await fetchAdminSession(request.signal);
  if (!session.active) {
    const url = new URL(request.url);
    throw redirect(`/admin/login?next=${encodeURIComponent(url.pathname + url.search)}`);
  }
  return session;
}

export function AdminFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="page admin">
      <nav className="admin-nav">
        <Link to="/admin">管理トップ</Link>
        <Link to="/search">一覧へ</Link>
      </nav>
      <h1 className="page-title admin-title">{title}</h1>
      {children}
    </main>
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
