import type {
  ItemCreateInput,
  ItemPatchInput,
  PlacePatchInput,
  SettingsPatchInput,
  TransportPatchInput,
} from "../domain/admin";
import type {
  AdminItemResponse,
  AdminPlaceListResponse,
  AdminPlaceResponse,
  AdminSessionResponse,
  AdminSettingsResponse,
  ErrorResponse,
  ItemDetailResponse,
  ItemListResponse,
  MapItemsResponse,
  PublicSettingsResponse,
} from "../domain/api";

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: ErrorResponse | null,
  ) {
    super(body?.error ?? `API error ${status}`);
  }

  get isConflict() {
    return this.status === 409;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin", ...init });
  if (!res.ok) {
    let body: ErrorResponse | null = null;
    try {
      body = (await res.json()) as ErrorResponse;
    } catch {
      // 本文がない・JSON でない
    }
    throw new ApiError(res.status, body);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

export function fetchSettings(signal?: AbortSignal) {
  return request<PublicSettingsResponse>("/api/settings", { signal });
}

/** 検索条件は URL の query をそのまま API に渡す（一覧と地図で同じ条件を使う） */
export function fetchItems(params: URLSearchParams, signal?: AbortSignal) {
  return request<ItemListResponse>(`/api/items?${params}`, { signal });
}

export function fetchMapItems(params: URLSearchParams, signal?: AbortSignal) {
  return request<MapItemsResponse>(`/api/map-items?${params}`, { signal });
}

export function fetchItem(id: string, signal?: AbortSignal) {
  return request<ItemDetailResponse>(`/api/items/${encodeURIComponent(id)}`, { signal });
}

/** 家族で共有する保存 */
export function setBookmark(itemId: string, saved: boolean) {
  return request<void>(`/api/bookmarks/${encodeURIComponent(itemId)}`, { method: saved ? "PUT" : "DELETE" });
}

/** 家族で「興味なし」にする／戻す */
export function setHidden(itemId: string, hidden: boolean) {
  return request<void>(`/api/hidden/${encodeURIComponent(itemId)}`, { method: hidden ? "PUT" : "DELETE" });
}

// ---- 親 ----

export function fetchAdminSession(signal?: AbortSignal) {
  return request<AdminSessionResponse>("/api/admin/session", { signal });
}

export function startAdminSession(pin: string) {
  return request<AdminSessionResponse>("/api/admin/session", json("POST", { pin }));
}

export function endAdminSession() {
  return request<void>("/api/admin/session", { method: "DELETE" });
}

export function fetchAdminItem(id: string, signal?: AbortSignal) {
  return request<AdminItemResponse>(`/api/admin/items/${encodeURIComponent(id)}`, { signal });
}

export function createItem(input: ItemCreateInput) {
  return request<{ id: string; place_id: string | null }>("/api/admin/items", json("POST", input));
}

export function patchItem(id: string, patch: ItemPatchInput) {
  return request<{ id: string; version: number }>(`/api/admin/items/${encodeURIComponent(id)}`, json("PATCH", patch));
}

export function fetchAdminPlaces(signal?: AbortSignal) {
  return request<AdminPlaceListResponse>("/api/admin/places", { signal });
}

export function fetchAdminPlace(id: string, signal?: AbortSignal) {
  return request<AdminPlaceResponse>(`/api/admin/places/${encodeURIComponent(id)}`, { signal });
}

export function patchPlace(id: string, patch: PlacePatchInput) {
  return request<{ id: string; version: number }>(`/api/admin/places/${encodeURIComponent(id)}`, json("PATCH", patch));
}

export function patchTransport(id: string, patch: TransportPatchInput) {
  return request<{ id: string; version: number }>(
    `/api/admin/places/${encodeURIComponent(id)}/transport`,
    json("PATCH", patch),
  );
}

export function fetchAdminSettings(signal?: AbortSignal) {
  return request<AdminSettingsResponse>("/api/admin/settings", { signal });
}

export function patchSettings(patch: SettingsPatchInput) {
  return request<AdminSettingsResponse>("/api/admin/settings", json("PATCH", patch));
}

export function uploadMedia(form: FormData) {
  return request<{ id: string }>("/api/admin/media", { method: "POST", body: form });
}

export function setMediaStatus(id: string, status: "active" | "hidden") {
  return request<void>(`/api/admin/media/${encodeURIComponent(id)}`, json("PATCH", { status }));
}
