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
foreach ($folder in @("Backlog", "Active", "Closed")) {
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
    Write-Error "Folder '$NewFolder' not found"
    exit 1
}
$Content = Get-Content $OldPath -Raw
$FileName = Split-Path $OldPath -Leaf
$NewPath = Join-Path $NewDir $FileName
Move-Item -Path $OldPath -Destination $NewPath -Force
Write-Output "$Found`t$NewFolder"
