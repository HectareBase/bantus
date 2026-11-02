# Claude デスクトップのセッション一覧ウィンドウ。claude-hotkeys.ps1 から読み込んで使う。
# アプリのデータフォルダは読むだけで、書き換えない。

Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes

$script:Utf8 = New-Object System.Text.UTF8Encoding($false)

function Read-JsonFile([string]$Path) {
    # 書き込み途中のファイルを読むことがあるので、失敗したら $null を返す
    try { return [IO.File]::ReadAllText($Path, $script:Utf8) | ConvertFrom-Json } catch { return $null }
}

function Get-RunningStatus {
    # ~/.claude/sessions/<pid>.json: 実行中の CLI セッションの busy / idle
    $map = @{}
    $dir = Join-Path $env:USERPROFILE '.claude\sessions'
    foreach ($f in Get-ChildItem $dir -Filter '*.json' -ErrorAction SilentlyContinue) {
        $d = Read-JsonFile $f.FullName
        if (-not $d -or -not $d.sessionId) { continue }
        if (-not (Get-Process -Id $d.pid -ErrorAction SilentlyContinue)) { continue }
        $map[$d.sessionId] = $d.status
    }
    return $map
}

function Format-Ago([long]$EpochMs) {
    if (-not $EpochMs) { return '' }
    $span = [DateTimeOffset]::UtcNow - [DateTimeOffset]::FromUnixTimeMilliseconds($EpochMs)
    if ($span.TotalMinutes -lt 1) { return 'たった今' }
    if ($span.TotalHours -lt 1) { return '{0} 分前' -f [int]$span.TotalMinutes }
    if ($span.TotalDays -lt 1) { return '{0} 時間前' -f [int]$span.TotalHours }
    return '{0} 日前' -f [int]$span.TotalDays
}

function Get-ClaudeSessions($Config) {
    $root = Join-Path $env:LOCALAPPDATA 'Claude-Data'
    $files = Get-ChildItem $root -Recurse -Filter 'local_*.json' -ErrorAction SilentlyContinue |
        Where-Object { $_.Directory.Parent.Parent.Name -eq 'claude-code-sessions' }
    $running = Get-RunningStatus

    $items = foreach ($f in $files) {
        $d = Read-JsonFile $f.FullName
        if (-not $d -or $d.isArchived) { continue }

        $folder = if ($d.cwd) { Split-Path $d.cwd -Leaf } else { '' }
        $color = $Config.defaultColor
        if ($Config.folderColors -and $Config.folderColors.$folder) { $color = $Config.folderColors.$folder }

        $status = $running[$d.cliSessionId]
        $mark = ''; $markColor = '#9CA3AF'; $rank = 2
        if ($status -eq 'busy') { $mark = '●'; $markColor = '#F97316'; $rank = 0 }
        elseif ($status) { $mark = '○'; $markColor = '#22C55E'; $rank = 1 }

        $detail = $d.title
        if ($d.postTurnSummary -and $d.postTurnSummary.status_detail) { $detail += "`n" + $d.postTurnSummary.status_detail }

        [pscustomobject]@{
            SessionId = $d.sessionId
            Title     = if ($d.title) { $d.title } else { '(無題)' }
            Folder    = $folder
            Color     = $color
            Mark      = $mark
            MarkColor = $markColor
            When      = Format-Ago $d.lastActivityAt
            Detail    = $detail
            Rank      = $rank
            Activity  = [long]$d.lastActivityAt
        }
    }
    # 処理中 → 起動中 → その他、それぞれ新しい順
    return @($items | Sort-Object Rank, @{ Expression = 'Activity'; Descending = $true })
}

function Get-ClaudeWindow {
    $p = Get-Process -Name claude -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    if (-not $p) { return $null }
    return [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
}

function Invoke-ClaudeButton([scriptblock]$Match) {
    # UIA で Claude ウィンドウ内のボタンを探して押す。見つからなければ $false
    $win = Get-ClaudeWindow
    if (-not $win) { return $false }
    $cond = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::Button)
    foreach ($el in $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)) {
        if (& $Match $el.Current.Name) {
            $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
            return $true
        }
    }
    return $false
}

