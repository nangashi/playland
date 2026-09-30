# CLAUDE.md

## 言語

ユーザーへの説明・報告・質問は日本語で書く（コード中のコメントやドキュメントも既存に合わせて日本語）。

## Git / GitHub 操作

サンドボックスからは `~/.ssh` が読めないため、`origin`（`ssh://git@github.com/...`）への `git push` / `git fetch` / `git pull` は失敗する。リモートとのやり取りは gh の認証を使うこと。

- PR・Issue・リポジトリ情報などは `gh` コマンドで操作する（`gh pr create`、`gh pr view`、`gh api` など）。
- push / fetch / pull は HTTPS の URL に gh の認証情報を渡して実行する:

  ```bash
  git -c credential.helper='!gh auth git-credential' push https://github.com/nangashi/playland.git HEAD
  git -c credential.helper='!gh auth git-credential' fetch https://github.com/nangashi/playland.git main
  ```

- URL を直接指定した fetch では `origin/*` の追跡ブランチは更新されない。取得した内容は `FETCH_HEAD` で参照する（例: `git merge FETCH_HEAD`）。
