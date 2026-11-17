// SPDX-License-Identifier: GPL-3.0-only
using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

internal static class Launcher {
    [STAThread]
    private static void Main() {
        string root = AppDomain.CurrentDomain.BaseDirectory;
        string backend = Path.Combine(root, "nsh", "backend");
        try {
            var start = new ProcessStartInfo {
                FileName = Path.Combine(backend, "node.exe"),
                Arguments = "\"" + Path.Combine(backend, "launcher.cjs") + "\"",
                WorkingDirectory = root,
                UseShellExecute = false,
                CreateNoWindow = true
            };
            using (var child = Process.Start(start)) {
                child.WaitForExit();
                if (child.ExitCode != 0) MessageBox.Show("播放器启动失败，请保留完整程序目录后重试。", "红果开源播放器");
            }
        } catch (Exception) {
            MessageBox.Show("无法启动片源服务，请检查程序目录中的运行组件是否完整。", "红果开源播放器");
        }
    }
}
