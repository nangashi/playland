/**
 * D1 の batch が 1 トランザクションとして扱われるか（途中の文が失敗したら前の文も取り消されるか）を確かめる。
 * 取り込みは「1 候補分の書き込み = 1 回の batch」で、途中で失敗したら候補が丸ごと残らない前提にしている。
 *
 * 家族のデータに関係しない表（PIN の試行回数）に、同じキーを 2 回 INSERT する batch を送る（2 回目は主キーの重複で失敗）。
 * 1 回目が残っていれば取り消されていない。確認後、残った行は必ず消す。
 */
const PROBE_KEY = "__batch_probe__";

export interface BatchCheckResult {
  /** batch 全体が失敗として返ったか */
  batchFailed: boolean;
  /** 失敗後に 1 回目の INSERT が残っていなかったか（true ならトランザクション） */
  rolledBack: boolean;
  /** 残った行を消したか */
  cleanedUp: boolean;
}

export async function checkBatchAtomic(db: D1Database): Promise<BatchCheckResult> {
  const count = async () =>
    (await db.prepare(`SELECT COUNT(*) AS n FROM admin_login_attempts WHERE key = ?`).bind(PROBE_KEY).first<{ n: number }>())?.n ?? 0;
  const cleanup = () => db.prepare(`DELETE FROM admin_login_attempts WHERE key = ?`).bind(PROBE_KEY).run();
  // 前回の確認が途中で止まっていたら片付けてから始める
  if ((await count()) > 0) await cleanup();

  const insert = () =>
    db
      .prepare(`INSERT INTO admin_login_attempts (key, window_started_at, failures) VALUES (?, '2000-01-01T00:00:00.000Z', 0)`)
      .bind(PROBE_KEY);
  let batchFailed = false;
  try {
    await db.batch([insert(), insert()]);
  } catch {
    batchFailed = true;
  }
  const left = await count();
  if (left > 0) await cleanup();
  return { batchFailed, rolledBack: left === 0, cleanedUp: left === 0 || (await count()) === 0 };
}
