import { describe, expect, it } from "vitest";
import { checkFetchUrl, isPublicAddress } from "../src/ingest/netguard";

describe("取得先の検査", () => {
  it("内部・予約アドレスを拒否する", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "::1",
      "::",
      "fc00::1",
      "fd12:3456::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "::ffff:10.0.0.1",
    ]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
  });

  it("公開アドレスは許可する", () => {
    for (const ip of ["8.8.8.8", "172.32.0.1", "203.0.113.200", "2001:4860:4860::8888", "::ffff:8.8.8.8"]) {
      expect(isPublicAddress(ip), ip).toBe(true);
    }
  });

  it("https・標準ポート・認証情報なし・ローカル以外の URL だけを許可する", () => {
    expect(checkFetchUrl("https://example.com/a.jpg").ok).toBe(true);
    for (const url of [
      "http://example.com/a.jpg",
      "https://user:pass@example.com/a.jpg",
      "https://example.com:8443/a.jpg",
      "https://localhost/a.jpg",
      "https://intranet/a.jpg",
      "https://127.0.0.1/a.jpg",
      "https://169.254.169.254/latest/meta-data",
      "https://[::1]/a.jpg",
      "file:///etc/passwd",
      "javascript:alert(1)",
    ]) {
      expect(checkFetchUrl(url).ok, url).toBe(false);
    }
  });
});
