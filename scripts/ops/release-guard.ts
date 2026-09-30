/**
 * 手元からのデプロイ（pnpm run deploy）の前に、main の最新と同じ内容かを確かめる。
 * 本番へのリリースは main へのマージで CI が行う。手元からは CI が使えないときだけ、同じ内容を出す。
 *
 * 止める条件：main 以外のブランチ／追跡中のファイルの変更（src・migrations は未追跡も）／origin/main と不一致
 */
import { execFileSync } from "node:child_process";

function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

const problems: string[] = [];

const branch = git("rev-parse", "--abbrev-ref", "HEAD");
if (branch !== "main") problems.push(`main ではなく ${branch} にいる`);

const changed = [
  git("status", "--porcelain", "--untracked-files=no"),
  git("status", "--porcelain", "--untracked-files=all", "--", "src", "migrations"),
]
  .join("\n")
  .split("\n")
  .filter(Boolean);
if (changed.length > 0) {
  problems.push(`コミットしていない変更がある:\n${[...new Set(changed)].map((l) => `    ${l}`).join("\n")}`);
}

try {
  execFileSync("git", ["fetch", "--quiet", "origin", "main"], { stdio: ["ignore", "ignore", "pipe"] });
  if (git("rev-parse", "HEAD") !== git("rev-parse", "FETCH_HEAD")) {
    problems.push("origin/main と一致していない（pull か push が必要）");
  }
} catch {
  problems.push("origin から main を取得できなかった（ネットワークか Git の認証を確認）");
}

if (problems.length > 0) {
  console.error("デプロイを中止しました。本番へは main へのマージでリリースします（docs/production.md「リリース」）。");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
