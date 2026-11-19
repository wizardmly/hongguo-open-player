param(
    [string]$NshCommand = 'nsh',
    [string]$OutputDir = 'dist/windows-v2.0.0'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$projectRoot = Split-Path $PSScriptRoot -Parent

Push-Location $projectRoot
try {
    $signerDir = Join-Path $projectRoot 'build\playback-signer\win32-x64'
    $signerJar = Join-Path $signerDir 'sign\domestic-sign.jar'
    if (-not (Test-Path -LiteralPath $signerJar)) {
        & (Join-Path $PSScriptRoot 'prepare-playback-signer.ps1')
        if ($LASTEXITCODE -ne 0) { throw 'Playback signer preparation failed' }
    }

    $mediaFfmpegDir = Join-Path $projectRoot 'build\media-ffmpeg\x64'
    $mediaFfmpegExe = Join-Path $mediaFfmpegDir 'ffmpeg.exe'
    if (-not (Test-Path -LiteralPath $mediaFfmpegExe)) {
        throw "Missing media FFmpeg binary: $mediaFfmpegExe"
    }

    $bytevc2Dir = Join-Path $projectRoot 'build\bytevc2\x64'
    $bytevc2Ffmpeg = Join-Path $bytevc2Dir 'bvc2-ffmpeg.exe'
    $bytevc2Raw = Join-Path $bytevc2Dir 'ffmpeg.exe'
    if (-not (Test-Path -LiteralPath $bytevc2Ffmpeg)) {
        if (-not (Test-Path -LiteralPath $bytevc2Raw)) {
            throw "Missing ByteVC2 decoder binary: $bytevc2Raw"
        }
        Copy-Item -LiteralPath $bytevc2Raw -Destination $bytevc2Ffmpeg -Force
    }

    & $NshCommand check
    if ($LASTEXITCODE -ne 0) { throw 'NSH type check failed' }

    & $NshCommand package App.tsx --target windows --out $OutputDir
    if ($LASTEXITCODE -ne 0) { throw 'NSH package failed' }

    $application = [System.IO.Path]::GetFullPath((Join-Path (Join-Path $projectRoot $OutputDir) '红果开源播放器'))
    $runtimeRoot = [System.IO.Path]::GetFullPath((Join-Path $application 'nsh\runtime'))
    if (-not $runtimeRoot.StartsWith([System.IO.Path]::GetFullPath($application) + [System.IO.Path]::DirectorySeparatorChar)) {
        throw 'Invalid runtime directory'
    }

    if (Test-Path -LiteralPath $runtimeRoot) {
        Remove-Item -LiteralPath $runtimeRoot -Recurse -Force
    }
    New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null

    $staleBackend = Join-Path $application 'nsh\backend'
    if (Test-Path -LiteralPath $staleBackend) {
        Remove-Item -LiteralPath $staleBackend -Recurse -Force
    }

    $destMediaFfmpeg = Join-Path $runtimeRoot 'media-ffmpeg'
    Copy-Item -LiteralPath $mediaFfmpegDir -Destination $destMediaFfmpeg -Recurse -Force

    $destBytevc2 = Join-Path $runtimeRoot 'bytevc2'
    Copy-Item -LiteralPath $bytevc2Dir -Destination $destBytevc2 -Recurse -Force
    $collidingFfmpeg = Join-Path $destBytevc2 'ffmpeg.exe'
    if (Test-Path -LiteralPath $collidingFfmpeg) {
        Remove-Item -LiteralPath $collidingFfmpeg -Force
    }

    $destSigner = Join-Path $runtimeRoot 'playback-signer'
    Copy-Item -LiteralPath $signerDir -Destination $destSigner -Recurse -Force

    Move-Item -LiteralPath (Join-Path $application '红果开源播放器.exe') -Destination (Join-Path $application 'nsh-player.exe') -Force
    $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
    & $compiler /nologo /target:winexe /reference:System.Windows.Forms.dll ('/win32icon:' + (Join-Path $application 'nsh\icon.ico')) ('/out:' + (Join-Path $application '红果开源播放器.exe')) (Join-Path $PSScriptRoot 'Launcher.cs')
    if ($LASTEXITCODE -ne 0) { throw 'Launcher build failed' }

    $archive = $application + '.zip'
    if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }
    [System.IO.Compression.ZipFile]::CreateFromDirectory($application, $archive, [System.IO.Compression.CompressionLevel]::Optimal, $true)
    Write-Output "NSH player ready at $application"
} finally {
    Pop-Location
}
