import { Hono } from "hono";
import { idSchema } from "../domain/model";
import { adminApi } from "./admin";
import { requireFamily, requireSameOrigin } from "./auth";
import { publicApi } from "./public";
import * as repo from "./repo";
import type { AppEnv } from "./types";

export const app = new Hono<AppEnv>();

app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "no-referrer");
});
// 画面・API・写真のすべてを家族認証の内側に置く
app.use("*", requireFamily());
app.use("/api/*", async (c, next) => {
  await next();
  // 家族のデータを共有キャッシュに載せない
  c.header("Cache-Control", "private, no-store");
});
app.use("/api/*", requireSameOrigin());

app.route("/api/admin", adminApi);
app.route("/api", publicApi);
app.all("/api/*", (c) => c.json({ error: "not found" }, 404));

/** 写真は非公開 R2 から、認証済みのリクエストにだけ返す */
app.get("/media/:id", async (c) => {
  const id = idSchema.safeParse(c.req.param("id"));
  if (!id.success) return c.body(null, 404);
  const media = await repo.getActiveMedia(c.env.DB, id.data);
  if (!media) return c.body(null, 404);
  const object = await c.env.MEDIA.get(media.r2_key);
  if (!object) {
    console.error("media object missing", media.id);
    return c.body(null, 404);
  }
  return new Response(object.body, {
    headers: {
      "Content-Type": media.content_type,
      "Content-Length": String(object.size),
      // 端末内だけにキャッシュし、共有キャッシュ（CDN 等）には載せない
      "Cache-Control": "private, max-age=3600",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
app.all("/media/*", (c) => c.body(null, 404));

// 画面（静的アセット）も認証を通した後に返す
app.all("*", async (c) => {
  const res = await c.env.ASSETS.fetch(c.req.raw);
  const out = new Response(res.body, res);
  out.headers.set("Cache-Control", "private, no-cache");
  return out;
});

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "internal error" }, 500);
});
