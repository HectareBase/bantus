// main のチェックアウトから npm start したウィジェットを、main に入った新しいコードへ自動で切り替える。
// .git の HEAD とブランチ（refs/heads、packed-refs）を見張り、先頭のコミットが変わったら npm run build して、
// 変わったファイルに合わせて読み込み直すか起動し直す（決め方は update-plan.ts）。git は読むだけで、リポジトリを書き換えない。

import { execFile, spawn } from 'node:child_process';
import { watch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import { updatePlan } from './update-plan';

/** 続けて変わったとき（マージ、pull など）に、まとめて 1 回にするための待ち時間 */
const DEBOUNCE_MS = 3_000;
/** 見張りが取りこぼしたときのための、読み直しの間隔 */
const POLL_MS = 60_000;
const GIT_TIMEOUT_MS = 10_000;
const BUILD_TIMEOUT_MS = 5 * 60_000;

export interface SelfUpdateHandlers {
  /** ビルドできた。画面だけが変わったので、ウィンドウを読み込み直す */
  reload(): void;
  /** ビルドできた。メインプロセスなどが変わったので、起動し直す */
  relaunch(): void;
  /** 利用者に伝えること（失敗や、入れ直しが要ること）。undefined で消す */
  notice(message: string | undefined): void;
}

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['--no-optional-locks', ...args],
      { cwd, timeout: GIT_TIMEOUT_MS, windowsHide: true, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } },
      (err, stdout) => (err ? reject(err) : resolve(stdout.trim())),
    );
  });
}

/** npm run build を裏で動かす。失敗したら、出力の終わりを付けて reject */
function build(appPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', ['run', 'build'], { cwd: appPath, shell: true, windowsHide: true, timeout: BUILD_TIMEOUT_MS });
    let output = '';
    const keep = (d: Buffer) => (output = (output + d.toString()).slice(-4_000));
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`npm run build が失敗しました（${code}）\n${output}`))));
  });
}

/** 見張りを始める。止める関数を返す。git が使えなければ何もしない */
export function startSelfUpdate(appPath: string, handlers: SelfUpdateHandlers): () => void {
  const watchers: FSWatcher[] = [];
  let timer: NodeJS.Timeout | undefined;
  let poll: NodeJS.Timeout | undefined;
  let stopped = false;
  /** 今動いているコードのコミット */
  let current = '';
  /** ビルドに失敗したコミット。同じコミットで何度も試さない */
  let failed = '';
  let busy = false;
  let again = false;
  let root = '';

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void check(), DEBOUNCE_MS);
  };

  async function check() {
    if (stopped) return;
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    try {
      const head = await git(root, ['rev-parse', 'HEAD']);
      if (head === current || head === failed) return;
      let files: string[] | undefined;
      try {
        files = (await git(root, ['diff', '--name-only', current, head])).split('\n').filter(Boolean);
      } catch {
        // 前のコミットがなくなった（リベースなど）ときは、比べられないので起動し直す
      }
      const plan = files ? updatePlan(files) : 'relaunch';
      console.log(`新しいコミット ${head.slice(0, 7)}：${plan}`);
      if (plan === 'none') {
        current = head;
        return;
      }
      if (plan === 'reinstall') {
        current = head;
        handlers.notice('依存パッケージが変わりました。npm run setup を実行してから起動し直してください');
        return;
      }
      try {
        await build(appPath);
      } catch (e) {
        failed = head;
        console.error(e);
        handlers.notice('新しいコードをビルドできませんでした。今の版のまま動きます');
        return;
      }
      if (stopped) return;
      current = head;
      handlers.notice(undefined);
      if (plan === 'reload') handlers.reload();
      else handlers.relaunch();
    } catch (e) {
      console.error('新しいコミットを調べられませんでした：', e);
    } finally {
      busy = false;
      if (again && !stopped) {
        again = false;
        schedule();
      }
    }
  }

  /** 見張れなかったフォルダは飛ばす（ポーリングで拾う） */
  function watchDir(dir: string, recursive: boolean, relevant: (name: string | null) => boolean) {
    try {
      const w = watch(dir, { recursive }, (_event, name) => {
        if (relevant(name)) schedule();
      });
      w.on('error', () => w.close());
      watchers.push(w);
    } catch {
      // フォルダがないなど
    }
  }

  void (async () => {
    try {
      const [top, gitDir, commonDir, head] = (
        await git(appPath, ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-dir', '--git-common-dir', 'HEAD'])
      ).split('\n');
      if (!top || !gitDir || !commonDir || !head || stopped) return;
      root = top;
      current = head;
      // HEAD（ブランチの切り替え）、packed-refs（git gc などでまとめられたブランチ）、refs/heads（ふつうのブランチ）
      const headFiles = (name: string | null) => name === null || name === 'HEAD' || name === 'packed-refs';
      watchDir(gitDir, false, headFiles);
      if (commonDir !== gitDir) watchDir(commonDir, false, headFiles);
      watchDir(join(commonDir, 'refs', 'heads'), true, () => true);
      poll = setInterval(() => void check(), POLL_MS);
      console.log(`main に入ったコードへの自動の切り替えを始めました（${head.slice(0, 7)}）`);
    } catch (e) {
      console.error('git のリポジトリが見つからないので、自動の切り替えはしません：', e);
    }
  })();

  return () => {
    stopped = true;
    clearTimeout(timer);
    clearInterval(poll);
    for (const w of watchers) w.close();
  };
}
