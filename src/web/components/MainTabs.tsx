import { NavLink } from "react-router";

/** 家族向け画面の切り替え（さがす／ランキング） */
export function MainTabs() {
  return (
    <nav className="main-tabs" aria-label="画面の切り替え">
      <NavLink to="/search" className={({ isActive }) => (isActive ? "main-tab is-active" : "main-tab")}>
        さがす
      </NavLink>
      <NavLink to="/ranking" className={({ isActive }) => (isActive ? "main-tab is-active" : "main-tab")}>
        ランキング
      </NavLink>
    </nav>
  );
}
