import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReplayHub } from '@/components/ReplayHub';
import { channelKey, formatDuration, formatReplayDate, hourInTimeZone, matchReplayChannel, recentReplays, searchReplays } from '@/utils/replayFinder';
import { useRemoteNavigation } from '@/hooks/useRemoteNavigation';
import { readMyPlatforms } from '@/utils/myPlatforms';
import { formatTime } from '@/utils/epgXmltv';
import { NativePlayerBridge } from '@/utils/nativePlayer';
import type { Channel } from '@/types/channel';
import type { EPGData, EPGProgram } from '@/types/epg';

// Heures de diffusion à Paris (novembre : UTC+1), quel que soit le fuseau de la machine de test.
const paris = (day: number, hour: number, minute = 0) => new Date(Date.UTC(2026, 10, day, hour - 1, minute));
const NOW = paris(7, 12).getTime(); // samedi 7 novembre 2026, midi à Paris

const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute);
const program = (channelId: string, title: string, start: Date, minutes: number): EPGProgram => ({
  id: `${channelId}-${start.getTime()}`,
  channelId,
  title,
  startTime: start,
  endTime: new Date(start.getTime() + minutes * 60_000),
});

const tf1: Channel = { id: 'c-tf1', name: 'FR: TF1 HD', url: 'http://x/tf1', catchupDays: 7 };
const tf1Fhd: Channel = { id: 'c-tf1-fhd', name: 'TF1 FHD', url: 'http://x/tf1fhd', catchupDays: 7 };
const france2: Channel = { id: 'c-f2', name: '|FR| France 2', url: 'http://x/f2', catchupDays: 7 };
const local: Channel = { id: 'c-loc', name: 'Télé locale', url: 'http://x/loc', catchupDays: 7 };
const noArchive: Channel = { id: 'c-m6', name: 'M6', url: 'http://x/m6' };
const channels = [tf1, tf1Fhd, france2, local, noArchive];
const days = (c: Channel) => c.catchupDays ?? 0;

const epg: EPGData = {
  'c-tf1': [
    program('c-tf1', 'Koh-Lanta', paris(4, 21, 10), 115),
    program('c-tf1', 'Journal de 20 heures', paris(6, 20, 0), 35), // trop court
    program('c-tf1', 'Koh-Lanta', paris(1, 15, 30), 60),
    program('c-tf1', 'Téléfilm du matin', paris(6, 9, 0), 90),
    program('c-tf1', 'Koh-Lanta', paris(7, 11, 30), 90), // en cours
  ],
  'c-tf1-fhd': [program('c-tf1-fhd', 'Koh-Lanta', paris(4, 21, 10), 115)],
  'c-f2': [
    program('c-f2', 'Envoyé spécial', paris(6, 21, 10), 110),
    program('c-f2', 'Vieux documentaire', paris(-1, 21, 0), 90), // hors archive (plus de 7 jours)
    program('c-f2', 'Nuit à Paris', paris(5, 4, 0), 60), // 21 h à Mérida, mais 4 h à la diffusion
  ],
  'c-loc': [program('c-loc', 'Koh-Lanta, le débat', paris(5, 21, 0), 60)],
  'c-m6': [program('c-m6', 'Koh-Lanta', paris(5, 21, 0), 60)],
};

