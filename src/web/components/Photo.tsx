import { useState } from "react";
import type { MediaRef } from "../../domain/api";
import { mediaKindLabel } from "../../domain/labels";
import { Placeholder } from "./Placeholder";

/** 写真があれば表示し、なければ（読み込めなければ）代替表示。写真の種類を添える */
export function Photo({ media, alt, showKind = true }: { media: MediaRef | null; alt: string; showKind?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (!media || failed) return <Placeholder />;
  return (
    <figure className="photo">
      <img src={`/media/${encodeURIComponent(media.id)}`} alt={alt} loading="lazy" onError={() => setFailed(true)} />
      {showKind && media.kind !== "venue" && <figcaption className="photo-kind">{mediaKindLabel[media.kind]}</figcaption>}
    </figure>
  );
}
