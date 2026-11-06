// セッションのコンテキストの使用量を、会話の記録（`~/.claude/projects/<フォルダ>/<cliSessionId>.jsonl`）の末尾から読む。
// 読むだけで、書き込まない。考え方は docs/design/worktree-cards.md の「コンテキストの使用量」。

import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ContextUsage } from '../shared/types';

/**
 * モデル → コンテキストの窓の大きさ（トークン）。アプリの get_usage が返した contextWindow で確かめた値だけを入れる。
 * 同じモデルでも窓の大きさが違うことがあるので、ここにないモデルは割合を出さない
 */
const CONTEXT_WINDOWS: Record<string, number> = {
  'claude-opus-5-5': 1_000_000,
};

/** 窓の大きさ。わからないモデルは undefined。`[1m]` の付いたモデル名は 100 万 */
export function contextWindowOf(model: string | undefined): number | undefined {
  if (!model) return undefined;
  if (/\[1m\]$/i.test(model)) return 1_000_000;
  return CONTEXT_WINDOWS[model];
}

/** 作業フォルダ → `~/.claude/projects` の下のフォルダ名（英数字以外を `-` にしたもの） */
export function projectDirName(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

export interface LastUsage {
  /** 入力に使ったトークン（input + cache_read + cache_creation） */
  tokens: number;
  model?: string;
}

/**
 * jsonl の文字列から、最後のアシスタントの発言（サブエージェントの発言 isSidechain は除く）の使用量を取る。
 * 末尾だけを読んだ文字列でもよい（先頭の切れた行は読めないので飛ばす）。見つからなければ undefined
 */
export function parseLastUsage(text: string): LastUsage | undefined {
  let end = text.length;
  while (end > 0) {
    const start = text.lastIndexOf('\n', end - 1) + 1;
    const line = text.slice(start, end);
    end = start - 1;
    // JSON.parse は重いので、アシスタントの発言だけを読む
    if (!line.includes('"assistant"') || !line.includes('"usage"')) continue;
    let d: any;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    if (d?.type !== 'assistant' || d.isSidechain) continue;
    const u = d.message?.usage;
    if (!u || typeof u !== 'object') continue;
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    const tokens = n(u.input_tokens) + n(u.cache_read_input_tokens) + n(u.cache_creation_input_tokens);
    // 失敗した発言など、使用量が 0 のものは飛ばす
    if (!tokens) continue;
    const model = typeof d.message.model === 'string' && d.message.model.startsWith('claude-') ? d.message.model : undefined;
    return { tokens, model };
  }
  return undefined;
}

/** 末尾から読む大きさ。見つからなければ次の大きさで読み直す（ツールの結果が大きい行のあとにあるときのため） */
const TAIL_STEPS = [64 * 1024, 512 * 1024, 4 * 1024 * 1024];

function readTail(path: string, size: number, bytes: number): string {
  const len = Math.min(size, bytes);
  const buf = Buffer.alloc(len);
  const fd = openSync(path, 'r');
  try {
    readSync(fd, buf, 0, len, size - len);
  } finally {
    closeSync(fd);
  }
  return buf.toString('utf8');
}

/** ファイルの末尾から使用量を読む。読めなければ undefined */
export function readLastUsage(path: string, size: number): LastUsage | undefined {
  for (const step of TAIL_STEPS) {
    const found = parseLastUsage(readTail(path, size, step));
    if (found || step >= size) return found;
  }
  return undefined;
}

/** 見つからなかったファイルを探し直すまでの間 */
const RETRY_MISSING_MS = 60_000;

interface Cached {
  path: string;
  size: number;
  mtimeMs: number;
  usage?: LastUsage;
}

/**
 * セッションごとの使用量を読む。読んだ結果は、ファイルの大きさと更新時刻が変わるまで使い回す。
 * ファイルの場所は作業フォルダから決め、なければ `projects` の下のフォルダを探す
 */
export function createContextReader(projectsDir: string) {
  const cache = new Map<string, Cached>();
  const missing = new Map<string, number>();

  function locate(cliSessionId: string, folders: string[], now: number): string | undefined {
    const name = `${cliSessionId}.jsonl`;
    for (const folder of folders) {
      const p = join(projectsDir, projectDirName(folder), name);
      if (existsSync(p)) return p;
    }
    const at = missing.get(cliSessionId);
    if (at !== undefined && now - at < RETRY_MISSING_MS) return undefined;
    let dirs: string[] = [];
    try {
      dirs = readdirSync(projectsDir);
    } catch {
      // フォルダがない
    }
    for (const dir of dirs) {
      const p = join(projectsDir, dir, name);
      if (existsSync(p)) {
        missing.delete(cliSessionId);
        return p;
      }
    }
    missing.set(cliSessionId, now);
    return undefined;
  }

  /**
   * cliSessionId のセッションの使用量。model は local_*.json の値（なければ記録の値を使う）。
   * folders は記録のフォルダを探す作業フォルダの候補
   */
  function read(cliSessionId: string, folders: string[], model: string | undefined, now = Date.now()): ContextUsage | undefined {
    if (!/^[0-9a-zA-Z-]+$/.test(cliSessionId)) return undefined;
    let entry = cache.get(cliSessionId);
    let path = entry?.path;
    let st: { size: number; mtimeMs: number } | undefined;
    try {
      if (path) st = statSync(path);
    } catch {
      path = undefined;
    }
    if (!path) {
      path = locate(cliSessionId, folders, now);
      if (!path) return undefined;
      try {
        st = statSync(path);
      } catch {
        return undefined;
      }
    }
    if (!st) return undefined;
    if (!entry || entry.path !== path || entry.size !== st.size || entry.mtimeMs !== st.mtimeMs) {
      let usage: LastUsage | undefined;
      try {
        usage = readLastUsage(path, st.size);
      } catch {
        usage = undefined;
      }
      entry = { path, size: st.size, mtimeMs: st.mtimeMs, usage };
      cache.set(cliSessionId, entry);
    }
    if (!entry.usage) return undefined;
    const m = model || entry.usage.model;
    const window = contextWindowOf(m);
    const out: ContextUsage = { tokens: entry.usage.tokens };
    if (window) out.window = window;
    if (m) out.model = m;
    return out;
  }

  /** 今ないセッションを使い回しの表から外す */
  function prune(keep: ReadonlySet<string>) {
    for (const id of cache.keys()) if (!keep.has(id)) cache.delete(id);
    for (const id of missing.keys()) if (!keep.has(id)) missing.delete(id);
  }

  return { read, prune };
}
