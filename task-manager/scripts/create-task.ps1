param(
    [Parameter(Mandatory=$true)]
    [string]$Workspace,
    [Parameter(Mandatory=$true)]
    [string]$Title,
    [string]$Priority = "medium",
    [string]$Folder = "Backlog",
    [string[]]$Tags = @(),
    [string]$Content = ""
)
$TaskDir = "$HOME/.pi/tasks/$Workspace/$Folder"
if (-not (Test-Path $TaskDir)) {
    New-Item -ItemType Directory -Path $TaskDir -Force | Out-Null
}
$Id = [guid]::NewGuid().ToString()
$Created = Get-Date -Format "yyyy-MM-dd"
$SafeName = $Title -replace '[^\w\-]', '-' -replace '-+', '-'
$FileName = "$SafeName.md"
$Path = Join-Path $TaskDir $FileName
if (Test-Path $Path) {
    $i = 1
    while (Test-Path $Path) {
        $FileName = "$SafeName-$i.md"
        $Path = Join-Path $TaskDir $FileName
        $i++
    }
}
$TagsStr = if ($Tags.Count -gt 0) { "`n  - " + ($Tags -join "`n  - ") } else { "" }
if ($Content) {
    $Content += "`n`n"
}
$Body = $Content + "
"
$FileContent = @"
---
id: $Id
title: $Title
created: $Created
priority: $Priority
tags:$TagsStr
---

# $Title

$Body
"@
$FileContent | Out-File -FilePath $Path -Encoding UTF8
Write-Output $Id
