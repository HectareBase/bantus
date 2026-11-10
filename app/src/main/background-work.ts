// セッションがバックグラウンドで動かしている作業（Bash の run_in_background、バックグラウンドのサブエージェント、Monitor）を、
// 会話の記録（`~/.claude/projects/<フォルダ>/<cliSessionId>.jsonl`）から数える。読むだけで、書き込まない。
// デスクトップ版の CLI は、バックグラウンドの作業が動いていても、ターンが終われば status を idle にする。
// 開始と終了の見分け方は docs/research/session-status.md の「バックグラウンドの作業」。

import { watch, type FSWatcher } from 'node:fs';
import { createTranscriptLocator } from './context-usage';
import { createJsonlTail, type JsonlTail } from './jsonl-tail';

/** 開始した作業（ID → 開始の時刻）と、終わった作業の ID */
export interface BackgroundState {
  started: Map<string, number>;
  ended: Set<string>;
}

export function newBackgroundState(): BackgroundState {
  return { started: new Map(), ended: new Set() };
}

/** 終了と数える `<status>`。Monitor の途中のイベントの通知には `<status>` がない */
const END_STATUSES = new Set(['completed', 'failed', 'killed', 'stopped']);
const NOTIFICATION = '<task-notification>';
const NOTIFICATION_BLOCK = /<task-notification>([\s\S]*?)<\/task-notification>/g;
/** 開始の行にだけ出る項目。JSON.parse の前にこれで絞る */
const START_HINT = /"(?:backgroundTaskId|async_launched|timeoutMs|persistent)"/;

/** 行の本文が、CLI が入れた終了の通知か。ツールの結果に同じ文字が出ても数えないよう、本文がそれで始まるものだけ */
function notificationText(d: any): string | undefined {
  const content = d?.type === 'queue-operation' ? d.content : d?.type === 'user' ? d.message?.content : undefined;
  return typeof content === 'string' && content.trimStart().startsWith(NOTIFICATION) ? content : undefined;
}

/** ツールの結果から、バックグラウンドで始めた作業の ID を取る。当てはまらなければ undefined */
function startedId(r: any): string | undefined {
  if (!r || typeof r !== 'object') return undefined;
  // Bash（自分で run_in_background にしたときも、2 分を超えて自動で回ったときも）
  if (typeof r.backgroundTaskId === 'string' && r.backgroundTaskId) return r.backgroundTaskId;
  // バックグラウンドのサブエージェント
  if (r.status === 'async_launched' && typeof r.agentId === 'string' && r.agentId) return r.agentId;
  // Monitor（timeoutMs と persistent が付く）
  if (typeof r.taskId === 'string' && r.taskId && ('timeoutMs' in r || 'persistent' in r)) return r.taskId;
  return undefined;
}

/**
 * 記録の行を state に足す。startedAt（CLI が起動した時刻、Unix ミリ秒）より前に始まった作業は数えない
 * （CLI を再起動すると、終了の通知がないまま作業が消えるため）
 */
export function applyLines(state: BackgroundState, lines: Iterable<string>, startedAt?: number): void {
  for (const line of lines) {
    const hasNotification = line.includes(NOTIFICATION);
    // JSON.parse は重いので、当てはまりそうな行だけを読む
    if (!hasNotification && !(line.includes('"toolUseResult"') && START_HINT.test(line))) continue;
    let d: any;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    const text = hasNotification ? notificationText(d) : undefined;
    if (text) {
      for (const m of text.matchAll(NOTIFICATION_BLOCK)) {
        const body = m[1] ?? '';
        const id = /<task-id>([^<]+)<\/task-id>/.exec(body)?.[1]?.trim();
        const status = /<status>([^<]+)<\/status>/.exec(body)?.[1]?.trim();
        if (id && status && END_STATUSES.has(status)) state.ended.add(id);
      }
      continue;
    }
    if (d?.type !== 'user') continue;
    const id = startedId(d.toolUseResult);
    if (!id || state.started.has(id)) continue;
    const at = typeof d.timestamp === 'string' ? Date.parse(d.timestamp) : Number.NaN;
    if (startedAt !== undefined && Number.isFinite(at) && at < startedAt) continue;
    state.started.set(id, at);
  }
}

/** 開始して、まだ終わっていない作業の数 */
export function activeCount(state: BackgroundState): number {
  let n = 0;
  for (const id of state.started.keys()) if (!state.ended.has(id)) n++;
  return n;
}

/** 記録の行の並びから、動いているバックグラウンドの作業の数を出す */
export function countBackgroundWork(lines: Iterable<string>, startedAt?: number): number {
  const state = newBackgroundState();
  applyLines(state, lines, startedAt);
  return activeCount(state);
}

/** その場で読む大きさの上限。これより多く増えていたら、少しずつ間を空けて読む */
const SYNC_BYTES = 256 * 1024;
/** 間を空けて読むときの 1 回の大きさと間（ミリ秒） */
const CHUNK_BYTES = 1024 * 1024;
const CHUNK_GAP_MS = 15;

