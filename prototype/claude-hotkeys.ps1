# Claude デスクトップ用ショートカット。shortcuts.json のキーを登録して常駐する。
# 起動: start-hotkeys.cmd（-STA で動かす必要がある）

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $here 'session-list.ps1')

# 二重起動を防ぐ
$mutex = New-Object System.Threading.Mutex($false, 'Local\ClaudeHelperHotkeys')
if (-not $mutex.WaitOne(0)) { exit 0 }

Add-Type -ReferencedAssemblies PresentationCore, WindowsBase -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Windows.Interop;

public class ClaudeHotkeys : IDisposable {
    [DllImport("user32.dll")] static extern bool RegisterHotKey(IntPtr hWnd, int id, uint mods, uint vk);
    [DllImport("user32.dll")] static extern bool UnregisterHotKey(IntPtr hWnd, int id);

    const int WM_HOTKEY = 0x0312;
    const uint MOD_NOREPEAT = 0x4000;
    readonly HwndSource source;
    int nextId = 1;

    public event Action<int> Pressed;

    public ClaudeHotkeys() {
        var p = new HwndSourceParameters("ClaudeHotkeys");
        p.ParentWindow = new IntPtr(-3); // HWND_MESSAGE: 見えないメッセージ専用ウィンドウ
        source = new HwndSource(p);
        source.AddHook(Hook);
    }

    // 登録できたら id、他のアプリが使用中なら 0
    public int Register(uint mods, uint vk) {
        int id = nextId++;
        return RegisterHotKey(source.Handle, id, mods | MOD_NOREPEAT, vk) ? id : 0;
    }

    IntPtr Hook(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled) {
        if (msg == WM_HOTKEY) {
            var h = Pressed;
            if (h != null) h(wParam.ToInt32());
            handled = true;
        }
        return IntPtr.Zero;
    }

    public void Dispose() {
        for (int i = 1; i < nextId; i++) UnregisterHotKey(source.Handle, i);
        source.Dispose();
    }
}
'@

function ConvertTo-HotkeyCode([string]$Text) {
    # "Ctrl+Alt+Space" → @{ Mods; Vk }
    $mods = 0; $key = $null
    foreach ($part in $Text.Split('+') | ForEach-Object { $_.Trim() }) {
        switch -Regex ($part) {
            '^(Ctrl|Control)$' { $mods = $mods -bor 2; continue }
            '^Alt$'            { $mods = $mods -bor 1; continue }
            '^Shift$'          { $mods = $mods -bor 4; continue }
            '^Win$'            { $mods = $mods -bor 8; continue }
            '^\d$'             { $key = "D$part"; continue }
            default            { $key = $part }
        }
    }
    $k = [Enum]::Parse([System.Windows.Input.Key], $key, $true)
    return @{ Mods = [uint32]$mods; Vk = [uint32][System.Windows.Input.KeyInterop]::VirtualKeyFromKey($k) }
}

function Invoke-HotkeyAction($Action) {
    if ($Action.action -eq 'toggleList') { Switch-SessionList; return }
    if ($Action.open) {
        Open-ClaudeSession ([pscustomobject]@{ SessionId = $Action.open; Title = '' }) $script:Config | Out-Null
        return
    }
    if ($Action.openByTitle) {
        $q = $Action.openByTitle
        $s = Get-ClaudeSessions $script:Config | Where-Object { $_.Title -like "*$q*" } | Select-Object -First 1
        if ($s) { Open-ClaudeSession $s $script:Config | Out-Null }
        return
    }
    if ($Action.click) {
        $name = $Action.click
        Invoke-ClaudeButton { param($n) $n -eq $name } | Out-Null
    }
}

# 手元の設定（shortcuts.json、git には入れない）がなければ見本を使う
$configPath = Join-Path $here 'shortcuts.json'
if (-not (Test-Path $configPath)) { $configPath = Join-Path $here 'shortcuts.example.json' }
$script:Config = [IO.File]::ReadAllText($configPath, (New-Object System.Text.UTF8Encoding($false))) | ConvertFrom-Json

New-SessionListWindow $script:Config (Join-Path $here 'session-list.xaml')

$script:Hotkeys = New-Object ClaudeHotkeys
$script:Actions = @{}
$failed = @()
foreach ($prop in $script:Config.hotkeys.PSObject.Properties) {
    try {
        $code = ConvertTo-HotkeyCode $prop.Name
        $id = $script:Hotkeys.Register($code.Mods, $code.Vk)
        if ($id) { $script:Actions[$id] = $prop.Value } else { $failed += "$($prop.Name)（他のアプリが使用中）" }
    } catch {
        $failed += "$($prop.Name)（キー名を解釈できません）"
    }
}
$script:Hotkeys.add_Pressed({
    param($id)
    try { Invoke-HotkeyAction $script:Actions[$id] } catch { }
})

if ($failed) {
    [System.Windows.MessageBox]::Show("登録できなかったショートカット:`n" + ($failed -join "`n"), 'Claude ショートカット') | Out-Null
}
if ($script:Config.showListOnStart) { Show-SessionList }

try {
    [System.Windows.Threading.Dispatcher]::Run()
} finally {
    $script:Hotkeys.Dispose()
    $mutex.ReleaseMutex()
}
