"""Exporte le dessin vectoriel commun vers le web et les ressources Android."""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
APP = ROOT / 'application'
RES = APP / 'android/app/src/main/res'
MARK = json.loads((HERE / 'mark.json').read_text(encoding='utf-8'))
BG = MARK['background']
R = MARK['tileRadius']

def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(value + '\n', encoding='utf-8')

def svg_parts(mono=None):
    """C = écran (trait), D = triangle, E = vide noir que l'encoche prolonge."""
    out = ''
    for p in MARK['parts']:
        if p.get('cut') and mono:
            continue
        attrs = f'd="{p["d"]}"'
        fill = mono or MARK[p['fill']] if 'fill' in p else 'none'
        attrs += f' fill="{fill}"'
        if 'stroke' in p:
            attrs += f' stroke="{mono or MARK[p["stroke"]]}" stroke-width="{p["width"]}"'
            if 'cap' in p:
                attrs += f' stroke-linecap="{p["cap"]}"'
            if 'join' in p:
                attrs += f' stroke-linejoin="{p["join"]}"'
        out += f'<path {attrs}/>'
    return out

# Sur la tuile, le dessin est agrandi (x1,22) et recentré : il occupe 82 % du carré, comme les grandes applis TV.
TILE_SCALE = 1.22
CY = MARK['contentCenterY']
big = f'<g transform="translate({54 - 54 * TILE_SCALE:.2f} {54 - CY * TILE_SCALE:.2f}) scale({TILE_SCALE})">{svg_parts()}</g>'
tile = f'<rect width="108" height="108" rx="{R}" fill="{BG}"/>'
icon = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108">{tile}{big}</svg>'
for path in [HERE / 'cedplay-icon.svg', APP / 'public/cedplay-icon.svg', APP / 'public/favicon.svg']:
    write(path, icon)
