param(
    [Parameter(Mandatory=$true)]
    [string]$Workspace,
    [Parameter(Mandatory=$true)]
    [string]$Name,
    [string]$NewFolder,
    [switch]$AllowClosed
)
$TasksRoot = "$HOME/.pi/tasks/$Workspace"
$NameSafe = $Name -replace '[^\w\-]', '-' -replace '-+', '-'
$Found = $null
$OldPath = $null
foreach ($folder in @("Backlog", "Active", "user-qa", "Closed")) {
    $Pattern = "$NameSafe*.md"
    $Files = Get-ChildItem -Path "$TasksRoot/$folder" -Filter $Pattern -ErrorAction SilentlyContinue
    if ($Files) {
        $OldPath = $Files[0].FullName
        $Found = $folder
        break
    }
}
if (-not $OldPath) {
    Write-Error "Task '$Name' not found"
    exit 1
}
if ($NewFolder -eq "Closed" -and -not $AllowClosed) {
    Write-Error "Use submit-qa script to move the task to user-qa instead of directly moving it to Closed."
    exit 1
}
$NewDir = "$TasksRoot/$NewFolder"
if (-not (Test-Path $NewDir)) {
    New-Item -ItemType Directory -Path $NewDir -Force | Out-Null
}
$FileName = Split-Path $OldPath -Leaf
$NewPath = Join-Path $NewDir $FileName
Move-Item -Path $OldPath -Destination $NewPath -Force
Write-Output "$Found`t$NewFolder"