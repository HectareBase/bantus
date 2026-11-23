// `.git/packed-refs` を読む。リモートブランチやタグも入って大きくなるので、変わっていなければ読み直さない
// （docs/design/io-schedule.md の「packed-refs の読み方」）。読むだけで、リポジトリを書き換えない。

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface PackedRefs {
  /** ref の完全な名前（`refs/...`）→ コミット */
  refs: ReadonlyMap<string, string>;
  /** 手元のブランチの名前（`refs/heads/` を除く） */
  heads: ReadonlySet<string>;
}

const EMPTY: PackedRefs = { refs: new Map(), heads: new Set() };

/** 覚えておくリポジトリの数の上限（古いものから捨てる） */
const CACHE_MAX = 16;

/** 今からこの時間内に更新されたファイルは覚えない（時刻の刻みの中で続けて書き換えられると、目印が変わらないことがあるため） */
const SETTLE_MS = 1000;

const HEADS = 'refs/heads/';

const cache = new Map<string, { id: string; packed: PackedRefs }>();
let reads = 0;

/** ファイルの中身を読んだ回数（テスト用） */
export const packedRefsReads = (): number => reads;

/** コメント（`#`）と peeled の行（`^`）は読み飛ばす。改行は LF でも CRLF でもよい */
export function parsePackedRefs(text: string): PackedRefs {
  const refs = new Map<string, string>();
  const heads = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^([0-9a-f]+) (refs\/\S+)$/.exec(line);
    if (!m) continue;
    refs.set(m[2]!, m[1]!);
    if (m[2]!.startsWith(HEADS)) heads.add(m[2]!.slice(HEADS.length));
  }
  return { refs, heads };
}

/**
 * 共有の場所 refDir の packed-refs を読む。ファイルの更新時刻、大きさ、番号が前回と同じなら読み直さない。
 * ファイルがないのは普通なので空を返す。ほかの理由で読めないとき（書き換えの途中で開けないなど）は undefined
 */
export function readPackedRefs(refDir: string, now: number = Date.now()): PackedRefs | undefined {
  const key = refDir.replace(/[\\/]+$/, '').toLowerCase();
  const file = join(refDir, 'packed-refs');
  try {
    // 先に stat する。読む間に置き換えられても、次の stat で目印が変わって読み直せる
    const st = statSync(file, { bigint: true });
    const id = `${st.mtimeNs}:${st.size}:${st.ino}`;
    const hit = cache.get(key);
    if (hit?.id === id) {
      cache.delete(key);
      cache.set(key, hit);
      return hit.packed;
    }
    cache.delete(key);
    reads++;
    const packed = parsePackedRefs(readFileSync(file, 'utf8'));
    if (now - Number(st.mtimeMs) >= SETTLE_MS) {
      cache.set(key, { id, packed });
      while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
    }
    return packed;
  } catch (e) {
    cache.delete(key);
    const code = (e as NodeJS.ErrnoException).code;
    return code === 'ENOENT' || code === 'ENOTDIR' ? EMPTY : undefined;
  }
}
