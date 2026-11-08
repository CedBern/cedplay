import { describe, expect, it } from 'vitest';
import { assertPublicTarget, expandIpv6, isPrivateAddress, parseXtreamServer } from '../../proxy-guards.mjs';

describe('garde anti-SSRF du relais', () => {
  it('reconnaît les plages IPv4 locales et publiques', () => {
    for (const address of ['0.0.0.0', '10.1.2.3', '127.0.0.1', '100.64.0.1', '169.254.1.1', '172.16.0.1', '192.168.1.1', '224.0.0.1']) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
    for (const address of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '100.63.255.255']) {
      expect(isPrivateAddress(address), address).toBe(false);
    }
  });

  it('décode les formes IPv6, y compris les IPv4 encapsulées en hexadécimal', () => {
    expect(expandIpv6('::ffff:7f00:1')).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff, 0x7f, 0, 0, 1]);
    expect(expandIpv6('::ffff:127.0.0.1')).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff, 0x7f, 0, 0, 1]);
    expect(expandIpv6('fe80::1%eth0')).not.toBeNull();
    expect(expandIpv6('pas une adresse')).toBeNull();
  });

  it('refuse les cibles locales exprimées en IPv6', () => {
    for (const address of ['::', '::1', 'fd00::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '::ffff:a00:1']) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
    expect(isPrivateAddress('::ffff:8.8.8.8')).toBe(false);
    expect(isPrivateAddress('2001:4860:4860::8888')).toBe(false);
  });

  it('refuse la forme normalisée par URL de [::ffff:127.0.0.1]', async () => {
    const url = new URL('http://[::ffff:127.0.0.1]:5179/');
    expect(url.hostname).toBe('[::ffff:7f00:1]');
    await expect(assertPublicTarget(url)).rejects.toThrow('Cible privée refusée');
  });

  it('refuse localhost et accepte une adresse publique sans requête DNS', async () => {
    await expect(assertPublicTarget(new URL('http://localhost:5179/'))).rejects.toThrow('Cible locale refusée');
    await expect(assertPublicTarget(new URL('http://machine.localhost/'))).rejects.toThrow('Cible locale refusée');
    await expect(assertPublicTarget(new URL('http://8.8.8.8/'))).resolves.toBeUndefined();
  });

  it('valide la syntaxe d’un serveur Xtream', () => {
    expect(parseXtreamServer('https://provider.test/')).toBe('https://provider.test');
    expect(parseXtreamServer('http://provider.test:8080/panel?x=1')).toBe('http://provider.test:8080/panel?x=1');
    expect(parseXtreamServer('ftp://provider.test')).toBeNull();
    expect(parseXtreamServer('https://user:pass@provider.test')).toBeNull();
    expect(parseXtreamServer('pas une url')).toBeNull();
  });
});
