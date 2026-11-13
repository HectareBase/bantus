// 前面にあるウィンドウのプロセス名を調べる。Claude のウィンドウを前に出す（docs/research/deep-link-and-uia.md）。
// Node から user32.dll を直接呼べないので、PowerShell を 1 つ動かし続け、1 行（命令）送るたびに 1 行で答えさせる。
// 起動と Add-Type に 1〜2 秒かかるので、起動したら一度だけ作っておく。
//
// 命令
// - fg：前面のウィンドウのプロセス名を答える（わからなければ空行）
// - raise：Claude のメインウィンドウを前に出し、前に出せたら 1、出せなかったら 0 を答える
// - open <base64>：セッションへ切り替える。中身は「local_ID と、データフォルダを改行で区切ったもの」の UTF-8 を base64 にした 1 語。
//   本体に WM_COPYDATA を送り、受け付けられたら 1、ウィンドウがない・送れない・結果が 0 なら 0 を答える
// - wins <ウィジェットのハンドル> <自分のプロセス ID>：ウィジェットと同じモニターにある、タスクバーに出るウィンドウを手前から順に答える
//   （ウィンドウの切り替え。docs/design/window-switcher.md）。答えは「W」のあとに、ウィンドウごとの
//   「;ハンドル:最小化(0/1):前面(0/1):プロセスの起動時刻:パス:タイトル」。起動時刻は FILETIME（わからなければ 0）、
//   パスとタイトルは UTF-8 の base64。Claude（プロセス名 claude）と自分のプロセスのウィンドウは入れない。調べられなければ空行
// - front <ハンドル> <自分のプロセス ID>：そのウィンドウを前に出す（最小化されていれば元に戻す）。前に出せたら 1、ウィンドウがもうない・断られたら 0。
//   もう前面にある（下の「前面とみなすウィンドウ」）ときは、タスクバーと同じく最小化して 2
// - icon <ハンドル> <0/1>：ウィンドウのアイコン（タスクバーや Alt+Tab に出るもの）を PNG の base64 で答える。1 なら大きいほうを先に探す。
//   取れなければ空行

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { helperCommand } from './native-helper';

