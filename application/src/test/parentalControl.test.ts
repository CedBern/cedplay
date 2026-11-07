import { describe, expect, it } from 'vitest';
import { isAdultGroupName, adultGroupNames, isValidPin } from '@/utils/parentalControl';

describe('détection des groupes adultes', () => {
  it('reconnaît les marqueurs explicites', () => {
    expect(isAdultGroupName('XXX')).toBe(true);
    expect(isAdultGroupName('Adult')).toBe(true);
    expect(isAdultGroupName('18+')).toBe(true);
    expect(isAdultGroupName('Pour adultes')).toBe(true);
    expect(isAdultGroupName('Erotique')).toBe(true);
    expect(isAdultGroupName('FR Porno')).toBe(true);
  });

  it('ignore les groupes sans marqueur', () => {
    expect(isAdultGroupName('France')).toBe(false);
    expect(isAdultGroupName('Télé Québec')).toBe(false);
    expect(isAdultGroupName('Cinéma')).toBe(false);
  });

  it('extrait les noms de groupes adultes', () => {
    const groups = [
      { name: 'France', channels: [] },
      { name: 'XXX', channels: [] },
      { name: 'Kids', channels: [] },
      { name: 'Adult', channels: [] },
    ];
    expect(adultGroupNames(groups)).toEqual(['XXX', 'Adult']);
  });
});

describe('validation du PIN', () => {
  it('accepte 4 à 8 chiffres uniquement', () => {
    expect(isValidPin('1234')).toBe(true);
    expect(isValidPin('12345678')).toBe(true);
    expect(isValidPin('123')).toBe(false);
    expect(isValidPin('123456789')).toBe(false);
    expect(isValidPin('abcd')).toBe(false);
    expect(isValidPin('')).toBe(false);
  });
});
