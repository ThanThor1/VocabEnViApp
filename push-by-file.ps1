$repoPath = "d:\FunnyApp1"
Set-Location $repoPath

$modifiedFiles = & git diff --name-only
$untrackedFiles = & git ls-files --others --exclude-standard

$allChangedFiles = $modifiedFiles + $untrackedFiles | Where-Object { $_ }

if ($allChangedFiles.Count -eq 0) {
    Write-Host "Khong co file nao de push" -ForegroundColor Yellow
    exit
}

Write-Host ("Tong so file thay doi: " + $allChangedFiles.Count) -ForegroundColor Cyan
Write-Host ""

$batchSize = 5
$batch = @()
$batchNum = 0

foreach ($file in $allChangedFiles) {
    $batch += $file
    
    if ($batch.Count -ge $batchSize) {
        $batchNum++
        $msg = "Batch " + $batchNum + " (" + $batch.Count + " files)"
        Write-Host ("[" + $batchNum + "] Pushing " + $msg + "...") -ForegroundColor Green
        
        foreach ($f in $batch) {
            Write-Host ("  + " + $f)
            & git add "$f"
        }
        
        $commitMsg = "Update: " + $msg
        & git commit -m $commitMsg
        
        if ($LASTEXITCODE -eq 0) {
            & git push --set-upstream origin main
            if ($LASTEXITCODE -eq 0) {
                Write-Host ("OK Batch " + $batchNum) -ForegroundColor Green
            } else {
                Write-Host ("ERROR Batch " + $batchNum) -ForegroundColor Red
                exit 1
            }
        } else {
            Write-Host ("SKIP Batch " + $batchNum) -ForegroundColor Yellow
        }
        
        Write-Host ""
        $batch = @()
    }
}

if ($batch.Count -gt 0) {
    $batchNum++
    $msg = "Batch " + $batchNum + " (" + $batch.Count + " files final)"
    Write-Host ("[" + $batchNum + "] Pushing " + $msg + "...") -ForegroundColor Green
    
    foreach ($f in $batch) {
        Write-Host ("  + " + $f)
        & git add "$f"
    }
    
    $commitMsg = "Update: " + $msg
    & git commit -m $commitMsg
    
    if ($LASTEXITCODE -eq 0) {
        & git push --set-upstream origin main
        if ($LASTEXITCODE -eq 0) {
            Write-Host ("OK Batch " + $batchNum + " (final)") -ForegroundColor Green
        } else {
            Write-Host ("ERROR Batch " + $batchNum) -ForegroundColor Red
            exit 1
        }
    } else {
        Write-Host ("SKIP Batch " + $batchNum) -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host ("DONE! " + $batchNum + " batches pushed") -ForegroundColor Green