describe('replay de la liste : correspondances et sélection', () => {
  it('reconnaît une chaîne malgré le préfixe de pays et la qualité', () => {
    expect(channelKey('FR: TF1 HD')).toBe('tf1');
    expect(channelKey('|FR| France 2 FHD')).toBe('france 2');
    expect(channelKey('TF1.fr')).toBe('tf1');
    expect(channelKey('Canal+')).toBe('canal+');
    expect(matchReplayChannel(tf1)?.id).toBe('tf1');
    expect(matchReplayChannel({ id: 'x', name: 'Chaîne 12', url: '', tvgName: 'France 2' })?.id).toBe('france2');
    expect(matchReplayChannel(local)).toBeNull();
  });

  it('« À revoir » : soirées terminées des grandes chaînes, sans doublon de qualité, les plus récentes d’abord', () => {
    const items = recentReplays(channels, epg, days, NOW);
    expect(items.map(i => `${i.replayChannel.id} ${i.program.title}`)).toEqual([
      'france2 Envoyé spécial',
      'tf1 Koh-Lanta',
    ]);
  });

  it('la recherche couvre toute la liste rejouable, dans l’archive, sans doublon', () => {
    const hits = searchReplays(channels, epg, days, 'koh lanta', NOW);
    expect(hits.map(h => [h.channel.id, h.program.startTime.getTime()])).toEqual([
      ['c-tf1', paris(7, 11, 30).getTime()], // en cours : « depuis le début »
      ['c-loc', paris(5, 21).getTime()],
      ['c-tf1', paris(4, 21, 10).getTime()], // TF1 FHD : même chaîne, même horaire, non répétée
      ['c-tf1', paris(1, 15, 30).getTime()],
    ]);
    expect(searchReplays(channels, epg, days, 'k', NOW)).toEqual([]);
  });

  it('la soirée se juge à l’heure de diffusion (Paris), pas à celle du téléphone', () => {
    expect(hourInTimeZone(new Date(Date.UTC(2026, 10, 4, 20, 0)), 'Europe/Paris')).toBe(21); // heure d'hiver
    expect(hourInTimeZone(new Date(Date.UTC(2026, 6, 4, 19, 30)), 'Europe/Paris')).toBe(21.5); // heure d'été
    expect(hourInTimeZone(new Date(Date.UTC(2026, 10, 5, 3, 0)), 'America/Merida')).toBe(21);
    expect(hourInTimeZone(new Date(Date.UTC(2026, 10, 5, 3, 0)), 'Europe/Paris')).toBe(4);
    // La « Nuit à Paris » (21 h à Mérida) n'entre pas dans « À revoir » ; Koh-Lanta (21 h 10 à Paris) oui.
    const titles = recentReplays(channels, epg, days, NOW).map(i => i.program.title);
    expect(titles).not.toContain('Nuit à Paris');
    expect(titles).toContain('Koh-Lanta');
  });

  it('formate dates et durées', () => {
    const now = new Date(NOW);
    expect(formatReplayDate(at(7, 9, 5), now)).toBe('Aujourd’hui · 09:05');
    expect(formatReplayDate(at(6, 21, 10), now)).toBe('Hier · 21:10');
    expect(formatReplayDate(at(4, 21, 10), now)).toMatch(/^Mercredi 4 nov\.? · 21:10$/);
    expect(formatDuration(program('x', 't', at(4, 21, 10), 110))).toBe('1 h 50');
    expect(formatDuration(program('x', 't', at(4, 21, 10), 45))).toBe('45 min');
    expect(formatDuration(program('x', 't', at(4, 21, 10), 120))).toBe('2 h');
  });
});

