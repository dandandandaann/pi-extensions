param(
    [Parameter(Mandatory=$true)]
    [string]$Workspace,
    [Parameter(Mandatory=$true)]
    [string]$UUID,
    [string]$NewFolder,
    [switch]$AllowClosed
)
$TasksRoot = "$HOME/.pi/tasks/$Workspace"

# Find task by UUID in frontmatter
$Found = $null
$OldPath = $null
foreach ($folder in @("Backlog", "Active", "user-qa", "Closed")) {
    $Dir = "$TasksRoot/$folder"
    if (-not (Test-Path $Dir)) { continue }
    $Files = Get-ChildItem -Path $Dir -Filter "*.md" -ErrorAction SilentlyContinue
    foreach ($File in $Files) {
        $content = Get-Content $File.FullName -Raw
        if ($content -match '(?s)^---\r?\n(.*?)\r?\n---') {
            $fm = $matches[1]
            if ($fm -match "id:\s*$UUID") {
                $OldPath = $File.FullName
                $Found = $folder
                break
            }
        }
    }
    if ($OldPath) { break }
}

if (-not $OldPath) {
    Write-Error "Task with UUID '$UUID' not found"
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
