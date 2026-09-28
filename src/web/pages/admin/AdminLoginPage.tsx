import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { ApiError, startAdminSession } from "../../api";

export function AdminLoginPage() {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const next = params.get("next");
  // 同一サイト内のパスだけに戻す
  const target = next && next.startsWith("/admin") ? next : "/admin";

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await startAdminSession(pin);
      navigate(target, { replace: true });
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      setError(
        status === 401
          ? "PIN が違います"
          : status === 429
            ? "失敗が続いたため、しばらく待ってからやり直してください"
            : status === 503
              ? "PIN が設定されていません（サーバーの設定を確認してください）"
              : "確認できませんでした",
      );
      setPin("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page admin">
      <h1 className="page-title">おうちのひと 専用</h1>
      <form className="pin-form" onSubmit={submit}>
        <label>
          PIN
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            pattern="\d{4,12}"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            required
          />
        </label>
        <button type="submit" className="link-button" disabled={busy}>
          確認する
        </button>
        {error && (
          <p className="save-status is-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </main>
  );
}