interface Entry {
  tail: JsonlTail;
  state: BackgroundState;
  startedAt?: number;
  /** 最後まで 1 度読み終えた（それまでは数を返さない） */
  ready: boolean;
  /** 少しずつ読む順番を待っている */
  queued: boolean;
  watcher?: FSWatcher;
}

/**
 * セッションごとに、バックグラウンドの作業の数を差分で読む。
 * - read は待機中（idle）のセッションだけに呼ぶ。処理中・対応待ちのセッションには pause を呼ぶ（読んだ位置は覚えたまま）
 * - 増えた分が大きいとき（起動して最初の 1 回など）は、メインプロセスを長く止めないよう、1 ファイルずつ少しずつ読み、読み終えたら onUpdate を呼ぶ
 * - 作業が 1 つ以上ある待機中のセッションは、記録のファイルを見張り、変わったら onUpdate を呼ぶ
 */
export function createBackgroundReader(projectsDir: string, onUpdate: () => void) {
  const entries = new Map<string, Entry>();
  const locator = createTranscriptLocator(projectsDir);
  const queue: Entry[] = [];
  let timer: NodeJS.Timeout | undefined;

  function watchFile(entry: Entry, on: boolean) {
    if (!on) {
      entry.watcher?.close();
      entry.watcher = undefined;
      return;
    }
    if (entry.watcher) return;
    try {
      const watcher = watch(entry.tail.path, () => onUpdate());
      watcher.on('error', () => watchFile(entry, false));
      entry.watcher = watcher;
    } catch {
      // 見張れなければ、低い頻度の読み直しに任せる
    }
  }

  function close(entry: Entry) {
    watchFile(entry, false);
    entry.queued = false;
  }

  /** 読める分を読んで state に足す。reset のときは数え直す。まだ残っていれば true */
  function pump(entry: Entry, maxBytes: number): boolean {
    const chunk = entry.tail.read(maxBytes);
    if (!chunk) return false;
    if (chunk.reset) entry.state = newBackgroundState();
    applyLines(entry.state, chunk.lines, entry.startedAt);
    return chunk.more;
  }

  function runQueue() {
    timer = undefined;
    const entry = queue[0];
    if (entry && !entry.queued) queue.shift();
    else if (entry && !pump(entry, CHUNK_BYTES)) {
      queue.shift();
      entry.queued = false;
      entry.ready = true;
      onUpdate();
    }
    if (queue.length) timer = setTimeout(runQueue, CHUNK_GAP_MS);
  }

  function enqueue(entry: Entry) {
    if (entry.queued) return;
    entry.queued = true;
    queue.push(entry);
    timer ??= setTimeout(runQueue, CHUNK_GAP_MS);
  }

  /**
   * 待機中のセッションの、動いているバックグラウンドの作業の数。まだ読み終えていない、記録が見つからないときは undefined。
   * startedAt は CLI の `sessions/<pid>.json` の startedAt（変わったら CLI が再起動したので、最初から数え直す）
   */
  function read(cliSessionId: string, folders: string[], startedAt: number | undefined, now = Date.now()): number | undefined {
    let entry = entries.get(cliSessionId);
    if (entry && entry.startedAt !== startedAt) {
      close(entry);
      entries.delete(cliSessionId);
      entry = undefined;
    }
    if (!entry) {
      const path = locator.locate(cliSessionId, folders, now);
      if (!path) return undefined;
      entry = { tail: createJsonlTail(path), state: newBackgroundState(), startedAt, ready: false, queued: false };
      entries.set(cliSessionId, entry);
    }
    if (!entry.queued) {
      const pending = entry.tail.pending();
      if (pending === undefined) {
        // ファイルが消えた。次に探し直す
        close(entry);
        entries.delete(cliSessionId);
        return undefined;
      }
      if (pending > SYNC_BYTES) enqueue(entry);
      else if (pending > 0 || !entry.ready) {
        if (pump(entry, SYNC_BYTES)) enqueue(entry);
        else entry.ready = true;
      }
    }
    if (!entry.ready) return undefined;
    const n = activeCount(entry.state);
    watchFile(entry, n > 0);
    return n;
  }

  /** 処理中・対応待ちのセッション。記録は読まず、見張りもやめる（読んだ位置は覚えたまま） */
  function pause(cliSessionId: string) {
    const entry = entries.get(cliSessionId);
    if (entry) watchFile(entry, false);
  }

  /** 今動いていないセッションを外す */
  function prune(keep: ReadonlySet<string>) {
    for (const [id, entry] of entries) {
      if (keep.has(id)) continue;
      close(entry);
      entries.delete(id);
    }
    locator.prune(keep);
  }

  /** 見張りと読む順番を、すべてやめる（テスト用） */
  function dispose() {
    for (const entry of entries.values()) close(entry);
    entries.clear();
    queue.length = 0;
    clearTimeout(timer);
    timer = undefined;
  }

  return { read, pause, prune, dispose };
}
