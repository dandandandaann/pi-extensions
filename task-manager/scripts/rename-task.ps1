param(
    [Parameter(Mandatory=$true)]
    [string]$Workspace,
    [Parameter(Mandatory=$true)]
    [string]$Name,
    [string]$NewTitle
)
$TasksRoot = "$HOME/.pi/tasks/$Workspace"
$NameSafe = $Name -replace '[^\w\-]', '-' -replace '-+', '-'
$Found = $null
$FilePath = $null
foreach ($folder in @("Backlog", "Active", "Closed")) {
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
$Content = Get-Content $FilePath -Raw
if ($NewTitle) {
    $Content = $Content -replace '(?s)^---\n.*?\ntitle:\s*.+?\n', "---\n`$1`ntitle: $NewTitle`n"
    $SafeNew = $NewTitle -replace '[^\w\-]', '-' -replace '-+', '-'
    $NewFileName = "$SafeNew.md"
    if ($NewFileName -ne (Split-Path $FilePath -Leaf)) {
        $NewPath = Join-Path (Split-Path $FilePath -Parent) $NewFileName
        if (-not (Test-Path $NewPath)) {
            Move-Item -Path $FilePath -Destination $NewPath
            $FilePath = $NewPath
        }
    }
}
Set-Content -Path $FilePath -Value $Content -Encoding UTF8
Write-Output $Found
