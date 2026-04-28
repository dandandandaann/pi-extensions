param(
    [Parameter(Mandatory=$true)]
    [string]$Workspace,
    [Parameter(Mandatory=$true)]
    [string]$UUID,
    [Parameter(Mandatory=$true)]
    [string]$Context
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
