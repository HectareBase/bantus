# .claude/worktrees のワークツリーを一覧にし、選んだものを削除する。
# 使い方:
#   powershell -NoProfile -File tools\clean-worktrees.ps1                       一覧だけ（何も消さない）
#   powershell -NoProfile -File tools\clean-worktrees.ps1 -Json                 一覧を JSON で出す
#   powershell -NoProfile -File tools\clean-worktrees.ps1 -Remove a,b           フォルダ名 a と b を削除する
#   powershell -NoProfile -File tools\clean-worktrees.ps1 -DeleteMergedBranches main に取り込み済みのブランチを消す
# 未コミットの変更があるもの、main にないコミットがあるものは、-Force を付けないと消さない。
# どのワークツリーをどのセッションが使っているかは、このスクリプトでは分からない（スキル clean-worktrees が調べる）。

param(
    [string[]]$Remove = @(),
    [switch]$DeleteMergedBranches,
    [switch]$Force,
    [switch]$Json,
    [string]$Base = 'main'
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

# どのワークツリーから動かしても、元のリポジトリの .claude/worktrees を見る
$commonDir = (git rev-parse --path-format=absolute --git-common-dir).Trim()
$repoRoot = Split-Path -Parent $commonDir
$wtRoot = Join-Path $repoRoot '.claude\worktrees'
$here = (git rev-parse --show-toplevel).Trim()

function Norm([string]$p) { [IO.Path]::GetFullPath($p).TrimEnd('\').ToLowerInvariant() }

function Get-SizeMB([string]$path) {
    $sum = (Get-ChildItem -LiteralPath $path -Recurse -Force -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
    [math]::Round([double]$sum / 1MB)
}

function Get-Worktrees {
    # git worktree list --porcelain は、空行で区切られたブロックが 1 つのワークツリー
    $items = @()
    $cur = $null
    foreach ($line in (git -C $repoRoot worktree list --porcelain) + '') {
        if ($line -like 'worktree *') { $cur = @{ path = $line.Substring(9); branch = ''; prunable = $false } }
        elseif ($line -like 'branch refs/heads/*') { $cur.branch = $line.Substring(18) }
        elseif ($line -like 'prunable*') { $cur.prunable = $true }
        elseif ($line -eq '' -and $cur) { $items += $cur; $cur = $null }
    }
    $registered = @{}
    $out = @()
    foreach ($w in $items) {
        $full = [IO.Path]::GetFullPath($w.path)
        if ((Norm $full) -eq (Norm $repoRoot)) { continue }
        $registered[(Norm $full)] = $true
        $exists = Test-Path -LiteralPath $full
        $dirty = 0; $ahead = 0; $atBase = $false
        if ($exists -and -not $w.prunable) {
            $dirty = @(git -C $full status --porcelain).Count
        }
        if ($w.branch) {
            $ahead = [int](git -C $repoRoot rev-list --count "$Base..refs/heads/$($w.branch)")
            $atBase = (git -C $repoRoot rev-parse "refs/heads/$($w.branch)") -eq (git -C $repoRoot rev-parse $Base)
        }
        $out += [pscustomobject]@{
            name = Split-Path -Leaf $full
            path = $full
            kind = $(if ($w.prunable -or -not $exists) { 'prunable' } else { 'worktree' })
            branch = $w.branch
            dirty = $dirty
            ahead = $ahead
            atBase = $atBase
            current = (Norm $full) -eq (Norm $here)
            sizeMB = $(if ($exists) { Get-SizeMB $full } else { 0 })
        }
    }
    # git に登録されていないフォルダ（削除の途中で残ったもの）
    if (Test-Path -LiteralPath $wtRoot) {
        foreach ($d in Get-ChildItem -LiteralPath $wtRoot -Directory -Force) {
            if ($registered[(Norm $d.FullName)]) { continue }
            $out += [pscustomobject]@{
                name = $d.Name; path = $d.FullName; kind = 'orphan'; branch = ''
                dirty = 0; ahead = 0; atBase = $false; current = $false; sizeMB = Get-SizeMB $d.FullName
            }
        }
    }
    $out
}

function Show([object[]]$list) {
    if ($Json) { ConvertTo-Json -InputObject @($list) -Depth 3; return }
    if (-not $list.Count) { Write-Output 'ワークツリーはありません'; return }
    $list | ForEach-Object {
        $note = @()
        switch ($_.kind) {
            'orphan' { $note += 'git の登録なし（フォルダだけ）' }
            'prunable' { $note += 'フォルダなし（登録だけ）' }
        }
        if ($_.current) { $note += '今いるワークツリー' }
        if ($_.dirty) { $note += "未コミット $($_.dirty) 件" }
        if ($_.ahead) { $note += "$Base にないコミット $($_.ahead) 件" }
        elseif ($_.atBase) { $note += "$Base と同じ（コミットなし。作ったばかりかもしれない）" }
        [pscustomobject]@{ 名前 = $_.name; ブランチ = $_.branch; 'MB' = $_.sizeMB; 状態 = ($note -join '、') }
    } | Format-Table -AutoSize | Out-String -Width 200
}

# -File で呼ぶと a,b は 1 つの文字列で届くので、ここで分ける
$Remove = @($Remove | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })

$list = @(Get-Worktrees)

if (-not $Remove.Count -and -not $DeleteMergedBranches) {
    Show $list
    exit 0
}

$failed = $false
foreach ($name in $Remove) {
    $w = $list | Where-Object { $_.name -eq $name } | Select-Object -First 1
    if (-not $w) { Write-Output "× $name : 見つからない"; $failed = $true; continue }
    if ($w.current) { Write-Output "× $name : 今いるワークツリーは消さない"; $failed = $true; continue }
    if (-not $Force -and ($w.dirty -or $w.ahead)) {
        Write-Output "× $name : 未コミットの変更か、$Base にないコミットがある（消すなら -Force）"; $failed = $true; continue
    }
    switch ($w.kind) {
        'prunable' { git -C $repoRoot worktree prune }
        'orphan' { Remove-Item -LiteralPath $w.path -Recurse -Force -ErrorAction SilentlyContinue }
        default {
            $gitArgs = @('-C', $repoRoot, 'worktree', 'remove')
            if ($Force) { $gitArgs += '--force' }
            & git @gitArgs $w.path 2>&1 | Out-Null
            git -C $repoRoot worktree prune
        }
    }
    if (Test-Path -LiteralPath $w.path) {
        # 中身は消えても、セッションが作業場所として持っているとフォルダが残る。セッションをアーカイブすると消える
        $left = @(Get-ChildItem -LiteralPath $w.path -Recurse -Force -File -ErrorAction SilentlyContinue).Count
        Remove-Item -LiteralPath $w.path -Recurse -Force -ErrorAction SilentlyContinue
        if (Test-Path -LiteralPath $w.path) {
            Write-Output "△ $name : フォルダが使用中で残った（残ったファイル $left 件）。使っているセッションをアーカイブすると消える"
            $failed = $true
            continue
        }
    }
    Write-Output "○ $name : 削除した（$($w.sizeMB) MB）"
}

if ($DeleteMergedBranches) {
    # どこかのワークツリーで使っているブランチは残す（作ったばかりのものも、$Base に取り込み済みに見える）
    $inUse = @{}
    foreach ($line in git -C $repoRoot worktree list --porcelain) {
        if ($line -like 'branch refs/heads/*') { $inUse[$line.Substring(18)] = $true }
    }
    foreach ($b in git -C $repoRoot branch --merged $Base --format='%(refname:short)') {
        if ($b -eq $Base -or $inUse[$b]) { continue }
        git -C $repoRoot branch -d $b
    }
    $unmerged = @(git -C $repoRoot branch --no-merged $Base --format='%(refname:short)')
    if ($unmerged.Count) { Write-Output "残した（$Base に取り込まれていない）: $($unmerged -join ', ')" }
}

if ($failed) { exit 1 }
