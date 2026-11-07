import { describe, it, expect } from 'vitest';
import { matchStreamingPlatformOrNetwork, STREAMING_PLATFORMS } from '@/utils/platformLogos';

describe('matchStreamingPlatformOrNetwork', () => {
  it('reconnaît les chaînes et catégories Netflix', () => {
    expect(matchStreamingPlatformOrNetwork('FR | NETFLIX 4K')).toBe('netflix');
    expect(matchStreamingPlatformOrNetwork('NETFLIX ACTION')).toBe('netflix');
    expect(matchStreamingPlatformOrNetwork('netflix')).toBe('netflix');
  });

  it('reconnaît Disney+', () => {
    expect(matchStreamingPlatformOrNetwork('DISNEY+ CINEMA UHD')).toBe('disneyplus');
    expect(matchStreamingPlatformOrNetwork('FR : DISNEY PLUS')).toBe('disneyplus');
    expect(matchStreamingPlatformOrNetwork('DISNEY CHANNEL')).toBe('disneyplus');
  });

  it('reconnaît Prime Video & Amazon Prime', () => {
    expect(matchStreamingPlatformOrNetwork('AMAZON PRIME VIDEO 1')).toBe('primevideo');
    expect(matchStreamingPlatformOrNetwork('PRIME VIDEO LIGUE 1')).toBe('primevideo');
    expect(matchStreamingPlatformOrNetwork('Amazon Prime')).toBe('primevideo');
  });

  it('reconnaît Max & HBO', () => {
    expect(matchStreamingPlatformOrNetwork('HBO MAX FHD')).toBe('max');
    expect(matchStreamingPlatformOrNetwork('WARNER MAX 4K')).toBe('max');
    expect(matchStreamingPlatformOrNetwork('HBO')).toBe('max');
  });

  it('reconnaît Apple TV+', () => {
    expect(matchStreamingPlatformOrNetwork('APPLE TV+ DRAMA')).toBe('appletv');
    expect(matchStreamingPlatformOrNetwork('Apple TV')).toBe('appletv');
  });

  it('reconnaît Canal+', () => {
    expect(matchStreamingPlatformOrNetwork('CANAL+ GRAND ECRAN')).toBe('canalplus');
    expect(matchStreamingPlatformOrNetwork('CANAL+ SPORT 360')).toBe('canalplus');
    expect(matchStreamingPlatformOrNetwork('MYCANAL LIVE')).toBe('canalplus');
  });

  it('reconnaît Paramount+', () => {
    expect(matchStreamingPlatformOrNetwork('PARAMOUNT+ UHD')).toBe('paramountplus');
    expect(matchStreamingPlatformOrNetwork('Paramount Plus')).toBe('paramountplus');
  });

  it('reconnaît Crunchyroll & ADN', () => {
    expect(matchStreamingPlatformOrNetwork('CRUNCHYROLL TV 24/7')).toBe('crunchyroll');
    expect(matchStreamingPlatformOrNetwork('ADN Anime')).toBe('adn');
  });

  it('reconnaît les plateformes gratuites et FAST (YouTube, Twitch, Pluto TV, Rakuten, Plex)', () => {
    expect(matchStreamingPlatformOrNetwork('YOUTUBE LIVE')).toBe('youtube');
    expect(matchStreamingPlatformOrNetwork('TWITCH GAMING')).toBe('twitch');
    expect(matchStreamingPlatformOrNetwork('PLUTO TV COMEDIE')).toBe('plutotv');
    expect(matchStreamingPlatformOrNetwork('RAKUTEN TV ACTION')).toBe('rakutentv');
    expect(matchStreamingPlatformOrNetwork('PLEX CINEMA')).toBe('plex');
  });

  it('reconnaît les réseaux français officiels (TF1, M6, France TV, Arte, Molotov)', () => {
    expect(matchStreamingPlatformOrNetwork('TF1 4K')).toBe('tf1plus');
    expect(matchStreamingPlatformOrNetwork('M6 FHD')).toBe('m6plus');
    expect(matchStreamingPlatformOrNetwork('France 2 UHD')).toBe('francetv');
    expect(matchStreamingPlatformOrNetwork('ARTE HD')).toBe('arte');
    expect(matchStreamingPlatformOrNetwork('MOLOTOV CHANNELS')).toBe('molotov');
  });

  it('reconnaît les chaînes sportives (DAZN, beIN, Eurosport)', () => {
    expect(matchStreamingPlatformOrNetwork('DAZN 1')).toBe('dazn');
    expect(matchStreamingPlatformOrNetwork('BEIN SPORTS 1 HD')).toBe('beinsports');
    expect(matchStreamingPlatformOrNetwork('EUROSPORT 1')).toBe('eurosport');
  });

  it('renvoie null pour les chaînes sans plateforme reconnue', () => {
    expect(matchStreamingPlatformOrNetwork('BFM TV')).toBeNull();
    expect(matchStreamingPlatformOrNetwork('CNN International')).toBeNull();
    expect(matchStreamingPlatformOrNetwork(null)).toBeNull();
    expect(matchStreamingPlatformOrNetwork(undefined)).toBeNull();
  });

  it('vérifie que toutes les plateformes définies ont des propriétés valides', () => {
    expect(STREAMING_PLATFORMS.length).toBeGreaterThanOrEqual(20);
    for (const p of STREAMING_PLATFORMS) {
      expect(p.id).toBeTruthy();
      expect(p.name).toBeTruthy();
      expect(p.url).toMatch(/^https:\/\//);
      expect(p.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(['svod', 'free', 'tv', 'anime', 'sport']).toContain(p.category);
    }
  });
});
