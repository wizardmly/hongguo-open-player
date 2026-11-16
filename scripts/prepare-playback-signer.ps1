param([string]$Archive)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$target = Join-Path $projectRoot 'build\playback-signer\win32-x64'
$releaseUrl = 'https://github.com/dddmiku/hongguo-desktop/releases/download/v1.4.0/runtime-win-x64.zip'
$expectedHash = '4f735e7ea01a84646c0e02db37c8f60d8e2da62d9ec99e622fc5395ac5c78b4c'

if (-not $Archive) {
    $downloadDir = Join-Path $projectRoot 'build\playback-signer\downloads'
    New-Item -ItemType Directory -Path $downloadDir -Force | Out-Null
    $Archive = Join-Path $downloadDir 'runtime-win-x64.zip'
    if (-not (Test-Path -LiteralPath $Archive)) {
        Invoke-WebRequest -Uri $releaseUrl -OutFile ($Archive + '.part')
        Move-Item -LiteralPath ($Archive + '.part') -Destination $Archive
    }
}

if ((Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedHash) {
    throw 'Playback signer archive checksum mismatch'
}

# Only the signer, JRE, and SDK metadata are used. Device and account archives
# from the source application are excluded. Our requests use our own registrar.
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $Archive))
$target = [System.IO.Path]::GetFullPath($target)
try {
    foreach ($entry in $zip.Entries) {
        if ($entry.FullName -notmatch '^(sign|capture/domestic|jre)/' -or $entry.FullName.EndsWith('/')) { continue }
        $destination = [System.IO.Path]::GetFullPath((Join-Path $target $entry.FullName))
        if (-not $destination.StartsWith($target + [System.IO.Path]::DirectorySeparatorChar)) { throw 'Invalid archive entry' }
        [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($destination)) | Out-Null
        [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $destination, $true)
    }
} finally {
    $zip.Dispose()
}

@{
    url = $releaseUrl
    sha256 = $expectedHash
    source = 'https://github.com/dddmiku/hongguo-desktop/tree/840836821956725d9bf9cb8d135cd88629f1d185/native/sign'
    sdkVersion = '7.4.3.32'
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $target 'source.json') -Encoding UTF8
Write-Output 'Windows playback signer prepared and archive SHA256 verified'
