import { execFile } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const TOAST_APP_ID = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe';

const POWERSHELL_TOAST_SCRIPT = [
  '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null',
  '$xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)',
  '$nodes = $xml.GetElementsByTagName("text")',
  '$nodes.Item(0).AppendChild($xml.CreateTextNode([string]$env:CEDPLAY_TOAST_TITLE)) | Out-Null',
  '$nodes.Item(1).AppendChild($xml.CreateTextNode([string]$env:CEDPLAY_TOAST_BODY)) | Out-Null',
  '$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)',
  `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${TOAST_APP_ID}').Show($toast)`,
].join('; ');

/**
 * Envoie une notification système Windows (WinRT Toast) et la trace optionnellement
 * dans CEDPLAY_NOTIFICATION_LOG pour les tests d'intégration.
 */
export function sendDesktopNotification({ kind = 'info', title = 'CedPlay Desktop', body = '', channelId = '', tag = '' } = {}) {
  const safeTitle = String(title || 'CedPlay Desktop').slice(0, 140);
  const safeBody = String(body || '').slice(0, 280);
  const entry = {
    ts: Date.now(),
    kind: String(kind || 'info'),
    title: safeTitle,
    body: safeBody,
    ...(channelId ? { channelId: String(channelId) } : {}),
    ...(tag ? { tag: String(tag) } : {}),
  };

  const logPath = process.env.CEDPLAY_NOTIFICATION_LOG;
  if (logPath) {
    try {
      mkdirSync(path.dirname(logPath), { recursive: true });
      appendFileSync(logPath, `${JSON.stringify(entry)}\n`, 'utf8');
    } catch {
      /* ignore log failure */
    }
  }

  if (process.platform !== 'win32' || process.env.CEDPLAY_DISABLE_OS_NOTIFICATIONS === '1') {
    return Promise.resolve({ ok: true, osToastSent: false, entry });
  }

  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', POWERSHELL_TOAST_SCRIPT],
      {
        timeout: 6000,
        windowsHide: true,
        env: {
          ...process.env,
          CEDPLAY_TOAST_TITLE: safeTitle,
          CEDPLAY_TOAST_BODY: safeBody,
        },
      },
      (err) => {
        resolve({ ok: !err, osToastSent: !err, entry });
      },
    );
  });
}
