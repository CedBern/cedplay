// Import de liste par adresse : web = fetch direct (le relais reste facultatif et
// public ; sans en-têtes CORS du serveur, l'import échoue avec un message clair).
// Android = requête native CapacitorHttp : ni CORS ni mixed content, la plupart des
// serveurs M3U sont donc accessibles sans téléchargement manuel du fichier.

import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { getActiveUserAgent } from '@/utils/userAgent';
import { assertImportSize, decodeImportText } from '@/utils/textImport';

export class CORSProxy {
  static async fetchWithProxy(url: string, options: RequestInit = {}): Promise<string> {
    let target: URL;
    try { target = new URL(url); } catch { throw new Error('Adresse de playlist invalide.'); }
    if (!['http:', 'https:'].includes(target.protocol)) throw new Error('Utilisez une adresse HTTP ou HTTPS.');
    if (Capacitor.isNativePlatform()) {
      try {
        // request() et non get() : l'implémentation Android de get() force GET,
        // y compris quand options.method vaut 'HEAD' (testConnectivity).
        const response = await CapacitorHttp.request({
          url: target.href,
          method: (options.method as 'GET' | 'HEAD') ?? 'GET',
          headers: { 'User-Agent': getActiveUserAgent() },
          responseType: 'text',
          connectTimeout: 15000,
          readTimeout: 60000,
        });
        if (response.status < 200 || response.status >= 300) {
          throw new Error(`Import impossible : HTTP ${response.status}. Téléchargez puis importez le fichier M3U. Aucun relais public utilisé.`);
        }
        const text = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
        assertImportSize(text.length, 'playlist');
        return text;
      } catch (err) {
        if (err instanceof Error && (err.message.startsWith('Import impossible : HTTP') || err.message.startsWith('Liste trop volumineuse'))) throw err;
        throw new Error('Import impossible (connexion ou accès). Téléchargez puis importez le fichier M3U. Aucun relais public utilisé.');
      }
    }
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
      // Refus avant lecture quand le serveur annonce déjà un fichier trop gros.
      const declared = Number(response.headers?.get?.('content-length'));
      if (Number.isFinite(declared) && declared > 0) assertImportSize(declared, 'playlist');
      // Octets puis décodage explicite : une liste Latin-1 sans en-tête de jeu
      // de caractères redevenait illisible après le décodage UTF-8 imposé par text().
      return decodeImportText(new Uint8Array(await response.arrayBuffer()), 'playlist');
    } catch (err) {
      if (err instanceof Error && (err.message.startsWith('Import impossible : HTTP') || err.message.startsWith('Liste trop volumineuse'))) {
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
