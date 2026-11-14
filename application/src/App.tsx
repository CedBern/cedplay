import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import Index from './pages/Index';
import NotFound from './pages/NotFound';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useEffect, useState } from 'react';
import { globalTelemetryLogger } from '@/utils/telemetry/logger';
import { StorageManager, AppSettings } from '@/utils/storage';
import { useRemoteNavigation } from '@/hooks/useRemoteNavigation';
import { createExitGuard, EXIT_CONFIRM_MS } from '@/utils/tvExitGuard';
import { toast } from 'sonner';

const App = () => {
  useRemoteNavigation();
  // Le miroir de thème (localStorage) prime sur les réglages synchrones hérités :
  // sans lui, un utilisateur en thème clair verrait un cadre sombre le temps que
  // les réglages arrivent d'IndexedDB.
  const [settings, setSettings] = useState<AppSettings>(() => {
    const initial = StorageManager.getSettings();
    const mirror = StorageManager.getThemeMirror();
    return mirror ? { ...initial, theme: mirror } : initial;
  });
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const s = await StorageManager.loadSettingsAsync();
        if (cancelled) return;
        setSettings(s);
        if (s.telemetryPersistence !== false) globalTelemetryLogger.enablePersistence();
      } catch { /* fallback synchronisé déjà en place */ }
    })();
    return () => { cancelled = true; };
  }, []);
  // Apply theme class when settings change
  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === 'dark') root.classList.add('dark'); else root.classList.remove('dark');
    // Miroir synchrone pour le script inline d'index.html (évite le flash au lancement).
    StorageManager.setThemeMirror(settings.theme);
  }, [settings.theme]);
  // Bouton retour Android : ferme le plein écran ou le dialogue ouvert, sinon
  // revient dans l'historique, sinon quitte l'app. Sur TV, la sortie demande un second appui :
  // un Retour de trop depuis l'Accueil ne doit pas fermer l'application.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let disposed = false;
    const confirmExit = createExitGuard();
    let remove: (() => void) | undefined;
    void import('@capacitor/app').then(async ({ App: CapApp }) => {
      if (disposed) return;
      const listener = await CapApp.addListener('backButton', ({ canGoBack }) => {
        if (disposed) return;
        if (document.fullscreenElement) {
          void document.exitFullscreen().catch(() => {});
          return;
        }
        if (document.querySelector('[role="dialog"]')) {
          // Les dialogues (Radix) se ferment sur Échap ; on le déclenche depuis
          // l'élément actif, qui est piégé à l'intérieur du dialogue.
          const target = (document.activeElement ?? document.body) as HTMLElement;
          target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
          return;
        }
        // L'écran principal revient d'abord à la rubrique précédente ou à l'Accueil.
        const back = new Event('iptv-back', { cancelable: true });
        window.dispatchEvent(back);
        if (back.defaultPrevented) return;
        if (canGoBack) window.history.back();
        else if (!document.documentElement.classList.contains('tv-mode') || confirmExit()) CapApp.exitApp();
        else toast('Appuie encore sur Retour pour quitter CedPlay', { id: 'exit-confirm', duration: EXIT_CONFIRM_MS });
      });
      if (disposed) void listener.remove();
      else remove = () => { void listener.remove(); };
    }).catch(() => { /* plugin indisponible */ });
    return () => { disposed = true; remove?.(); };
  }, []);
  return (
    <TooltipProvider>
      <Toaster />
      <ErrorBoundary>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </ErrorBoundary>
    </TooltipProvider>
  );
};

export default App;
