import { useState } from "react";
import { setBookmark } from "../api";

interface Props {
  itemId: string;
  saved: boolean;
  onChange: (saved: boolean) => void;
  /** icon=カード用の星だけ / full=詳細用のボタン */
  variant?: "icon" | "full";
}

/** 家族で共有する保存。押した直後に表示を変え、失敗したら元に戻して知らせる */
export function SaveButton({ itemId, saved, onChange, variant = "icon" }: Props) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function toggle() {
    if (pending) return;
    const next = !saved;
    setPending(true);
    setFailed(false);
    onChange(next);
    try {
      await setBookmark(itemId, next);
    } catch {
      onChange(!next);
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <span className={`save save-${variant}`}>
      <button
        type="button"
        className={saved ? "save-button is-saved" : "save-button"}
        aria-pressed={saved}
        aria-label={saved ? "保存を解除" : "保存する"}
        title={saved ? "保存を解除" : "保存する"}
        onClick={toggle}
        disabled={pending}
      >
        <span aria-hidden>{saved ? "★" : "☆"}</span>
        {variant === "full" && <span>{saved ? "保存済み" : "保存する"}</span>}
      </button>
      {failed && (
        <span className="save-error" role="alert">
          保存できませんでした
        </span>
      )}
    </span>
  );
}
