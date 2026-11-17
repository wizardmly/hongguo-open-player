param([string]$NshCommand = 'nsh')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$projectRoot = Split-Path $PSScriptRoot -Parent
Push-Location $projectRoot
try {
    & node scripts/prepare-backend.cjs
    if ($LASTEXITCODE -ne 0) { throw 'Backend preparation failed' }
    & $NshCommand check
    if ($LASTEXITCODE -ne 0) { throw 'NSH type check failed' }
    & $NshCommand package App.tsx --target windows --out dist/windows-integrated
    if ($LASTEXITCODE -ne 0) { throw 'NSH package failed' }
    $application = Join-Path $projectRoot 'dist\windows-integrated\红果开源播放器'
    $bundledBackend = [System.IO.Path]::GetFullPath((Join-Path $application 'nsh\backend'))
    if (-not $bundledBackend.StartsWith([System.IO.Path]::GetFullPath($application) + [System.IO.Path]::DirectorySeparatorChar)) { throw 'Invalid backend directory' }
    if (Test-Path -LiteralPath $bundledBackend) { Remove-Item -LiteralPath $bundledBackend -Recurse -Force }
    Copy-Item -LiteralPath (Join-Path $projectRoot 'backend') -Destination $bundledBackend -Recurse -Force
    Move-Item -LiteralPath (Join-Path $application '红果开源播放器.exe') -Destination (Join-Path $application 'nsh-player.exe') -Force
    $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
    & $compiler /nologo /target:winexe /reference:System.Windows.Forms.dll ("/win32icon:" + (Join-Path $application 'nsh\icon.ico')) ("/out:" + (Join-Path $application '红果开源播放器.exe')) (Join-Path $PSScriptRoot 'Launcher.cs')
    if ($LASTEXITCODE -ne 0) { throw 'Launcher build failed' }
    $archive = $application + '.zip'
    if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive }
    [System.IO.Compression.ZipFile]::CreateFromDirectory($application, $archive, [System.IO.Compression.CompressionLevel]::Optimal, $true)
    Write-Output "NSH player ready at $application"
} finally { Pop-Location }
