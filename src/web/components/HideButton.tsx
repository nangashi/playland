import { useState } from "react";
import { setHidden } from "../api";

interface Props {
  itemId: string;
  hidden: boolean;
  onChange: (hidden: boolean) => void;
  variant?: "icon" | "full";
}

/** 家族で「興味なし」にする。押した直後に表示を変え、失敗したら元に戻して知らせる */
export function HideButton({ itemId, hidden, onChange, variant = "icon" }: Props) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function toggle() {
    if (pending) return;
    const next = !hidden;
    setPending(true);
    setFailed(false);
    onChange(next);
    try {
      await setHidden(itemId, next);
    } catch {
      onChange(!next);
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  const label = hidden ? "興味なしを取り消す" : "興味なしにする";
  return (
    <span className={`save save-${variant}`}>
      <button
        type="button"
        className={hidden ? "hide-button is-hidden" : "hide-button"}
        aria-pressed={hidden}
        aria-label={label}
        title={label}
        onClick={toggle}
        disabled={pending}
      >
        <span aria-hidden>{hidden ? "↺" : "⊘"}</span>
        {variant === "full" && <span>{hidden ? "興味なしを取り消す" : "興味なし"}</span>}
      </button>
      {failed && (
        <span className="save-error" role="alert">
          変更できませんでした
        </span>
      )}
    </span>
  );
}
