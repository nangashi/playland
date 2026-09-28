/**
 * 端末で選んでいるプロフィール。表示の切り替え用で、権限の根拠にはしない。
 * localStorage が使えない環境（プライベートブラウズ等）でも、このタブの中では選択を保つ。
 */
const KEY = "playland.profileId";
let memory: string | null = null;

export function getSelectedProfileId(): string | null {
  try {
    return localStorage.getItem(KEY) ?? memory;
  } catch {
    return memory;
  }
}

export function setSelectedProfileId(id: string | null) {
  memory = id;
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {
    // memory に残っているので続行できる
  }
}
