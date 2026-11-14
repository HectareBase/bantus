# 全画面のアプリを開いたときに、Bantus のウィンドウが手前に残るかを記録する検証用スクリプト。
# 使い方: powershell -NoProfile -File tools\watch-fullscreen.ps1 [-LogPath <ログのパス>] [-ProcessNames electron,bantus] [-IntervalMs 200]
# 前面のウィンドウと Bantus のウィンドウ（ウィジェット、めくれ、ツールチップ、縁取り）の様子を調べ、変わったときだけ 1 行書く。
# ウィンドウのタイトルが入るので、既定ではリポジトリ直下の local/（git に入れない）に書く。
#
# 1 行の中身
# - FG：前面のウィンドウ。プロセス名、ハンドル、矩形、モニター全体を覆っているか（full=1）、SHQueryUserNotificationState の値
#   （2 = 全画面で忙しい QUNS_BUSY、3 = D3D の全画面、4 = プレゼンテーション、5 = 通常 QUNS_ACCEPTS_NOTIFICATIONS）
# - Bantus のウィンドウごとに：ハンドル、クラス、矩形、最前面の印（top=1 は WS_EX_TOPMOST）、
#   前面のウィンドウより手前にあるか（above=1。前面のウィンドウから GW_HWNDPREV でたどって見つかれば手前）、
#   前面のウィンドウと同じモニターか（same=1）
# ウィジェットの top が 1 から 0 になれば、アプリが ABN_FULLSCREENAPP を受けたとわかる（main.ts の applyAlwaysOnTop）。
# top=0 なのに above=1 のままなら、最前面を外しても全画面のアプリより手前に残っている。

param(
    [string]$LogPath = (Join-Path (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)) 'local\fullscreen-log.txt'),
    [string[]]$ProcessNames = @('electron', 'bantus'),
    [int]$IntervalMs = 200
)

Add-Type -Namespace BantusProbe -Name Win -UsingNamespace System.Text, System.Collections.Generic -MemberDefinition @'
[StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
[StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
[DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint cmd);
[DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int index);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder sb, int max);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
[DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr hWnd, uint flags);
[DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr mon, ref MONITORINFO mi);
[DllImport("shell32.dll")] public static extern int SHQueryUserNotificationState(out int state);
[DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hWnd, int attr, out int value, int size);

public static List<IntPtr> TopLevel() {
  var list = new List<IntPtr>();
  EnumWindows((h, l) => { list.Add(h); return true; }, IntPtr.Zero);
  return list;
}
public static string ClassOf(IntPtr h) { var sb = new StringBuilder(256); GetClassName(h, sb, 256); return sb.ToString(); }
public static string TitleOf(IntPtr h) { var sb = new StringBuilder(256); GetWindowText(h, sb, 256); return sb.ToString(); }
public static bool Topmost(IntPtr h) { return (GetWindowLongPtr(h, -20).ToInt64() & 0x8) != 0; }
public static bool Cloaked(IntPtr h) { int v; return DwmGetWindowAttribute(h, 14, out v, 4) == 0 && v != 0; }
// h が fg より手前にあるか。fg から一つ手前（GW_HWNDPREV = 3）へたどる
public static bool Above(IntPtr h, IntPtr fg) {
  if (fg == IntPtr.Zero || h == fg) return false;
  for (IntPtr p = GetWindow(fg, 3); p != IntPtr.Zero; p = GetWindow(p, 3)) if (p == h) return true;
  return false;
}
public static RECT MonitorRect(IntPtr h, out IntPtr mon) {
  mon = MonitorFromWindow(h, 2);
  var mi = new MONITORINFO(); mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
  GetMonitorInfo(mon, ref mi);
  return mi.rcMonitor;
}
'@

function RectText($r) { '{0},{1},{2},{3}' -f $r.Left, $r.Top, $r.Right, $r.Bottom }

function ProcessNameOf([IntPtr]$h) {
    $procId = [uint32]0
    [void][BantusProbe.Win]::GetWindowThreadProcessId($h, [ref]$procId)
    try { return (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch { return '?' }
}

$utf8 = New-Object System.Text.UTF8Encoding($false)
New-Item -ItemType Directory -Force (Split-Path -Parent $LogPath) | Out-Null
$names = $ProcessNames | ForEach-Object { $_.ToLower() }
$last = ''
Write-Host "記録先: $LogPath（Ctrl+C で終わる）"

while ($true) {
    $pids = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $names -contains $_.ProcessName.ToLower() } | ForEach-Object { $_.Id })
    $fg = [BantusProbe.Win]::GetForegroundWindow()
    $fgRect = New-Object BantusProbe.Win+RECT
    [void][BantusProbe.Win]::GetWindowRect($fg, [ref]$fgRect)
    $fgMon = [IntPtr]::Zero
    $mon = [BantusProbe.Win]::MonitorRect($fg, [ref]$fgMon)
    $full = [int]($fgRect.Left -le $mon.Left -and $fgRect.Top -le $mon.Top -and $fgRect.Right -ge $mon.Right -and $fgRect.Bottom -ge $mon.Bottom)
    $quns = 0
    [void][BantusProbe.Win]::SHQueryUserNotificationState([ref]$quns)
    $parts = @("FG $(ProcessNameOf $fg) $fg [$(RectText $fgRect)] full=$full quns=$quns cls=$([BantusProbe.Win]::ClassOf($fg))")

    foreach ($h in [BantusProbe.Win]::TopLevel()) {
        if (-not [BantusProbe.Win]::IsWindowVisible($h) -or [BantusProbe.Win]::Cloaked($h)) { continue }
        $procId = [uint32]0
        [void][BantusProbe.Win]::GetWindowThreadProcessId($h, [ref]$procId)
        if ($pids -notcontains [int]$procId) { continue }
        $r = New-Object BantusProbe.Win+RECT
        [void][BantusProbe.Win]::GetWindowRect($h, [ref]$r)
        if ($r.Right -le $r.Left -or $r.Bottom -le $r.Top) { continue }
        $m = [IntPtr]::Zero
        [void][BantusProbe.Win]::MonitorRect($h, [ref]$m)
        $top = [int][BantusProbe.Win]::Topmost($h)
        $above = [int][BantusProbe.Win]::Above($h, $fg)
        $same = [int]($m -eq $fgMon)
        $parts += "  $h $([BantusProbe.Win]::ClassOf($h)) '$([BantusProbe.Win]::TitleOf($h))' [$(RectText $r)] top=$top above=$above same=$same"
    }

    $snapshot = $parts -join "`r`n"
    if ($snapshot -ne $last) {
        $last = $snapshot
        $line = '{0:HH:mm:ss.fff}  {1}' -f (Get-Date), $snapshot
        [IO.File]::AppendAllText($LogPath, $line + "`r`n", $utf8)
        Write-Host $line
    }
    Start-Sleep -Milliseconds $IntervalMs
}
