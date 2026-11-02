# ~/.claude/sessions/*.json の状態の変化を記録する検証用スクリプト。
# 使い方: powershell -NoProfile -File tools\watch-status.ps1 [-LogPath <ログのパス>]
# ログにはセッションのタイトルが入るので、既定ではリポジトリ直下の local/（git に入れない）に書く。

param([string]$LogPath = (Join-Path (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)) 'local\status-log.txt'))

$utf8 = New-Object System.Text.UTF8Encoding($false)
$dir = Join-Path $env:USERPROFILE '.claude\sessions'
$fields = 'status', 'waitingFor', 'tempo', 'state', 'needs', 'detail'
$last = @{}
New-Item -ItemType Directory -Force (Split-Path -Parent $LogPath) | Out-Null

while ($true) {
    foreach ($f in Get-ChildItem $dir -Filter '*.json' -ErrorAction SilentlyContinue) {
        try { $d = [IO.File]::ReadAllText($f.FullName, $utf8) | ConvertFrom-Json } catch { continue }
        $snapshot = ($fields | ForEach-Object { "$_=$($d.$_)" }) -join ' | '
        if ($last[$f.Name] -ne $snapshot) {
            $last[$f.Name] = $snapshot
            $line = '{0:HH:mm:ss.fff}  {1}  [{2}]  {3}' -f (Get-Date), $f.BaseName, $d.name, $snapshot
            [IO.File]::AppendAllText($LogPath, $line + "`r`n", $utf8)
        }
    }
    Start-Sleep -Milliseconds 300
}
