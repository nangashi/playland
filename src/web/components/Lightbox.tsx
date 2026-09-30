import { useEffect, useRef } from "react";
import type { MediaInfo } from "../../domain/api";
import { mediaKindLabel } from "../../domain/labels";
import { safeExternalUrl } from "../../domain/links";

interface Props {
  media: MediaInfo[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}

/** 写真の拡大表示。説明・種類・出典を添え、前後の写真に移れる */
export function Lightbox({ media, index, onIndexChange, onClose }: Props) {
  const current = media[index];
  const closeRef = useRef<HTMLButtonElement>(null);
  const touchX = useRef<number | null>(null);
  const hasMany = media.length > 1;
  const prev = () => onIndexChange((index - 1 + media.length) % media.length);
  const next = () => onIndexChange((index + 1) % media.length);

  // 開いている間は背景をスクロールさせず、閉じるボタンにフォーカスを置く
  useEffect(() => {
    closeRef.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
    };
  }, []);

  // キー操作（最新の index を使うため、依存に index を入れて張り直す）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && hasMany) prev();
      else if (e.key === "ArrowRight" && hasMany) next();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // prev / next / onClose は index と media から決まる
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, media.length, hasMany]);

  if (!current) return null;
  const sourceUrl = safeExternalUrl(current.source_url);

  return (
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="写真の拡大表示"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onTouchStart={(e) => {
        touchX.current = e.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(e) => {
        const start = touchX.current;
        const end = e.changedTouches[0]?.clientX;
        touchX.current = null;
        if (!hasMany || start === null || end === undefined || Math.abs(end - start) < 50) return;
        if (end < start) next();
        else prev();
      }}
    >
      <button ref={closeRef} type="button" className="lightbox-close" onClick={onClose} aria-label="閉じる">
        ×
      </button>
      <figure className="lightbox-figure">
        <img src={`/media/${encodeURIComponent(current.id)}`} alt={current.caption ?? ""} />
        <figcaption className="lightbox-caption">
          {current.caption && <strong>{current.caption}</strong>}
          <span>
            {mediaKindLabel[current.kind]}
            {current.credit && (
              <>
                {"・出典："}
                {sourceUrl ? (
                  <a href={sourceUrl} target="_blank" rel="noopener noreferrer">
                    {current.credit}
                  </a>
                ) : (
                  current.credit
                )}
              </>
            )}
          </span>
          {hasMany && (
            <span className="lightbox-count">
              {index + 1} / {media.length}
            </span>
          )}
        </figcaption>
      </figure>
      {hasMany && (
        <>
          <button type="button" className="lightbox-nav is-prev" onClick={prev} aria-label="前の写真">
            ‹
          </button>
          <button type="button" className="lightbox-nav is-next" onClick={next} aria-label="次の写真">
            ›
          </button>
        </>
      )}
    </div>
  );
}
