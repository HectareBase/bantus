// ウィジェットを Windows のアプリバー（SHAppBarMessage）として登録する。登録すると、ほかのウィンドウを最大化しても
// ウィジェットの帯に重ならない（作業領域からウィジェットの分が引かれる）。
//
// Node から shell32.dll を直接呼べないので、foreground.ts と同じく PowerShell を 1 つ動かし続け、1 行（命令）送るたびに 1 行で答えさせる。
// foreground.ts の PowerShell には相乗りせず、別に動かす。理由は 3 つ：
// - 終わり方が違う。foreground.ts は終了時に kill するが、こちらは ABM_REMOVE を確実に呼びたいので、標準入力を閉じて
//   PowerShell 自身に外させる。Bantus が落ちたときも、標準入力が切れるので PowerShell が外してから終わる
// - SHAppBarMessage はエクスプローラーに SendMessage するので、エクスプローラーが固まると待たされる。同じ列に並べると、
//   前面のプロセス名の問い合わせやセッションを開く命令まで遅れる
// - 固定（pinned）がオンのときだけ要る。撮影だけのときなど、foreground.ts を起動しない場面とも切り離せる
//
// 命令（答えは 1 行）
// - new <hwnd>：ABM_NEW で登録する。答えは「コールバックのメッセージ番号 TaskbarCreated のメッセージ番号」
// - query <hwnd> <edge> <left> <top> <right> <bottom>：ABM_QUERYPOS。答えはシェルが直した矩形「left top right bottom」
// - set <hwnd> <edge> <left> <top> <right> <bottom>：ABM_SETPOS。答えは決まった矩形
// - remove <hwnd>：ABM_REMOVE。答えは 1
// 標準入力が閉じたら（Bantus が終わった、落ちた）、PowerShell は登録したままのものを外してから終わる（スクリプトの finally）。
// 座標はどれも物理ピクセル。PowerShell はふつう DPI を意識しないので、呼ぶたびにスレッドを Per-Monitor v2 にしてから呼ぶ

import { screen, type BrowserWindow } from 'electron';
import { abEdge, fitWidth, fromLtrb, proposeRect, sameLtrb, toLtrb, type Edge, type Ltrb, type PlacedBar, type Rect } from './appbar-place';
import { createPowerShellLine } from './powershell-line';

const SCRIPT = `
Add-Type -Namespace Bantus -Name AppBar -MemberDefinition @'
[StructLayout(LayoutKind.Sequential)] public struct RECT { public int left; public int top; public int right; public int bottom; }
[StructLayout(LayoutKind.Sequential)] public struct APPBARDATA { public uint cbSize; public IntPtr hWnd; public uint uCallbackMessage; public uint uEdge; public RECT rc; public IntPtr lParam; }
[DllImport("shell32.dll")] public static extern UIntPtr SHAppBarMessage(uint msg, ref APPBARDATA data);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern uint RegisterWindowMessage(string name);
[DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr ctx);
static APPBARDATA Data(long h) {
  SetThreadDpiAwarenessContext(new IntPtr(-4));
  var d = new APPBARDATA();
  d.cbSize = (uint)Marshal.SizeOf(typeof(APPBARDATA));
  d.hWnd = new IntPtr(h);
  return d;
}
public static string Register(long h) {
  var d = Data(h);
  d.uCallbackMessage = RegisterWindowMessage("BantusAppBarCallback");
  SHAppBarMessage(0, ref d);
  return d.uCallbackMessage + " " + RegisterWindowMessage("TaskbarCreated");
}
public static string Pos(uint msg, long h, uint edge, int l, int t, int r, int b) {
  var d = Data(h);
  d.uEdge = edge;
  d.rc.left = l; d.rc.top = t; d.rc.right = r; d.rc.bottom = b;
  SHAppBarMessage(msg, ref d);
  return d.rc.left + " " + d.rc.top + " " + d.rc.right + " " + d.rc.bottom;
}
public static void Remove(long h) {
  var d = Data(h);
  SHAppBarMessage(1, ref d);
}
'@
$bar = [long]0
try {
  while ($null -ne ($line = [Console]::In.ReadLine())) {
    $w = $line.Trim() -split ' '
    $answer = switch ($w[0]) {
      'new' { $bar = [long]$w[1]; [Bantus.AppBar]::Register($bar) }
      'query' { [Bantus.AppBar]::Pos(2, [long]$w[1], [uint32]$w[2], [int]$w[3], [int]$w[4], [int]$w[5], [int]$w[6]) }
      'set' { [Bantus.AppBar]::Pos(3, [long]$w[1], [uint32]$w[2], [int]$w[3], [int]$w[4], [int]$w[5], [int]$w[6]) }
      'remove' { [Bantus.AppBar]::Remove([long]$w[1]); if ($bar -eq [long]$w[1]) { $bar = [long]0 }; '1' }
      default { '' }
    }
    [Console]::Out.WriteLine($answer)
    [Console]::Out.Flush()
  }
} finally {
  if ($bar -ne 0) { [Bantus.AppBar]::Remove($bar) }
}
`;

/** ABN_POSCHANGED と ABN_FULLSCREENAPP（コールバックの wParam） */
const ABN_POSCHANGED = 1;
const ABN_FULLSCREENAPP = 2;
const TIMEOUT_MS = 3000;

/** アプリバーにしたい場所。monitor はモニター全体（作業領域ではない）、width はウィジェットの幅。どれも画面の座標（DIP） */
export interface AppBarWant {
  edge: Edge;
  monitor: Rect;
  width: number;
}

