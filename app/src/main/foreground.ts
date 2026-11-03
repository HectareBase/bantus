// 前面にあるウィンドウのプロセス名を調べる（docs/research/deep-link-and-uia.md）。
// Node から user32.dll を直接呼べないので、GetForegroundWindow を呼ぶ PowerShell を 1 つ動かし続け、1 行送るたびに 1 行で答えさせる。
// 起動と Add-Type に 1〜2 秒かかるので、起動したら一度だけ作っておく。

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

const SCRIPT = `
Add-Type -Namespace Bantus -Name Win -MemberDefinition @'
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
'@
while ($null -ne [Console]::In.ReadLine()) {
  $id = [uint32]0
  [void][Bantus.Win]::GetWindowThreadProcessId([Bantus.Win]::GetForegroundWindow(), [ref]$id)
  $p = Get-Process -Id $id -ErrorAction SilentlyContinue
  [Console]::Out.WriteLine($(if ($p) { $p.ProcessName } else { '' }))
  [Console]::Out.Flush()
}
`;

type Waiter = { resolve: (name: string | undefined) => void; done: boolean };

let child: ChildProcessWithoutNullStreams | undefined;
let buffer = '';
/** 答えは送った順に返ってくる。時間切れになったものも、答えが来るまで列に残す（順番をずらさないため） */
const waiting: Waiter[] = [];

function settle(w: Waiter | undefined, name: string | undefined) {
  if (!w || w.done) return;
  w.done = true;
  w.resolve(name);
}

function ensureChild(): ChildProcessWithoutNullStreams | undefined {
  if (child) return child;
  if (process.platform !== 'win32') return undefined;
  // -EncodedCommand（UTF-16LE の base64）なら、引数の引用符を気にしなくてよい
  const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64');
  const p = spawn('powershell.exe', ['-NoProfile', '-NoLogo', '-NonInteractive', '-EncodedCommand', encoded], {
    windowsHide: true,
  });
  p.stdout.setEncoding('utf8');
  p.stdout.on('data', (chunk: string) => {
    buffer += chunk;
    let at: number;
    while ((at = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, at).trim();
      buffer = buffer.slice(at + 1);
      settle(waiting.shift(), line || undefined);
    }
  });
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

/** 先に PowerShell を起動しておく（最初の問い合わせを待たせない） */
export function startForegroundProbe() {
  ensureChild();
}

export function stopForegroundProbe() {
  const p = child;
  child = undefined;
  for (const w of waiting.splice(0)) settle(w, undefined);
  p?.kill();
}

/** 前面のウィンドウのプロセス名（例：claude）。わからないときや時間切れは undefined */
export function foregroundProcessName(timeoutMs = 1000): Promise<string | undefined> {
  const p = ensureChild();
  if (!p) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const w: Waiter = { resolve, done: false };
    waiting.push(w);
    setTimeout(() => settle(w, undefined), timeoutMs);
    p.stdin.write('\n');
  });
}
