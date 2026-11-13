// git の詳細のマージの数え方（docs/design/git-detail.md の「マージ」）。メインプロセスと画面の両方から使う純粋関数

import type { GitMerge } from './types';

/** 取り込んだコミットの数。取ってきた範囲の外にも続くなら「N+」 */
export function mergeCountLabel(m: Pick<GitMerge, 'children' | 'more'>): string {
  return `${m.children.length}${m.more ? '+' : ''}`;
}

/** マージの 1 行目：セッションのタイトル、なければ短いブランチ名、件名を読めなければ件名のまま */
export function mergeHeadline(m: GitMerge, fallback: string): string {
  return m.title || m.name || fallback;
}
