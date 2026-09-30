/** 保存できる画像形式（media.content_type の制約と同じ） */
export const IMAGE_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type ImageContentType = (typeof IMAGE_CONTENT_TYPES)[number];

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function ascii(b: Uint8Array, from: number, to: number) {
  return String.fromCharCode(...b.slice(from, to));
}

const SIGNATURES: { type: ImageContentType; test: (b: Uint8Array) => boolean }[] = [
  { type: "image/jpeg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: "image/png", test: (b) => [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v) },
  { type: "image/webp", test: (b) => ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP" },
];

/** 実際のファイル内容から形式を判定する（申告された Content-Type は信用しない） */
export function sniffImageType(bytes: Uint8Array): ImageContentType | null {
  return SIGNATURES.find((s) => s.test(bytes))?.type ?? null;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // 型定義の差（DOM と Workers）を避けるため、ArrayBuffer を持つコピーを渡す
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
