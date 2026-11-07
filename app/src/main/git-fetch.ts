// リモートの定期的な取得（git fetch）。設定でオンにしたときだけ動かす（既定はオフ）。
// 作業中のファイル、インデックス、ローカルのブランチ、HEAD、stash には触れず、refs/remotes と取ってきたオブジェクトだけを書く。
// 決まりは docs/design/git-fetch.md。git status の待ち行列（git-status.ts）とは別にし、一度に 1 つずつ動かす。

import { execFile } from 'node:child_process';
import type { FetchFailure, FetchStatus } from '../shared/types';

export type { FetchFailure, FetchStatus };

/** 1 回の取得を待つ長さ */
export const FETCH_TIMEOUT_MS = 60_000;
/** 起動から（または設定でオンにしてから）最初の取得までの長さ。起動直後の読み込みと重ねない */
export const FIRST_DELAY_MS = 60_000;
/** ロックで失敗したときに、やり直すまでの長さ（やり直しは 1 度だけ） */
export const RETRY_DELAY_MS = 60_000;


/** `git -C <dir>` に続ける引数。--prune は付けない（ユーザーの fetch.prune には従う） */
export function fetchArgs(remote: string): string[] {
  return ['-c', 'credential.interactive=never', 'fetch', '--no-auto-gc', '--no-auto-maintenance', '--no-write-fetch-head', '--quiet', remote];
}

/** ログインの画面を出さないための環境変数 */
export const FETCH_ENV = { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' } as const;

/** git の標準エラーの文と、打ち切ったかどうかから、失敗の種類を決める */
export function classifyFetchError(message: string, timedOut: boolean): FetchFailure {
  const m = message.toLowerCase();
  if (/cannot lock ref|index\.lock|unable to create '[^']*\.lock'|\.lock': file exists/.test(m)) return 'lock';
  if (/authentication failed|could not read username|could not read password|permission denied \(publickey/.test(m)) return 'auth';
  if (
    timedOut ||
    /could not resolve host|unable to access|failed to connect|connection timed out|timed out|network is unreachable|could not read from remote repository|connection reset|connection refused|no route to host/.test(m)
  )
    return 'offline';
  return 'other';
}

/** リポジトリごとの取得の記録 */
export interface FetchRecord {
  /** 最後に試した時刻 */
  triedAt?: number;
  /** 最後にうまくいった時刻 */
  okAt?: number;
  /** 最後の失敗（うまくいったら消す） */
  failure?: FetchFailure;
  /** ロックで失敗し、やり直しを待っている。その時刻 */
  retryAt?: number;
  /** 認証の失敗で止めている。開き直すか「今すぐ取得」を押すまで取得しない */
  stopped?: boolean;
}

/**
 * 次に取得する時刻。止めているなら undefined。
 * まだ試していなければ startedAt（起動か、オンにした時刻）の 1 分後、ロックのやり直しを待っていればその時刻、
 * それ以外は最後に試してから間隔ぶんあと
 */
export function nextFetchAt(record: FetchRecord | undefined, startedAt: number, intervalMs: number): number | undefined {
  if (record?.stopped) return undefined;
  if (record?.retryAt !== undefined) return record.retryAt;
  if (record?.triedAt === undefined) return startedAt + FIRST_DELAY_MS;
  return record.triedAt + intervalMs;
}

/** 取得を 1 回試したあとの記録。result は 'ok' か失敗の種類 */
export function afterFetch(prev: FetchRecord | undefined, now: number, result: 'ok' | FetchFailure): FetchRecord {
  const okAt = result === 'ok' ? now : prev?.okAt;
  const base: FetchRecord = { triedAt: now, ...(okAt !== undefined && { okAt }) };
  if (result === 'ok') return base;
  // ロック：1 分後に 1 度だけやり直す。やり直しでもだめなら、次の回まで待つ
  if (result === 'lock') return prev?.retryAt !== undefined ? { ...base, failure: 'lock' } : { ...base, failure: 'lock', retryAt: now + RETRY_DELAY_MS };
  if (result === 'auth') return { ...base, failure: 'auth', stopped: true };
  return { ...base, failure: result };
}

/** 設定の分を、取得の間隔（ms）にする。選べる値でなければ既定の 10 分 */
export function fetchIntervalMs(minutes: number): number {
  return ([5, 10, 30].includes(minutes) ? minutes : 10) * 60_000;
}

/** 取得するリポジトリ */
export interface FetchTarget {
  /** 目印（元のリポジトリの .git を小文字にしたもの） */
  commonDir: string;
  /** git を動かすフォルダ（元のフォルダか、そのワークツリー） */
  dir: string;
  /** 元のフォルダのブランチ。その追跡先のリモートから取る */
  branch: string;
  /** 設定画面に出す名前 */
  name: string;
}


export type RunFetch = (dir: string, remote: string) => Promise<void>;
export type ReadRemote = (dir: string, branch: string) => Promise<string | undefined>;

/** 失敗したら、標準エラーの文と打ち切ったかどうかを持つ Error で終わる */
function runFetch(dir: string, remote: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['-C', dir, ...fetchArgs(remote)],
      { timeout: FETCH_TIMEOUT_MS, windowsHide: true, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, ...FETCH_ENV } },
      (err, _stdout, stderr) => {
        if (!err) return resolve();
        const e = new Error(String(stderr || err.message)) as Error & { timedOut?: boolean };
        e.timedOut = (err as { killed?: boolean }).killed === true;
        reject(e);
      },
    );
  });
}

