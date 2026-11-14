using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace CedPlayDesktop
{
    static class Launcher
    {
        private static bool SetWindowLifecycle(int port, string action)
        {
            try
            {
                var request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + "/api/desktop/lifecycle/" + action);
                request.Method = "POST";
                request.ContentLength = 0;
                request.Timeout = 3000;
                using (var response = (HttpWebResponse)request.GetResponse())
                using (var reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
                {
                    string body = reader.ReadToEnd();
                    return body.Contains("\"backgroundWork\":true");
                }
            }
            catch
            {
                return false;
            }
        }

        private static int FindFreePort()
        {
            var listener = new TcpListener(IPAddress.Loopback, 0);
            listener.Start();
            int port = ((IPEndPoint)listener.LocalEndpoint).Port;
            listener.Stop();
            return port;
        }

        private static bool IsHealthy(int port)
        {
            try
            {
                var req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + "/api/desktop/health");
                req.Timeout = 800;
                using (var resp = (HttpWebResponse)req.GetResponse())
                using (var reader = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
                {
                    string body = reader.ReadToEnd();
                    return resp.StatusCode == HttpStatusCode.OK && body.Contains("\"desktop\":true");
                }
            }
            catch
            {
                return false;
            }
        }

        private static bool IsPortInUse(int port)
        {
            try
            {
                using (var client = new TcpClient())
                {
                    var result = client.BeginConnect("127.0.0.1", port, null, null);
                    bool success = result.AsyncWaitHandle.WaitOne(200);
                    if (success) client.EndConnect(result);
                    return success;
                }
            }
            catch
            {
                return false;
            }
        }

        private static string FindExecutable(string name, string[] fallbacks)
        {
            string pathEnv = Environment.GetEnvironmentVariable("PATH") ?? "";
            foreach (string dir in pathEnv.Split(';'))
            {
                if (string.IsNullOrWhiteSpace(dir)) continue;
                try
                {
                    string candidate = Path.Combine(dir.Trim(), name);
                    if (File.Exists(candidate)) return candidate;
                }
                catch { }
            }
            foreach (string candidate in fallbacks)
            {
                if (!string.IsNullOrEmpty(candidate) && File.Exists(candidate)) return candidate;
            }
            return null;
        }

        private static string[] FindBrowserCandidates()
        {
            string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            string pf86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
            var raw = new[]
            {
                FindExecutable("msedge.exe", new[] {
                    Path.Combine(pf86, "Microsoft", "Edge", "Application", "msedge.exe"),
                    Path.Combine(pf, "Microsoft", "Edge", "Application", "msedge.exe"),
                    Path.Combine(localAppData, "Microsoft", "Edge", "Application", "msedge.exe")
                }),
                FindExecutable("chrome.exe", new[] {
                    Path.Combine(pf, "Google", "Chrome", "Application", "chrome.exe"),
                    Path.Combine(pf86, "Google", "Chrome", "Application", "chrome.exe"),
                    Path.Combine(localAppData, "Google", "Chrome", "Application", "chrome.exe")
                }),
                FindExecutable("brave.exe", new[] {
                    Path.Combine(pf, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
                    Path.Combine(pf86, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
                    Path.Combine(localAppData, "BraveSoftware", "Brave-Browser", "Application", "brave.exe")
                })
            };

            var list = new System.Collections.Generic.List<string>();
            foreach (string path in raw)
            {
                if (string.IsNullOrEmpty(path) || !File.Exists(path)) continue;
                if (string.Equals(Path.GetFileName(path), "msedge.exe", StringComparison.OrdinalIgnoreCase))
                {
                    string ifeo = Path.Combine(Path.GetDirectoryName(path) ?? "", "msedge_IFEO.exe");
                    if (File.Exists(ifeo)) continue;
                }
                if (!list.Contains(path)) list.Add(path);
            }
            return list.ToArray();
        }

        [STAThread]
        static void Main(string[] args)
        {
            bool created;
            using (var mutex = new Mutex(true, "Local\\CedPlayDesktopLauncher", out created))
            {
                if (!created) return;
                try { Run(args); }
                finally { mutex.ReleaseMutex(); }
            }
        }

        private static void Run(string[] args)
        {
            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            string serverScript = Path.Combine(baseDir, "desktop", "server.mjs");
            if (!File.Exists(serverScript))
            {
                MessageBox.Show(
                    "Fichier introuvable : " + serverScript,
                    "CedPlay Desktop",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
                return;
            }

            string nodeExe = FindExecutable("node.exe", new[] {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "nodejs", "node.exe")
            });
            if (nodeExe == null)
            {
                MessageBox.Show(
                    "Node.js est requis pour exécuter CedPlay Desktop.",
                    "CedPlay Desktop",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
                return;
            }

            string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string[] browsers = FindBrowserCandidates();
            if (browsers.Length == 0)
            {
                MessageBox.Show(
                    "Aucun navigateur Chromium compatible (Edge, Chrome ou Brave) n'est disponible sur ce PC.",
                    "CedPlay Desktop",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
                return;
            }

            int port = 4178;
            int configuredPort;
            if (int.TryParse(Environment.GetEnvironmentVariable("CEDPLAY_DESKTOP_PORT"), out configuredPort)
                && configuredPort > 0 && configuredPort <= 65535) port = configuredPort;
            Process serverProc = null;
            if (!IsHealthy(port))
            {
                if (IsPortInUse(port)) port = FindFreePort();
                var psi = new ProcessStartInfo
                {
                    FileName = nodeExe,
                    Arguments = "\"" + serverScript + "\"",
                    WorkingDirectory = baseDir,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };
                psi.EnvironmentVariables["CEDPLAY_DESKTOP_PORT"] = port.ToString();
                serverProc = Process.Start(psi);

                bool ready = false;
                for (int i = 0; i < 60; i++)
                {
                    if (IsHealthy(port)) { ready = true; break; }
                    if (serverProc != null && serverProc.HasExited) break;
                    Thread.Sleep(150);
                }
                if (!ready)
                {
                    try { if (serverProc != null && !serverProc.HasExited) serverProc.Kill(); } catch { }
                    MessageBox.Show(
                        "Le serveur local CedPlay Desktop n'a pas démarré à temps.",
                        "CedPlay Desktop",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error
                    );
                    return;
                }
            }

            string profileDir = Environment.GetEnvironmentVariable("CEDPLAY_PROFILE_DIR");
            if (string.IsNullOrWhiteSpace(profileDir)) profileDir = Path.Combine(localAppData, "CedPlay", "DesktopProfile");
            Directory.CreateDirectory(profileDir);

            string appUrl = "http://127.0.0.1:" + port + "/?desktop=1";
            SetWindowLifecycle(port, "retain");
            try
            {
                bool launched = false;
                foreach (string browserExe in browsers)
                {
                    var browserPsi = new ProcessStartInfo
                    {
                        FileName = browserExe,
                        Arguments = "--app=" + appUrl
                            + " --user-data-dir=\"" + profileDir + "\""
                            + " --window-size=1280,720"
                            + " --disable-background-mode"
                            + " --no-first-run"
                            + " --no-default-browser-check",
                        UseShellExecute = false
                    };
                    using (Process browser = Process.Start(browserPsi))
                    {
                        if (browser == null) continue;
                        if (browser.WaitForExit(1200))
                        {
                            // Un navigateur bloqué ou redirigé (ex: IFEO) sort en erreur : tenter le suivant.
                            // Un code 0 signifie une fermeture volontaire rapide (ou prise en charge existante).
                            if (browser.ExitCode != 0) continue;
                            launched = true;
                            break;
                        }
                        launched = true;
                        browser.WaitForExit();
                        break;
                    }
                }
                if (!launched)
                {
                    MessageBox.Show(
                        "La fenêtre CedPlay n'a pas pu démarrer. Ferme les anciennes fenêtres CedPlay puis réessaie.",
                        "CedPlay Desktop",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error
                    );
                }
            }
            finally
            {
                bool backgroundWork = SetWindowLifecycle(port, "release");
                if (!backgroundWork && serverProc != null)
                {
                    try { serverProc.WaitForExit(3500); } catch { }
                }
            }
        }
    }
}
