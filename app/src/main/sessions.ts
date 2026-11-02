// Claude デスクトップのセッション一覧と状態を読む。データは読むだけで、書き換えない。
// 読み取り元と項目は docs/data-sources.md、状態の判定は docs/session-status.md。

import { readFileSync, readdirSync, watch, type FSWatcher } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import type { SessionState, SessionView } from '../shared/types';

const RUNNING_DIR = join(homedir(), '.claude', 'sessions');

function claudeDataDirs(): string[] {
  const base = join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'Claude-Data');
  return listDirs(base)
    .filter((name) => name.startsWith('claude_'))
    .map((name) => join(base, name, 'claude-code-sessions'));
}

function listDirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
}

function listFiles(dir: string, pattern: RegExp): string[] {
  try {
    return readdirSync(dir).filter((name) => pattern.test(name)).map((name) => join(dir, name));
  } catch {
    return [];
  }
}

/** 書き込み途中のファイルを読むことがあるので、失敗したら undefined */
function readJson(path: string): any {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

function isAlive(pid: unknown): boolean {
  if (typeof pid !== 'number') return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // 権限がなくて調べられないだけなら、動いている
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** CLI のセッション ID → { status, waitingFor }。ファイルだけが残っているものは除く */
function readRunning(): Map<string, { status?: string; waitingFor?: string }> {
  const map = new Map<string, { status?: string; waitingFor?: string }>();
  for (const file of listFiles(RUNNING_DIR, /^\d+\.json$/)) {
    const d = readJson(file);
    if (!d?.sessionId || !isAlive(d.pid)) continue;
    map.set(d.sessionId, { status: d.status, waitingFor: d.waitingFor });
  }
  return map;
}

function toState(running: { status?: string } | undefined): SessionState {
  if (!running) return 'stopped';
  switch (running.status) {
    case 'waiting': return 'waiting';
    case 'busy': return 'busy';
    // 起動直後で status がまだない一瞬も含めて待機として扱う
    default: return 'idle';
  }
}

/** local_*.json が入っているフォルダ（アカウントごと） */
function sessionDirs(): string[] {
  const dirs: string[] = [];
  for (const root of claudeDataDirs()) {
    for (const a of listDirs(root)) {
      for (const b of listDirs(join(root, a))) dirs.push(join(root, a, b));
    }
  }
  return dirs;
}

export function readSessions(): SessionView[] {
  const running = readRunning();
  const views: SessionView[] = [];
  for (const dir of sessionDirs()) {
    for (const file of listFiles(dir, /^local_.*\.json$/)) {
      const d = readJson(file);
      if (!d?.sessionId || d.isArchived) continue;
      const r = running.get(d.cliSessionId);
      const state = toState(r);
      const summary = d.postTurnSummary ?? {};
      views.push({
        id: d.sessionId,
        title: d.title || '(無題)',
        folder: d.cwd ? basename(d.cwd) : '',
        state,
        waitingFor: state === 'waiting' ? r?.waitingFor : undefined,
        needsAction: summary.needs_action || undefined,
        detail: summary.status_detail || undefined,
        lastActivityAt: Number(d.lastActivityAt) || 0,
      });
    }
  }
  const order: Record<SessionState, number> = { waiting: 0, busy: 1, idle: 2, stopped: 3 };
  return views.sort((a, b) => order[a.state] - order[b.state] || b.lastActivityAt - a.lastActivityAt);
}

/**
 * 2 種類のフォルダを見張り、変化があったら（まとめて）onChange を呼ぶ。
 * fs.watch は取りこぼすことがあるので、低い頻度の読み直しも続ける。
 */
export function watchSessions(onChange: () => void, fallbackMs = 30_000): () => void {
  let timer: NodeJS.Timeout | undefined;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(onChange, 250);
  };

  const watchers: FSWatcher[] = [];
  for (const dir of [RUNNING_DIR, ...claudeDataDirs()]) {
    try {
      watchers.push(watch(dir, { recursive: true }, schedule));
    } catch {
      // フォルダがまだない場合は、低い頻度の読み直しに任せる
    }
  }
  const interval = setInterval(onChange, fallbackMs);

  return () => {
    clearTimeout(timer);
    clearInterval(interval);
    for (const w of watchers) w.close();
  };
}
