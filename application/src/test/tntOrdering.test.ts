import { describe, expect, it } from 'vitest';
import { compareChannelNames, compareGroupNames, isFrenchGroupName, orderFrenchGroupsForTnt, symbolLedName, tntDisplayName, tntNumberFor } from '@/utils/tntOrdering';
import type { Channel, ChannelGroup } from '@/types/channel';

const group = (name: string, names: string[]): ChannelGroup => ({
  name,
  channels: names.map(n => ({ id: n, name: n, url: `http://exemple/${encodeURIComponent(n)}` }) as Channel),
});

describe('tntNumberFor', () => {
  it('numérote les chaînes de la TNT française dans l\'ordre Arcom (6 juin 2025)', () => {
    expect(tntNumberFor('TF1')).toBe(1);
    expect(tntNumberFor('TF1 HD')).toBe(1);
    expect(tntNumberFor('France 2')).toBe(2);
    expect(tntNumberFor('FRANCE 3 FHD')).toBe(3);
    expect(tntNumberFor('France 4')).toBe(4);
    expect(tntNumberFor('France 5')).toBe(5);
    expect(tntNumberFor('M6')).toBe(6);
    expect(tntNumberFor('Arte')).toBe(7);
    expect(tntNumberFor('LCP Assemblée nationale')).toBe(8);
    expect(tntNumberFor('Public Sénat')).toBe(8);
    expect(tntNumberFor('W9')).toBe(9);
    expect(tntNumberFor('TMC')).toBe(10);
    expect(tntNumberFor('TFX')).toBe(11);
    expect(tntNumberFor('Gulli')).toBe(12);
    expect(tntNumberFor('BFM TV')).toBe(13);
    expect(tntNumberFor('CNews')).toBe(14);
    expect(tntNumberFor('LCI')).toBe(15);
    expect(tntNumberFor('France Info')).toBe(16);
    expect(tntNumberFor('CStar')).toBe(17);
    expect(tntNumberFor('T18')).toBe(18);
    expect(tntNumberFor('Novo 19')).toBe(19);
    expect(tntNumberFor('TF1 Séries Films')).toBe(20);
    expect(tntNumberFor("L'Équipe")).toBe(21);
    expect(tntNumberFor('6ter')).toBe(22);
    expect(tntNumberFor('RMC Story')).toBe(23);
    expect(tntNumberFor('RMC Découverte')).toBe(24);
    expect(tntNumberFor('Chérie 25')).toBe(25);
  });

  it('lit à travers une étiquette de pays en préfixe', () => {
    expect(tntNumberFor('FR | TF1')).toBe(1);
    expect(tntNumberFor('FR: France 2')).toBe(2);
    expect(tntNumberFor('French - M6')).toBe(6);
  });

  it('ne confond pas les chaînes musicales avec leur chaîne TNT homonyme', () => {
    for (const name of ['M6 MUSIC', 'FR: M6 MUSIC FHD', 'CSTAR HITS', 'FR: CSTAR HITS FHD']) {
      expect(tntNumberFor(name), name).toBeNull();
      expect(tntDisplayName(name)).toBe(name);
    }
    for (const suffix of ['', ' SD', ' HD', ' FHD', ' UHD', ' 4K', ' HD 50FPS']) {
      expect(tntNumberFor(`FR: M6${suffix}`)).toBe(6);
      expect(tntNumberFor(`FR: CSTAR${suffix}`)).toBe(17);
    }
  });

  it('conserve la numérotation des généralistes et de leurs variantes TS du catalogue réel', () => {
    for (const name of ['FR: M6 HD (TS)', 'FR: M6 FHD (TS)', 'FR: M6 INTER FHD', 'FR: M6 INTER FHD (TS)']) {
      expect(tntNumberFor(name), name).toBe(6);
    }
    for (const name of ['FR: CSTAR HD (TS)', 'FR: CSTAR FHD (TS)']) {
      expect(tntNumberFor(name), name).toBe(17);
    }
    for (const name of ['FR: M6 MUSIC (TS)', 'FR: M6 MUSIC FHD (TS)', 'FR: CSTAR HITS FHD (TS)']) {
      expect(tntNumberFor(name), name).toBeNull();
    }
  });

  it('ne numérote ni France 24, ni les déclinaisons, ni les noms à symbole ou déjà numérotés', () => {
    expect(tntNumberFor('France 24')).toBeNull();
    expect(tntNumberFor('Gulli Max')).toBeNull();
    expect(tntNumberFor('BFM Business')).toBeNull();
    expect(tntNumberFor('RMC Sport 1')).toBeNull();
    expect(tntNumberFor('TV5 Monde')).toBeNull();
    expect(tntNumberFor('✪ TF1')).toBeNull();
    expect(tntNumberFor('1. TF1')).toBeNull();
    expect(tntNumberFor('')).toBeNull();
  });
});

