using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace HaiDou.Installer
{
    internal static class Program
    {
        internal const string ProductVersion = "0.5.3";
        internal const int ApiVersion = 17;
        internal const string WebsiteUrl = "https://haxiaxiaozio-art.github.io/lol-haidou/?v=11";
        internal static readonly string LogPath = Path.Combine(Path.GetTempPath(), "HaiDouHelper-install.log");

        [STAThread]
        private static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            bool uninstall = Array.Exists(args, value => value.Equals("/uninstall", StringComparison.OrdinalIgnoreCase));
            bool preview = Array.Exists(args, value => value.Equals("/preview", StringComparison.OrdinalIgnoreCase));
            if (uninstall)
            {
                RunUninstall();
                return;
            }
            Application.Run(new InstallerForm(preview));
        }

        internal static void WriteLog(string message)
        {
            try { File.AppendAllText(LogPath, DateTime.Now.ToString("O") + " " + message + Environment.NewLine, new UTF8Encoding(true)); }
            catch { }
        }

        private static void RunUninstall()
        {
            if (MessageBox.Show("确定要卸载海斗数据助手吗？\n\n本操作只删除助手程序和当前用户的启动项，不会删除战绩文件。", "卸载海斗数据助手", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
            try
            {
                InstallerOperations.StopRunningHelper();
                string installDirectory = InstallerOperations.ReadInstallLocation();
                InstallerOperations.RemoveRegistration();
                if (!string.IsNullOrWhiteSpace(installDirectory) && InstallerOperations.IsOwnedInstallDirectory(installDirectory))
                {
                    foreach (string name in new[] { "HaiDouHelper.exe", "start-hidden.vbs", "README.txt", ".haidou-helper-install" })
                    {
                        string target = Path.Combine(installDirectory, name);
                        if (File.Exists(target)) File.Delete(target);
                    }
                }
                MessageBox.Show("海斗数据助手已卸载。", "卸载完成", MessageBoxButtons.OK, MessageBoxIcon.Information);
                string self = Application.ExecutablePath;
                string directory = Path.GetDirectoryName(self) ?? "";
                Process.Start(new ProcessStartInfo("cmd.exe", "/d /c ping 127.0.0.1 -n 2 > nul & del /f /q \"" + self + "\" & rmdir \"" + directory + "\"") { CreateNoWindow = true, UseShellExecute = false });
            }
            catch (Exception error)
            {
                MessageBox.Show("卸载失败：\n\n" + error.Message, "海斗数据助手", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }
    }

    internal sealed class HealthInfo
    {
        internal int Version;
        internal bool IsHaiDou;
    }

    internal sealed class StepUpdate
    {
        internal int Step;
        internal bool Done;
        internal string Message = "";
    }

    internal static class InstallerOperations
    {
        private const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\HaiDouHelper";

        internal static HealthInfo ReadHealth()
        {
            try
            {
                HttpWebRequest request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:3212/v1/health");
                request.Timeout = 1000;
                request.ReadWriteTimeout = 1000;
                using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
                using (StreamReader reader = new StreamReader(response.GetResponseStream() ?? Stream.Null, Encoding.UTF8))
                {
                    string body = reader.ReadToEnd();
                    Match version = Regex.Match(body, "\\\"version\\\"\\s*:\\s*(\\d+)");
                    return new HealthInfo { IsHaiDou = body.Contains("haidou-local-helper"), Version = version.Success ? int.Parse(version.Groups[1].Value) : 0 };
                }
            }
            catch { return null; }
        }

        internal static string ReadInstallLocation()
        {
            using (RegistryKey key = Registry.CurrentUser.OpenSubKey(UninstallKey))
                return Convert.ToString(key == null ? null : key.GetValue("InstallLocation")) ?? "";
        }

        internal static string ReadDisplayVersion()
        {
            using (RegistryKey key = Registry.CurrentUser.OpenSubKey(UninstallKey))
                return Convert.ToString(key == null ? null : key.GetValue("DisplayVersion")) ?? "";
        }

        internal static string ResolveInstallDirectory(string selectedDirectory)
        {
            if (string.IsNullOrWhiteSpace(selectedDirectory)) throw new InvalidOperationException("请选择安装位置。");
            string selected = Path.GetFullPath(selectedDirectory.Trim());
            string installDirectory = Path.GetFileName(selected.TrimEnd(Path.DirectorySeparatorChar)).Equals("HaiDouHelper", StringComparison.OrdinalIgnoreCase) ? selected : Path.Combine(selected, "HaiDouHelper");
            installDirectory = Path.GetFullPath(installDirectory);
            string volumeRoot = (Path.GetPathRoot(installDirectory) ?? "").TrimEnd(Path.DirectorySeparatorChar);
            foreach (string protectedRoot in new[] { Environment.GetFolderPath(Environment.SpecialFolder.Windows), Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData) })
            {
                if (string.IsNullOrWhiteSpace(protectedRoot)) continue;
                string fullProtected = Path.GetFullPath(protectedRoot).TrimEnd(Path.DirectorySeparatorChar);
                if (installDirectory.TrimEnd(Path.DirectorySeparatorChar).Equals(volumeRoot, StringComparison.OrdinalIgnoreCase) || installDirectory.Equals(fullProtected, StringComparison.OrdinalIgnoreCase) || installDirectory.StartsWith(fullProtected + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException("请选择文档、游戏盘或其他当前用户可写目录，不要选择系统目录或磁盘根目录。");
            }
            return installDirectory;
        }

        internal static bool StopRunningHelper()
        {
            HealthInfo health = ReadHealth();
            if (health == null || !health.IsHaiDou) return false;
            int pid = FindListeningProcessId(3212);
            if (pid <= 0) throw new InvalidOperationException("检测到旧助手在线，但无法确认其进程。请在任务管理器中结束 HaiDouHelper.exe 后重试。");
            Process process = Process.GetProcessById(pid);
            if (!process.ProcessName.Equals("HaiDouHelper", StringComparison.OrdinalIgnoreCase) && !process.ProcessName.Equals("node", StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("端口 3212 被其他程序占用，更新已安全停止。");
            Program.WriteLog("STOP oldPid=" + pid + " process=" + process.ProcessName);
            process.Kill();
            if (!process.WaitForExit(8000)) throw new InvalidOperationException("旧版助手仍在运行，更新已安全停止。请在任务管理器中结束 HaiDouHelper.exe 后重试。");
            return true;
        }

        private static int FindListeningProcessId(int port)
        {
            ProcessStartInfo info = new ProcessStartInfo("netstat.exe", "-ano -p TCP") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true };
            using (Process process = Process.Start(info))
            {
                string output = process == null ? "" : process.StandardOutput.ReadToEnd();
                if (process != null) process.WaitForExit(3000);
                foreach (string line in output.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries))
                {
                    string normalized = Regex.Replace(line.Trim(), "\\s+", " ");
                    if (!normalized.Contains(":" + port + " ") || normalized.IndexOf("LISTENING", StringComparison.OrdinalIgnoreCase) < 0) continue;
                    string[] parts = normalized.Split(' ');
                    int pid;
                    if (int.TryParse(parts[parts.Length - 1], out pid)) return pid;
                }
            }
            return 0;
        }

        internal static void CopyPayload(string sourceDirectory, string installDirectory)
        {
            Directory.CreateDirectory(installDirectory);
            string probe = Path.Combine(installDirectory, ".write-test");
            File.WriteAllText(probe, "ok", Encoding.ASCII);
            File.Delete(probe);
            CopyRequired(Path.Combine(sourceDirectory, "HaiDouHelper.exe"), Path.Combine(installDirectory, "HaiDouHelper.exe"));
            CopyRequired(Path.Combine(sourceDirectory, "start-hidden.vbs"), Path.Combine(installDirectory, "start-hidden.vbs"));
            CopyRequired(Path.Combine(sourceDirectory, "README.txt"), Path.Combine(installDirectory, "README.txt"));
            CopyRequired(Application.ExecutablePath, Path.Combine(installDirectory, "HaiDouHelperInstaller.exe"));
            File.WriteAllText(Path.Combine(installDirectory, ".haidou-helper-install"), "HaiDouHelper|" + Program.ProductVersion, new UTF8Encoding(true));
            foreach (string name in new[] { "HaiDouHelper.exe", "start-hidden.vbs", "README.txt", "HaiDouHelperInstaller.exe", ".haidou-helper-install" })
                if (!File.Exists(Path.Combine(installDirectory, name))) throw new IOException("安装文件校验失败，缺少：" + name);
        }

        private static void CopyRequired(string source, string destination)
        {
            if (!File.Exists(source)) throw new FileNotFoundException("安装包缺少文件：" + Path.GetFileName(source));
            File.Copy(source, destination, true);
        }

        internal static void Register(string installDirectory)
        {
            string launcher = Path.Combine(installDirectory, "start-hidden.vbs");
            string installer = Path.Combine(installDirectory, "HaiDouHelperInstaller.exe");
            string wscript = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "wscript.exe");
            using (RegistryKey protocol = Registry.CurrentUser.CreateSubKey(@"Software\Classes\haidou-helper"))
            {
                protocol.SetValue("", "URL:HaiDou Data Helper Protocol");
                protocol.SetValue("URL Protocol", "");
                using (RegistryKey command = protocol.CreateSubKey(@"shell\open\command")) command.SetValue("", Quote(wscript) + " " + Quote(launcher) + " \"%1\"");
            }
            using (RegistryKey run = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run")) run.SetValue("HaiDouHelper", Quote(wscript) + " " + Quote(launcher));
            using (RegistryKey uninstall = Registry.CurrentUser.CreateSubKey(UninstallKey))
            {
                uninstall.SetValue("DisplayName", "HaiDou Data Helper");
                uninstall.SetValue("DisplayVersion", Program.ProductVersion);
                uninstall.SetValue("Publisher", "HaiDou Report");
                uninstall.SetValue("UninstallString", Quote(installer) + " /uninstall");
                uninstall.SetValue("InstallLocation", installDirectory);
                uninstall.SetValue("NoModify", 1, RegistryValueKind.DWord);
                uninstall.SetValue("NoRepair", 1, RegistryValueKind.DWord);
            }
        }

        internal static void StartHelper(string installDirectory)
        {
            Process.Start(new ProcessStartInfo(Path.Combine(installDirectory, "HaiDouHelper.exe")) { UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden, WorkingDirectory = installDirectory });
        }

        internal static void VerifyVersion17()
        {
            for (int attempt = 0; attempt < 12; attempt++)
            {
                Thread.Sleep(500);
                HealthInfo health = ReadHealth();
                if (health != null && health.IsHaiDou && health.Version >= Program.ApiVersion) return;
            }
            throw new InvalidOperationException("新版文件已复制，但本地接口没有达到 V17。请检查安全软件拦截记录。");
        }

        internal static bool IsOwnedInstallDirectory(string directory)
        {
            try
            {
                string marker = Path.Combine(Path.GetFullPath(directory), ".haidou-helper-install");
                return File.Exists(marker) && File.ReadAllText(marker, Encoding.UTF8).StartsWith("HaiDouHelper|", StringComparison.Ordinal);
            }
            catch { return false; }
        }

        internal static void CleanupPreviousInstall(string previousDirectory, string newDirectory)
        {
            if (string.IsNullOrWhiteSpace(previousDirectory) || Path.GetFullPath(previousDirectory).Equals(Path.GetFullPath(newDirectory), StringComparison.OrdinalIgnoreCase) || !IsOwnedInstallDirectory(previousDirectory)) return;
            foreach (string name in new[] { "HaiDouHelper.exe", "start-hidden.vbs", "README.txt", "HaiDouHelperInstaller.exe", ".haidou-helper-install" })
            {
                string target = Path.Combine(previousDirectory, name);
                if (File.Exists(target)) File.Delete(target);
            }
            if (Directory.Exists(previousDirectory) && Directory.GetFileSystemEntries(previousDirectory).Length == 0) Directory.Delete(previousDirectory);
        }

        internal static void RemoveRegistration()
        {
            TryDeleteTree(@"Software\Classes\haidou-helper");
            TryDeleteTree(UninstallKey);
            using (RegistryKey run = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", true))
                if (run != null) run.DeleteValue("HaiDouHelper", false);
        }

        private static void TryDeleteTree(string path)
        {
            try { Registry.CurrentUser.DeleteSubKeyTree(path); }
            catch (ArgumentException) { }
        }

        private static string Quote(string value) { return "\"" + value + "\""; }
    }

    internal sealed class InstallerForm : Form
    {
        private readonly Label[] stepIcons = new Label[6];
        private readonly Label[] stepLabels = new Label[6];
        private readonly TextBox pathBox = new TextBox();
        private readonly Button browseButton = new Button();
        private readonly Button installButton = new Button();
        private readonly Button cancelButton = new Button();
        private readonly ProgressBar progress = new ProgressBar();
        private readonly Label statusLabel = new Label();
        private readonly BackgroundWorker worker = new BackgroundWorker();
        private readonly string sourceDirectory;
        private readonly string previousDirectory;
        private bool installing;
        private bool succeeded;

        internal InstallerForm(bool preview)
        {
            sourceDirectory = AppDomain.CurrentDomain.BaseDirectory;
            previousDirectory = InstallerOperations.ReadInstallLocation();
            BuildInterface();
            worker.WorkerReportsProgress = true;
            worker.DoWork += InstallInBackground;
            worker.ProgressChanged += ApplyProgress;
            worker.RunWorkerCompleted += InstallationCompleted;
            if (preview) Shown += delegate { SetStep(0, true); SetStep(1, true); SetStep(2, false); progress.Value = 42; statusLabel.Text = "正在复制主程序并校验安装文件…"; pathBox.Enabled = browseButton.Enabled = installButton.Enabled = false; };
        }

        private void BuildInterface()
        {
            Text = "海斗数据助手安装程序";
            ClientSize = new Size(620, 610);
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            BackColor = Color.FromArgb(245, 247, 250);
            AutoScaleMode = AutoScaleMode.Dpi;

            Panel header = PanelAt(0, 0, 620, 104, Color.FromArgb(24, 49, 83));
            Controls.Add(header);
            header.Controls.Add(LabelAt("海斗数据助手", 28, 20, 360, 38, 20, Color.White, FontStyle.Bold));
            header.Controls.Add(LabelAt("读取本机 LOL 战绩，仅服务当前 Windows 用户", 30, 61, 430, 24, 9.5f, Color.FromArgb(203, 218, 236), FontStyle.Regular));
            Label badge = LabelAt("目标 V17", 500, 35, 90, 30, 10, Color.FromArgb(180, 237, 211), FontStyle.Bold);
            badge.TextAlign = ContentAlignment.MiddleCenter;
            badge.BorderStyle = BorderStyle.FixedSingle;
            header.Controls.Add(badge);

            Panel card = PanelAt(24, 124, 572, 92, Color.White);
            card.BorderStyle = BorderStyle.FixedSingle;
            Controls.Add(card);
            card.Controls.Add(LabelAt("当前版本", 18, 14, 90, 22, 9, Color.FromArgb(101, 113, 130), FontStyle.Regular));
            HealthInfo health = InstallerOperations.ReadHealth();
            string installed = InstallerOperations.ReadDisplayVersion();
            string current = health != null ? "应用 " + (string.IsNullOrWhiteSpace(installed) ? "未知" : installed) + "  ·  接口 V" + health.Version : string.IsNullOrWhiteSpace(installed) ? "尚未安装" : "应用 " + installed + "  ·  当前未运行";
            card.Controls.Add(LabelAt(current, 18, 38, 335, 30, 11.5f, Color.FromArgb(28, 39, 55), FontStyle.Bold));
            card.Controls.Add(LabelAt("安装后", 403, 14, 80, 22, 9, Color.FromArgb(101, 113, 130), FontStyle.Regular));
            Label target = LabelAt("应用 0.5.3  ·  接口 V17", 392, 38, 166, 30, 10.5f, Color.FromArgb(20, 126, 86), FontStyle.Bold);
            target.TextAlign = ContentAlignment.MiddleRight;
            card.Controls.Add(target);

            Controls.Add(LabelAt("安装位置", 26, 232, 100, 24, 9, Color.FromArgb(73, 85, 103), FontStyle.Bold));
            pathBox.SetBounds(26, 259, 468, 30);
            pathBox.Font = UiFont(9.5f, FontStyle.Regular);
            string legacyDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "HaiDouHelper");
            bool keepPreviousParent = !string.IsNullOrWhiteSpace(previousDirectory) && Directory.Exists(previousDirectory) && !Path.GetFullPath(previousDirectory).Equals(Path.GetFullPath(legacyDirectory), StringComparison.OrdinalIgnoreCase);
            pathBox.Text = keepPreviousParent ? Path.GetDirectoryName(previousDirectory) : Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
            Controls.Add(pathBox);
            browseButton.SetBounds(504, 257, 92, 32);
            browseButton.Text = "选择目录";
            browseButton.Font = UiFont(9, FontStyle.Regular);
            browseButton.Click += Browse;
            Controls.Add(browseButton);
            Controls.Add(LabelAt("程序会安装到所选目录下的 HaiDouHelper 文件夹，不需要管理员权限。", 27, 292, 550, 24, 8.5f, Color.FromArgb(113, 124, 140), FontStyle.Regular));

            Panel steps = PanelAt(24, 326, 572, 164, Color.White);
            steps.BorderStyle = BorderStyle.FixedSingle;
            Controls.Add(steps);
            string[] names = { "检测当前版本", "关闭旧版助手", "复制并校验文件", "注册自动启动", "启动新版助手", "确认接口达到 V17" };
            for (int index = 0; index < names.Length; index++)
            {
                int column = index % 2;
                int row = index / 2;
                int x = 18 + column * 275;
                int y = 14 + row * 47;
                stepIcons[index] = LabelAt("○", x, y, 26, 28, 12, Color.FromArgb(153, 163, 176), FontStyle.Bold);
                stepLabels[index] = LabelAt(names[index], x + 31, y + 2, 224, 27, 9.5f, Color.FromArgb(58, 70, 87), FontStyle.Regular);
                steps.Controls.Add(stepIcons[index]);
                steps.Controls.Add(stepLabels[index]);
            }

            progress.SetBounds(26, 507, 570, 8);
            progress.Style = ProgressBarStyle.Continuous;
            Controls.Add(progress);
            statusLabel.SetBounds(27, 523, 560, 30);
            statusLabel.Text = "准备安装，请确认安装位置。";
            statusLabel.Font = UiFont(9.5f, FontStyle.Regular);
            statusLabel.ForeColor = Color.FromArgb(73, 85, 103);
            statusLabel.AutoEllipsis = true;
            Controls.Add(statusLabel);

            cancelButton.SetBounds(406, 557, 90, 36);
            cancelButton.Text = "取消";
            cancelButton.Font = UiFont(9.5f, FontStyle.Regular);
            cancelButton.Click += delegate { if (!installing) Close(); };
            Controls.Add(cancelButton);
            installButton.SetBounds(506, 557, 90, 36);
            installButton.Text = "开始安装";
            installButton.Font = UiFont(9.5f, FontStyle.Bold);
            installButton.BackColor = Color.FromArgb(33, 105, 177);
            installButton.ForeColor = Color.White;
            installButton.FlatStyle = FlatStyle.Flat;
            installButton.FlatAppearance.BorderSize = 0;
            installButton.Click += StartInstall;
            Controls.Add(installButton);
            AcceptButton = installButton;
            CancelButton = cancelButton;
            FormClosing += delegate(object sender, FormClosingEventArgs args) { if (installing) args.Cancel = true; };
        }

        private void Browse(object sender, EventArgs args)
        {
            using (FolderBrowserDialog dialog = new FolderBrowserDialog { Description = "请选择海斗数据助手的安装位置", ShowNewFolderButton = true })
            {
                if (Directory.Exists(pathBox.Text)) dialog.SelectedPath = pathBox.Text;
                if (dialog.ShowDialog(this) == DialogResult.OK) pathBox.Text = dialog.SelectedPath;
            }
        }

        private void StartInstall(object sender, EventArgs args)
        {
            if (succeeded)
            {
                Process.Start(Program.WebsiteUrl);
                Close();
                return;
            }
            installing = true;
            installButton.Enabled = browseButton.Enabled = pathBox.Enabled = cancelButton.Enabled = false;
            ResetSteps();
            worker.RunWorkerAsync(pathBox.Text);
        }

        private void InstallInBackground(object sender, DoWorkEventArgs args)
        {
            string selected = Convert.ToString(args.Argument) ?? "";
            Program.WriteLog("START version=" + Program.ProductVersion);
            Report(0, false, "正在检测当前版本和安装位置…");
            string installDirectory = InstallerOperations.ResolveInstallDirectory(selected);
            Report(0, true, "已确认安装位置");
            Report(1, false, "正在关闭运行中的旧版助手…");
            bool stopped = InstallerOperations.StopRunningHelper();
            Report(1, true, stopped ? "旧版助手已关闭" : "没有运行中的旧助手");
            Report(2, false, "正在复制主程序并校验安装文件…");
            InstallerOperations.CopyPayload(sourceDirectory, installDirectory);
            Report(2, true, "安装文件校验通过");
            Report(3, false, "正在注册开机启动和网页连接…");
            InstallerOperations.Register(installDirectory);
            Report(3, true, "启动项注册完成");
            Report(4, false, "正在启动新版海斗数据助手…");
            InstallerOperations.StartHelper(installDirectory);
            Report(4, true, "新版助手已启动");
            Report(5, false, "正在确认本地接口达到 V17…");
            InstallerOperations.VerifyVersion17();
            Report(5, true, "本地接口已达到 V17");
            InstallerOperations.CleanupPreviousInstall(previousDirectory, installDirectory);
            Program.WriteLog("SUCCESS version=" + Program.ProductVersion + " api=" + Program.ApiVersion + " stoppedOld=" + stopped + " path=" + installDirectory);
            args.Result = installDirectory;
        }

        private void Report(int step, bool done, string message)
        {
            worker.ReportProgress(done ? Math.Min(96, (step + 1) * 16) : Math.Max(4, step * 16 + 4), new StepUpdate { Step = step, Done = done, Message = message });
        }

        private void ApplyProgress(object sender, ProgressChangedEventArgs args)
        {
            StepUpdate update = (StepUpdate)args.UserState;
            progress.Value = args.ProgressPercentage;
            statusLabel.Text = update.Message;
            SetStep(update.Step, update.Done);
        }

        private void InstallationCompleted(object sender, RunWorkerCompletedEventArgs args)
        {
            installing = false;
            if (args.Error == null)
            {
                succeeded = true;
                progress.Value = 100;
                statusLabel.Text = "安装成功：海斗数据助手 V17 已启动。";
                statusLabel.ForeColor = Color.FromArgb(20, 126, 86);
                installButton.SetBounds(456, 557, 140, 36);
                installButton.Text = "完成并打开网页";
                installButton.BackColor = Color.FromArgb(20, 126, 86);
                installButton.Enabled = true;
                cancelButton.Text = "关闭";
                cancelButton.Enabled = true;
                return;
            }
            Program.WriteLog("FAILED: " + args.Error.Message);
            for (int index = 0; index < stepIcons.Length; index++) if (stepIcons[index].Text == "●") { stepIcons[index].Text = "×"; stepIcons[index].ForeColor = Color.FromArgb(191, 59, 59); stepLabels[index].ForeColor = Color.FromArgb(142, 43, 43); }
            statusLabel.Text = "安装失败：" + args.Error.Message + "  日志：" + Program.LogPath;
            statusLabel.ForeColor = Color.FromArgb(172, 48, 48);
            installButton.SetBounds(506, 557, 90, 36);
            installButton.Text = "重试安装";
            installButton.BackColor = Color.FromArgb(33, 105, 177);
            installButton.Enabled = browseButton.Enabled = pathBox.Enabled = cancelButton.Enabled = true;
            cancelButton.Text = "关闭";
        }

        private void SetStep(int index, bool done)
        {
            stepIcons[index].Text = done ? "✓" : "●";
            stepIcons[index].ForeColor = done ? Color.FromArgb(20, 126, 86) : Color.FromArgb(33, 105, 177);
            stepLabels[index].ForeColor = done ? Color.FromArgb(35, 83, 67) : Color.FromArgb(25, 76, 132);
            if (!done) stepLabels[index].Font = UiFont(9.5f, FontStyle.Bold);
        }

        private void ResetSteps()
        {
            succeeded = false;
            progress.Value = 0;
            statusLabel.ForeColor = Color.FromArgb(73, 85, 103);
            for (int index = 0; index < stepIcons.Length; index++)
            {
                stepIcons[index].Text = "○";
                stepIcons[index].ForeColor = Color.FromArgb(153, 163, 176);
                stepLabels[index].ForeColor = Color.FromArgb(58, 70, 87);
                stepLabels[index].Font = UiFont(9.5f, FontStyle.Regular);
            }
        }

        private static Panel PanelAt(int x, int y, int width, int height, Color color) { return new Panel { Location = new Point(x, y), Size = new Size(width, height), BackColor = color }; }
        private static Label LabelAt(string text, int x, int y, int width, int height, float size, Color color, FontStyle style) { return new Label { Text = text, Location = new Point(x, y), Size = new Size(width, height), Font = UiFont(size, style), ForeColor = color, BackColor = Color.Transparent }; }
        private static Font UiFont(float size, FontStyle style) { return new Font("Microsoft YaHei UI", size, style); }
    }
}
