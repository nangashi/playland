/**
 * 外部の画像を取得するときの宛先の検査。
 * ローカル環境・社内ネットワーク・クラウドのメタデータ用アドレスへは取得しない。
 */

function ipv4Parts(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return nums.every((n) => n >= 0 && n <= 255) ? nums : null;
}

export function isPublicIPv4(ip: string): boolean {
  const p = ipv4Parts(ip);
  if (!p) return false;
  const [a, b] = p as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return false; // 予約・プライベート・ループバック
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  if (a === 169 && b === 254) return false; // リンクローカル（クラウドのメタデータを含む）
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && p[2] === 0) return false;
  if (a === 198 && (b === 18 || b === 19)) return false; // ベンチマーク用
  if (a >= 224) return false; // マルチキャスト・予約
  return true;
}

export function isPublicIPv6(ip: string): boolean {
  const s = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (s === "::" || s === "::1") return false;
  const mapped = s.match(/^(?:0{0,4}:){0,5}(?::|0{0,4}:)?ffff:(\d+\.\d+\.\d+\.\d+)$/) ?? s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPublicIPv4(mapped[1]!);
  if (s.startsWith("64:ff9b:")) return false; // NAT64（内部 IPv4 を指しうる）
  const first = Number.parseInt(s.split(":")[0] || "0", 16);
  if ((first & 0xfe00) === 0xfc00) return false; // fc00::/7 ユニークローカル
  if ((first & 0xffc0) === 0xfe80) return false; // fe80::/10 リンクローカル
  if ((first & 0xff00) === 0xff00) return false; // マルチキャスト
  return true;
}

export function isPublicAddress(ip: string): boolean {
  return ip.includes(":") ? isPublicIPv6(ip) : isPublicIPv4(ip);
}

/** 取得してよい URL か（https・認証情報なし・標準ポート・IP 直書きなら公開アドレス） */
export function checkFetchUrl(value: string): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: "URL として読めません" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "https 以外は取得しません" };
  if (url.username || url.password) return { ok: false, reason: "認証情報を含む URL は取得しません" };
  if (url.port && url.port !== "443") return { ok: false, reason: "標準以外のポートは取得しません" };
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || !host.includes(".") && !host.includes(":")) {
    return { ok: false, reason: "ローカルのホストは取得しません" };
  }
  if ((/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":")) && !isPublicAddress(host)) {
    return { ok: false, reason: "内部アドレスは取得しません" };
  }
  return { ok: true, url };
}
