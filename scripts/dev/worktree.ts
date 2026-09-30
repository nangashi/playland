/**
 * 並行開発用のワークツリーを、画面確認できる状態で作る。
 *
 *   pnpm wt <ブランチ> [--from <元のブランチ>] [--dir <場所>]
 *
 * 1. git worktree add（ブランチがなければ --from（既定 main）から作る）
 * 2. メインの作業ツリーから .dev.vars とローカルの D1・R2（.wrangler/state）をコピーする
 *    共有しないのは、ブランチで足したマイグレーションが他のブランチの DB に混ざらないようにするため
 * 3. pnpm install と、ローカル DB へのマイグレーション
 *
 * 場所の既定は、リポジトリの隣の <リポジトリ名>.worktrees/<ブランチ>（リポジトリの中に置くとテストが二重に拾われる）。
 * 片付けは git worktree remove <場所>（コピーしたデータもまとめて消える）。
 */
import { execFileSync } from "node:child_process";
import { cp, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { parseArgs } from "node:util";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    from: { type: "string", default: "main" },
    dir: { type: "string" },
  },
});
const [branch] = positionals;

function run(cmd: string, args: string[], cwd?: string): void {
  execFileSync(cmd, args, { cwd, stdio: "inherit" });
}

function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

async function main(): Promise<number> {
  if (!branch) {
    console.error("使い方: pnpm wt <ブランチ> [--from <元のブランチ>] [--dir <場所>]");
    return 2;
  }
  // ワークツリーの中から実行しても、コピー元はメインの作業ツリーにする
  const mainRoot = dirname(git("rev-parse", "--path-format=absolute", "--git-common-dir"));
  const dir = values.dir ?? join(dirname(mainRoot), `${basename(mainRoot)}.worktrees`, branch.replaceAll("/", "-"));

  const hasBranch = git("branch", "--list", branch) !== "";
  run("git", hasBranch ? ["worktree", "add", dir, branch] : ["worktree", "add", "-b", branch, dir, values.from]);

  for (const path of [".dev.vars", ".wrangler/state"]) {
    if (await exists(join(mainRoot, path))) {
      await cp(join(mainRoot, path), join(dir, path), { recursive: true });
      console.log(`コピー: ${path}`);
    } else {
      console.log(`なし（スキップ）: ${path}`);
    }
  }

  run("pnpm", ["install", "--frozen-lockfile", "--prefer-offline"], dir);
  run("pnpm", ["db:migrate:local"], dir);

  console.log(`\n準備できました。\n  cd ${dir}\n  pnpm dev   # 5173 が使用中なら 5174… に自動でずれる`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