describe('symbolLedName', () => {
  it('repère les noms qui commencent par un symbole, pas par une lettre ou un chiffre', () => {
    expect(symbolLedName('✪ Groupe')).toBe(true);
    expect(symbolLedName('+18 Divers')).toBe(true);
    expect(symbolLedName(' TF1')).toBe(false);
    expect(symbolLedName('6ter')).toBe(false);
    expect(symbolLedName('ZDF')).toBe(false);
  });
});

describe('isFrenchGroupName', () => {
  it('reconnaît les groupes français courants', () => {
    expect(isFrenchGroupName('FR')).toBe(true);
    expect(isFrenchGroupName('FR: Sport')).toBe(true);
    expect(isFrenchGroupName('France - TNT')).toBe(true);
    expect(isFrenchGroupName('FRENCH TV')).toBe(true);
    expect(isFrenchGroupName('Généralistes')).toBe(true);
    expect(isFrenchGroupName('TNT')).toBe(true);
  });

  it('laisse les autres groupes à leur place', () => {
    expect(isFrenchGroupName('Sports')).toBe(false);
    expect(isFrenchGroupName('Documents')).toBe(false);
    expect(isFrenchGroupName('Free')).toBe(false);
    expect(isFrenchGroupName('Fridge')).toBe(false);
  });
});

describe('compareChannelNames', () => {
  it('classe les généralistes TNT d\'abord, puis A–Z, symboles après le z', () => {
    const sorted = ['TV5 Monde', 'W9', '✪ Chaîne', 'TF1', 'France 2', 'M6', 'Arte', 'ZDF'].sort(compareChannelNames);
    expect(sorted).toEqual(['TF1', 'France 2', 'M6', 'Arte', 'W9', 'TV5 Monde', 'ZDF', '✪ Chaîne']);
  });

  it('suit l\'ordre numérique de la TNT, pas l\'ordre lexicographique', () => {
    expect(compareChannelNames('TFX', 'Gulli')).toBeLessThan(0);
    expect(compareChannelNames('Chérie 25', 'TF1')).toBeGreaterThan(0);
  });

  it('place les noms à symbole après le z', () => {
    expect(compareChannelNames('ZZZ Dernière', '✪ Chaîne')).toBeLessThan(0);
    expect(compareChannelNames('+18', 'ZZZ Dernière')).toBeGreaterThan(0);
  });
});

describe('compareGroupNames', () => {
  it('met les groupes français en tête et les symboles après le z', () => {
    const sorted = ['Documents', 'FR', 'Sports', '✪ Chaîne', 'France - TNT', '+18 Divers'].sort(compareGroupNames);
    expect(sorted.slice(0, 2)).toEqual(['FR', 'France - TNT']);
    expect(sorted.slice(2, 4)).toEqual(['Documents', 'Sports']);
    expect(sorted.slice(4)).toEqual(expect.arrayContaining(['+18 Divers', '✪ Chaîne']));
  });

  it('classe tout nom à symbole après le dernier groupe alphabétique', () => {
    expect(compareGroupNames('Sports', '+18 Divers')).toBeLessThan(0);
    expect(compareGroupNames('✪ Chaîne', 'Sports')).toBeGreaterThan(0);
    expect(compareGroupNames('Zzz', '✪ Chaîne')).toBeLessThan(0);
  });

  it('met les groupes adultes tout à la fin, après les symboles', () => {
    expect(compareGroupNames('Adulte', 'Sports')).toBeGreaterThan(0);
    expect(compareGroupNames('Adulte', '+18 Divers')).toBeGreaterThan(0);
    expect(compareGroupNames('Adulte', '✪ Chaîne')).toBeGreaterThan(0);
    expect(compareGroupNames('Sports', 'Adulte')).toBeLessThan(0);
    expect(compareGroupNames('Porno', 'Zzz')).toBeGreaterThan(0);
    expect(compareGroupNames('XXX', 'Zzz')).toBeGreaterThan(0);
    expect(compareGroupNames('+18', 'Zzz')).toBeGreaterThan(0);
    expect(compareGroupNames('18+ Films', 'Zzz')).toBeGreaterThan(0);
    expect(compareGroupNames('Érotique', 'Zzz')).toBeGreaterThan(0);
    expect(compareGroupNames('🔥 Adulte', 'Zzz')).toBeGreaterThan(0);
  });
});

