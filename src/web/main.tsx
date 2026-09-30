import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, redirect } from "react-router";
import { RouterProvider } from "react-router/dom";
import { Layout } from "./components/Layout";
import { AdminInboxPage, adminInboxLoader } from "./pages/admin/AdminInboxPage";
import { AdminItemPage, adminItemLoader } from "./pages/admin/AdminItemPage";
import { AdminItemsPage, adminItemsLoader } from "./pages/admin/AdminItemsPage";
import { AdminLoginPage } from "./pages/admin/AdminLoginPage";
import { AdminNewItemPage, adminNewItemLoader } from "./pages/admin/AdminNewItemPage";
import { AdminPlacePage, adminPlaceLoader } from "./pages/admin/AdminPlacePage";
import { AdminSettingsPage, adminSettingsLoader } from "./pages/admin/AdminSettingsPage";
import { AdminLayout, adminLayoutLoader } from "./pages/admin/common";
import { ErrorPage } from "./pages/ErrorPage";
import { ItemPage, itemLoader } from "./pages/ItemPage";
import { RankingPage, rankingLoader } from "./pages/RankingPage";
import { SearchPage, searchLoader } from "./pages/SearchPage";
import "./styles.css";

const router = createBrowserRouter([
  {
    element: <Layout />,
    errorElement: <ErrorPage />,
    children: [
      { path: "/", loader: () => redirect("/search") },
      // 以前のプロフィール選択画面の URL
      { path: "/profiles", loader: () => redirect("/search") },
      { path: "/search", element: <SearchPage />, loader: searchLoader },
      { path: "/ranking", element: <RankingPage />, loader: rankingLoader },
      { path: "/items/:id", element: <ItemPage />, loader: itemLoader },
      { path: "/admin/login", element: <AdminLoginPage /> },
      {
        // 管理画面はタブ（承認待ち／候補の一覧／候補を追加／家族の設定）で切り替える。開いたら承認待ちから
        path: "/admin",
        element: <AdminLayout />,
        loader: adminLayoutLoader,
        children: [
          { index: true, loader: () => redirect("/admin/inbox") },
          { path: "inbox", element: <AdminInboxPage />, loader: adminInboxLoader },
          { path: "items", element: <AdminItemsPage />, loader: adminItemsLoader },
          { path: "new", element: <AdminNewItemPage />, loader: adminNewItemLoader },
          { path: "items/:id", element: <AdminItemPage />, loader: adminItemLoader },
          { path: "places/:id", element: <AdminPlacePage />, loader: adminPlaceLoader },
          { path: "settings", element: <AdminSettingsPage />, loader: adminSettingsLoader },
        ],
      },
      { path: "*", element: <ErrorPage notFound /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);

// ホーム画面から開いたときのオフライン案内（public/sw.js）。開発中は Vite の配信と干渉させない
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err: unknown) => console.error("service worker", err));
  });
}
