import { useEffect, useState } from 'react';
import { loadOfficialDocumentaries, type OfficialDocumentary, type OfficialDocumentarySource } from '@/utils/officialDocumentaries';

export function useOfficialDocumentaries(source: OfficialDocumentarySource, enabled: boolean, context: string): OfficialDocumentary[] {
  const [result, setResult] = useState<{ source: OfficialDocumentarySource; context: string; items: OfficialDocumentary[] } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void loadOfficialDocumentaries(source, controller.signal)
      .then(items => { if (!controller.signal.aborted) setResult({ source, context, items }); })
      .catch(() => {});
    return () => controller.abort();
  }, [source, enabled, context]);
  return enabled && result?.source === source && result.context === context ? result.items : [];
}
