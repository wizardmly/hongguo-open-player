// SPDX-License-Identifier: GPL-3.0-only
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Windows.Forms;

internal static class Launcher {
    private static string QuoteArg(string arg) {
        if (string.IsNullOrEmpty(arg)) return "\"\"";
        bool needsQuotes = false;
        foreach (char c in arg) {
            if (char.IsWhiteSpace(c) || c == '"') {
                needsQuotes = true;
                break;
            }
        }
        if (!needsQuotes) return arg;
        var sb = new StringBuilder();
        sb.Append('"');
        int backslashes = 0;
        foreach (char c in arg) {
            if (c == '\\') {
                backslashes++;
            } else if (c == '"') {
                sb.Append('\\', backslashes * 2 + 1);
                sb.Append('"');
                backslashes = 0;
            } else {
                if (backslashes > 0) {
                    sb.Append('\\', backslashes);
                    backslashes = 0;
                }
                sb.Append(c);
            }
        }
        if (backslashes > 0) sb.Append('\\', backslashes * 2);
        sb.Append('"');
        return sb.ToString();
    }

    [STAThread]
    private static void Main(string[] args) {
        string root = AppDomain.CurrentDomain.BaseDirectory;
        string playerExe = Path.Combine(root, "nsh-player.exe");
        if (!File.Exists(playerExe)) {
            MessageBox.Show("缺少主程序文件 nsh-player.exe，请保留完整程序目录后重试。", "红果开源播放器");
            return;
        }

        string runtimeRoot = Path.Combine(root, "nsh", "runtime");
        string[] candidatePaths = new[] {
            Path.Combine(runtimeRoot, "media-ffmpeg"),
            Path.Combine(runtimeRoot, "bytevc2"),
            Path.Combine(runtimeRoot, "playback-signer", "jre", "bin")
        };

        var extraPaths = new List<string>();
        foreach (string dir in candidatePaths) {
            if (Directory.Exists(dir)) extraPaths.Add(dir);
        }

        var start = new ProcessStartInfo {
            FileName = playerExe,
            WorkingDirectory = root,
            UseShellExecute = false
        };

        if (args != null && args.Length > 0) {
            var quoted = new string[args.Length];
            for (int i = 0; i < args.Length; i++) quoted[i] = QuoteArg(args[i]);
            start.Arguments = string.Join(" ", quoted);
        }

        string currentPath = Environment.GetEnvironmentVariable("PATH") ?? "";
        if (extraPaths.Count > 0) {
            string prefix = string.Join(Path.PathSeparator.ToString(), extraPaths);
            start.EnvironmentVariables["PATH"] = string.IsNullOrEmpty(currentPath)
                ? prefix
                : prefix + Path.PathSeparator + currentPath;
        }

        try {
            using (var child = Process.Start(start)) {
                if (child == null) {
                    MessageBox.Show("无法启动红果开源播放器，请检查程序目录中的运行组件是否完整。", "红果开源播放器");
                }
            }
        } catch (Exception) {
            MessageBox.Show("无法启动红果开源播放器，请检查程序目录中的运行组件是否完整。", "红果开源播放器");
        }
    }
}
