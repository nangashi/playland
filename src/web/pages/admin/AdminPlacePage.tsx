import { lazy, Suspense, useState, type FormEvent } from "react";
import { useLoaderData, useRevalidator, type LoaderFunctionArgs } from "react-router";
import type { PlacePatchInput, TransportPatchInput } from "../../../domain/admin";
import type { AdminPlaceResponse } from "../../../domain/api";
import { modeLabel } from "../../../domain/labels";
import {
  durationBases,
  modeVisibilities,
  positionAccuracies,
  transportModes,
  type DurationBasis,
  type ModeVisibility,
  type PlaceRecord,
  type TransportMode,
} from "../../../domain/model";
import { fetchAdminPlace, patchPlace, patchTransport } from "../../api";
import { AdminFrame, numberField, numberOrNull, requireParentSession, SaveMessage, useSave } from "./common";

const PinPicker = lazy(() => import("../../map/PinPicker"));

export async function adminPlaceLoader(args: LoaderFunctionArgs) {
  await requireParentSession(args);
  return fetchAdminPlace(args.params.id ?? "", args.request.signal);
}

export function AdminPlacePage() {
  const data = useLoaderData<typeof adminPlaceLoader>();
  const revalidator = useRevalidator();
  const placeSave = useSave();
  const transportSave = useSave();
  return (
    <AdminFrame title="場所・移動の編集" back>
      <PlaceForm key={`p:${data.place.version}`} data={data} save={placeSave} reload={revalidator.revalidate} />
      <TransportForm key={`t:${data.place.version}`} data={data} save={transportSave} reload={revalidator.revalidate} />
    </AdminFrame>
  );
}

const ACCURACY_LABEL = { exact: "正確な地点", approximate: "おおよその位置（町丁目の代表点など）", unknown: "未確認" };

