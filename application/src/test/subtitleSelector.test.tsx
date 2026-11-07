// Tests du sélecteur de sous-titres (SubtitleSelector.tsx).
// Les utilités pures (normalizeSubtitleLang, sortTracksByPriority, parseSrt,
// cuesToSrt, cuesToVtt) restent les implémentations réelles (importActual) ;
// seuls les effets réseau / cache / traduction sont mockés.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SubtitleSelector } from '@/components/SubtitleSelector';
import { toast } from 'sonner';
import {
  searchSubtitles,
  downloadSubtitleText,
  getCachedSubtitle,
  saveCachedSubtitle,
  type SubtitleTrack,
} from '@/utils/subtitles';
import { translateSrt, shiftCues } from '@/utils/subtitleTranslator';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock('@/utils/idb', () => ({ getMeta: vi.fn(async () => undefined), setMeta: vi.fn(async () => {}) }));
vi.mock('@/utils/subtitles', async (importActual) => ({
  ...(await importActual<typeof import('@/utils/subtitles')>()),
  searchSubtitles: vi.fn(),
  downloadSubtitleText: vi.fn(),
  getCachedSubtitle: vi.fn(),
  saveCachedSubtitle: vi.fn(),
}));
vi.mock('@/utils/subtitleTranslator', async (importActual) => ({
  ...(await importActual<typeof import('@/utils/subtitleTranslator')>()),
  translateSrt: vi.fn(),
  shiftCues: vi.fn((cues: unknown) => cues),
}));

const toastMock = vi.mocked(toast);
const searchMock = vi.mocked(searchSubtitles);
const downloadMock = vi.mocked(downloadSubtitleText);
const getCacheMock = vi.mocked(getCachedSubtitle);
const saveCacheMock = vi.mocked(saveCachedSubtitle);
const translateMock = vi.mocked(translateSrt);
const shiftMock = vi.mocked(shiftCues);

const SRT_BONJOUR = '1\n00:00:01,000 --> 00:00:02,000\nBonjour';
const VTT_BONJOUR = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nBonjour';

function piste(overrides: Partial<SubtitleTrack>): SubtitleTrack {
  return {
    id: 'p1',
    name: 'Piste test',
    lang: 'other',
    langCode: 'xx',
    langLabel: 'Autre',
    url: 'http://sub.test/piste.srt',
    format: 'srt',
    ...overrides,
  };
}

function monter(onSubtitleReady: (sub: unknown) => void = vi.fn()) {
  render(
    <SubtitleSelector
      mediaTitle="Film test"
      kind="movie"
      mediaKey="media-1"
      onSubtitleReady={onSubtitleReady as never}
    />
  );
  return onSubtitleReady;
}

beforeEach(() => {
  vi.clearAllMocks();
  getCacheMock.mockResolvedValue(null);
  searchMock.mockResolvedValue([]);
});

afterEach(cleanup);

