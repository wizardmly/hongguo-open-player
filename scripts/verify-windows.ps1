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

    $testDir = Join-Path $projectRoot '.nsh\test'
    if (Test-Path -LiteralPath $testDir) {
        Remove-Item -Path (Join-Path $testDir '*.png') -Force -ErrorAction SilentlyContinue
    }

    $jreBin = Join-Path $signerDir 'jre\bin'
    $prevPath = $env:PATH
    $prevLive = $env:HONGGUO_LIVE_TEST
    $env:PATH = "$mediaFfmpegDir;$bytevc2Dir;$jreBin;$prevPath"
    $env:HONGGUO_LIVE_TEST = '1'
    try {
        & $NshCommand test Live.test.tsx --target windows --verbose
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    } finally {
        $env:PATH = $prevPath
        if ($null -eq $prevLive) {
            Remove-Item Env:HONGGUO_LIVE_TEST -ErrorAction SilentlyContinue
        } else {
            $env:HONGGUO_LIVE_TEST = $prevLive
        }
    }

    if (-not ('LiveScreenshotVerifier' -as [type])) {
        Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

public static class LiveScreenshotVerifier {
    private static byte[] LoadBgra(string path, out int w, out int h, out int stride) {
        using (var bmp = new Bitmap(path)) {
            w = bmp.Width;
            h = bmp.Height;
            var rect = new Rectangle(0, 0, w, h);
            var data = bmp.LockBits(rect, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
            try {
                stride = Math.Abs(data.Stride);
                byte[] buf = new byte[stride * h];
                Marshal.Copy(data.Scan0, buf, 0, buf.Length);
                return buf;
            } finally {
                bmp.UnlockBits(data);
            }
        }
    }

    public static void Verify(string testDir) {
        int w, h, stA, wb, hb, stB;
        byte[] a = LoadBgra(Path.Combine(testDir, "hongguo-ep2-frame-a.png"), out w, out h, out stA);
        byte[] b = LoadBgra(Path.Combine(testDir, "hongguo-ep2-frame-b.png"), out wb, out hb, out stB);
        long diff = 0;
        for (int y = (int)Math.Floor(h * 0.45); y < (int)Math.Floor(h * 0.78); y++) {
            int offA = y * stA;
            int offB = y * stB;
            for (int x = (int)Math.Floor(w * 0.12); x < (int)Math.Floor(w * 0.58); x++) {
                int ia = offA + x * 4;
                int ib = offB + x * 4;
                if (Math.Abs(a[ia + 2] - b[ib + 2]) > 6) diff++;
                if (Math.Abs(a[ia + 1] - b[ib + 1]) > 6) diff++;
                if (Math.Abs(a[ia + 0] - b[ib + 0]) > 6) diff++;
            }
        }
        Console.WriteLine("NSH_PLAYBACK_TIMING ep2_video_pixel_diff=" + diff);
        if (diff < 20000) throw new Exception("Switched episode video frame appears frozen (pixel diff=" + diff + ")");

        string[] shots = new[] {
            "switch-1-to-2-15ms.png",
            "switch-1-to-2-80ms.png",
            "switch-2-to-1-20ms.png",
            "switch-1-to-3-40ms.png"
        };
        foreach (string shot in shots) {
            int sw, sh, st;
            byte[] px = LoadBgra(Path.Combine(testDir, shot), out sw, out sh, out st);
            double sum = 0;
            long count = 0;
            for (int y = (int)Math.Floor(sh * 0.25); y < (int)Math.Floor(sh * 0.78); y += 2) {
                int rowOff = y * st;
                for (int x = (int)Math.Floor(sw * 0.22); x < (int)Math.Floor(sw * 0.44); x += 2) {
                    int idx = rowOff + x * 4;
                    sum += 0.299 * px[idx + 2] + 0.587 * px[idx + 1] + 0.114 * px[idx + 0];
                    count++;
                }
            }
            double avgLuma = sum / Math.Max(1L, count);
            Console.WriteLine("NSH_SWITCH_LUMA " + shot + "=" + avgLuma.ToString("F2"));
            if (avgLuma < 8.0) throw new Exception("Black frame detected during episode switch in " + shot + " (avgLuma=" + avgLuma.ToString("F2") + ")");
        }
    }
}
'@
    }
    [LiveScreenshotVerifier]::Verify($testDir)
} finally {
    Pop-Location
}
