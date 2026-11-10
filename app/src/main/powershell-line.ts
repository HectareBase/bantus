// 常駐する PowerShell に 1 行（命令）送り、1 行で答えさせる仕組み。foreground.ts と同じ方式（アプリバーの appbar.ts が使う）。
// PowerShell は最初の命令を送るときに起動し、落ちたら次の命令で起動し直す。

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

type Waiter = { resolve: (line: string | undefined) => void; done: boolean };

export interface PowerShellLine {
  /** 命令を 1 行送り、答えの 1 行を返す。PowerShell が使えないときや時間切れは undefined */
  ask(command: string, timeoutMs: number): Promise<string | undefined>;
  /** 答えを待たずに 1 行送る（終わるときの片付け用）。答えは読み捨てる */
  send(command: string): void;
  /** 標準入力を閉じる。PowerShell は残りの命令を片付けてから自分で終わる */
  close(): void;
}

export function createPowerShellLine(script: string): PowerShellLine {
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

  function ensureChild(): ChildProcessWithoutNullStreams | undefined {
    if (child) return child;
    if (closed || process.platform !== 'win32') return undefined;
    // -EncodedCommand（UTF-16LE の base64）なら、引数の引用符を気にしなくてよい
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const p = spawn('powershell.exe', ['-NoProfile', '-NoLogo', '-NonInteractive', '-EncodedCommand', encoded], { windowsHide: true });
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      let at: number;
      while ((at = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, at).trim();
        buffer = buffer.slice(at + 1);
        settle(waiting.shift(), line);
      }
    });
    p.stderr.on('data', (chunk: Buffer) => console.error('PowerShell：', chunk.toString().trim()));
    const reset = () => {
      if (child !== p) return;
      child = undefined;
      buffer = '';
      for (const w of waiting.splice(0)) settle(w, undefined);
    };
    p.on('exit', reset);
    p.on('error', reset);
    p.stdin.on('error', reset);
    child = p;
    return p;
  }

  function ask(command: string, timeoutMs: number): Promise<string | undefined> {
    const p = ensureChild();
    if (!p) return Promise.resolve(undefined);
    return new Promise((resolve) => {
      const w: Waiter = { resolve, done: false };
      waiting.push(w);
      setTimeout(() => settle(w, undefined), timeoutMs);
      p.stdin.write(`${command}\n`);
    });
  }

  function send(command: string) {
    if (!child) return;
    waiting.push({ resolve: () => {}, done: false });
    child.stdin.write(`${command}\n`);
  }

  function close() {
    closed = true;
    child?.stdin.end();
  }

  return { ask, send, close };
}
