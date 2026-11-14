import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { NativePlayerBridge } from '@/utils/nativePlayer';
import { isDesktopRuntime } from '@/utils/desktopBridge';

export type InterfaceMode = 'auto' | 'tv' | 'mobile';

const CACHE_KEY = 'cedplay.tvDetected';

function readCache(): boolean | null {
  try {
    const v = localStorage.getItem(CACHE_KEY);
    return v === '1' ? true : v === '0' ? false : null;
  } catch { return null; }
}

function writeCache(tv: boolean): void {
  try { localStorage.setItem(CACHE_KEY, tv ? '1' : '0'); } catch { /* stockage indisponible */ }
}

/** Forçage pour la recette dans un navigateur : ?tv=1 ou ?tv=0. */
function urlOverride(): boolean | null {
  try {
    const v = new URLSearchParams(window.location.search).get('tv');
    return v === '1' ? true : v === '0' ? false : null;
  } catch { return null; }
}

/** Estimation immédiate, avant la réponse du pont natif : desktop Windows ou appli Android sans écran tactile. */
function guess(): boolean {
  if (isDesktopRuntime()) return true;
  const cached = readCache();
  if (cached !== null) return cached;
  return Capacitor.isNativePlatform() && typeof navigator !== 'undefined' && navigator.maxTouchPoints === 0;
}

export function resolveTvMode(mode: InterfaceMode | undefined, detected: boolean): boolean {
  const forced = urlOverride();
  if (forced !== null) return forced;
  if (mode === 'tv') return true;
  if (mode === 'mobile') return false;
  return detected || isDesktopRuntime();
}

/**
 * Interface télécommande : détectée sur téléviseur / box Android TV / Desktop Windows, ou imposée dans les réglages.
 * Ajoute la classe `tv-mode` sur <html> pour les styles propres à la TV, et `desktop-mode` sous Windows Desktop.
 */
export function useTvMode(mode: InterfaceMode | undefined): boolean {
  const [detected, setDetected] = useState<boolean>(guess);
  const desktop = isDesktopRuntime();
  useEffect(() => {
    let cancelled = false;
    void NativePlayerBridge.isTelevision().then(tv => {
      if (cancelled || tv === null) return;
      writeCache(tv);
      setDetected(tv);
    });
    return () => { cancelled = true; };
  }, []);
  const tv = resolveTvMode(mode, detected);
  useEffect(() => {
    document.documentElement.classList.toggle('tv-mode', tv);
    document.documentElement.classList.toggle('desktop-mode', desktop);
    return () => {
      document.documentElement.classList.remove('tv-mode');
      document.documentElement.classList.remove('desktop-mode');
    };
  }, [tv, desktop]);
  return tv;
}
