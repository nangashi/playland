import type { MiddlewareHandler } from "hono";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { AppEnv } from "./types";

export interface Identity {
  email: string | null;
  mock: boolean;
}

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

/**
 * 画面・API・写真のすべてに適用する認証境界。
 * 外側の Cloudflare Access に加えて、Worker でも Access の JWT を検証する。
 * 設定が欠けている・不明なモードの場合は拒否する（fail closed）。
 */
export function requireFamily(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const mode = c.env.AUTH_MODE;
    if (mode === "dev-mock") {
      // 模擬認証はローカルからのアクセスに限る。本番ホスト名では効かない
      if (!LOCAL_HOSTNAMES.has(new URL(c.req.url).hostname)) {
        console.error("AUTH_MODE=dev-mock rejected for non-local host");
        return deny(c, 403);
      }
      c.set("identity", { email: null, mock: true });
      return next();
    }
    if (mode === "access") {
      const team = c.env.ACCESS_TEAM_DOMAIN;
      const aud = c.env.ACCESS_AUD;
      if (!team || !aud) {
        console.error("Cloudflare Access is not configured");
        return deny(c, 503);
      }
      // Worker 単位の Access が検証済みの情報を渡した場合はそれを使う（aud が一致するものだけ）。
      // 静的アセットを使う構成では渡されないことがあるため、その場合は JWT を自前で検証する。
      const platform = accessContext(c);
      if (platform && platform.aud === aud) {
        const identity = await platform.getIdentity().catch(() => undefined);
        c.set("identity", { email: identity?.email ?? null, mock: false });
        return next();
      }
      const token = c.req.header("cf-access-jwt-assertion");
      if (!token) return deny(c, 401);
      try {
        const { payload } = await jwtVerify(token, jwks(team), {
          issuer: `https://${team}`,
          audience: aud,
        });
        c.set("identity", {
          email: typeof payload.email === "string" ? payload.email : null,
          mock: false,
        });
        return next();
      } catch {
        return deny(c, 401);
      }
    }
    console.error("Unknown AUTH_MODE");
    return deny(c, 503);
  };
}

function accessContext(c: Parameters<MiddlewareHandler<AppEnv>>[0]): CloudflareAccessContext | undefined {
  try {
    return (c.executionCtx as ExecutionContext).access;
  } catch {
    // ExecutionContext がない呼び出し（テスト等）
    return undefined;
  }
}

function jwks(teamDomain: string) {
  let set = jwksCache.get(teamDomain);
  if (!set) {
    set = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
    jwksCache.set(teamDomain, set);
  }
  return set;
}

function deny(c: Parameters<MiddlewareHandler<AppEnv>>[0], status: 401 | 403 | 503) {
  c.header("Cache-Control", "no-store");
  return c.json({ error: status === 503 ? "unavailable" : "unauthorized" }, status);
}

/** 状態を変える操作は同一オリジンからのみ受け付ける（CSRF 対策） */
export function requireSameOrigin(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(c.req.method)) return next();
    const origin = c.req.header("origin");
    if (!origin || origin !== new URL(c.req.url).origin) {
      return c.json({ error: "forbidden" }, 403);
    }
    return next();
  };
}
