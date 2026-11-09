// 前面にあるウィンドウのプロセス名を調べる。Claude のウィンドウを前に出す（docs/research/deep-link-and-uia.md）。
// Node から user32.dll を直接呼べないので、PowerShell を 1 つ動かし続け、1 行（命令）送るたびに 1 行で答えさせる。
// 起動と Add-Type に 1〜2 秒かかるので、起動したら一度だけ作っておく。
//
// 命令
// - fg：前面のウィンドウのプロセス名を答える（わからなければ空行）
// - raise：Claude のメインウィンドウを前に出し、前に出せたら 1、出せなかったら 0 を答える
// - open <base64>：セッションへ切り替える。中身は「local_ID と、データフォルダを改行で区切ったもの」の UTF-8 を base64 にした 1 語。
//   本体に WM_COPYDATA を送り、受け付けられたら 1、ウィンドウがない・送れない・結果が 0 なら 0 を答える

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

// 前面にないプロセスの SetForegroundWindow は Windows に断られる（タスクバーが点滅するだけ）。
// 断られたら、どこにも割り当てのない仮想キー（0x88）を押して離したことにしてから、もう一度呼ぶ。
// 入力があったことで前面の切り替えの制限が外れる。0x88 はどのアプリも使わないので、前面のアプリには何も起きない
//
// open では 0x88 を押したことにしてから AllowSetForegroundWindow で本体に前に出る許可を渡し、WM_COPYDATA（0x4A）を
// SendMessageTimeout（SMTO_ABORTIFHUNG = 2、1 秒で打ち切り）で送る。メッセージ専用ウィンドウの親は HWND_MESSAGE（-3）
const SCRIPT = `
Add-Type -Namespace Bantus -Name Win -MemberDefinition @'
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
[DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
[DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(uint pid);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string title);
[DllImport("user32.dll")] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint msg, IntPtr wParam, ref COPYDATASTRUCT lParam, uint flags, uint timeout, out IntPtr result);
[StructLayout(LayoutKind.Sequential)] public struct COPYDATASTRUCT { public IntPtr dwData; public int cbData; public IntPtr lpData; }
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
function Invoke-Open([string]$arg) {
  $parts = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($arg)) -split "\`n"
  $id = $parts[0]
  if ($id -notmatch '^local_[0-9a-f-]{36}$') { return '0' }
  foreach ($dir in $parts[1..($parts.Length - 1)]) {
    if (-not $dir) { continue }
    $h = [Bantus.Win]::FindWindowEx([IntPtr](-3), [IntPtr]::Zero, 'Chrome_MessageWindow', $dir)
    if ($h -eq [IntPtr]::Zero) { continue }
    $owner = [uint32]0
    [void][Bantus.Win]::GetWindowThreadProcessId($h, [ref]$owner)
    $exe = (Get-Process -Id $owner -ErrorAction SilentlyContinue).Path
    if (-not $exe) { continue }
    [Bantus.Win]::keybd_event([byte]0x88, 0, 0, [UIntPtr]::Zero)
    [Bantus.Win]::keybd_event([byte]0x88, 0, 2, [UIntPtr]::Zero)
    [void][Bantus.Win]::AllowSetForegroundWindow($owner)
    $bytes = [Text.Encoding]::Unicode.GetBytes("START\`0$env:SystemRoot\`0\`"$exe\`" claude://claude.ai/epitaxy/$id\`0")
    $mem = [Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length + 2)
    try {
      [Runtime.InteropServices.Marshal]::Copy($bytes, 0, $mem, $bytes.Length)
      [Runtime.InteropServices.Marshal]::WriteInt16($mem, $bytes.Length, 0)
      $data = New-Object Bantus.Win+COPYDATASTRUCT
      $data.cbData = $bytes.Length + 2
      $data.lpData = $mem
      $result = [IntPtr]::Zero
      $sent = [Bantus.Win]::SendMessageTimeout($h, 0x4A, [IntPtr]::Zero, [ref]$data, 2, 1000, [ref]$result)
      if ($sent -ne [IntPtr]::Zero -and $result -ne [IntPtr]::Zero) { return '1' }
    } finally {
      [Runtime.InteropServices.Marshal]::FreeHGlobal($mem)
    }
  }
  '0'
}
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $words = $line.Trim() -split ' ', 2
  $answer = switch ($words[0]) {
    'raise' { Invoke-Raise }
    'open' { Invoke-Open $words[1] }
    default { Get-FgName }
  }
  [Console]::Out.WriteLine($answer)
  [Console]::Out.Flush()
}
`;

type Command = 'fg' | 'raise' | `open ${string}`;
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

/**
 * プロセスを起動せずにセッションへ切り替える。Electron の単一インスタンスの仕組みと同じ WM_COPYDATA を、
 * 本体のメッセージ専用ウィンドウ（タイトルがデータフォルダのパス）に直接送る（docs/research/deep-link-and-uia.md）。
 * 受け付けられたときだけ true。ウィンドウがない、送れない、結果が 0、PowerShell が使えない、時間切れは false
 */
export async function sendOpenToClaude(id: string, dataFolders: string[], timeoutMs = 1500): Promise<boolean> {
  if (dataFolders.length === 0) return false;
  const arg = Buffer.from([id, ...dataFolders].join('\n'), 'utf8').toString('base64');
  return (await ask(`open ${arg}`, timeoutMs)) === '1';
}
