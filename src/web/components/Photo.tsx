import { useState } from "react";
import type { MediaRef } from "../../domain/api";
import { mediaKindLabel } from "../../domain/labels";
import type { ItemKind } from "../../domain/model";
import { Placeholder } from "./Placeholder";

/** 写真があれば表示し、なければ（読み込めなければ）代替イラスト。写真の種類を必ず添える */
export function Photo({ media, kind, alt }: { media: MediaRef | null; kind: ItemKind; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (!media || failed) return <Placeholder kind={kind} />;
  return (
    <figure className="photo">
      <img src={`/media/${encodeURIComponent(media.id)}`} alt={alt} loading="lazy" onError={() => setFailed(true)} />
      <figcaption className="photo-kind">{mediaKindLabel[media.kind]}</figcaption>
    </figure>
  );
}
