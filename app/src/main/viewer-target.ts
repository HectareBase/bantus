// HTML ビューアに何を出すかを決める（docs/design/html-viewer.md）。ファイルの読み取りは渡された関数だけで行う（テストしやすくするため）。

import { join } from 'node:path';
import { cardKeyOf } from '../shared/card-key';
import { ja } from '../shared/strings/ja';
import type { SessionView, ViewerState } from '../shared/types';
import { checkViewerPath, isInside, viewerFileName } from '../shared/viewer-path';
import { folderKey } from './sessions';

export interface ViewerTarget {
  state: ViewerState;
  /** 表示しているときだけ。ビューを分ける目印（作業フォルダを小文字にしたもの） */
  key?: string;
  /** 表示しているときだけ。realpath をとったファイルの場所 */
  file?: string;
  /** 表示しているときだけ。作業フォルダ */
  dir?: string;
}

export interface ViewerFs {
  /** ファイルなら realpath をとった場所。ない、フォルダ、読めないときは undefined */
  realFile(path: string): string | undefined;
  /** フォルダの realpath。ない、読めないときは undefined */
  realDir(path: string): string | undefined;
}

/** カードの名前と同じく、ワークツリーならその名前、元のフォルダならブランチ名 */
export function viewerPlace(s: SessionView): string {
  return s.worktree?.label ?? s.mainBranch ?? s.mainHead ?? ja.widget.originFolder;
}

/**
 * 今開いているセッション（session）と設定のパス（path）から、出すものを決める。
 * shownCards は画面が出している（アーカイブしていない）カードの目印。まだ届いていなければ undefined で、アーカイブは見ない。
 * 元のフォルダの同じファイルに代えて出すことはしない
 */
export function resolveViewerTarget(
  session: SessionView | undefined,
  path: string,
  shownCards: ReadonlySet<string> | undefined,
  fs: ViewerFs,
): ViewerTarget {
  if (!session) return { state: { kind: 'noSession' } };
  const checked = checkViewerPath(path);
  if (!('path' in checked) || !checked.path) return { state: { kind: 'noPath' } };
  const file = viewerFileName(checked.path);
  const place = viewerPlace(session);
  const dir = session.workDir;
  if (!dir) return { state: { kind: 'noDir', file, place } };
  if (shownCards && !shownCards.has(cardKeyOf(session))) return { state: { kind: 'archived', file, place } };
  const wanted = join(dir, checked.path);
  const missing: ViewerTarget = { state: { kind: 'missing', file, place, path: wanted } };
  const realDir = fs.realDir(dir);
  const realFile = fs.realFile(wanted);
  // リンクをたどった先が作業フォルダの外なら、ないものとして扱う
  if (!realDir || !realFile || !isInside(realDir, realFile)) return missing;
  return { state: { kind: 'ok', file, place }, key: folderKey(dir), file: realFile, dir };
}

/** 残しておくビューの目印：作業フォルダがあり、カードを出している（アーカイブしていない）セッションの作業フォルダ */
export function liveViewerKeys(sessions: readonly SessionView[], shownCards: ReadonlySet<string> | undefined): Set<string> {
  const keys = new Set<string>();
  for (const s of sessions) {
    if (s.workDir && (!shownCards || shownCards.has(cardKeyOf(s)))) keys.add(folderKey(s.workDir));
  }
  return keys;
}
