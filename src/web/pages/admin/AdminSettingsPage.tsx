import { lazy, Suspense, useState, type FormEvent } from "react";
import { useLoaderData, useRevalidator, type LoaderFunctionArgs } from "react-router";
import type { SettingsPatchInput } from "../../../domain/admin";
import type { AdminSettingsResponse } from "../../../domain/api";
import { fetchAdminSettings, patchSettings } from "../../api";
import { AdminFrame, numberField, numberOrNull, requireParentSession, SaveMessage, useSave } from "./common";

const PinPicker = lazy(() => import("../../map/PinPicker"));

export async function adminSettingsLoader(args: LoaderFunctionArgs) {
  await requireParentSession(args);
  return fetchAdminSettings(args.request.signal);
}

export function AdminSettingsPage() {
  const data = useLoaderData<typeof adminSettingsLoader>();
  const revalidator = useRevalidator();
  const save = useSave();
  return (
    <AdminFrame title="家族の設定">
      <SettingsForm key={data.version} data={data} save={save} reload={revalidator.revalidate} />
    </AdminFrame>
  );
}

function SettingsForm({
  data,
  save,
  reload,
}: {
  data: AdminSettingsResponse;
  save: ReturnType<typeof useSave>;
  reload: () => void;
}) {
  const [label, setLabel] = useState(data.origin_label);
  const [lat, setLat] = useState(numberField(data.origin_latitude));
  const [lng, setLng] = useState(numberField(data.origin_longitude));
  const [bike, setBike] = useState(String(data.bicycle_max_minutes));
  const [bump, setBump] = useState(false);
  const { status, run } = save;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const patch: SettingsPatchInput = { version: data.version };
    if (label !== data.origin_label) patch.origin_label = label;
    const latitude = numberOrNull(lat);
    const longitude = numberOrNull(lng);
    if (latitude !== data.origin_latitude || longitude !== data.origin_longitude) {
      patch.origin_latitude = latitude;
      patch.origin_longitude = longitude;
    }
    const minutes = numberOrNull(bike);
    if (minutes !== null && minutes !== data.bicycle_max_minutes) patch.bicycle_max_minutes = minutes;
    if (bump) patch.bump_origin_version = true;
    if (Object.keys(patch).length === 1) return;
    if (await run(() => patchSettings(patch))) reload();
  }

  return (
    <form className="form" onSubmit={submit}>
      <fieldset>
        <legend>出発地</legend>
        <p className="hint">
          出発地の座標は親の画面だけで扱い、子ども向けの画面や一般の API には出しません。
          出発地を変えると、これまでの所要時間は「前の出発地の値」として扱われ、検索には使われなくなります（現在の版 {data.origin_version}）。
        </p>
        <label>
          呼び名
          <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={50} required />
        </label>
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
        <Suspense fallback={<div className="map map-small map-loading">地図を読み込んでいます…</div>}>
          <PinPicker
            latitude={numberOrNull(lat)}
            longitude={numberOrNull(lng)}
            fallbackCenter={null}
            onChange={(la, lo) => {
              setLat(String(la));
              setLng(String(lo));
            }}
          />
        </Suspense>
        <label className="check">
          <input type="checkbox" checked={bump} onChange={(e) => setBump(e.target.checked)} />
          座標は変えずに、出発地の前提を変える（古い所要時間を使わない）
        </label>
      </fieldset>
      <fieldset>
        <legend>自転車</legend>
        <label>
          片道の上限（分）
          <input type="number" min={1} max={180} value={bike} onChange={(e) => setBike(e.target.value)} required />
        </label>
      </fieldset>
      <button type="submit" className="link-button" disabled={status.kind === "saving"}>
        保存する
      </button>
      <SaveMessage status={status} onReload={reload} />
    </form>
  );
}
