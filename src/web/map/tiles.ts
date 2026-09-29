/**
 * 背景地図の設定。地図表示・座標取得・施設情報・経路は別々の依存先として扱い、
 * 背景地図はここだけを差し替えれば変えられるようにする。
 * 地理院タイル（標準地図）: https://maps.gsi.go.jp/development/ichiran.html
 * 出典の表示が利用条件。
 */
export const BASE_TILES = {
  url: "https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png",
  attribution:
    '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener noreferrer">地理院タイル</a>',
  minZoom: 5,
  maxZoom: 18,
} as const;

/** 候補がないときの初期表示（日本全体）。家族の自宅位置は子ども向けの画面に使わない */
export const FALLBACK_VIEW = { center: [36.5, 138.0] as [number, number], zoom: 5 };