// 前面にないプロセスの SetForegroundWindow は Windows に断られる（タスクバーが点滅するだけ）。
// 断られたら、どこにも割り当てのない仮想キー（0x88）を押して離したことにしてから、もう一度呼ぶ。
// 入力があったことで前面の切り替えの制限が外れる。0x88 はどのアプリも使わないので、前面のアプリには何も起きない
//
// open では 0x88 を押したことにしてから AllowSetForegroundWindow で本体に前に出る許可を渡し、WM_COPYDATA（0x4A）を
// SendMessageTimeout（SMTO_ABORTIFHUNG = 2、1 秒で打ち切り）で送る。メッセージ専用ウィンドウの親は HWND_MESSAGE（-3）
//
// wins の列挙は C#（List）でまとめて行う。ウィンドウごとに PowerShell のパイプラインや Get-Process を通すと遅い。
// - タスクバーに出るもの：見えている、タイトルがある、ツールウィンドウ（WS_EX_TOOLWINDOW = 0x80）でない、
//   WS_EX_APPWINDOW（0x40000）が付いているか「所有者（GW_OWNER = 4）がなく WS_EX_NOACTIVATE（0x08000000）でもない」、
//   DWM で隠されていない（DWMWA_CLOAKED = 14。ほかの仮想デスクトップや、裏で待っているストアアプリ）、
//   タスクバーから外されていない（ITaskbarList::DeleteTab で外すと、Windows がウィンドウに ITaskList_Deleted のプロパティを付ける。
//   Electron の skipTaskbar もこれ。文書にない印なので、Windows が変えたら効かなくなり、そのウィンドウも並ぶだけ）
// - モニターは MonitorFromWindow（MONITOR_DEFAULTTONEAREST = 2）で比べる。最小化したウィンドウは画面の外（-32000）にあるので、
//   GetWindowPlacement の元に戻したときの場所（rcNormalPosition）から MonitorFromRect で引く
// - 実行ファイルのパスは OpenProcess（PROCESS_QUERY_LIMITED_INFORMATION = 0x1000）と QueryFullProcessImageName で引く。
//   管理者で動いているプロセスでも引ける。引けなければ空のまま並べる。起動時刻（GetProcessTimes）は並び順に使う
// - 前面とみなすウィンドウ（FrontWindow）：前面のウィンドウ（GetForegroundWindow）の一番上の所有者（GetAncestor の GA_ROOTOWNER = 3）。
//   ただし前面が Bantus 自身（帯を押すとウィジェットが前面になる）のときは、Bantus 以外で、最小化しておらずタスクバーに出るウィンドウのうち
//   一番手前のもの（直前まで前面だったもの）。最前面に固定したウィンドウ（WS_EX_TOPMOST = 0x8）は、前面でなくても手前にいるので飛ばす。
//   一覧の前面の印と、front で最小化するかどうかの両方に使う
// - アイコンは WM_GETICON（0x7F。ICON_BIG = 1、ICON_SMALL2 = 2、ICON_SMALL = 0）を SendMessageTimeout（200 ms で打ち切り）で聞き、
//   なければクラスのアイコン（GCLP_HICON = -14、GCLP_HICONSM = -34）。実行ファイルのアイコンと違い、タスクバーと同じ絵になる。
//   アイコンはウィンドウのものなので破棄しない
const SCRIPT = `
Add-Type -Namespace Bantus -Name Win -UsingNamespace System.Text, System.Collections.Generic -ReferencedAssemblies System.Drawing -MemberDefinition @'
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
public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
[DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int max);
[DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int index);
[DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint cmd);
[DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr hWnd, uint flags);
[DllImport("user32.dll")] public static extern IntPtr MonitorFromRect(ref RECT rc, uint flags);
[DllImport("user32.dll")] public static extern bool GetWindowPlacement(IntPtr hWnd, ref WINDOWPLACEMENT wp);
[DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hWnd, int attr, out int value, int size);
[DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
[DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
[DllImport("kernel32.dll", CharSet = CharSet.Unicode)] public static extern bool QueryFullProcessImageName(IntPtr h, uint flags, StringBuilder name, ref int size);
[StructLayout(LayoutKind.Sequential)] public struct RECT { public int left, top, right, bottom; }
[StructLayout(LayoutKind.Sequential)] public struct POINT { public int x, y; }
[StructLayout(LayoutKind.Sequential)] public struct WINDOWPLACEMENT { public int length, flags, showCmd; public POINT min, max; public RECT normal; }
[DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hWnd, uint flags);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr GetProp(IntPtr hWnd, string name);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextLength(IntPtr hWnd);
[DllImport("kernel32.dll")] public static extern bool GetProcessTimes(IntPtr h, out long creation, out long exit, out long kernel, out long user);
[DllImport("user32.dll", EntryPoint = "SendMessageTimeoutW")] public static extern IntPtr SendIconMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);
[DllImport("user32.dll", EntryPoint = "GetClassLongPtrW")] public static extern IntPtr GetClassLongPtr(IntPtr hWnd, int index);
static string B64(string s) { return Convert.ToBase64String(Encoding.UTF8.GetBytes(s)); }
static string ExePath(uint pid, out long created) {
  string path = "";
  created = 0;
  IntPtr p = OpenProcess(0x1000, false, pid);
  if (p == IntPtr.Zero) return path;
  StringBuilder name = new StringBuilder(1024);
  int size = name.Capacity;
  if (QueryFullProcessImageName(p, 0, name, ref size)) path = name.ToString(0, size);
  long exit, kernel, user;
  if (!GetProcessTimes(p, out created, out exit, out kernel, out user)) created = 0;
  CloseHandle(p);
  return path;
}
static IntPtr IconMessage(IntPtr h, int which) {
  IntPtr r;
  return SendIconMessage(h, 0x7F, (IntPtr)which, IntPtr.Zero, 2, 200, out r) == IntPtr.Zero ? IntPtr.Zero : r;
}
public static string IconPng(IntPtr h, bool big) {
  if (!IsWindow(h)) return "";
  int[] order = big ? new int[] { 1, -14, 2, 0, -34 } : new int[] { 2, 0, -34, 1, -14 };
  IntPtr icon = IntPtr.Zero;
  foreach (int k in order) {
    icon = k >= 0 ? IconMessage(h, k) : GetClassLongPtr(h, k);
    if (icon != IntPtr.Zero) break;
  }
  if (icon == IntPtr.Zero) return "";
  try {
    using (System.Drawing.Icon ic = System.Drawing.Icon.FromHandle(icon))
    using (System.Drawing.Bitmap bmp = ic.ToBitmap())
    using (System.IO.MemoryStream ms = new System.IO.MemoryStream()) {
      bmp.Save(ms, System.Drawing.Imaging.ImageFormat.Png);
      return Convert.ToBase64String(ms.ToArray());
    }
  } catch { return ""; }
}
static bool OnTaskbar(IntPtr h) {
  if (!IsWindowVisible(h)) return false;
  int ex = GetWindowLong(h, -20);
  if ((ex & 0x80) != 0) return false;
  if ((ex & 0x40000) == 0 && ((ex & 0x08000000) != 0 || GetWindow(h, 4) != IntPtr.Zero)) return false;
  int cloaked;
  if (DwmGetWindowAttribute(h, 14, out cloaked, 4) == 0 && cloaked != 0) return false;
  return GetProp(h, "ITaskList_Deleted") == IntPtr.Zero;
}
public static IntPtr FrontWindow(uint selfPid) {
  IntPtr fg = GetForegroundWindow();
  if (fg != IntPtr.Zero) {
    uint pid;
    GetWindowThreadProcessId(fg, out pid);
    if (pid != selfPid) {
      IntPtr root = GetAncestor(fg, 3);
      return root == IntPtr.Zero ? fg : root;
    }
  }
  IntPtr first = IntPtr.Zero;
  EnumWindows(delegate(IntPtr h, IntPtr l) {
    uint pid;
    GetWindowThreadProcessId(h, out pid);
    if (pid == selfPid || IsIconic(h) || (GetWindowLong(h, -20) & 0x8) != 0 || !OnTaskbar(h) || GetWindowTextLength(h) == 0) return true;
    first = h;
    return false;
  }, IntPtr.Zero);
  return first;
}
public static string List(IntPtr self, uint selfPid) {
  IntPtr monitor = MonitorFromWindow(self, 2);
  IntPtr front = FrontWindow(selfPid);
  StringBuilder sb = new StringBuilder("W");
  StringBuilder text = new StringBuilder(512);
  Dictionary<uint, string> paths = new Dictionary<uint, string>();
  Dictionary<uint, long> times = new Dictionary<uint, long>();
  EnumWindows(delegate(IntPtr h, IntPtr l) {
    if (h == self || !OnTaskbar(h)) return true;
    text.Length = 0;
    if (GetWindowText(h, text, text.Capacity) == 0) return true;
    uint pid;
    GetWindowThreadProcessId(h, out pid);
    if (pid == selfPid) return true;
    bool min = IsIconic(h);
    IntPtr m;
    if (min) {
      WINDOWPLACEMENT wp = new WINDOWPLACEMENT();
      wp.length = Marshal.SizeOf(typeof(WINDOWPLACEMENT));
      if (!GetWindowPlacement(h, ref wp)) return true;
      m = MonitorFromRect(ref wp.normal, 2);
    } else m = MonitorFromWindow(h, 2);
    if (m != monitor) return true;
    string path;
    long created;
    if (!paths.TryGetValue(pid, out path)) { path = ExePath(pid, out created); paths[pid] = path; times[pid] = created; }
    else created = times[pid];
    if (path.Length > 0 && string.Equals(System.IO.Path.GetFileNameWithoutExtension(path), "claude", StringComparison.OrdinalIgnoreCase)) return true;
    string title = text.ToString();
    if (title.Length > 200) title = title.Substring(0, 200);
    bool active = h == front;
    sb.Append(';').Append(h.ToInt64()).Append(':').Append(min ? '1' : '0').Append(':').Append(active ? '1' : '0').Append(':').Append(created)
      .Append(':').Append(B64(path)).Append(':').Append(B64(title));
    return true;
  }, IntPtr.Zero);
  return sb.ToString();
}
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
function Get-Windows([string]$arg) {
  $parts = "$arg" -split ' '
  $h = [long]0
  $id = [uint32]0
  if ($parts.Length -ne 2 -or -not [long]::TryParse($parts[0], [ref]$h) -or -not [uint32]::TryParse($parts[1], [ref]$id)) { return '' }
  try { [Bantus.Win]::List([IntPtr]$h, $id) } catch { '' }
}
function Get-Icon([string]$arg) {
  $parts = "$arg" -split ' '
  $h = [long]0
  if ($parts.Length -ne 2 -or -not [long]::TryParse($parts[0], [ref]$h)) { return '' }
  try { [Bantus.Win]::IconPng([IntPtr]$h, $parts[1] -eq '1') } catch { '' }
}
function Invoke-Front([string]$arg) {
  $parts = "$arg" -split ' '
  $n = [long]0
  $id = [uint32]0
  if ($parts.Length -ne 2 -or -not [long]::TryParse($parts[0], [ref]$n) -or -not [uint32]::TryParse($parts[1], [ref]$id)) { return '0' }
  $h = [IntPtr]$n
  if (-not [Bantus.Win]::IsWindow($h)) { return '0' }
  if (-not [Bantus.Win]::IsIconic($h) -and [Bantus.Win]::FrontWindow($id) -eq $h) {
    [void][Bantus.Win]::ShowWindow($h, 6)
    return '2'
  }
  if ([Bantus.Win]::IsIconic($h)) { [void][Bantus.Win]::ShowWindow($h, 9) }
  $ok = [Bantus.Win]::SetForegroundWindow($h)
  if (-not $ok) {
    [Bantus.Win]::keybd_event([byte]0x88, 0, 0, [UIntPtr]::Zero)
    [Bantus.Win]::keybd_event([byte]0x88, 0, 2, [UIntPtr]::Zero)
    $ok = [Bantus.Win]::SetForegroundWindow($h)
  }
  if ($ok) { '1' } else { '0' }
}
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $words = $line.Trim() -split ' ', 2
  $answer = switch ($words[0]) {
    'raise' { Invoke-Raise }
    'open' { Invoke-Open $words[1] }
    'wins' { Get-Windows $words[1] }
    'front' { Invoke-Front $words[1] }
    'icon' { Get-Icon $words[1] }
    default { Get-FgName }
  }
  [Console]::Out.WriteLine($answer)
  [Console]::Out.Flush()
}
`;

