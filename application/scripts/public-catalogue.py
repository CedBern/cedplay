"""Catalogue CedPlay : source JSON unique, M3U généré, contrôle HLS borné.

Sans option : contrôle de cohérence hors réseau.
--generate : régénère le M3U après une modification éditoriale des sources.
--probe --write : contrôle manifestes ET extrait média, puis date les résultats.
Une panne ne supprime jamais une chaîne. Aucun annuaire tiers n'est importé.
"""
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.parse import urljoin, urlparse
from concurrent.futures import ThreadPoolExecutor
import argparse
import datetime
import json
import sys

PUBLIC = Path(__file__).resolve().parents[1] / 'public'
SOURCE = PUBLIC / 'chaines-gratuites-sources.json'
M3U = PUBLIC / 'chaines-gratuites.m3u'


def render(entries):
    lines = ['#EXTM3U', '# Sélection CedPlay : signaux proposés par les diffuseurs / SPR MXPlus.',
             '# Sources et vérification : chaines-gratuites-sources.json.',
             '# Certaines émissions peuvent être géobloquées ou indisponibles selon les droits.', '']
    for c in entries:
        logo = f' tvg-logo="{c["logo"]}"' if c.get('logo') else ''
        lines += [f'# Source : {c["source"]}',
                  f'#EXTINF:-1 tvg-id="{c["id"]}"{logo} group-title="{c["group"]}",{c["name"]}', c['url'], '']
    return '\n'.join(lines)


def validate(entries):
    assert entries, 'Catalogue vide'
    assert len({c['id'] for c in entries}) == len(entries), 'Identifiants dupliqués'
    for c in entries:
        for key in ('id', 'name', 'group', 'url', 'source', 'logo'):
            value = c.get(key, '')
            assert isinstance(value, str), f'{key} invalide'
            assert not any(char in value for char in '\r\n"'), f'{key} invalide'
        for key in ('url', 'source'):
            parsed = urlparse(c[key])
            assert parsed.scheme == 'https' and parsed.hostname and not parsed.username, f'{key} non HTTPS'
        assert all(c[key].strip() for key in ('id', 'name', 'group')), 'Métadonnées manquantes'


def check(c):
    result = dict(c, checkedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                  status=0, hls=False, segmentStatus=0, segmentSampleBytes=0)
    result.pop('checkError', None)
    try:
        url = c['url']
        for _ in range(5):
            with urlopen(Request(url, headers={'User-Agent': 'IPTVSmartersPro'}), timeout=12) as response:
                body = response.read(262144).decode('utf-8-sig')
                url = response.url
                result['status'] = response.status
            if not body.lstrip().startswith('#EXTM3U'):
                raise ValueError('Réponse non HLS')
            lines = [line.strip() for line in body.splitlines() if line.strip() and not line.startswith('#')]
            if not lines:
                raise ValueError('Liste de segments vide')
            if '#EXT-X-STREAM-INF:' in body:
                url = urljoin(url, lines[0])
                continue
            if '#EXTINF:' not in body:
                raise ValueError('Aucun segment média')
            with urlopen(Request(urljoin(url, lines[-1]), headers={'User-Agent': 'IPTVSmartersPro'}), timeout=12) as response:
                sample = response.read(32768)
                result['segmentStatus'] = response.status
            # Échantillon TS, fMP4 ou audio HLS ; ce n'est pas un décodage ni une lecture humaine.
            media = len(sample) > 188 and (sample[:1] == b'G' or
                    any(box in sample[:256] for box in (b'moof', b'ftyp', b'styp')) or sample[:3] == b'ID3')
            if not media:
                raise ValueError('Extrait média non reconnu')
            result.update(hls=True, segmentSampleBytes=len(sample))
            return result
        raise ValueError('Trop de listes imbriquées')
    except Exception as error:
        # N'enregistrer ni URL de segment signée, ni détail contenant un éventuel jeton.
        code = getattr(error, 'code', None)
        result['checkError'] = f'HTTP {code}' if code else type(error).__name__
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--generate', action='store_true')
    parser.add_argument('--probe', action='store_true')
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    if args.write and not args.probe:
        parser.error('--write exige --probe')
    entries = json.loads(SOURCE.read_text(encoding='utf-8-sig'))
    validate(entries)
    expected = render(entries)
    if args.generate:
        M3U.write_text(expected, encoding='utf-8', newline='\n')
    if M3U.read_text(encoding='utf-8-sig').strip() != expected.strip():
        raise SystemExit('M3U désynchronisé : lancer --generate après revue des sources.')
    if args.probe:
        with ThreadPoolExecutor(max_workers=4) as executor:
            results = list(executor.map(check, entries))
        if args.write:
            SOURCE.write_text(json.dumps(results, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        for c in results:
            print(f'{c["name"]}: {"extrait reçu" if c["hls"] else c["checkError"]}')
        return 0 if all(c['hls'] for c in results) else 1
    print(f'{len(entries)} chaînes : sources et M3U cohérents.')
    return 0


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.exit(main())
