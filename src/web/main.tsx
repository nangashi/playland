import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, redirect } from "react-router";
import { RouterProvider } from "react-router/dom";
import { Layout } from "./components/Layout";
import { AdminHomePage, adminHomeLoader } from "./pages/admin/AdminHomePage";
import { AdminItemPage, adminItemLoader } from "./pages/admin/AdminItemPage";
import { AdminLoginPage } from "./pages/admin/AdminLoginPage";
import { AdminPlacePage, adminPlaceLoader } from "./pages/admin/AdminPlacePage";
import { AdminSettingsPage, adminSettingsLoader } from "./pages/admin/AdminSettingsPage";
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
      { path: "/admin", element: <AdminHomePage />, loader: adminHomeLoader },
      { path: "/admin/items/:id", element: <AdminItemPage />, loader: adminItemLoader },
      { path: "/admin/places/:id", element: <AdminPlacePage />, loader: adminPlaceLoader },
      { path: "/admin/settings", element: <AdminSettingsPage />, loader: adminSettingsLoader },
      { path: "*", element: <ErrorPage notFound /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