describe('Replay et plateformes', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    localStorage.clear();
    vi.spyOn(NativePlayerBridge, 'isAvailable').mockReturnValue(false);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const renderHub = (tvMode = false) => {
    const onCatchup = vi.fn();
    render(<ReplayHub channels={channels} epgData={epg} catchupDays={days} onCatchup={onCatchup} tvMode={tvMode} />);
    return onCatchup;
  };

  it('vue Replay : « À revoir » se lit dans l’app, les chaînes ouvrent leur site officiel', async () => {
    const user = userEvent.setup();
    const open = vi.spyOn(window, 'open').mockReturnValue({ opener: window } as unknown as Window);
    const onCatchup = renderHub();
    expect(screen.getByRole('button', { name: 'Replay', pressed: true })).toBeInTheDocument();

    const recent = screen.getByRole('region', { name: 'À revoir dans l’app' });
    await user.click(within(recent).getByRole('button', { name: /Revoir « Envoyé spécial », France 2/ }));
    expect(onCatchup).toHaveBeenCalledWith(france2, epg['c-f2']![0]);

    const replay = screen.getByRole('region', { name: 'Replay des chaînes' });
    const tf1Row = within(replay).getByRole('button', { name: /^TF1 En ce moment/ });
    expect(tf1Row).toHaveTextContent(`En ce moment : Koh-Lanta, jusqu’à ${formatTime(paris(7, 13))}`);
    await user.click(tf1Row);
    expect(open).toHaveBeenCalledWith('https://www.tf1.fr/tf1', '_blank');
  });

  it('la recherche montre la liste d’abord, puis les sites officiels, sans en choisir un à la touche Entrée', async () => {
    const user = userEvent.setup();
    const open = vi.spyOn(window, 'open').mockReturnValue({ opener: window } as unknown as Window);
    const onCatchup = renderHub();
    await user.type(screen.getByRole('searchbox', { name: 'Chercher un programme' }), 'Envoyé{Enter}');
    expect(open).not.toHaveBeenCalled();

    const mine = screen.getByRole('region', { name: 'Dans votre liste' });
    await user.click(await within(mine).findByRole('button', { name: /Envoyé spécial/ }));
    expect(onCatchup).toHaveBeenCalledWith(france2, epg['c-f2']![0]);

    const sites = screen.getByRole('region', { name: 'Sur les sites officiels' });
    await user.click(within(sites).getByRole('button', { name: /france\.tv/ }));
    expect(open).toHaveBeenCalledWith('https://www.france.tv/recherche/?q=Envoy%C3%A9', '_blank');
    expect(screen.queryByRole('region', { name: 'Replay des chaînes' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Effacer la recherche' }));
    expect(screen.getByRole('region', { name: 'Replay des chaînes' })).toBeInTheDocument();
  });

  it('sans replay dans la liste : pas de rangée « À revoir » ni de section « Dans votre liste »', async () => {
    const user = userEvent.setup();
    render(<ReplayHub channels={channels} epgData={epg} catchupDays={() => 0} onCatchup={vi.fn()} />);
    expect(screen.queryByRole('region', { name: 'À revoir dans l’app' })).toBeNull();
    await user.type(screen.getByRole('searchbox', { name: 'Chercher un programme' }), 'Koh');
    expect(screen.queryByRole('region', { name: 'Dans votre liste' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Sur les sites officiels' })).toBeInTheDocument();
  });

  it('vue Plateformes : on ajoute une plateforme, elle passe en tête et reste mémorisée', async () => {
    const user = userEvent.setup();
    renderHub();
    await user.click(screen.getByRole('button', { name: 'Plateformes' }));
    const mine = screen.getByRole('region', { name: 'Mes plateformes' });
    expect(within(mine).getByRole('button', { name: /Choisis celles que tu utilises/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Ajouter Netflix à mes plateformes' }));
    expect(within(screen.getByRole('region', { name: 'Mes plateformes' })).getByRole('button', { name: /Netflix/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ajouter Netflix à mes plateformes' })).toBeNull();
    expect(readMyPlatforms()).toEqual(['netflix']);
    expect(screen.getByRole('region', { name: 'Autres plateformes' })).toBeInTheDocument();
  });

  it('le filtre réduit les autres plateformes', async () => {
    const user = userEvent.setup();
    renderHub();
    await user.click(screen.getByRole('button', { name: 'Plateformes' }));
    await user.click(screen.getByRole('button', { name: 'Anime' }));
    const others = screen.getByRole('region', { name: 'Toutes les plateformes' });
    expect(within(others).getByRole('button', { name: /^Crunchyroll/ })).toBeInTheDocument();
    expect(within(others).queryByRole('button', { name: /^Netflix/ })).toBeNull();
  });

  it('le choix en cases à cocher met à jour Mes plateformes', async () => {
    const user = userEvent.setup();
    renderHub();
    await user.click(screen.getByRole('button', { name: 'Plateformes' }));
    await user.click(screen.getByRole('button', { name: 'Choisir' }));
    const dialog = screen.getByRole('dialog', { name: 'Mes plateformes' });
    await user.click(within(dialog).getByRole('checkbox', { name: /Arte/ }));
    await user.click(within(dialog).getByRole('checkbox', { name: /YouTube/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Terminé · 2 choisies' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(readMyPlatforms()).toEqual(['arte', 'youtube']);
  });

  it('Android : la plateforme s’ouvre par l’application officielle', async () => {
    const user = userEvent.setup();
    vi.mocked(NativePlayerBridge.isAvailable).mockReturnValue(true);
    const openWeb = vi.spyOn(NativePlayerBridge, 'openWeb').mockResolvedValue(true);
    renderHub();
    await user.click(screen.getByRole('button', { name: 'Plateformes' }));
    await user.click(screen.getByRole('button', { name: /^Netflix/ }));
    // allowAppHome : si l'app ne gère pas la page exacte, on l'ouvre quand même à son accueil.
    expect(openWeb).toHaveBeenCalledWith('https://www.netflix.com', 'Netflix', ['com.netflix.mediaclient'], true);
  });

  it('Android : la recherche sur site officiel passe les paquets, sans ouverture à l’aveugle', async () => {
    const user = userEvent.setup();
    vi.mocked(NativePlayerBridge.isAvailable).mockReturnValue(true);
    const openWeb = vi.spyOn(NativePlayerBridge, 'openWeb').mockResolvedValue(true);
    renderHub();
    await user.type(screen.getByRole('searchbox', { name: 'Chercher un programme' }), 'Koh');
    const sites = screen.getByRole('region', { name: 'Sur les sites officiels' });
    const siteButton = await within(sites).findByRole('button', { name: /TF1\+/ });
    await user.click(siteButton);
    // Pas d'allowAppHome : si l'app ne gère pas la page de recherche, navigateur (requête conservée).
    expect(openWeb).toHaveBeenCalledWith('https://www.tf1.fr/tf1/koh', 'Recherche TF1+', ['fr.tf1.mytf1'], false);
  });

  it('TV : une seule page en rangées, sans sélecteur de vue', () => {
    renderHub(true);
    expect(screen.queryByRole('group', { name: 'Vue' })).toBeNull();
    expect(screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent)).toEqual([
      'Mes plateformes',
      'À revoir dans l’app',
      'Replay des chaînes',
      'Toutes les plateformes',
    ]);
    expect(screen.getByRole('button', { name: 'Choisir mes plateformes' })).toBeInTheDocument();
  });
});

describe('Replay et plateformes : heure vivante', () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('« En ce moment » change quand l’émission se termine, sans rouvrir la page', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(NOW);
    localStorage.clear();
    vi.spyOn(NativePlayerBridge, 'isAvailable').mockReturnValue(false);
    render(<ReplayHub channels={channels} epgData={epg} catchupDays={days} onCatchup={vi.fn()} />);
    const replay = screen.getByRole('region', { name: 'Replay des chaînes' });
    expect(within(replay).getByRole('button', { name: /^TF1 En ce moment : Koh-Lanta/ })).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(62 * 60_000); }); // 13 h 02 : Koh-Lanta est fini
    expect(within(replay).queryByRole('button', { name: /^TF1 En ce moment/ })).toBeNull();
    expect(within(replay).getByRole('button', { name: /^TF1 Replay sur TF1\+/ })).toBeInTheDocument();
  });
});

describe('Replay et plateformes : télécommande avec la navigation globale', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    localStorage.clear();
    vi.spyOn(NativePlayerBridge, 'isAvailable').mockReturnValue(false);
    // Une colonne : chaque élément sous le précédent, dans l'ordre du document.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const y = Array.prototype.indexOf.call(document.querySelectorAll('*'), this) * 10;
      return { x: 0, y, left: 0, top: y, right: 80, bottom: y + 8, width: 80, height: 8, toJSON() {} };
    });
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  function TvPage() {
    useRemoteNavigation();
    return <ReplayHub channels={channels} epgData={epg} catchupDays={days} onCatchup={vi.fn()} tvMode />;
  }
  const press = (key: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(document.activeElement ?? document.body, { key, ...init });

  it('la recherche se traverse aux flèches, OK ouvre la saisie, Retour la quitte puis revient à « Plus »', () => {
    const back = vi.fn();
    window.addEventListener('iptv-back', back);
    render(<TvPage />);
    const search = screen.getByRole('searchbox', { name: 'Chercher un programme' });
    press('ArrowDown');
    expect(search).toHaveFocus();
    expect(search).toHaveAttribute('readonly'); // pas de clavier à l'arrivée
    press('ArrowDown');
    expect(search).not.toHaveFocus(); // Bas traverse le champ sans saisir
    press('ArrowUp');
    expect(search).toHaveFocus();

    press('Enter');
    expect(search).not.toHaveAttribute('readonly');
    fireEvent.change(search, { target: { value: 'Envoyé' } });
    expect(screen.getByRole('region', { name: 'Dans votre liste' })).toBeInTheDocument();
    press('Escape');
    expect(search).toHaveFocus();
    expect(search).toHaveAttribute('readonly');
    expect(back).not.toHaveBeenCalled(); // Retour quitte d'abord la saisie

    press('ArrowDown');
    expect(document.activeElement).not.toBe(search);
    press('Escape');
    expect(back).toHaveBeenCalledTimes(1); // puis Retour remonte à « Plus »
    window.removeEventListener('iptv-back', back);
  });

  it('le choix des plateformes se fait aux flèches et à OK, et Retour ferme le panneau', async () => {
    const back = vi.fn();
    window.addEventListener('iptv-back', back);
    render(<TvPage />);
    const choose = screen.getByRole('button', { name: 'Choisir mes plateformes' });
    choose.focus();
    fireEvent.click(choose);
    const dialog = screen.getByRole('dialog', { name: 'Mes plateformes' });
    const rows = within(dialog).getAllByRole('checkbox');
    rows[0].focus();
    press('ArrowDown');
    expect(rows[1]).toHaveFocus();
    press('Enter');
    expect(rows[1]).toHaveAttribute('aria-checked', 'true');
    press('Enter', { repeat: true }); // touche maintenue : pas de bascule en rafale
    expect(rows[1]).toHaveAttribute('aria-checked', 'true');
    press('ArrowUp');
    press('Enter');
    expect(rows[0]).toHaveAttribute('aria-checked', 'true');
    press('Enter');
    expect(rows[0]).toHaveAttribute('aria-checked', 'false');
    press('Escape');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(back).not.toHaveBeenCalled();
    expect(readMyPlatforms()).toHaveLength(1);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Modifier' })).toHaveFocus()); // retour sur la tuile d'ouverture
    window.removeEventListener('iptv-back', back);
  });
});
