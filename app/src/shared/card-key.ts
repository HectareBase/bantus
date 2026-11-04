// カード（ワークツリー）の目印。画面とメインプロセスの両方で使う（アーカイブの印の保存と片付け）。

/** リポジトリのフォルダとワークツリーの目印（元のフォルダは空）を | でつなぐ */
export function cardKeyOf(s: { repoKey: string; worktree?: { key: string } }): string {
  return `${s.repoKey}|${s.worktree?.key ?? ''}`;
}
