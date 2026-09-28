import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { app } from "../src/server/app";

async function call(url: string, overrides: Partial<Env>, init?: RequestInit) {
  const ctx = createExecutionContext();
  const res = await app.fetch(new Request(url, init), { ...env, ...overrides }, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

describe("家族限定の認証境界（A17）", () => {
  const paths = ["/", "/search", "/api/items", "/api/profiles", "/media/x"];

  it("Access の JWT がなければ画面・API・写真のすべてを拒否", async () => {
    const accessEnv = { AUTH_MODE: "access", ACCESS_TEAM_DOMAIN: "family.cloudflareaccess.com", ACCESS_AUD: "aud" };
    for (const p of paths) {
      const res = await call(`https://playland.example${p}`, accessEnv as Partial<Env>);
      expect(res.status, p).toBe(401);
      expect(res.headers.get("Cache-Control"), p).toBe("no-store");
    }
  });

  it("不正な JWT は拒否", async () => {
    const accessEnv = { AUTH_MODE: "access", ACCESS_TEAM_DOMAIN: "family.cloudflareaccess.com", ACCESS_AUD: "aud" };
    const res = await call("https://playland.example/api/items", accessEnv as Partial<Env>, {
      headers: { "cf-access-jwt-assertion": "not-a-jwt" },
    });
    expect(res.status).toBe(401);
  });

  it("Access の設定が欠けていれば拒否（fail closed）", async () => {
    for (const p of paths) {
      const res = await call(`https://playland.example${p}`, { AUTH_MODE: "access" } as Partial<Env>);
      expect(res.status, p).toBe(503);
    }
  });

  it("未知の AUTH_MODE は拒否", async () => {
    const res = await call("http://localhost/api/items", { AUTH_MODE: "" } as Partial<Env>);
    expect(res.status).toBe(503);
  });

  it("模擬認証は本番ホスト名では効かない", async () => {
    const res = await call("https://playland.example/api/items", { AUTH_MODE: "dev-mock" } as Partial<Env>);
    expect(res.status).toBe(403);
  });

  it("wrangler の既定設定は Access モード（模擬認証ではない）", async () => {
    const config = (await import("../wrangler.jsonc?raw")).default as string;
    expect(config).toMatch(/"AUTH_MODE":\s*"access"/);
    expect(config).toMatch(/"workers_dev":\s*false/);
    expect(config).toMatch(/"preview_urls":\s*false/);
    expect(config).toMatch(/"run_worker_first":\s*true/);
  });
});
