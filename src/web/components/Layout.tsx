import { Outlet, ScrollRestoration, useNavigation } from "react-router";

export function Layout() {
  const navigation = useNavigation();
  return (
    <div className="app">
      {navigation.state === "loading" && <div className="loading-bar" aria-hidden />}
      <Outlet />
      {/* 詳細から戻ったときに一覧のスクロール位置を戻す */}
      <ScrollRestoration />
    </div>
  );
}
