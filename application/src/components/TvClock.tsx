import { useEffect, useState } from 'react';
import { formatTime } from '@/utils/epgXmltv';

/** Heure dans l'en-tête TV : visible depuis toutes les rubriques, comme sur un décodeur. */
export function TvClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    // Recalé sur la minute : un simple intervalle de 30 s afficherait l'heure avec jusqu'à 30 s de retard.
    let timer = 0;
    const tick = () => {
      setNow(new Date());
      timer = window.setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
    };
    timer = window.setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
    return () => window.clearTimeout(timer);
  }, []);
  return <time data-tv-clock dateTime={now.toISOString()} className="px-2 text-[17px] font-medium tabular-nums text-foreground/75">{formatTime(now)}</time>;
}
