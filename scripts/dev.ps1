param([string]$NshCommand = 'nsh')

$ErrorActionPreference = 'Stop'
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
    if (-not (Test-Path -LiteralPath (Join-Path $mediaFfmpegDir 'ffmpeg.exe'))) {
        throw "Missing media FFmpeg binary in $mediaFfmpegDir"
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

    $jreBin = Join-Path $signerDir 'jre\bin'
    $prevPath = $env:PATH
    $env:PATH = "$mediaFfmpegDir;$bytevc2Dir;$jreBin;$prevPath"
    try {
        & $NshCommand run App.tsx --target windows
        exit $LASTEXITCODE
    } finally {
        $env:PATH = $prevPath
    }
} finally {
    Pop-Location
}
