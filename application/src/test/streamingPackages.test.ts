import { describe, expect, it } from 'vitest';
import { streamingPlatforms } from '@/data/streamingPlatforms';
import { replayPlatforms } from '@/data/replayChannels';

// Nom de paquet Android : segments minuscules séparés par des points (identifiants Play Store).
const ANDROID_PACKAGE = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;

describe('Paquets Android des plateformes de streaming', () => {
  it('chaque plateforme propose des applications officielles au format valide', () => {
    for (const platform of streamingPlatforms) {
      const packages = platform.androidPackages;
      expect(packages, `${platform.id} sans paquet Android`).toBeDefined();
      expect(packages!.length).toBeGreaterThan(0);
      expect(packages!.length).toBeLessThanOrEqual(3); // mobile + variante TV au plus
      for (const pkg of packages!) {
        expect(pkg, `${platform.id} : paquet invalide`).toMatch(ANDROID_PACKAGE);
      }
      expect(new Set(packages!).size, `${platform.id} : doublon`).toBe(packages!.length);
    }
  });

  it('un paquet n’est partagé qu’entre Canal+ et OCS (même application myCANAL)', () => {
    for (const a of streamingPlatforms) {
      for (const b of streamingPlatforms) {
        if (a.id >= b.id) continue;
        const shared = a.androidPackages!.filter(pkg => b.androidPackages!.includes(pkg));
        const allowed = ['canalplus', 'ocs'].includes(a.id) && ['canalplus', 'ocs'].includes(b.id);
        if (!allowed) expect(shared, `paquet partagé ${a.id}/${b.id}`).toEqual([]);
      }
    }
  });

  it('IDs vérifiés sur le Play Store le 8 novembre 2026 (extraits)', () => {
    const byId = new Map(streamingPlatforms.map(p => [p.id, p.androidPackages!]));
    expect(byId.get('netflix')).toEqual(['com.netflix.mediaclient', 'com.netflix.ninja']); // variante Android TV
    expect(byId.get('youtube')).toContain('com.google.android.youtube.tv'); // variante TV après la mobile
    expect(byId.get('primevideo')).toEqual(['com.amazon.avod.thirdpartyclient', 'com.amazon.amazonvideo.livingroom']);
    expect(byId.get('max')).toEqual(['com.wbd.stream', 'com.wbd.hbomax']);
    expect(byId.get('tf1plus')).toContain('fr.tf1.mytf1');
    expect(byId.get('m6plus')).toContain('fr.m6.m6replay');
    expect(byId.get('francetv')).toContain('fr.francetv.pluzz');
    expect(byId.get('arte')).toContain('tv.arte.plus7');
    expect(byId.get('rakutentv')).toContain('tv.wuaki');
    expect(byId.get('adn')).toContain('fr.anidn');
    // Paquet inhabituel mais officiel de l'app L'Équipe (éditeur L'Equipe 24/24).
    expect(byId.get('lequipe')).toEqual(['lequipe.fr']);
  });

  it('URLs appuyées sur les domaines réellement déclarés par les apps (dumpsys Hisense)', () => {
    // Prime : www.primevideo.com n'est pas un App Link des apps, app.primevideo.com l'est.
    expect(streamingPlatforms.find(p => p.id === 'primevideo')!.url).toBe('https://app.primevideo.com');
    // Max : www.max.com n'est pas déclaré non plus — l'app s'ouvre à l'accueil via le paquet.
    expect(streamingPlatforms.find(p => p.id === 'max')!.url).toBe('https://www.max.com');
  });

  it('replay officiel : mêmes paquets que la plateforme de streaming de même id', () => {
    const byId = new Map(streamingPlatforms.map(p => [p.id, p.androidPackages!]));
    for (const platform of replayPlatforms) {
      expect(platform.androidPackages, `${platform.id} : désaccord replay/streaming`).toEqual(byId.get(platform.id));
    }
  });
});
