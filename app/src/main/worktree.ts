// アプリのフォルダが git のワークツリーの中にあるかの判定と、ワークツリー版をいつものウィジェットと分けるための値。
// ファイルを読む部分は呼び出す側から渡し、ここは純粋な関数だけにする（test/worktree.test.ts）。

import { dirname, basename } from 'node:path';
import { normalizeSettings, type Settings } from '../shared/settings';

/** フォルダの .git の種類。ワークツリーではファイル（gitdir: … と書いてある）、ふつうのチェックアウトではフォルダ */
export type GitEntry = 'file' | 'dir' | undefined;

/**
 * appPath から上へたどり、最初に見つかった .git がファイルなら、そのフォルダの名前をワークツリー名として返す。
 * .git がフォルダ（main のチェックアウト）か、どこにもなければ undefined
 */
export function worktreeName(appPath: string, gitEntry: (dir: string) => GitEntry): string | undefined {
  let dir = appPath;
  for (;;) {
    const entry = gitEntry(dir);
    if (entry === 'file') return basename(dir) || undefined;
    if (entry === 'dir') return undefined;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** フォルダ名や ID に使えるよう、英数字と . _ - 以外を _ にする */
export function safeName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, '_');
}

/** ワークツリー版のデータフォルダ。いつもの <userData> の横に -wt-<名前>（見本データならさらに -debug） */
export function worktreeUserData(userData: string, name: string, fixture: boolean): string {
  return `${userData}-wt-${safeName(name)}${fixture ? '-debug' : ''}`;
}

/** ワークツリー版の AppUserModelId。タスクバーと知らせを、いつものウィジェットと分ける */
export function worktreeAppUserModelId(base: string, name: string): string {
  return `${base}.wt.${safeName(name)}`;
}

/**
 * ワークツリー版の最初の設定。いつもの設定（読めなければ既定値）を写し、端を反対側にして重ならないようにする。
 * Windows の起動時に開く設定は、いつものウィジェットのものなので写さない
 */
export function worktreeInitialSettings(base: unknown): Settings {
  const s = normalizeSettings(base);
  return { ...s, edge: s.edge === 'left' ? 'right' : 'left', openAtLogin: false };
}
