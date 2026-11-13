// 常駐の補助プログラムに 1 行（命令）送り、1 行で答えさせる仕組み。foreground.ts（前面のウィンドウ）と appbar.ts（アプリバー）が使う。
// Node から Windows の API を直接呼べないので、補助プログラムを動かし続ける（docs/design/native-helper.md）。
//
// 起動するのは C で書いた bantus-helper.exe（native/bantus-helper.c）。インストール版は resources に、
// 開発中は native/build に置く（npm run build:native）。exe がない、起動できない（セキュリティソフトや AppLocker に止められた）、
// 一度も答えずに落ちたときは、同じ命令に答える PowerShell のスクリプト（呼ぶ側が渡す）に切り替え、答えていない命令を送り直す。
// 環境変数 BANTUS_HELPER=powershell なら、初めから PowerShell を使う（比べるとき用）。
// 補助プログラムは最初の命令を送るときに起動し、落ちたら次の命令で起動し直す。

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** foreground：foreground.ts の命令。appbar：appbar.ts の命令（exe には引数 appbar を付ける） */
export type HelperMode = 'foreground' | 'appbar';

type Waiter = { command: string; resolve: (line: string | undefined) => void; done: boolean };

export interface HelperLine {
  /** 起動しておく（最初の問い合わせを待たせない） */
  start(): void;
  /** 命令を 1 行送り、答えの 1 行を返す。使えないときや時間切れは undefined */
  ask(command: string, timeoutMs: number): Promise<string | undefined>;
  /** 答えを待たずに 1 行送る（終わるときの片付け用）。答えは読み捨てる */
  send(command: string): void;
  /** 標準入力を閉じる。補助プログラムは残りの命令を片付けてから自分で終わる。そのあとは起動し直さない */
  close(): void;
}

/** exe を探す場所。インストール版の resources と、開発中のビルド結果（dist/node/main から見た native/build） */
export function helperExeCandidates(resourcesPath: string | undefined, dirname: string): string[] {
  const dev = join(dirname, '..', '..', '..', 'native', 'build', 'bantus-helper.exe');
  return resourcesPath ? [join(resourcesPath, 'bantus-helper.exe'), dev] : [dev];
}

/** exe を使えないと分かったか（一度分かったら、このあとはどちらの使い方でも PowerShell にする） */
let nativeFailed = false;

/** Electron なら process.resourcesPath がある（テストの Node にはない） */
function nativeExe(): string | undefined {
  if (nativeFailed || process.env.BANTUS_HELPER === 'powershell') return undefined;
  return helperExeCandidates((process as { resourcesPath?: string }).resourcesPath, __dirname).find((p) => existsSync(p));
}

/** findExe は exe のパス（使わないなら undefined）。テストで差し替える */
export function createHelperLine(mode: HelperMode, script: string, findExe: () => string | undefined = nativeExe): HelperLine {
  let child: ChildProcessWithoutNullStreams | undefined;
  let buffer = '';
  let closed = false;
  /** 答えは送った順に返ってくる。時間切れになったものも、答えが来るまで列に残す（順番をずらさないため） */
  const waiting: Waiter[] = [];

  function settle(w: Waiter | undefined, line: string | undefined) {
    if (!w || w.done) return;
    w.done = true;
    w.resolve(line);
  }

  function giveUpNative(exe: string, why: unknown) {
    nativeFailed = true;
    console.error(`補助プログラム（${exe}）を使えないので、PowerShell に切り替えます：`, why);
  }

  function launch(): ChildProcessWithoutNullStreams {
    let exe = nativeFailed ? undefined : findExe();
    let p: ChildProcessWithoutNullStreams | undefined;
    if (exe) {
      // 起動できないときは、error のイベントでなく、その場で例外になることがある（exe の形をしていない、止められたなど）
      try {
        p = spawn(exe, mode === 'appbar' ? ['appbar'] : [], { windowsHide: true });
      } catch (e) {
        giveUpNative(exe, e);
        exe = undefined;
      }
    }
    // -EncodedCommand（UTF-16LE の base64）なら、引数の引用符を気にしなくてよい
    p ??= spawn('powershell.exe', ['-NoProfile', '-NoLogo', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
      windowsHide: true,
    });
    let answered = false;
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', (chunk: string) => {
      answered = true;
      buffer += chunk;
      let at: number;
      while ((at = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, at).trim();
        buffer = buffer.slice(at + 1);
        // 答えの列から外すのは、答えが来たときだけ（時間切れのものも、ここで外れる）
        settle(waiting.shift(), line);
      }
    });
    p.stderr.on('data', (chunk: Buffer) => console.error('補助プログラム：', chunk.toString().trim()));
    const self = p;
    let gone = false;
    const reset = (failed: boolean) => {
      if (gone || child !== self) return;
      gone = true;
      child = undefined;
      buffer = '';
      // exe が起動できなかった、一度も答えずに落ちた。PowerShell に切り替え、答えていない命令を送り直す
      if (exe && failed && !answered) {
        giveUpNative(exe, 'answered nothing');
        const pending = waiting.filter((w) => !w.done);
        waiting.splice(0);
        if (!closed && pending.length > 0) {
          const next = launch();
          child = next;
          for (const w of pending) {
            waiting.push(w);
            next.stdin.write(`${w.command}\n`);
          }
          return;
        }
      }
      for (const w of waiting.splice(0)) settle(w, undefined);
    };
    p.on('exit', (code) => reset(code !== 0));
    p.on('error', () => reset(true));
    p.stdin.on('error', () => reset(true));
    return p;
  }

  function ensureChild(): ChildProcessWithoutNullStreams | undefined {
    if (child) return child;
    if (closed || process.platform !== 'win32') return undefined;
    child = launch();
    return child;
  }

  function ask(command: string, timeoutMs: number): Promise<string | undefined> {
    const p = ensureChild();
    if (!p) return Promise.resolve(undefined);
    return new Promise((resolve) => {
      const w: Waiter = { command, resolve, done: false };
      waiting.push(w);
      setTimeout(() => settle(w, undefined), timeoutMs);
      p.stdin.write(`${command}\n`);
    });
  }

  function send(command: string) {
    if (!child) return;
    waiting.push({ command, resolve: () => {}, done: false });
    child.stdin.write(`${command}\n`);
  }

  function close() {
    closed = true;
    child?.stdin.end();
  }

  return { start: () => void ensureChild(), ask, send, close };
}
