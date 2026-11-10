// 処理中のセッションのタスクリスト（デスクトップの mcp__ccd_turn__update_plan）の進み具合を、
// 会話の記録（`~/.claude/projects/<フォルダ>/<cliSessionId>.jsonl`）から作り直す。読むだけで、書き込まない。
// 作り直し方と読み方の注意は docs/research/work-progress.md。使うのは手順の数と状態だけで、手順の名前は持たない。

import { watch, type FSWatcher } from 'node:fs';
import type { PlanStep } from '../shared/types';
import { createTranscriptLocator } from './context-usage';
import { createJsonlTail, type JsonlTail } from './jsonl-tail';

const PLAN_TOOL = 'mcp__ccd_turn__update_plan';
const WRAP_UP_TOOL = 'mcp__ccd_turn__wrap_up';
/** ツールの上限（12）より少し多めまで受け付ける。それより長いリストは信用しない */
const MAX_STEPS = 20;

/** 今のターンのタスクリスト。steps がなければ、このターンにはまだリストがない */
export interface PlanState {
  steps?: PlanStep[];
  /** 数えた tool_use の ID（1 つの発言が複数の行に分かれて記録されるため）。ターンが変わったら空にする */
  seen: Set<string>;
}

export function newPlanState(): PlanState {
  return { seen: new Set() };
}

function toStep(status: unknown): PlanStep {
  return status === 'completed' ? 'done' : status === 'in_progress' ? 'active' : 'todo';
}

/** 1 から始まる番号の並びを、0 から始まる位置にする。番号でないもの、範囲の外のものは捨てる */
function indexes(v: unknown, length: number): number[] {
  const list: unknown[] = Array.isArray(v) ? v : [v];
  return list.filter((n): n is number => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= length).map((n) => n - 1);
}

/** update_plan の呼び出し 1 つを当てはめる */
export function applyPlanInput(state: PlanState, input: any): void {
  if (!input || typeof input !== 'object') return;
  if (Array.isArray(input.items)) {
    if (input.items.length > MAX_STEPS) return;
    state.steps = input.items.map((item: any) => toStep(item?.status));
    return;
  }
  const steps = state.steps;
  if (!steps) return;
  if (input.advance === true) {
    // 今の手順を終え、その次の「これから」の手順を始める
    const cur = steps.indexOf('active');
    for (let i = 0; i < steps.length; i++) if (steps[i] === 'active') steps[i] = 'done';
    let next = steps.indexOf('todo', cur < 0 ? 0 : cur + 1);
    if (next < 0) next = steps.indexOf('todo');
    if (next >= 0) steps[next] = 'active';
  }
  for (const i of indexes(input.done, steps.length)) steps[i] = 'done';
  for (const i of indexes(input.start, steps.length)) steps[i] = 'active';
}

/** 本当のユーザーの発言（ツールの結果、CLI が入れた発言、まとめ直しの要約ではないもの）か */
function isUserTurn(d: any): boolean {
  if (d?.type !== 'user' || d.isSidechain || d.isMeta || d.isCompactSummary || d.isVisibleInTranscriptOnly) return false;
  const content = d.message?.content;
  if (typeof content === 'string') return true;
  if (!Array.isArray(content)) return false;
  return !content.some((b: any) => b?.type === 'tool_result');
}

/**
 * 記録の行を state に足す。本当のユーザーの発言があれば、そこからが新しいターンなので、前のリストを捨てる。
 * wrap_up はタスクリストを終わらせるので、すべて終わったものとする
 */
export function applyPlanLines(state: PlanState, lines: Iterable<string>): void {
  for (const line of lines) {
    const tool = line.includes('update_plan') || line.includes('wrap_up');
    // JSON.parse は重いので、当てはまりそうな行だけを読む。ユーザーの発言は、ツールの結果（toolUseResult を持つ）を除く
    const user = !tool && line.includes('"type":"user"') && !line.includes('"toolUseResult"');
    if (!tool && !user) continue;
    let d: any;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    if (isUserTurn(d)) {
      state.steps = undefined;
      state.seen.clear();
      continue;
    }
    // api-request-blob などにも同じ呼び出しが写っているので、アシスタントの発言だけを数える
    if (d?.type !== 'assistant' || d.isSidechain || !Array.isArray(d.message?.content)) continue;
    for (const b of d.message.content) {
      if (b?.type !== 'tool_use' || (b.name !== PLAN_TOOL && b.name !== WRAP_UP_TOOL)) continue;
      if (typeof b.id === 'string') {
        if (state.seen.has(b.id)) continue;
        state.seen.add(b.id);
      }
      if (b.name === PLAN_TOOL) applyPlanInput(state, b.input);
      else if (state.steps) state.steps = state.steps.map((): PlanStep => 'done');
    }
  }
}

