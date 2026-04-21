param(
    [Parameter(Mandatory=$true)]
    [string]$Workspace,
    [Parameter(Mandatory=$true)]
    [string]$Name,
    [string]$NewFolder
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
if ($NewFolder -and $NewFolder -eq $Found) {
    Write-Output "Task already in $NewFolder"
    exit 0
}
$NewDir = "$TasksRoot/$NewFolder"
if (-not (Test-Path $NewDir)) {
    New-Item -ItemType Directory -Path $NewDir -Force | Out-Null
}
$Content = Get-Content $OldPath -Raw
$FileName = Split-Path $OldPath -Leaf
$NewPath = Join-Path $NewDir $FileName
Move-Item -Path $OldPath -Destination $NewPath -Force
Write-Output "$Found`t$NewFolder"