function Open-ClaudeSession($Session, $Config) {
    if ($Config.openMethod -eq 'uia') {
        # サイドバーの行は「タイトル フォルダ名」という名前のボタン
        $title = $Session.Title
        $ok = Invoke-ClaudeButton { param($n) $n -eq $title -or ($n.StartsWith("$title ") -and -not $n.EndsWith('のその他のオプション')) }
        if ($ok) { return $true }
    }
    Start-Process "claude://claude.ai/epitaxy/$($Session.SessionId)"
    return $true
}

function New-SessionListWindow($Config, [string]$XamlPath) {
    # イベントハンドラは Dispatcher.Run() 中にスクリプトのスコープで動くので、状態は $script:UI に置く
    $reader = [System.Xml.XmlReader]::Create($XamlPath)
    $win = [System.Windows.Markup.XamlReader]::Load($reader)
    $reader.Close()

    $script:UI = @{
        Window   = $win
        List     = $win.FindName('SessionList')
        Search   = $win.FindName('SearchBox')
        Config   = $Config
        All      = @()
        Quitting = $false
    }

    $script:UI.Search.add_TextChanged({ Update-SessionFilter })
    $script:UI.List.add_MouseLeftButtonUp({ Open-SelectedSession })
    $win.add_PreviewKeyDown({
        param($s, $e)
        $list = $script:UI.List
        switch ($e.Key) {
            'Escape' { $script:UI.Window.Hide(); $e.Handled = $true }
            'Return' { Open-SelectedSession; $e.Handled = $true }
            'Down'   { if ($list.SelectedIndex -lt $list.Items.Count - 1) { $list.SelectedIndex++ }; $list.ScrollIntoView($list.SelectedItem); $e.Handled = $true }
            'Up'     { if ($list.SelectedIndex -gt 0) { $list.SelectedIndex-- }; $list.ScrollIntoView($list.SelectedItem); $e.Handled = $true }
        }
    })
    # × は隠すだけ。終了は「終了」ボタンから
    $win.add_Closing({ param($s, $e) if (-not $script:UI.Quitting) { $e.Cancel = $true; $script:UI.Window.Hide() } })
    $win.FindName('QuitButton').add_Click({
        $script:UI.Quitting = $true
        $script:UI.Window.Close()
        $script:UI.Window.Dispatcher.InvokeShutdown()
    })

    $timer = New-Object System.Windows.Threading.DispatcherTimer
    $timer.Interval = [TimeSpan]::FromSeconds([Math]::Max(1, [int]$Config.refreshSeconds))
    $timer.add_Tick({ if ($script:UI.Window.IsVisible) { Update-SessionList } })
    $timer.Start()
    $script:UI.Timer = $timer
}

function Update-SessionFilter {
    $list = $script:UI.List
    $selectedId = if ($list.SelectedItem) { $list.SelectedItem.SessionId }
    $q = $script:UI.Search.Text.Trim()
    $list.ItemsSource = if ($q) {
        @($script:UI.All | Where-Object { $_.Title -like "*$q*" -or $_.Folder -like "*$q*" })
    } else { $script:UI.All }
    # 自動更新で選択が先頭に戻らないようにする
    $i = 0
    if ($selectedId) {
        for ($k = 0; $k -lt $list.Items.Count; $k++) { if ($list.Items[$k].SessionId -eq $selectedId) { $i = $k; break } }
    }
    if ($list.Items.Count -gt 0) { $list.SelectedIndex = $i }
}

function Update-SessionList {
    $script:UI.All = Get-ClaudeSessions $script:UI.Config
    Update-SessionFilter
}

function Open-SelectedSession {
    $s = $script:UI.List.SelectedItem
    if (-not $s) { return }
    Open-ClaudeSession $s $script:UI.Config | Out-Null
    if ($script:UI.Config.hideListAfterOpen) { $script:UI.Window.Hide() }
}

function Show-SessionList {
    $script:UI.Search.Text = ''
    Update-SessionList
    $script:UI.Window.Show()
    $script:UI.Window.Activate() | Out-Null
    $script:UI.Search.Focus() | Out-Null
}

function Switch-SessionList {
    if ($script:UI.Window.IsVisible -and $script:UI.Window.IsActive) { $script:UI.Window.Hide() } else { Show-SessionList }
}