/** 画面に出すリスト。手順が 2 つ以上のときだけ（1 つでは進み具合にならない） */
export function shownPlan(state: PlanState): PlanStep[] | undefined {
  return state.steps && state.steps.length >= 2 ? [...state.steps] : undefined;
}

/** 記録の行の並びから、今のターンのリストを作り直す */
export function rebuildPlan(lines: Iterable<string>): PlanStep[] | undefined {
  const state = newPlanState();
  applyPlanLines(state, lines);
  return shownPlan(state);
}

/** その場で読む大きさの上限。これより多く増えていたら、少しずつ間を空けて読む */
const SYNC_BYTES = 256 * 1024;
/** 間を空けて読むときの 1 回の大きさと間（ミリ秒） */
const CHUNK_BYTES = 1024 * 1024;
const CHUNK_GAP_MS = 15;
/** 記録が変わってから読むまでの間（書き込みが続くのでまとめる） */
const WATCH_DELAY_MS = 150;

interface Entry {
  tail: JsonlTail;
  state: PlanState;
  /** 最後まで 1 度読み終えた（それまではリストを返さない） */
  ready: boolean;
  /** 少しずつ読む順番を待っている */
  queued: boolean;
  watcher?: FSWatcher;
  timer?: NodeJS.Timeout;
  /** 最後に渡したリスト（変わったときだけ onUpdate を呼ぶ） */
  key: string;
}

const keyOf = (state: PlanState) => shownPlan(state)?.join(',') ?? '';

/**
 * セッションごとに、今のターンのタスクリストを差分で読む。
 * - read は処理中（busy）のセッションだけに呼ぶ。ほかのセッションには pause を呼ぶ（読んだ位置とリストは覚えたまま）
 * - 増えた分が大きいとき（最初の 1 回など）は、メインプロセスを長く止めないよう、1 ファイルずつ少しずつ読み、読み終えたら onUpdate を呼ぶ
 * - 処理中の間は記録のファイルを見張り、リストが変わったときだけ onUpdate を呼ぶ
 */
export function createPlanReader(projectsDir: string, onUpdate: () => void) {
  const entries = new Map<string, Entry>();
  const locator = createTranscriptLocator(projectsDir);
  const queue: Entry[] = [];
  let timer: NodeJS.Timeout | undefined;

  /** 読める分を読んで state に足す。まだ残っていれば true */
  function pump(entry: Entry, maxBytes: number): boolean {
    const chunk = entry.tail.read(maxBytes);
    if (!chunk) return false;
    if (chunk.reset) entry.state = newPlanState();
    applyPlanLines(entry.state, chunk.lines);
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
      entry.key = keyOf(entry.state);
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

  /** 増えた分を読む（大きければ順番待ちに回す）。ファイルが読めなければ false */
  function catchUp(entry: Entry): boolean {
    if (entry.queued) return true;
    const pending = entry.tail.pending();
    if (pending === undefined) return false;
    if (pending > SYNC_BYTES) enqueue(entry);
    else if (pending > 0 || !entry.ready) {
      if (pump(entry, SYNC_BYTES)) enqueue(entry);
      else entry.ready = true;
    }
    return true;
  }

  /** 記録が変わった。少し待ってから増えた分を読み、リストが変わっていれば知らせる */
  function onChange(entry: Entry) {
    if (entry.timer) return;
    entry.timer = setTimeout(() => {
      entry.timer = undefined;
      if (!entry.watcher || !catchUp(entry) || !entry.ready) return;
      const key = keyOf(entry.state);
      if (key === entry.key) return;
      entry.key = key;
      onUpdate();
    }, WATCH_DELAY_MS);
  }

  function watchFile(entry: Entry, on: boolean) {
    if (!on) {
      entry.watcher?.close();
      entry.watcher = undefined;
      clearTimeout(entry.timer);
      entry.timer = undefined;
      return;
    }
    if (entry.watcher) return;
    try {
      const watcher = watch(entry.tail.path, () => onChange(entry));
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

  /** 処理中のセッションの、今のターンのタスクリスト（手順が 2 つ以上のときだけ）。読み終えていない、ないときは undefined */
  function read(cliSessionId: string, folders: string[], now = Date.now()): PlanStep[] | undefined {
    let entry = entries.get(cliSessionId);
    if (!entry) {
      const path = locator.locate(cliSessionId, folders, now);
      if (!path) return undefined;
      entry = { tail: createJsonlTail(path), state: newPlanState(), ready: false, queued: false, key: '' };
      entries.set(cliSessionId, entry);
    }
    if (!catchUp(entry)) {
      // ファイルが消えた。次に探し直す
      close(entry);
      entries.delete(cliSessionId);
      return undefined;
    }
    watchFile(entry, true);
    if (!entry.ready) return undefined;
    entry.key = keyOf(entry.state);
    return shownPlan(entry.state);
  }

  /** 処理中でないセッション。記録は読まず、見張りもやめる（読んだ位置とリストは覚えたまま） */
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
