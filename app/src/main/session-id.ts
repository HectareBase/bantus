// 行の右クリックメニューで ID をコピーするとき、画面から受け取った ID を確かめる（画面が任意の文字列をクリップボードに書けないように）。

import type { SessionView } from '../shared/types';

/** 今知っているセッションにあり、`local_` で始まる ID ならそれを返す。ほかは undefined */
export function copyableId(sessions: readonly SessionView[], id: unknown): string | undefined {
  if (typeof id !== 'string' || !id.startsWith('local_')) return undefined;
  return sessions.some((s) => s.id === id) ? id : undefined;
}
