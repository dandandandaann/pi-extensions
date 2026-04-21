param(
    [Parameter(Mandatory=$true)]
    [string]$Workspace,
    [Parameter(Mandatory=$true)]
    [string]$Name,
    [Parameter(Mandatory=$true)]
    [string]$Context
)
$TasksRoot = "$HOME/.pi/tasks/$Workspace"
$NameSafe = $Name -replace '[^\w\-]', '-' -replace '-+', '-'
$Found = $null
$OldPath = $null

# Find task in Active folder (submit-to-qa only works from Active)
$Files = Get-ChildItem -Path "$TasksRoot/Active" -Filter "$NameSafe*.md" -ErrorAction SilentlyContinue
if (-not $Files) {
    Write-Error "Task '$Name' not found in Active folder"
    exit 1
}
$OldPath = $Files[0].FullName
$Found = "Active"

$NewDir = "$TasksRoot/user-qa"
if (-not (Test-Path $NewDir)) {
    New-Item -ItemType Directory -Path $NewDir -Force | Out-Null
}

$FileName = Split-Path $OldPath -Leaf
$NewPath = Join-Path $NewDir $FileName

# Append context as a "Submitted to QA" note
$Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm"
$QaNote = "`n----`n$Timestamp`n## Submitted to QA`n$Context"
Add-Content -Path $OldPath -Value $QaNote -Encoding UTF8

# Move the file
Move-Item -Path $OldPath -Destination $NewPath -Force
Write-Output "Moved to user-qa"
