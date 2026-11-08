import { describe, expect, it } from 'vitest';
import {
  MAX_PLAYLIST_BYTES, MAX_XMLTV_BYTES, MAX_XMLTV_CHARS,
  assertImportSize, assertXmltvTextSize, decodeImportText,
} from '@/utils/textImport';

const bytesOf = (...values: number[]) => new Uint8Array(values);

describe('textImport — décodage', () => {
  it('décode l’UTF-8 et retire le BOM', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('#EXTM3U\n#EXTINF:-1,Été')]);
    expect(decodeImportText(bytes, 'playlist')).toBe('#EXTM3U\n#EXTINF:-1,Été');
  });

  it('replie une liste Latin-1 sans déclaration sur windows-1252', () => {
    // « Café » en windows-1252 : l'octet 0xE9 n'est pas de l'UTF-8 valide.
    expect(decodeImportText(bytesOf(0x43, 0x61, 0x66, 0xe9), 'playlist')).toBe('Café');
  });

  it('respecte la déclaration d’encodage d’un guide XMLTV', () => {
    const body = '<?xml version="1.0" encoding="ISO-8859-1"?><tv><channel id="é"/></tv>';
    const bytes = new Uint8Array(body.length);
    for (let i = 0; i < body.length; i++) bytes[i] = body.charCodeAt(i) & 0xff;
    expect(decodeImportText(bytes, 'xmltv')).toContain('<channel id="é"/>');
  });

  it('décode un guide UTF-16 annoncé par le BOM', () => {
    const text = '<?xml version="1.0"?><tv><channel id="a"/></tv>';
    const bytes = new Uint8Array(2 + text.length * 2);
    bytes[0] = 0xff; bytes[1] = 0xfe;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      bytes[2 + i * 2] = code & 0xff;
      bytes[3 + i * 2] = code >> 8;
    }
    expect(decodeImportText(bytes, 'xmltv')).toBe(text);
  });

  it('décode un guide UTF-16 grand-boutiste annoncé par le BOM', () => {
    const text = '<?xml version="1.0"?><tv><channel id="b"/></tv>';
    const bytes = new Uint8Array(2 + text.length * 2);
    bytes[0] = 0xfe; bytes[1] = 0xff;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      bytes[2 + i * 2] = code >> 8;
      bytes[3 + i * 2] = code & 0xff;
    }
    expect(decodeImportText(bytes, 'xmltv')).toBe(text);
  });
});

describe('textImport — plafonds', () => {
  it('refuse une liste au-delà de 64 Mo avant lecture', () => {
    expect(() => assertImportSize(MAX_PLAYLIST_BYTES, 'playlist')).not.toThrow();
    expect(() => assertImportSize(MAX_PLAYLIST_BYTES + 1, 'playlist')).toThrow('Liste trop volumineuse');
  });

  it('refuse un guide compressé au-delà du plafond', () => {
    expect(() => assertImportSize(MAX_XMLTV_BYTES, 'xmltv')).not.toThrow();
    expect(() => assertImportSize(MAX_XMLTV_BYTES + 1, 'xmltv')).toThrow('Guide trop volumineux');
  });

  it('refuse un guide décompressé au-delà du plafond', () => {
    expect(() => assertXmltvTextSize(MAX_XMLTV_CHARS)).not.toThrow();
    expect(() => assertXmltvTextSize(MAX_XMLTV_CHARS + 1)).toThrow('Guide trop volumineux');
  });
});