/** 元のフォルダのブランチの追跡先のリモート（branch.<名前>.remote）。ないか、手元（.）なら undefined */
function readRemote(dir: string, branch: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['--no-optional-locks', '-C', dir, 'config', '--get', `branch.${branch}.remote`],
      { timeout: 5_000, windowsHide: true },
      (err, stdout) => {
        const remote = err ? '' : stdout.trim();
        resolve(remote && remote !== '.' ? remote : undefined);
      },
    );
  });
}

/**
 * 取得の待ち行列。tick を定期的に呼ぶと、時刻の来たリポジトリを並べて 1 つずつ取得する。
 * 取得が終わったら（うまくいっても失敗しても）onFetched を呼ぶ。様子が変わったら onStatus を呼ぶ
 */
export function createGitFetch(
  onFetched: (commonDir: string) => void,
  onStatus: () => void = () => {},
  run: RunFetch = runFetch,
  remoteOf: ReadRemote = readRemote,
  now = () => Date.now(),
) {
  let enabled = false;
  let intervalMs = fetchIntervalMs(10);
  /** 起動か、オンにした時刻。最初の取得はこの 1 分後 */
  let startedAt = now();
  let targets = new Map<string, FetchTarget>();
  const records = new Map<string, FetchRecord>();
  /** 分かったリモート（マージ済みを refs/remotes で調べるのに使う） */
  const remotes = new Map<string, string>();
  let queue: string[] = [];
  let running: string | undefined;

  async function drain() {
    if (running) return;
    while (enabled && queue.length) {
      const key = queue.shift()!;
      const target = targets.get(key);
      if (!target) continue;
      running = key;
      onStatus();
      let result: 'ok' | FetchFailure | undefined;
      const remote = await remoteOf(target.dir, target.branch);
      if (remote) {
        remotes.set(key, remote);
        try {
          await run(target.dir, remote);
          result = 'ok';
        } catch (e) {
          result = classifyFetchError(String((e as Error)?.message ?? ''), (e as { timedOut?: boolean })?.timedOut === true);
        }
      } else remotes.delete(key);
      // リモートがなければ取得しない（試した時刻だけ残し、次の回にまた調べる）
      records.set(key, result ? afterFetch(records.get(key), now(), result) : { ...records.get(key), triedAt: now() });
      running = undefined;
      onStatus();
      if (result) onFetched(key);
    }
  }

  /** 時刻の来たリポジトリを並べる */
  function tick() {
    if (!enabled) return;
    const t = now();
    for (const key of targets.keys()) {
      if (key === running || queue.includes(key)) continue;
      const at = nextFetchAt(records.get(key), startedAt, intervalMs);
      if (at !== undefined && t >= at) {
        // やり直しの時刻に並べたら、その印は afterFetch が見るので残す
        queue.push(key);
      }
    }
    void drain();
  }

  return {
    /** 取得するリポジトリ（アーカイブしていないカードがあるもの）。外れたものは待ち行列からも外す */
    setTargets(list: FetchTarget[]) {
      targets = new Map(list.map((t) => [t.commonDir, t]));
      queue = queue.filter((k) => targets.has(k));
    },
    /** 設定が変わったとき。オフにしたら待ち行列を空にし、記録を消す。オンにしたら、その 1 分後から取得する */
    setOptions(opts: { enabled: boolean; minutes: number }) {
      intervalMs = fetchIntervalMs(opts.minutes);
      if (opts.enabled === enabled) return;
      enabled = opts.enabled;
      queue = [];
      records.clear();
      remotes.clear();
      startedAt = now();
      onStatus();
    },
    tick,
    /** 今すぐ取得：止めていたリポジトリも含め、すべてを並べる */
    fetchNow() {
      if (!enabled) return;
      for (const key of targets.keys()) {
        const r = records.get(key);
        if (r?.stopped) records.set(key, { ...r, stopped: false });
        if (key !== running && !queue.includes(key)) queue.push(key);
      }
      onStatus();
      void drain();
    },
    /** 取得がオンで、リモートが分かっていればその名前 */
    remoteOf(commonDir: string): string | undefined {
      return enabled ? remotes.get(commonDir) : undefined;
    },
    status(): FetchStatus {
      let lastAt: number | undefined;
      const failures: FetchStatus['failures'] = [];
      for (const [key, r] of records) {
        if (r.okAt !== undefined && (lastAt === undefined || r.okAt > lastAt)) lastAt = r.okAt;
        // オフラインは出さない。ロックはやり直しを待っている間は出さない
        if (!r.failure || r.failure === 'offline' || (r.failure === 'lock' && r.retryAt !== undefined)) continue;
        failures.push({ name: targets.get(key)?.name ?? key, failure: r.failure });
      }
      return { enabled, running: running !== undefined || queue.length > 0, ...(lastAt !== undefined && { lastAt }), failures };
    },
  };
}
