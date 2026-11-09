import { describe, expect, it } from 'vitest';
import { catchupUrl, formatTimeshiftStart, isInArchive, parseArchiveStreams, streamIdOf, timeshiftTemplate } from '@/utils/catchup';
import { describeFailure } from '@/utils/streamCheck';

describe('catch-up Xtream', () => {
  it('extrait l’identifiant de flux des adresses Xtream', () => {
    expect(streamIdOf({ id: 'a', name: 'A', url: 'http://srv.test:8080/live/u/p/1234.ts' })).toBe('1234');
    expect(streamIdOf({ id: 'b', name: 'B', url: 'http://srv.test/u/p/987' })).toBe('987');
    expect(streamIdOf({ id: 'c', name: 'C', url: 'https://cdn.test/live/index.m3u8' })).toBeNull();
  });

  it('ne garde que les chaînes avec archives', () => {
    expect(parseArchiveStreams([
      { stream_id: 1, tv_archive: 1, tv_archive_duration: '3' },
      { stream_id: '2', tv_archive: 0, tv_archive_duration: 7 },
      { stream_id: 3, tv_archive: '1' },
      { stream_id: 'x', tv_archive: 1 },
    ])).toEqual({ '1': 3, '3': 1 });
    expect(parseArchiveStreams({ error: true })).toEqual({});
  });

  it('exprime le début dans le fuseau du serveur', () => {
    const start = new Date('2026-11-05T19:30:00Z');
    expect(formatTimeshiftStart(start, 'Europe/Paris')).toBe('2026-11-05:20-30');
    expect(formatTimeshiftStart(start, 'UTC')).toBe('2026-11-05:19-30');
  });

  it('construit l’adresse timeshift avec la durée en minutes', () => {
    const account = { server: 'http://srv.test:8080', username: 'jo', password: 'p@ss' };
    const url = catchupUrl(account, '1234', new Date('2026-11-05T19:30:00Z'), new Date('2026-11-05T20:21:10Z'), 'UTC');
    expect(url).toBe('http://srv.test:8080/timeshift/jo/p%40ss/52/2026-11-05:19-30/1234.ts');
  });

  it('laisse le modèle timeshift être rempli par le lecteur Android', () => {
    const account = { server: 'http://srv.test:8080', username: 'jo', password: 'p@ss' };
    expect(timeshiftTemplate(account, '1234'))
      .toBe('http://srv.test:8080/timeshift/jo/p%40ss/{minutes}/{start}/1234.ts');
  });

  it('limite la relecture à la fenêtre d’archive', () => {
    const now = Date.parse('2026-11-05T20:00:00Z');
    expect(isInArchive(new Date('2026-11-04T20:00:00Z'), 2, now)).toBe(true);
    expect(isInArchive(new Date('2026-11-02T20:00:00Z'), 2, now)).toBe(false);
    expect(isInArchive(new Date('2026-11-05T21:00:00Z'), 2, now)).toBe(false);
  });
});

describe('vérification des chaînes', () => {
  it('décrit les échecs en français', () => {
    expect(describeFailure({ ok: false, status: 0 })).toBe('Ne répond pas');
    expect(describeFailure({ ok: false, status: 404 })).toBe('Introuvable (404)');
    expect(describeFailure({ ok: false, status: 403 })).toBe('Accès refusé (403)');
    expect(describeFailure({ ok: false, status: 503 })).toBe('Erreur du serveur (503)');
    expect(describeFailure({ ok: false, status: 200 })).toBe('Réponse vide');
  });
});
