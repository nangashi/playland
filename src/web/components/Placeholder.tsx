import type { ItemKind } from "../../domain/model";

/**
 * 写真がない候補の代替イラスト。実際の施設写真に見えないよう、
 * 単純な図形と「イラスト」の表示にする。
 */
export function Placeholder({ kind }: { kind: ItemKind }) {
  return (
    <div className={`placeholder placeholder-${kind}`} role="img" aria-label="しゃしんは まだ ありません">
      <svg viewBox="0 0 120 80" preserveAspectRatio="xMidYMax slice" aria-hidden>
        <circle cx="92" cy="22" r="10" className="ph-sun" />
        <path d="M0 80 L38 34 L62 62 L80 44 L120 80 Z" className="ph-hill" />
      </svg>
      <span className="placeholder-note">イラスト</span>
    </div>
  );
}
