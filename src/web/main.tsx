import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, redirect } from "react-router";
import { RouterProvider } from "react-router/dom";
import { Layout } from "./components/Layout";
import { ErrorPage } from "./pages/ErrorPage";
import { ItemPage, itemLoader } from "./pages/ItemPage";
import { ProfilePage, profilesLoader } from "./pages/ProfilePage";
import { SearchPage, searchLoader } from "./pages/SearchPage";
import { getSelectedProfileId } from "./profile";
import "./styles.css";

const router = createBrowserRouter([
  {
    element: <Layout />,
    errorElement: <ErrorPage />,
    children: [
      { path: "/", loader: () => redirect(getSelectedProfileId() ? "/search" : "/profiles") },
      { path: "/profiles", element: <ProfilePage />, loader: profilesLoader },
      { path: "/search", element: <SearchPage />, loader: searchLoader },
      { path: "/items/:id", element: <ItemPage />, loader: itemLoader },
      { path: "*", element: <ErrorPage notFound /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
