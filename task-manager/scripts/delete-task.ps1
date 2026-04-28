param(
    [Parameter(Mandatory=$true)]
    [string]$Workspace,
    [Parameter(Mandatory=$true)]
    [string]$UUID
)
$TasksRoot = "$HOME/.pi/tasks/$Workspace"

# Find task by UUID in frontmatter
foreach ($folder in @("Backlog", "Active", "user-qa", "Closed")) {
    $Dir = "$TasksRoot/$folder"
    if (-not (Test-Path $Dir)) {
        New-Item -ItemType Directory -Path $Dir -Force | Out-Null
    }
    $Files = Get-ChildItem -Path $Dir -Filter "*.md" -ErrorAction SilentlyContinue
    foreach ($File in $Files) {
        $content = Get-Content $File.FullName -Raw
        if ($content -match '(?s)^---\n(.*?)\n---') {
            $fm = $matches[1]
            if ($fm -match "id:\s*$UUID") {
                Remove-Item -Path $File.FullName -Force
                Write-Output $folder
                exit 0
            }
        }
    }
}
Write-Error "Task with UUID '$UUID' not found"
exit 1
