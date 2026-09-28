import type {
  ItemDetailResponse,
  ItemListResponse,
  ProfileListResponse,
} from "../domain/api";
import type { FavoritesFilter } from "../domain/search";

export class ApiError extends Error {
  constructor(public status: number) {
    super(`API error ${status}`);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin", ...init });
  if (!res.ok) throw new ApiError(res.status);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export function fetchProfiles(signal?: AbortSignal) {
  return request<ProfileListResponse>("/api/profiles", { signal });
}

export function fetchItems(
  params: { favorites: FavoritesFilter; profileId: string | null; limit: number; offset: number },
  signal?: AbortSignal,
) {
  const q = new URLSearchParams({
    favorites: params.favorites,
    limit: String(params.limit),
    offset: String(params.offset),
  });
  if (params.profileId) q.set("profile_id", params.profileId);
  return request<ItemListResponse>(`/api/items?${q}`, { signal });
}

export function fetchItem(id: string, signal?: AbortSignal) {
  return request<ItemDetailResponse>(`/api/items/${encodeURIComponent(id)}`, { signal });
}

export function setFavorite(profileId: string, itemId: string, saved: boolean) {
  return request<void>(
    `/api/profiles/${encodeURIComponent(profileId)}/favorites/${encodeURIComponent(itemId)}`,
    { method: saved ? "PUT" : "DELETE" },
  );
}
