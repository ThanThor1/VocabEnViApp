# Auto Commit and Gradual Push Script

Write-Host "=== PHASE 1: COMMIT CHANGED FILES ===" -ForegroundColor Cyan
$status = git status --porcelain

if ($status) {
    foreach ($line in $status) {
        $rawPath = $line.Substring(3).Trim()
        
        # Handle quoted paths
        if ($rawPath.StartsWith('"') -and $rawPath.EndsWith('"')) {
            $filePath = $rawPath.Substring(1, $rawPath.Length - 2)
        } elseif ($rawPath -match " -> ") {
             $parts = $rawPath -split " -> "
             $filePath = $parts[1]
        } else {
            $filePath = $rawPath
        }

        Write-Host "Processing: $filePath"
        git add "$filePath"
        
        # Check if something was staged
        $staged = git diff --name-only --cached
        if ($staged) {
            git commit -m "Update $filePath"
            Write-Host "-> Committed." -ForegroundColor Green
        } else {
             Write-Host "-> No changes to commit." -ForegroundColor Yellow
        }
    }
} else {
    Write-Host "No files to commit." -ForegroundColor Green
}

Write-Host "`n=== PHASE 2: GRADUAL PUSH ===" -ForegroundColor Cyan

# Check for remote branch
$remoteOutput = git ls-remote origin main 2>$null
if (-not $remoteOutput) {
    Write-Host "Remote 'main' not found. Pushing all..." -ForegroundColor Yellow
    git push -u origin main
    exit
}


$remoteHash = $remoteOutput.Trim().Split()[0]
Write-Host "Remote main is at: $remoteHash" -ForegroundColor Gray

# Get commits to push
$commits = git log "${remoteHash}..HEAD" --format="%H" --reverse

if (-not $commits) {
    Write-Host "Everything up to date." -ForegroundColor Green
    exit
}

$count = $commits.Count
$i = 1

foreach ($commit in $commits) {
    Write-Host "[$i / $count] Pushing commit $commit ..." -ForegroundColor Cyan
    
    # Push specific commit to main
    git push origin "$commit`:refs/heads/main"
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "-> OK." -ForegroundColor Green
    } else {
        Write-Host "-> Error pushing. Stopping." -ForegroundColor Red
        exit
    }
    $i++
}

Write-Host "Done!" -ForegroundColor Green