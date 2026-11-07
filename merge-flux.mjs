import { readFileSync, writeFileSync } from 'node:fs';

const countries = [
  { code: 'fr', name: 'France' },
  { code: 'mx', name: 'Mexique' },
  { code: 'us', name: 'États-Unis' },
  { code: 'be', name: 'Belgique' },
  { code: 'ch', name: 'Suisse' },
  { code: 'it', name: 'Italie' },
  { code: 'es', name: 'Espagne' },
  { code: 'uk', name: 'Royaume-Uni' },
];

const header = `#EXTM3U

# ============================================================
#  FLUX PUBLICS GRATUITS — source : projet open-source iptv-org/iptv
# ============================================================
#  Chaînes diffusées publiquement et gratuitement par leurs
#  diffuseurs (chaînes publiques, gouvernementales, d'information,
#  locales...). Chaque chaîne est groupée par pays (group-title).
#
#  ATTENTION :
#   - Ces flux sont publics mais peuvent changer, être géo-bloqués
#     ou ne pas diffuser 24 h/24 (mention "[Not 24/7]").
#   - Aucune chaîne payante n'est incluse.
#   - Source d'origine : https://github.com/iptv-org/iptv
# ============================================================
`;

let out = header;
let total = 0;

for (const { code, name } of countries) {
  const raw = readFileSync(`flux-legaux-source/${code}.m3u`, 'utf8');
  const lines = raw.split(/\r?\n/);
  const block = [];
  for (const line of lines) {
    if (line.trim() === '' || line.startsWith('#EXTM3U')) continue;
    if (line.startsWith('#EXTINF')) {
      // Insère group-title juste après #EXTINF:-1
      block.push(line.replace(/^#EXTINF:-1\s*/, `#EXTINF:-1 group-title="${name}" `));
      total++;
    } else {
      // Ligne URL : suit son #EXTINF
      block.push(line);
    }
  }
  out += `\n# --- ${name} ---\n`;
  out += block.join('\n');
  out += '\n';
}

writeFileSync('application/public/flux-legaux.m3u', out, 'utf8');
console.log(`Total de chaînes écrites : ${total}`);
