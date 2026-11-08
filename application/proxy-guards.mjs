import dns from 'dns/promises';
import net from 'net';

/**
 * Garde anti-SSRF du relais de développement, isolée du serveur HTTP pour être
 * testée : mêmes règles pour toutes les routes qui sortent vers un serveur
 * choisi par le navigateur.
 */

/**
 * Développe une adresse IPv6 en 16 octets, y compris les formes hexadécimales
 * des adresses IPv4 encapsulées (`::ffff:7f00:1`). `null` si illisible.
 */
export function expandIpv6(address) {
  if (typeof address !== 'string') return null;
  // Identifiant de zone (`fe80::1%eth0`) et casse indifférente.
  let value = address.toLowerCase().split('%')[0];
  const dotted = value.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (dotted) {
    const parts = dotted.slice(1).map(Number);
    if (parts.some(part => part > 255)) return null;
    const high = ((parts[0] << 8) | parts[1]).toString(16).padStart(4, '0');
    const low = ((parts[2] << 8) | parts[3]).toString(16).padStart(4, '0');
    value = `${value.slice(0, -dotted[0].length)}${high}:${low}`;
  }
  const halves = value.split('::');
  if (halves.length > 2) return null;
  const groups = (part) => (part ? part.split(':') : []);
  const left = groups(halves[0]);
  const right = halves.length === 2 ? groups(halves[1]) : [];
  if (halves.length === 1 && left.length !== 8) return null;
  const missing = 8 - left.length - right.length;
  if (missing < 0) return null;
  const bytes = [];
  for (const group of [...left, ...Array(missing).fill('0'), ...right]) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    const groupValue = parseInt(group, 16);
    bytes.push(groupValue >> 8, groupValue & 0xff);
  }
  return bytes.length === 16 ? bytes : null;
}

function isPrivateIpv4(address) {
  const [a, b] = address.split('.').map(Number);
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a === 169 && b === 254) return true;           // lien local
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a >= 224) return true;                          // multicast + réservé
  return false;
}

/** Vrai pour les adresses qui ne doivent jamais être jointes par le relais (SSRF). */
export function isPrivateAddress(address) {
  const version = net.isIP(address);
  if (version === 4) return isPrivateIpv4(address);
  if (version === 6) {
    const bytes = expandIpv6(address);
    if (!bytes) return true;
    const zeroPrefix = bytes.slice(0, 10).every(byte => byte === 0);
    // ::ffff:0:0/96 (IPv4 mappé) et ::/96 (IPv4 compatible obsolète) : `new URL`
    // normalise `[::ffff:127.0.0.1]` en `[::ffff:7f00:1]`, donc les 32 derniers
    // bits sont décodés — reconnaître seulement la forme pointée laissait passer
    // une adresse locale.
    if (zeroPrefix && ((bytes[10] === 0xff && bytes[11] === 0xff) || (bytes[10] === 0 && bytes[11] === 0))) {
      return isPrivateIpv4(`${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`);
    }
    if ((bytes[0] & 0xfe) === 0xfc) return true;                      // ULA fc00::/7
    if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true; // lien local fe80::/10
    return false;
  }
  return true; // adresse illisible : refus par prudence
}

/** Refuse les cibles locales ou privées, y compris via un nom qui s'y résout. */
export async function assertPublicTarget(url) {
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) throw new Error('Cible locale refusée');
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw new Error('Cible privée refusée');
    return;
  }
  const addresses = await dns.lookup(host, { all: true, verbatim: true });
  if (addresses.length === 0) throw new Error('Cible introuvable');
  for (const { address } of addresses) {
    if (isPrivateAddress(address)) throw new Error('Cible privée refusée');
  }
}

/** Valide une URL de serveur Xtream : http/https uniquement, sans identifiants inclus. */
export function parseXtreamServer(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (url.username || url.password) return null;
    return url.href.replace(/\/+$/, '');
  } catch {
    return null;
  }
}
