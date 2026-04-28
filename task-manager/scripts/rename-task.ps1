param(
    [Parameter(Mandatory=$true)]
    [string]$Workspace,
    [Parameter(Mandatory=$true)]
    [string]$UUID,
    [string]$NewTitle
)
$TasksRoot = "$HOME/.pi/tasks/$Workspace"

# Find task by UUID in frontmatter
$Found = $null
$FilePath = $null
foreach ($folder in @("Backlog", "Active", "user-qa", "Closed")) {
    $Dir = "$TasksRoot/$folder"
    if (-not (Test-Path $Dir)) { continue }
    $Files = Get-ChildItem -Path $Dir -Filter "*.md" -ErrorAction SilentlyContinue
    foreach ($File in $Files) {
        $content = Get-Content $File.FullName -Raw
        if ($content -match '(?s)^---\n(.*?)\n---') {
            $fm = $matches[1]
            if ($fm -match "id:\s*$UUID") {
                $FilePath = $File.FullName
                $Found = $folder
                break
            }
        }
    }
    if ($FilePath) { break }
}

if (-not $FilePath) {
    Write-Error "Task with UUID '$UUID' not found"
    exit 1
}

# Ensure Backlog folder exists for new tasks
$BacklogDir = "$TasksRoot/Backlog"
if (-not (Test-Path $BacklogDir)) {
    New-Item -ItemType Directory -Path $BacklogDir -Force | Out-Null
}

$Content = Get-Content $FilePath -Raw
if ($NewTitle) {
    # Replace title in frontmatter (preserve id line)
    $Content = $Content -replace '(?s)(^title:).+', "`$1 $NewTitle"
    Set-Content -Path $FilePath -Value $Content -Encoding UTF8
}

Write-Output $Found
