import { lookup } from "node:dns/promises";
import { MAX_IMAGE_BYTES, sniffImageType, type ImageContentType } from "../../src/domain/image";
import { checkFetchUrl, isPublicAddress } from "../../src/ingest/netguard";

const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 20_000;

/** 名前解決の結果がすべて公開アドレスであることを確かめる */
async function assertPublicHost(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "");
  const addrs = await lookup(host, { all: true, verbatim: true });
  if (addrs.length === 0) throw new Error("名前解決できません");
  const bad = addrs.find((a) => !isPublicAddress(a.address));
  if (bad) throw new Error(`内部アドレス（${bad.address}）へは取得しません`);
}

/**
 * 画像を安全に取得する：https のみ・内部アドレス拒否・リダイレクト先も再検査・
 * 時間とサイズの上限・実際の内容で形式を判定。
 * （名前解決と接続の間に宛先が変わる攻撃は完全には防げないため、ローカルの取り込み用途に限る）
 */
export async function safeFetchImage(
  rawUrl: string,
): Promise<{ bytes: Uint8Array; contentType: ImageContentType; finalUrl: string }> {
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const checked = checkFetchUrl(current);
    if (!checked.ok) throw new Error(checked.reason);
    await assertPublicHost(checked.url.hostname);

    const res = await fetch(checked.url, {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: "image/jpeg,image/png,image/webp;q=0.9,*/*;q=0.1" },
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new Error("リダイレクト先がありません");
      current = new URL(location, checked.url).toString();
      continue;
    }
    if (!res.ok || !res.body) throw new Error(`取得に失敗しました（HTTP ${res.status}）`);
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > MAX_IMAGE_BYTES) throw new Error("5MB を超える画像です");

    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_IMAGE_BYTES) {
        await reader.cancel();
        throw new Error("5MB を超える画像です");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      bytes.set(c, offset);
      offset += c.byteLength;
    }
    const contentType = sniffImageType(bytes);
    if (!contentType) throw new Error("JPEG・PNG・WebP 以外の形式です");
    return { bytes, contentType, finalUrl: current };
  }
  throw new Error("リダイレクトが多すぎます");
}
