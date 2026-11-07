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

const App = () => {
  useRemoteNavigation();
  const [settings, setSettings] = useState<AppSettings>(() => StorageManager.getSettings());
  useEffect(() => { (async () => { const s = await StorageManager.loadSettingsAsync(); setSettings(s); if (s.telemetryPersistence !== false) globalTelemetryLogger.enablePersistence(); })(); }, []);
  // Apply theme class when settings change
  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === 'dark') root.classList.add('dark'); else root.classList.remove('dark');
  }, [settings.theme]);
  // Bouton retour Android : ferme le plein écran ou le dialogue ouvert, sinon
  // revient dans l'historique, sinon quitte l'app.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let disposed = false;
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
        else CapApp.exitApp();
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
