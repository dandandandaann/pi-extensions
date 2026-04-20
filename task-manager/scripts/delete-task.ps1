param(
    [Parameter(Mandatory=$true)]
    [string]$Workspace,
    [Parameter(Mandatory=$true)]
    [string]$Name
)
$TasksRoot = "$HOME/.pi/tasks/$Workspace"
$NameSafe = $Name -replace '[^\w\-]', '-' -replace '-+', '-'
foreach ($folder in @("Backlog", "Active", "Closed")) {
    $Pattern = "$NameSafe*.md"
    $Files = Get-ChildItem -Path "$TasksRoot/$folder" -Filter $Pattern -ErrorAction SilentlyContinue
    if ($Files) {
        Remove-Item -Path $Files[0].FullName -Force
        Write-Output $folder
        exit 0
    }
}
Write-Error "Task '$Name' not found"
exit 1