describe('tntDisplayName', () => {
  it('préfixe le numéro TNT sans jamais doubler une numérotation existante', () => {
    expect(tntDisplayName('TF1')).toBe('1. TF1');
    expect(tntDisplayName('TF1 HD')).toBe('1. TF1 HD');
    expect(tntDisplayName('France 24')).toBe('France 24');
    expect(tntDisplayName('✪ TF1')).toBe('✪ TF1');
    expect(tntDisplayName('1. TF1')).toBe('1. TF1');
  });
});

describe('orderFrenchGroupsForTnt', () => {
  it('conserve le titre fournisseur avant les chaînes musicales de la photo', () => {
    const names = ['FR: -- MUSIQUE / NEWS --', 'FR: M6 MUSIC', 'FR: M6 MUSIC FHD', 'FR: NRJ HITS HD', 'FR: NRJ HITS FHD', 'FR: MCM HD', 'FR: MCM FHD', 'FR: MTV HD', 'FR: CSTAR HITS FHD'];
    expect(orderFrenchGroupsForTnt([group('FR MUSIQUE', names)])[0].channels.map(c => c.name)).toEqual(names);
  });

  it('ne déplace aucune chaîne à travers un titre de section fournisseur', () => {
    const names = ['TV5 Monde', 'W9', 'FR: -- GENERALISTES --', 'M6 HD', 'TF1 FHD', 'FR: -- AUTRES --', 'Arte', 'France 2'];
    expect(orderFrenchGroupsForTnt([group('FR', names)])[0].channels.map(c => c.name)).toEqual([
      'W9', 'TV5 Monde', 'FR: -- GENERALISTES --', 'TF1 FHD', 'M6 HD', 'FR: -- AUTRES --', 'France 2', 'Arte',
    ]);
  });

  it('respecte les sections sans préfixe pays et les sections vides', () => {
    const names = ['== EN TETE ==', '-- A SUIVRE --', 'M6', 'TF1', '--- FIN ---'];
    expect(orderFrenchGroupsForTnt([group('FR', names)])[0].channels.map(c => c.name)).toEqual([
      '== EN TETE ==', '-- A SUIVRE --', 'TF1', 'M6', '--- FIN ---',
    ]);
  });

  it('ne change ni les données sources ni un ordre manuel contenant un titre', () => {
    const names = ['M6', 'FR: -- GENERALISTES --', 'France 2', 'TF1'];
    const input = [group('FR', names)];
    const output = orderFrenchGroupsForTnt(input);
    expect(input[0].channels.map(c => c.name)).toEqual(names);
    for (const channel of output[0].channels) expect(channel).toBe(input[0].channels.find(c => c.id === channel.id));
    expect(orderFrenchGroupsForTnt(input, { channelOrder: { FR: names } })[0]).toBe(input[0]);
  });

  it('place les généralistes TNT en tête des groupes français, le reste garde son ordre', () => {
    const groups = [group('FR', ['TV5 Monde', 'W9', 'TF1', 'France 2']), group('Sports', ['beIN 1', 'Arsenal TV'])];
    const out = orderFrenchGroupsForTnt(groups);
    expect(out[0].channels.map(c => c.name)).toEqual(['TF1', 'France 2', 'W9', 'TV5 Monde']);
    expect(out[1].channels.map(c => c.name)).toEqual(['beIN 1', 'Arsenal TV']);
  });

  it('ne touche pas aux groupes sans chaîne TNT ni aux noms à symbole', () => {
    const groups = [group('FR', ['✪ Chaîne', 'TV5 Monde']), group('Sports', ['beIN 1'])];
    const out = orderFrenchGroupsForTnt(groups);
    expect(out[0]).toBe(groups[0]);
    expect(out[1]).toBe(groups[1]);
  });

  it('laisse l\'ordre choisi dans Organiser et le tri A–Z primer', () => {
    const groups = [group('FR', ['TF1', 'France 2'])];
    expect(orderFrenchGroupsForTnt(groups, { channelOrder: { FR: ['France 2', 'TF1'] } })[0]).toBe(groups[0]);
    expect(orderFrenchGroupsForTnt(groups, { channelSort: 'name' })).toBe(groups);
  });
});
