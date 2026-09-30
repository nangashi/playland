// ホーム画面から開いたときに通信できなければ、ブラウザのエラー画面の代わりに案内を出す。
// 家族のデータ（/api/*）・写真（/media/*）・画面のスクリプトは端末に保存せず、毎回 Worker（認証の内側）から取る。
const CACHE = "playland-offline-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload" })))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  // 画面の遷移だけを扱う。Access のログインへのリダイレクトなどは、そのままブラウザに返す
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(async () => (await caches.match(OFFLINE_URL)) ?? Response.error()),
  );
});
