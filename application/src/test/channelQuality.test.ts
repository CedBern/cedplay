import { describe, expect, it } from 'vitest';
import { channelQuality, selectChannelQuality } from '@/utils/channelQuality';
import type { Channel } from '@/types/channel';

const channel = (over: Partial<Channel> = {}): Channel => ({
  id: 'c', name: 'Chaîne', url: 'https://example.test/primary.m3u8', ...over,
});

describe('channelQuality', () => {
  it.each([
    ['TF1 4K', '4K'],
    ['Canal+ UHD', '4K'],
    ['Cinéma 2160p', '4K'],
    ['France 2 FHD', 'FHD'],
    ['Arte Full HD', 'FHD'],
    ['M6 HD', 'HD'],
    ['TMC 720p', 'HD'],
    ['BFM SD', 'SD'],
    ['France 3 576p', 'SD'],
  ])('lit la qualité annoncée de « %s »', (name, expected) => {
    expect(channelQuality({ name })).toBe(expected);
  });

  it('respecte la qualité explicite et ne devine rien sans indication', () => {
    expect(channelQuality({ name: 'TF1', quality: 'FHD' })).toBe('FHD');
    expect(channelQuality({ name: 'TF1', quality: 'UHD' })).toBe('4K');
    expect(channelQuality({ name: 'TF1' })).toBeUndefined();
    expect(channelQuality({ name: '  ' })).toBeUndefined();
  });
});

describe('selectChannelQuality', () => {
  it('ouvre la variante de la qualité choisie en gardant l’identité de la chaîne', () => {
    const variant: Channel = channel({ id: 'v', name: 'TF1 FHD', url: 'https://example.test/fhd.m3u8', quality: 'FHD' });
    const parent = channel({ id: 'parent', name: 'TF1 HD', quality: 'HD', variants: [variant] });
    const selected = selectChannelQuality(parent, 'FHD');
    expect(selected).toMatchObject({ id: 'parent', url: variant.url, quality: 'FHD' });
    // La chaîne d'origine reste accessible comme variante, pour revenir à HD.
    expect(selected?.variants?.[0]).toMatchObject({ id: 'parent', url: parent.url, quality: 'HD' });
    expect(selected?.variants).toHaveLength(1);
  });

  it('retourne la chaîne inchangée si elle a déjà la qualité, et null si aucune variante', () => {
    const parent = channel({ id: 'parent', name: 'TF1 HD', quality: 'HD', variants: [channel({ id: 'v', name: 'TF1 FHD', quality: 'FHD' })] });
    expect(selectChannelQuality(parent, 'all')).toBe(parent);
    expect(selectChannelQuality(parent, 'HD')).toBe(parent);
    expect(selectChannelQuality(parent, 'SD')).toBeNull();
  });
});
