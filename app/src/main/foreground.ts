// 前面にあるウィンドウのプロセス名を調べる。Claude のウィンドウを前に出す（docs/research/deep-link-and-uia.md）。
// Node から user32.dll を直接呼べないので、PowerShell を 1 つ動かし続け、1 行（命令）送るたびに 1 行で答えさせる。
// 起動と Add-Type に 1〜2 秒かかるので、起動したら一度だけ作っておく。
//
// 命令
// - fg：前面のウィンドウのプロセス名を答える（わからなければ空行）
// - raise：Claude のメインウィンドウを前に出し、前に出せたら 1、出せなかったら 0 を答える

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

// 前面にないプロセスの SetForegroundWindow は Windows に断られる（タスクバーが点滅するだけ）。
// 断られたら、どこにも割り当てのない仮想キー（0x88）を押して離したことにしてから、もう一度呼ぶ。
// 入力があったことで前面の切り替えの制限が外れる。0x88 はどのアプリも使わないので、前面のアプリには何も起きない
const SCRIPT = `
Add-Type -Namespace Bantus -Name Win -MemberDefinition @'
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
[DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
'@
function Get-FgName {
  $id = [uint32]0
  [void][Bantus.Win]::GetWindowThreadProcessId([Bantus.Win]::GetForegroundWindow(), [ref]$id)
  $p = Get-Process -Id $id -ErrorAction SilentlyContinue
  if ($p) { $p.ProcessName } else { '' }
}
function Invoke-Raise {
  $p = Get-Process -Name claude -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } | Select-Object -First 1
  if (-not $p) { return '0' }
  $h = $p.MainWindowHandle
  if ([Bantus.Win]::IsIconic($h)) { [void][Bantus.Win]::ShowWindow($h, 9) }
  $ok = [Bantus.Win]::SetForegroundWindow($h)
  if (-not $ok) {
    [Bantus.Win]::keybd_event([byte]0x88, 0, 0, [UIntPtr]::Zero)
    [Bantus.Win]::keybd_event([byte]0x88, 0, 2, [UIntPtr]::Zero)
    $ok = [Bantus.Win]::SetForegroundWindow($h)
  }
  if ($ok -and (Get-FgName) -eq 'claude') { '1' } else { '0' }
}
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $answer = if ($line.Trim() -eq 'raise') { Invoke-Raise } else { Get-FgName }
  [Console]::Out.WriteLine($answer)
  [Console]::Out.Flush()
}
`;

type Command = 'fg' | 'raise';
type Waiter = { resolve: (line: string | undefined) => void; done: boolean };

let child: ChildProcessWithoutNullStreams | undefined;
let buffer = '';
/** 答えは送った順に返ってくる。時間切れになったものも、答えが来るまで列に残す（順番をずらさないため） */
const waiting: Waiter[] = [];

function settle(w: Waiter | undefined, line: string | undefined) {
  if (!w || w.done) return;
  w.done = true;
  w.resolve(line);
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
      settle(waiting.shift(), line);
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

/** 命令を 1 行送り、答えの 1 行を返す。PowerShell が使えないときや時間切れは undefined */
function ask(command: Command, timeoutMs: number): Promise<string | undefined> {
  const p = ensureChild();
  if (!p) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const w: Waiter = { resolve, done: false };
    waiting.push(w);
    setTimeout(() => settle(w, undefined), timeoutMs);
    p.stdin.write(`${command}\n`);
  });
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
export async function foregroundProcessName(timeoutMs = 1000): Promise<string | undefined> {
  return (await ask('fg', timeoutMs)) || undefined;
}

/**
 * Claude のメインウィンドウを前に出す（最小化されていれば元に戻す）。
 * 前に出して、前面のプロセスが claude になったときだけ true。断られたとき、PowerShell が使えないとき、時間切れは false
 */
export async function raiseClaudeWindow(timeoutMs = 1000): Promise<boolean> {
  return (await ask('raise', timeoutMs)) === '1';
}
