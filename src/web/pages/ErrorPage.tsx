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
      ? "みつからなかったよ"
      : status === 401 || status === 403
        ? "ログインが ひつようです。おうちのひとに きいてね"
        : "うまく よみこめなかったよ。すこし まってから もういちど ためしてね";

  return (
    <main className="page">
      <p className="empty">{message}</p>
      <Link to="/search" className="secondary-button">
        さがす がめんへ
      </Link>
    </main>
  );
}