write(HERE / 'cedplay-mark-mono.svg', f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108">{svg_parts("#000000")}</svg>')

name = (f'<text x="145" y="79" fill="{MARK["line"]}" font-family="Sora, Segoe UI, sans-serif" font-size="56" font-weight="700" letter-spacing="-1">'
        f'{MARK["nameStart"]}<tspan fill="{MARK["accent"]}">{MARK["nameEnd"]}</tspan></text>'
        f'<text x="147" y="110" fill="{MARK["muted"]}" font-family="Sora, Segoe UI, sans-serif" font-size="19">{MARK["tagline"]}</text>')
write(HERE / 'cedplay-logo.svg', f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 520 140"><rect width="520" height="140" rx="20" fill="{BG}"/><g transform="translate(16 16)">{tile}{big}</g>{name}</svg>')
name_light = name.replace(f'fill="{MARK["line"]}"', 'fill="#111113"').replace(f'fill="{MARK["accent"]}"', f'fill="{MARK["accentOnLight"]}"').replace(f'fill="{MARK["muted"]}"', 'fill="#55555C"')
write(HERE / 'cedplay-logo-clair.svg', f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 520 140"><rect width="520" height="140" rx="20" fill="#F5F5F2"/><g transform="translate(16 16)">{tile}{big}</g>{name_light}</svg>')

def vector(size, transform='', monochrome=False):
    rendered = ''
    for p in MARK['parts']:
        if p.get('cut') and monochrome:
            continue  # à 24 dp l'encoche ne ferait qu'un pixel : le symbole de notification reste plein.
        attrs = f'android:pathData="{p["d"]}"'
        if 'fill' in p:
            attrs += f' android:fillColor="{"#FFFFFF" if monochrome else MARK[p["fill"]]}"'
        if 'stroke' in p:
            attrs += f' android:strokeColor="{"#FFFFFF" if monochrome else MARK[p["stroke"]]}" android:strokeWidth="{p["width"]}"'
            if 'cap' in p:
                attrs += f' android:strokeLineCap="{p["cap"]}"'
            if 'join' in p:
                attrs += f' android:strokeLineJoin="{p["join"]}"'
        rendered += f'<path {attrs}/>'
    return f'<?xml version="1.0" encoding="utf-8"?><vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="{size}dp" android:height="{size}dp" android:viewportWidth="108" android:viewportHeight="108"><group {transform}>{rendered}</group></vector>'

# Premier plan adaptatif : x0,8, la plus grande taille qui tient encore dans le masque rond.
foreground = f'android:scaleX="0.8" android:scaleY="0.8" android:translateX="{54 - 54 * 0.8:.2f}" android:translateY="{54 - CY * 0.8:.2f}"'
write(RES / 'drawable/cedplay_foreground.xml', vector(108, foreground))
write(RES / 'drawable/cedplay_splash_icon.xml', vector(288, 'android:scaleX="0.6" android:scaleY="0.6" android:translateX="21.6" android:translateY="21.6"'))
write(RES / 'drawable/ic_stat_cedplay.xml', vector(24, 'android:scaleX="0.86" android:scaleY="0.86" android:translateX="7.56" android:translateY="7.56"', True))
write(RES / 'drawable-v24/ic_launcher_foreground.xml', vector(108, foreground))
write(RES / 'drawable/ic_launcher_background.xml', f'<shape xmlns:android="http://schemas.android.com/apk/res/android"><solid android:color="{BG}"/></shape>')
write(RES / 'values/ic_launcher_background.xml', f'<resources><color name="ic_launcher_background">{BG}</color></resources>')
for file in ['ic_launcher.xml', 'ic_launcher_round.xml']:
    write(RES / 'mipmap-anydpi-v26' / file, '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android"><background android:drawable="@color/ic_launcher_background"/><foreground android:drawable="@drawable/cedplay_foreground"/><monochrome android:drawable="@drawable/ic_stat_cedplay"/></adaptive-icon>')

manifest = {'id': '/', 'name': MARK['name'], 'short_name': MARK['name'], 'lang': 'fr', 'start_url': '/', 'scope': '/', 'display': 'standalone', 'background_color': BG, 'theme_color': BG, 'icons': [{'src': '/cedplay-192.png', 'sizes': '192x192', 'type': 'image/png', 'purpose': 'any'}, {'src': '/cedplay-512.png', 'sizes': '512x512', 'type': 'image/png', 'purpose': 'any'}]}
write(APP / 'public/site.webmanifest', json.dumps(manifest, ensure_ascii=False, indent=2))

# Couleur de fond du lancement Android et de la barre du navigateur.
styles = RES / 'values/styles.xml'
text = styles.read_text(encoding='utf-8')
start = text.find('<item name="windowSplashScreenBackground">')
if start >= 0:
    end = text.find('</item>', start)
    text = text[:start] + f'<item name="windowSplashScreenBackground">{BG}' + text[end:]
    styles.write_text(text, encoding='utf-8')
index = APP / 'index.html'
text = index.read_text(encoding='utf-8')
start = text.find('<meta name="theme-color" content="')
if start >= 0:
    start += len('<meta name="theme-color" content="')
    end = text.find('"', start)
    index.write_text(text[:start] + BG + text[end:], encoding='utf-8')

for filename in ['Lancer le lecteur.cmd', "Construire l'APK.cmd"]:
    path = ROOT / filename
    text = path.read_text(encoding='utf-8').replace('Lecteur IPTV', 'CedPlay')
    if filename.startswith('Construire'):
        text = text.replace('Lecteur-IPTV.apk" >nul', 'CedPlay.apk" >nul') if 'CedPlay.apk' not in text else text
        # Garder le chemin de livraison habituel à jour pour les anciens raccourcis (une seule fois).
        line = 'copy /y "%~dp0application\\android\\app\\build\\outputs\\apk\\release\\app-release.apk" "%~dp0CedPlay.apk" >nul'
        alias = 'copy /y "%~dp0CedPlay.apk" "%~dp0Lecteur-IPTV.apk" >nul'
        if alias not in text:
            text = text.replace(line, line + '\n' + alias)
    path.write_text(text, encoding='utf-8')

print('Identité vectorielle, manifest et mentions natives exportés.')
