import { useEffect, useState } from 'react';
import { loadBodlavDocumentaries, type BodlavDocumentary } from '@/utils/bodlav';

export function useBodlavDocumentaries(enabled: boolean, context: string): BodlavDocumentary[] {
  const [result, setResult] = useState<{ context: string; items: BodlavDocumentary[] } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void loadBodlavDocumentaries(controller.signal)
      .then(items => { if (!controller.signal.aborted) setResult({ context, items }); })
      .catch(() => {});
    return () => controller.abort();
  }, [enabled, context]);
  return enabled && result?.context === context ? result.items : [];
}
