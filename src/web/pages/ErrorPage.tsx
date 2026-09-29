import { isRouteErrorResponse, Link, useRouteError } from "react-router";
import { ApiError } from "../api";

export function ErrorPage({ notFound = false }: { notFound?: boolean }) {
  const error = useRouteError();
  const status = notFound
    ? 404
    : error instanceof ApiError
      ? error.status
      : isRouteErrorResponse(error)
        ? error.status
        : 0;

  const message =
    status === 404
      ? "ページが見つかりません。"
      : status === 401 || status === 403
        ? "ログインが必要です。"
        : "読み込めませんでした。時間をおいてもう一度お試しください。";

  return (
    <main className="page">
      <p className="empty">{message}</p>
      <p className="empty">
        <Link to="/search">一覧へ</Link>
      </p>
    </main>
  );
}
