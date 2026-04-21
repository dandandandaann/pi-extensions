param(
    [Parameter(Mandatory=$true)]
    [string]$Workspace,
    [Parameter(Mandatory=$true)]
    [string]$Name,
    [string]$Content
)
$TasksRoot = "$HOME/.pi/tasks/$Workspace"
$NameSafe = $Name -replace '[^\w\-]', '-' -replace '-+', '-'
$Found = $null
$FilePath = $null
foreach ($folder in @("Backlog", "Active", "user-qa", "Closed")) {
    $Pattern = "$NameSafe*.md"
    $Files = Get-ChildItem -Path "$TasksRoot/$folder" -Filter $Pattern -ErrorAction SilentlyContinue
    if ($Files) {
        $FilePath = $Files[0].FullName
        $Found = $folder
        break
    }
}
if (-not $FilePath) {
    Write-Error "Task '$Name' not found"
    exit 1
}
# Ensure Backlog folder exists
$BacklogDir = "$TasksRoot/Backlog"
if (-not (Test-Path $BacklogDir)) {
    New-Item -ItemType Directory -Path $BacklogDir -Force | Out-Null
}
if ($Content) {
    $Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm"
    $AppendContent = "`n----`n$Timestamp`n$Content"
    Add-Content -Path $FilePath -Value $AppendContent -Encoding UTF8
}
Get-Content $FilePath
