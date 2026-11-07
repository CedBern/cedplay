// Legacy API name: only the supplied server is contacted.
export class CORSProxy {
  static async fetchWithProxy(url: string, options: RequestInit = {}): Promise<string> {
    let target: URL;
    try { target = new URL(url); } catch { throw new Error('Adresse de playlist invalide.'); }
    if (!['http:', 'https:'].includes(target.protocol)) throw new Error('Utilisez une adresse HTTP ou HTTPS.');
    if (this.isMixedContentIssue(url)) throw new Error('Import HTTP impossible depuis une page HTTPS. Téléchargez puis importez le fichier M3U.');
    const controller = new AbortController();
    const abort = () => controller.abort();
    const timeout = setTimeout(abort, 15000);
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    try {
      const response = await fetch(target.href, { ...options, signal: controller.signal, referrerPolicy: 'no-referrer' });
      if (!response.ok) {
        throw new Error(`Import impossible : HTTP ${response.status}. Téléchargez puis importez le fichier M3U. Aucun relais public utilisé.`);
      }
      return await response.text();
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Import impossible : HTTP')) {
        throw err;
      }
      throw new Error('Import impossible (connexion, accès ou CORS). Téléchargez puis importez le fichier M3U. Aucun relais public utilisé.');
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', abort);
    }
  }
  static convertToHttps(url: string): string { return url.replace(/^http:/, 'https:'); }
  static isMixedContentIssue(url: string): boolean {
    return window.location.protocol === 'https:' && url.startsWith('http://');
  }
  static async testConnectivity(url: string): Promise<boolean> {
    try { await this.fetchWithProxy(url, { method: 'HEAD' }); return true; } catch { return false; }
  }
}