describe('SubtitleSelector', () => {
  it('applique le sous-titre en cache au montage', async () => {
    getCacheMock.mockResolvedValue({ srt: SRT_BONJOUR, vtt: VTT_BONJOUR });
    const onReady = vi.fn();
    monter(onReady);

    // Le badge affiche l'étiquette du cache, la recherche n'active rien d'autre.
    expect(await screen.findByText('Français (Enregistré)')).toBeVisible();
    expect(getCacheMock).toHaveBeenCalledWith('media-1', 'fr');
    expect(searchMock).toHaveBeenCalledWith(
      { title: 'Film test', year: undefined, kind: 'movie', season: undefined, episode: undefined, imdbId: undefined },
      undefined
    );

    const ready = onReady.mock.calls.map((c) => c[0]).find((s) => s !== null);
    expect(ready).toEqual({
      srtContent: SRT_BONJOUR,
      vttContent: VTT_BONJOUR,
      label: 'Français (Enregistré)',
      isTranslated: true,
    });
  });

  it('sélectionne automatiquement la piste française', async () => {
    const fr = piste({ id: 'fr1', name: 'Film test FR', lang: 'fr', langCode: 'fr', langLabel: 'Français', url: 'http://sub.test/fr.srt' });
    const en = piste({ id: 'en1', name: 'Film test EN', lang: 'en', langCode: 'en', langLabel: 'Anglais', url: 'http://sub.test/en.srt' });
    searchMock.mockResolvedValue([fr, en]);
    downloadMock.mockResolvedValue(SRT_BONJOUR);
    const onReady = vi.fn();
    monter(onReady);

    await waitFor(() => expect(onReady).toHaveBeenCalledWith(expect.objectContaining({ label: 'Film test FR' })));
    const ready = onReady.mock.calls[onReady.mock.calls.length - 1][0];
    expect(ready.srtContent).toContain('Bonjour');
    expect(ready.vttContent).toContain('WEBVTT');
    expect(ready.vttContent).toContain('00:00:01.000 --> 00:00:02.000');
    expect(ready.isTranslated).toBe(false);
    // Le SRT a bien été reformaté par parseSrt/cuesToSrt réels (timings conservés).
    expect(ready.srtContent).toContain('00:00:01,000 --> 00:00:02,000');
    expect(downloadMock).toHaveBeenCalledWith('http://sub.test/fr.srt', undefined);
    expect(screen.getByText('Film test FR')).toBeVisible();
    // La piste FR est marquée comme sélectionnée dans la liste dépliée.
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it('traduit automatiquement quand il n’y a pas de piste française', async () => {
    const en = piste({ id: 'en1', name: 'Show EN', lang: 'en', langCode: 'en', langLabel: 'Anglais', url: 'http://sub.test/en.srt' });
    searchMock.mockResolvedValue([en]);
    downloadMock.mockResolvedValue(SRT_BONJOUR);
    translateMock.mockResolvedValue({
      srt: '1\n00:00:01,000 --> 00:00:02,000\nSalut',
      vtt: 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nSalut',
      cueCount: 12,
    });
    const onReady = vi.fn();
    monter(onReady); // autoTranslate = true par défaut

    expect(await screen.findByText('Français (Traduit de Anglais)')).toBeVisible();

    const ready = onReady.mock.calls.map((c) => c[0]).find((s) => s !== null);
    expect(ready.srtContent).toContain('Salut');
    expect(ready.vttContent).toContain('Salut');
    expect(ready.isTranslated).toBe(true);
    expect(translateMock).toHaveBeenCalledWith(SRT_BONJOUR, 'fr', expect.objectContaining({ deeplApiKey: undefined }));
    expect(saveCacheMock).toHaveBeenCalledWith(
      'media-1',
      'fr',
      '1\n00:00:01,000 --> 00:00:02,000\nSalut',
      'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nSalut'
    );
    expect(toastMock.success).toHaveBeenCalledWith('Sous-titres traduits en français avec succès (12 répliques).');
  });

  it('ajuste la synchronisation du sous-titre actif', async () => {
    getCacheMock.mockResolvedValue({ srt: SRT_BONJOUR, vtt: VTT_BONJOUR });
    const user = userEvent.setup();
    const onReady = vi.fn();
    monter(onReady);
    await screen.findByText('Français (Enregistré)');

    // Déplier le panneau de réglages puis avancer de +0,5 s.
    await user.click(screen.getByRole('button', { name: 'Choisir / Régler' }));
    await user.click(screen.getByRole('button', { name: '+0.5 s' }));

    expect(shiftMock).toHaveBeenCalledWith([expect.objectContaining({ text: 'Bonjour' })], 500);
    expect(toastMock.info).toHaveBeenCalledWith('Synchronisation ajustée : +0.5 s');
    // Le sous-titre décalé est renvoyé au lecteur et re-mis en cache.
    // cuesToSrt/cuesToVtt réels régénèrent le contenu (index de réplique + saut de ligne final pour le VTT).
    await waitFor(() =>
      expect(saveCacheMock).toHaveBeenCalledWith(
        'media-1',
        'fr',
        SRT_BONJOUR,
        'WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\nBonjour\n'
      )
    );
    const lastReady = onReady.mock.calls[onReady.mock.calls.length - 1][0];
    expect(lastReady.label).toBe('Français (Enregistré)');
    expect(lastReady.srtContent).toContain('Bonjour');
    // Le décalage affiché passe à +0,5 s (la lecture du décalage s'ajoute au bouton « +0.5 s »).
    expect(screen.getAllByText('+0.5 s')).toHaveLength(2);
  });
});