type Command = 'fg' | 'raise' | `open ${string}` | `wins ${string}` | `front ${string}` | `icon ${string}`;
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
  const { command, args } = helperCommand('foreground', SCRIPT);
  const p = spawn(command, args, { windowsHide: true });
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

/** ウィンドウのハンドル（10 進の数字）として受け付ける形 */
const HANDLE = /^\d{1,20}$/;

/**
 * ウィジェット（widgetHandle はそのウィンドウのハンドル）と同じモニターにある、タスクバーに出るウィンドウの一覧を 1 行で返す。
 * 読み方は window-switcher.ts の parseWindowList。PowerShell が使えないとき、時間切れは undefined
 */
export function askWindowList(widgetHandle: string, pid: number, timeoutMs = 1500): Promise<string | undefined> {
  if (!HANDLE.test(widgetHandle) || !Number.isInteger(pid) || pid <= 0) return Promise.resolve(undefined);
  return ask(`wins ${widgetHandle} ${pid}`, timeoutMs);
}

/**
 * ウィンドウのアイコン（タスクバーや Alt+Tab に出るもの）を PNG の data URL で返す。big なら大きいほう（32px）を先に探す。
 * 取れないとき、ウィンドウがもうないとき、PowerShell が使えないとき、時間切れは undefined
 */
export async function windowIcon(handle: string, big: boolean, timeoutMs = 1500): Promise<string | undefined> {
  if (!HANDLE.test(handle)) return undefined;
  const png = await ask(`icon ${handle} ${big ? 1 : 0}`, timeoutMs);
  return png && /^[A-Za-z0-9+/]+={0,2}$/.test(png) ? `data:image/png;base64,${png}` : undefined;
}

/**
 * ハンドルのウィンドウを前に出す（最小化されていれば元に戻す）。もう前面にあれば最小化する（タスクバーのボタンと同じ）。
 * pid は Bantus 自身のプロセス（帯を押してウィジェットが前面になったときに、直前の前面のウィンドウを見るため）。
 * 前に出したら 'front'、最小化したら 'minimized'。ウィンドウがもうない、Windows に断られた、PowerShell が使えない、時間切れは undefined
 */
export async function toggleWindow(handle: string, pid: number, timeoutMs = 1000): Promise<'front' | 'minimized' | undefined> {
  if (!HANDLE.test(handle) || !Number.isInteger(pid) || pid <= 0) return undefined;
  const answer = await ask(`front ${handle} ${pid}`, timeoutMs);
  return answer === '1' ? 'front' : answer === '2' ? 'minimized' : undefined;
}
