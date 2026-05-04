param(
    [Parameter(Mandatory=$true)]
    [string]$Workspace,
    [Parameter(Mandatory=$true)]
    [string]$UUID,
    [string]$Content,
    [string]$File
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
        $fileContent = Get-Content $File.FullName -Raw
        if ($fileContent -match '(?s)^---\r?\n(.*?)\r?\n---') {
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

if ($File) {
    if (Test-Path $File) {
        $Content = Get-Content -Path $File -Raw -Encoding UTF8
    } else {
        Write-Error "File not found: $File"
        exit 1
    }
}

if (-not $Content) {
    Write-Error "Error: either -Content or -File parameter is required"
    exit 1
}

if ($Content) {
    $Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm"
    $AppendContent = "`n----`n$Timestamp`n$Content"
    Add-Content -Path $FilePath -Value $AppendContent -Encoding UTF8
}

Get-Content $FilePath