function PlaceForm({ data, save, reload }: { data: AdminPlaceResponse; save: ReturnType<typeof useSave>; reload: () => void }) {
  const [place, setPlace] = useState<PlaceRecord>(data.place);
  const [lat, setLat] = useState(numberField(data.place.latitude));
  const [lng, setLng] = useState(numberField(data.place.longitude));
  const { status, run } = save;
  const set = <K extends keyof PlaceRecord>(k: K, v: PlaceRecord[K]) => setPlace((p) => ({ ...p, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const patch: Record<string, unknown> = { version: data.place.version };
    for (const k of ["name", "address_text", "position_accuracy", "google_place_id", "google_maps_url"] as const) {
      if (place[k] !== data.place[k]) patch[k] = place[k];
    }
    const latitude = numberOrNull(lat);
    const longitude = numberOrNull(lng);
    if (latitude !== data.place.latitude || longitude !== data.place.longitude) {
      patch.latitude = latitude;
      patch.longitude = longitude;
    }
    if (Object.keys(patch).length === 1) return;
    if (await run(() => patchPlace(data.place.id, patch as PlacePatchInput))) reload();
  }

  return (
    <form className="form" onSubmit={submit}>
      <fieldset>
        <legend>場所</legend>
        <label>
          名前
          <input value={place.name} onChange={(e) => set("name", e.target.value)} required />
        </label>
        <label>
          住所
          <input value={place.address_text ?? ""} onChange={(e) => set("address_text", e.target.value)} />
        </label>
        <p className="hint">座標は、取得元が確かな値か、地図で確認した値だけを入れてください。推測で埋めません。</p>
        <Suspense fallback={<div className="map map-small map-loading">地図を読み込んでいます…</div>}>
          <PinPicker
            latitude={numberOrNull(lat)}
            longitude={numberOrNull(lng)}
            fallbackCenter={data.origin}
            onChange={(la, lo) => {
              setLat(String(la));
              setLng(String(lo));
              // 地図で確認して置いた位置は「正確な地点」を初期値にする（親が変更できる）
              set("position_accuracy", "exact");
            }}
          />
        </Suspense>
        <div className="inline-fields">
          <label>
            緯度
            <input inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} />
          </label>
          <label>
            経度
            <input inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} />
          </label>
        </div>
        <label>
          位置の精度
          <select
            value={place.position_accuracy}
            onChange={(e) => set("position_accuracy", e.target.value as PlaceRecord["position_accuracy"])}
          >
            {positionAccuracies.map((v) => (
              <option key={v} value={v}>
                {ACCURACY_LABEL[v]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Googleマップの施設 URL（同じ施設だと確認したもの）
          <input type="url" value={place.google_maps_url ?? ""} onChange={(e) => set("google_maps_url", e.target.value)} />
        </label>
        <button type="submit" className="link-button" disabled={status.kind === "saving"}>
          場所を保存
        </button>
        <SaveMessage status={status} onReload={reload} />
      </fieldset>
    </form>
  );
}

type EstimateChoice = "unknown" | "estimated" | "no_route";

interface ModeRow {
  visibility: ModeVisibility;
  note: string;
  choice: EstimateChoice;
  minutes: string;
  basis: DurationBasis;
  walk: string;
  transfers: string;
  estimateNote: string;
}

const VISIBILITY_LABEL: Record<TransportMode, Record<ModeVisibility, string>> = {
  transit: { default: "標準（表示）", show: "表示", hide: "表示しない" },
  car: { default: "標準（表示）", show: "表示", hide: "表示しない" },
  bicycle: { default: "標準（上限時間以内なら表示）", show: "表示", hide: "表示しない" },
};
const BASIS_LABEL: Record<DurationBasis, string> = {
  door_to_door: "出発地から入口まで（合計）",
  driving_only: "運転時間だけ（車の手配・駐車後の移動を含まない）",
};

function initialRows(data: AdminPlaceResponse): Record<TransportMode, ModeRow> {
  const rows = {} as Record<TransportMode, ModeRow>;
  for (const mode of transportModes) {
    const pref = data.preferences.find((p) => p.mode === mode);
    const manual = data.estimates.find((e) => e.mode === mode && e.source === "manual");
    rows[mode] = {
      visibility: pref?.visibility ?? "default",
      note: pref?.note ?? "",
      choice: manual ? manual.route_status : "unknown",
      minutes: numberField(manual?.minutes),
      basis: manual?.basis ?? (mode === "car" ? "driving_only" : "door_to_door"),
      walk: numberField(manual?.walk_minutes),
      transfers: numberField(manual?.transfers),
      estimateNote: manual?.note ?? "",
    };
  }
  return rows;
}

function TransportForm({ data, save, reload }: { data: AdminPlaceResponse; save: ReturnType<typeof useSave>; reload: () => void }) {
  const [rows, setRows] = useState(() => initialRows(data));
  const { status, run } = save;
  const setRow = (mode: TransportMode, next: Partial<ModeRow>) => setRows((r) => ({ ...r, [mode]: { ...r[mode], ...next } }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const initial = initialRows(data);
    const patch: TransportPatchInput = { version: data.place.version, preferences: [], estimates: [] };
    for (const mode of transportModes) {
      const r = rows[mode];
      const before = initial[mode];
      if (r.visibility !== before.visibility || r.note !== before.note) {
        patch.preferences!.push({ mode, visibility: r.visibility, note: r.note || null });
      }
      if (JSON.stringify({ ...r, visibility: 0, note: 0 }) !== JSON.stringify({ ...before, visibility: 0, note: 0 })) {
        if (r.choice === "unknown") patch.estimates!.push({ mode, route_status: "clear" });
        else if (r.choice === "no_route") patch.estimates!.push({ mode, route_status: "no_route", note: r.estimateNote || null });
        else {
          const minutes = numberOrNull(r.minutes);
          if (minutes === null) return;
          patch.estimates!.push({
            mode,
            route_status: "estimated",
            minutes,
            basis: r.basis,
            walk_minutes: numberOrNull(r.walk),
            transfers: numberOrNull(r.transfers),
            note: r.estimateNote || null,
          });
        }
      }
    }
    if (patch.preferences!.length === 0 && patch.estimates!.length === 0) return;
    if (await run(() => patchTransport(data.place.id, patch))) reload();
  }

  return (
    <form className="form" onSubmit={submit}>
      <fieldset>
        <legend>移動</legend>
        <p className="hint">
          時間は、経路サービスで調べた結果や実際に確認した目安を入れます（出発地の版 {data.origin_version}）。
          分からない場合は「未確認」のままにしてください。
        </p>
        {transportModes.map((mode) => {
          const r = rows[mode];
          return (
            <div key={mode} className="mode-block">
              <h3>
                {modeLabel[mode]}
              </h3>
              <label>
                表示
                <select value={r.visibility} onChange={(e) => setRow(mode, { visibility: e.target.value as ModeVisibility })}>
                  {modeVisibilities.map((v) => (
                    <option key={v} value={v}>
                      {VISIBILITY_LABEL[mode][v]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                メモ（表示方針の理由など）
                <input value={r.note} onChange={(e) => setRow(mode, { note: e.target.value })} />
              </label>
              <label>
                所要時間
                <select value={r.choice} onChange={(e) => setRow(mode, { choice: e.target.value as EstimateChoice })}>
                  <option value="unknown">未確認</option>
                  <option value="estimated">時間を入力</option>
                  <option value="no_route">この手段では行けない（確認済み）</option>
                </select>
              </label>
              {r.choice === "estimated" && (
                <>
                  <div className="inline-fields">
                    <label>
                      片道（分）
                      <input type="number" min={1} max={1440} required value={r.minutes} onChange={(e) => setRow(mode, { minutes: e.target.value })} />
                    </label>
                    {mode === "transit" && (
                      <>
                        <label>
                          うち徒歩（分）
                          <input type="number" min={0} value={r.walk} onChange={(e) => setRow(mode, { walk: e.target.value })} />
                        </label>
                        <label>
                          乗換（回）
                          <input type="number" min={0} value={r.transfers} onChange={(e) => setRow(mode, { transfers: e.target.value })} />
                        </label>
                      </>
                    )}
                  </div>
                  <label>
                    時間の基準
                    <select value={r.basis} onChange={(e) => setRow(mode, { basis: e.target.value as DurationBasis })}>
                      {durationBases.map((b) => (
                        <option key={b} value={b}>
                          {BASIS_LABEL[b]}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              {r.choice !== "unknown" && (
                <label>
                  時間についてのメモ
                  <input value={r.estimateNote} onChange={(e) => setRow(mode, { estimateNote: e.target.value })} />
                </label>
              )}
            </div>
          );
        })}
        <button type="submit" className="link-button" disabled={status.kind === "saving"}>
          移動を保存
        </button>
        <SaveMessage status={status} onReload={reload} />
      </fieldset>
    </form>
  );
}
