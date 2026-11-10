// jsonl のファイルを、前回読んだ位置から増えた分だけ読む。読むだけで、書き込まない。
// 会話の記録（`~/.claude/projects/<フォルダ>/<cliSessionId>.jsonl`）のように、後ろへ足していくファイル向け。
// 注意点は docs/research/work-progress.md（増えた分だけ読む、最初の 1 回は全体、小さくなったら最初から、書きかけの最後の行は残す）。

import { closeSync, openSync, readSync, statSync } from 'node:fs';

const EMPTY = Buffer.alloc(0);

export interface TailChunk {
  /** 今回読めた、改行で終わっている行（空の行は除く） */
  lines: string[];
  /** ファイルが小さくなった、または置き換わったので、最初から読み直した。呼び出し側は読んだ結果を捨ててから lines を使う */
  reset: boolean;
  /** まだ読んでいない分が残っている（maxBytes で止めた） */
  more: boolean;
}

/**
 * 1 つのファイルの差分の読み手。位置と、改行で終わっていない最後の行（バイトのまま。UTF-8 の文字の途中で切れることがあるため）を覚える。
 * ファイルが読めなければ read は undefined を返し、位置はそのまま
 */
export function createJsonlTail(path: string) {
  let offset = 0;
  let rest: Buffer = EMPTY;
  let ino: number | undefined;

  function stat() {
    try {
      return statSync(path);
    } catch {
      return undefined;
    }
  }

  /** まだ読んでいないバイト数。小さくなった、置き換わったときは全体の大きさ。読めなければ undefined */
  function pending(): number | undefined {
    const st = stat();
    if (!st) return undefined;
    return st.size < offset || (ino !== undefined && st.ino !== ino) ? st.size : st.size - offset;
  }

  /** 増えた分を、多くても maxBytes まで読む */
  function read(maxBytes = Number.POSITIVE_INFINITY): TailChunk | undefined {
    const st = stat();
    if (!st) return undefined;
    let reset = false;
    if (st.size < offset || (ino !== undefined && st.ino !== ino)) {
      offset = 0;
      rest = EMPTY;
      reset = true;
    }
    ino = st.ino;
    if (st.size === offset) return { lines: [], reset, more: false };
    const len = Math.min(st.size - offset, maxBytes);
    const buf = Buffer.alloc(len);
    let n = 0;
    try {
      const fd = openSync(path, 'r');
      try {
        n = readSync(fd, buf, 0, len, offset);
      } finally {
        closeSync(fd);
      }
    } catch {
      return undefined;
    }
    offset += n;
    const data = rest.length ? Buffer.concat([rest, buf.subarray(0, n)]) : buf.subarray(0, n);
    const last = data.lastIndexOf(0x0a);
    if (last < 0) {
      rest = Buffer.from(data);
      return { lines: [], reset, more: offset < st.size };
    }
    rest = Buffer.from(data.subarray(last + 1));
    const lines = data
      .toString('utf8', 0, last)
      .split('\n')
      .map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line))
      .filter((line) => line.length > 0);
    return { lines, reset, more: offset < st.size };
  }

  return { path, read, pending };
}

export type JsonlTail = ReturnType<typeof createJsonlTail>;