export interface AppBarHost {
  window(): BrowserWindow | undefined;
  /** 今アプリバーにしたい場所。登録しないなら undefined */
  wanted(): AppBarWant | undefined;
  /** 帯の場所が決まった（undefined なら外した） */
  onPlaced(bar: PlacedBar | undefined): void;
  /** 全画面のアプリが開いた・閉じた */
  onFullscreen(on: boolean): void;
}

export interface AppBar {
  /** 登録する・置き直す・外すを、今の wanted() に合わせる。続けて呼ばれても、1 つずつまとめて行う */
  sync(): void;
  /**
   * 置いた場所を覚え直す。Windows の拡大率が変わると、物理ピクセルの場所は同じでも DIP の場所が変わるので、
   * 同じ場所でも SETPOS し直して onPlaced を呼ぶ（呼ばないと、ウィジェットと縁取りが古い DIP の場所のまま残る）
   */
  refresh(): void;
  /** 外して PowerShell を終える（終了するとき） */
  stop(): void;
}

function handleOf(w: BrowserWindow): string {
  const b = w.getNativeWindowHandle();
  return (b.length >= 8 ? b.readBigUInt64LE(0) : BigInt(b.readUInt32LE(0))).toString();
}

function parseLtrb(line: string | undefined): Ltrb | undefined {
  const n = line?.split(' ').map(Number);
  if (!n || n.length !== 4 || !n.every(Number.isFinite)) return undefined;
  const [left, top, right, bottom] = n as [number, number, number, number];
  return { left, top, right, bottom };
}

function ltrb(r: Ltrb): string {
  return `${r.left} ${r.top} ${r.right} ${r.bottom}`;
}

/** Windows 以外では何もしないものを返す */
export function createAppBar(host: AppBarHost): AppBar {
  if (process.platform !== 'win32') return { sync: () => {}, refresh: () => {}, stop: () => {} };
  const ps = createPowerShellLine(SCRIPT, 'appbar');
  /** 登録しているウィンドウのハンドル */
  let registered: string | undefined;
  /** メッセージを受ける仕掛けをしたウィンドウ */
  let hooked: BrowserWindow | undefined;
  /** 最後に ABM_SETPOS した矩形と端（物理ピクセル）。同じなら SETPOS し直さない（ABN_POSCHANGED が往復し続けないように） */
  let lastSet: { edge: Edge; rc: Ltrb } | undefined;
  let fullscreen = false;
  let running = false;
  let again = false;
  let stopped = false;

  function setFullscreen(on: boolean) {
    if (fullscreen === on) return;
    fullscreen = on;
    host.onFullscreen(on);
  }

  function hook(w: BrowserWindow, callback: number, taskbarCreated: number) {
    if (hooked === w) return;
    hooked = w;
    w.hookWindowMessage(callback, (wParam, lParam) => {
      const code = wParam.readUInt32LE(0);
      if (code === ABN_POSCHANGED) sync();
      // lParam が 0 でなければ全画面のアプリが開いた、0 なら閉じた
      else if (code === ABN_FULLSCREENAPP) setFullscreen(lParam.readUInt32LE(0) !== 0);
    });
    // エクスプローラーが起動し直すと、登録は消える。登録し直す
    if (taskbarCreated > 0) {
      w.hookWindowMessage(taskbarCreated, () => {
        registered = undefined;
        lastSet = undefined;
        sync();
      });
    }
  }

  async function remove() {
    if (!registered) return;
    const h = registered;
    registered = undefined;
    lastSet = undefined;
    await ps.ask(`remove ${h}`, TIMEOUT_MS);
    setFullscreen(false);
    host.onPlaced(undefined);
  }

  async function step() {
    const w = host.window();
    const want = w && !w.isDestroyed() ? host.wanted() : undefined;
    if (!w || w.isDestroyed() || !want) return remove();
    const h = handleOf(w);
    if (registered && registered !== h) await remove();
    if (!registered) {
      const ids = (await ps.ask(`new ${h}`, TIMEOUT_MS))?.split(' ').map(Number);
      const callback = ids?.[0];
      if (!callback) return;
      registered = h;
      hook(w, callback, ids?.[1] ?? 0);
    }
    // DIP を物理ピクセルにする。null を渡すと、矩形のいちばん近くのモニターの拡大率で変換される
    const monitor = screen.dipToScreenRect(null, want.monitor);
    const width = Math.round(want.width * (monitor.width / want.monitor.width));
    const edge = abEdge(want.edge);
    const queried = parseLtrb(await ps.ask(`query ${h} ${edge} ${ltrb(proposeRect(want.edge, toLtrb(monitor), width))}`, TIMEOUT_MS));
    if (!queried || registered !== h) return;
    const next = fitWidth(want.edge, queried, width);
    if (lastSet && lastSet.edge === want.edge && sameLtrb(lastSet.rc, next)) return;
    const placed = parseLtrb(await ps.ask(`set ${h} ${edge} ${ltrb(next)}`, TIMEOUT_MS));
    if (!placed || registered !== h) return;
    lastSet = { edge: want.edge, rc: next };
    host.onPlaced({ edge: want.edge, rect: screen.screenToDipRect(null, fromLtrb(placed)) });
  }

  function sync() {
    if (stopped) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    void (async () => {
      try {
        do {
          again = false;
          await step();
        } while (again && !stopped);
      } catch (e) {
        console.error('アプリバーを登録し直せませんでした：', e);
      } finally {
        running = false;
      }
    })();
  }

  function refresh() {
    lastSet = undefined;
    sync();
  }

  function stop() {
    stopped = true;
    if (registered) ps.send(`remove ${registered}`);
    registered = undefined;
    // 標準入力を閉じる。PowerShell は残りの命令を片付け、登録したままのものを外してから終わる
    ps.close();
  }

  return { sync, refresh, stop };
}
