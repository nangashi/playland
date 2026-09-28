import { useState } from "react";
import { setFavorite } from "../api";

interface Props {
  itemId: string;
  profileId: string | null;
  saved: boolean;
  onChange?: (saved: boolean) => void;
  size?: "normal" | "large";
}

/**
 * 「いきたい」ボタン。押した直後に表示を変え、保存に失敗したら元に戻して知らせる。
 */
export function FavoriteButton({ itemId, profileId, saved, onChange, size = "normal" }: Props) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!profileId) return null;

  async function toggle() {
    if (!profileId || pending) return;
    const next = !saved;
    setPending(true);
    setFailed(false);
    onChange?.(next);
    try {
      await setFavorite(profileId, itemId, next);
    } catch {
      onChange?.(!next);
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={`fav fav-${size}`}>
      <button
        type="button"
        className={saved ? "fav-button is-saved" : "fav-button"}
        aria-pressed={saved}
        onClick={toggle}
        disabled={pending}
      >
        <span aria-hidden>{saved ? "★" : "☆"}</span> {saved ? "いきたい！" : "いきたい"}
      </button>
      {failed && (
        <p className="fav-error" role="alert">
          ほぞん できなかったよ。もういちど おしてね
        </p>
      )}
    </div>
  );
}
