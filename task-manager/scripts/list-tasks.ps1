param(
    [Parameter(Mandatory=$true)]
    [string]$Workspace,
    [string]$Folder = "Backlog"
)
$TaskDir = "$HOME/.pi/tasks/$Workspace/$Folder"
if (-not (Test-Path $TaskDir)) {
    exit 0
}
Get-ChildItem -Path $TaskDir -Filter "*.md" | ForEach-Object {
    $title = "Untitled"
    $priority = "medium"
    $created = ""
    $uuid = ""
    $content = Get-Content $_.FullName -Raw
    if ($content -match '(?s)^---\r?\n(.*?)\r?\n---') {
        $fm = $matches[1]
        if ($fm -match 'title:\s*(.+)') { $title = $matches[1].Trim() }
        if ($fm -match 'priority:\s*(.+)') { $priority = $matches[1].Trim() }
        if ($fm -match 'created:\s*(.+)') { $created = $matches[1].Trim() }
        if ($fm -match 'id:\s*(.+)') { $uuid = $matches[1].Trim() }
    }
    "$($_.BaseName)`t$title`t$priority`t$created`t$uuid"
}
