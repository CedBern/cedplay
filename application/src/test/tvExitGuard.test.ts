import { describe, expect, it } from 'vitest';
import { createExitGuard } from '@/utils/tvExitGuard';

describe('Sortie de l’application sur TV', () => {
  it('un seul Retour ne quitte pas, un second rapproché quitte', () => {
    let time = 1000;
    const confirm = createExitGuard(2500, () => time);
    expect(confirm()).toBe(false);
    time += 2500;
    expect(confirm()).toBe(true);
  });

  it('un second Retour trop tardif redemande une confirmation', () => {
    let time = 1000;
    const confirm = createExitGuard(2500, () => time);
    expect(confirm()).toBe(false);
    time += 2501;
    expect(confirm()).toBe(false);
    time += 100;
    expect(confirm()).toBe(true);
    // Sortie annulée par le système : il faut de nouveau deux appuis.
    expect(confirm()).toBe(false);
  });
});
