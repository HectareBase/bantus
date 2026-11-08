// HTML ビューアに出すファイルの相対パス（docs/design/html-viewer.md）。設定画面とメインプロセスの両方で使う。
// 画面から届いた値はここで検査し、メインプロセスは realpath をとったあとにもう一度ルートの中にあるかを確かめる。

/** 受け付けない理由。設定画面では入力欄の下に出す */
export type ViewerPathProblem = 'absolute' | 'outside' | 'extension' | 'invalid';

/** パスの長さの上限 */
export const VIEWER_PATH_MAX = 260;

/**
 * 相対パスを検査し、区切りを / にそろえた形を返す。空なら ''（まだ決めていない）。
 * 絶対パス、ドライブ名、`..` でルートの外に出るもの、.html／.htm 以外は受け付けない
 */
export function checkViewerPath(input: string): { path: string } | { problem: ViewerPathProblem } {
  const raw = input.trim();
  if (!raw) return { path: '' };
  if (raw.length > VIEWER_PATH_MAX || /[\x00-\x1f<>"|?*]/.test(raw)) return { problem: 'invalid' };
  const slashed = raw.replace(/\\/g, '/');
  // /a、//server、C:、C:/a、~/a
  if (slashed.startsWith('/') || /^[a-z]:/i.test(slashed) || slashed.startsWith('~')) return { problem: 'absolute' };
  // ドライブ名のほかに : は使えない（NTFS の代替データストリームを避ける）
  if (slashed.includes(':')) return { problem: 'invalid' };
  const parts: string[] = [];
  for (const part of slashed.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (!parts.length) return { problem: 'outside' };
      parts.pop();
      continue;
    }
    // 末尾の点と空白は Windows が捨てるので、見た目と違うファイルを指さないよう受け付けない
    if (/[. ]$/.test(part)) return { problem: 'invalid' };
    parts.push(part);
  }
  if (!parts.length) return { problem: 'invalid' };
  if (!/\.html?$/i.test(parts[parts.length - 1]!)) return { problem: 'extension' };
  return { path: parts.join('/') };
}

/** 保存できる形の相対パスなら true（空も通す） */
export function isViewerPath(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const checked = checkViewerPath(v);
  return 'path' in checked && checked.path === v;
}

/** ファイル名（パスの最後の部分） */
export function viewerFileName(path: string): string {
  return path.split('/').pop() ?? path;
}

/** 区切りを除いたパスが、ルートの中（ルートそのものは含まない）にあるか。大文字と小文字は区別しない（Windows） */
export function isInside(root: string, target: string): boolean {
  const norm = (p: string) => p.replace(/[\\/]+/g, '/').replace(/\/$/, '').toLowerCase();
  const r = norm(root);
  const t = norm(target);
  return t.startsWith(`${r}/`) && t.length > r.length + 1;
}
