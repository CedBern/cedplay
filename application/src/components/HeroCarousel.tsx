import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Info, Play } from 'lucide-react';

export interface HeroItem {
  key: string;
  /** Petite ligne au-dessus du titre : « Reprendre », « En direct »… */
  eyebrow: string;
  live?: boolean;
  title: string;
  meta?: string | undefined;
  /** Affiche (film, série) : plein cadre. */
  image?: string | undefined;
  /** Logo de chaîne : halo flou en fond et logo net. */
  logo?: string | undefined;
  /** Vignette affichée en grand quand la chaîne n'a pas d'image de logo. */
  badge?: ReactNode;
  /** Progression 0–100 (lecture en cours, programme du direct). */
  progress?: number | null | undefined;
  actionLabel: string;
  onPlay: () => void;
  /** Action secondaire facultative : ouvrir la fiche du titre. */
  detailsLabel?: string | undefined;
  onDetails?: (() => void) | undefined;
}

/**
 * Bandeau d'accueil du téléphone : affiche en fondu vers le fond, défilement aimanté
 * au doigt et points de pagination. Il ne tourne jamais seul : rien ne bouge pendant qu'on lit.
 */
export function HeroCarousel({ items }: { items: HeroItem[] }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);

  // Diapositive visible d'après la position de défilement.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setIndex(Math.round(el.scrollLeft / Math.max(1, el.clientWidth))));
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => { el.removeEventListener('scroll', onScroll); cancelAnimationFrame(frame); };
  }, []);

  const goTo = (i: number) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' });
  };

  if (!items.length) return null;
  return <section aria-roledescription="carrousel" aria-label="À la une" className="relative overflow-hidden rounded-2xl sm:rounded-[28px]">
    <div
      ref={scroller}
      className="hero-scroller flex snap-x snap-mandatory overflow-x-auto"
    >
      {items.map((item, i) => <article
        key={item.key}
        aria-roledescription="diapositive"
        aria-label={`${i + 1} sur ${items.length} : ${item.title}`}
        className="relative h-[372px] w-full shrink-0 snap-center overflow-hidden sm:h-[420px]"
      >
        {/* Fond : affiche plein cadre, ou halo coloré tiré du logo de la chaîne. */}
        {item.image
          ? <img src={item.image} alt="" referrerPolicy="no-referrer" loading={i === 0 ? 'eager' : 'lazy'} className={`hero-image absolute inset-0 h-full w-full object-cover object-top ${index === i ? 'is-active' : ''}`} onError={e => { e.currentTarget.style.display = 'none'; }} />
          : <div aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(120%_80%_at_70%_20%,hsl(var(--primary)/0.22),transparent_60%),radial-gradient(90%_70%_at_10%_90%,hsl(var(--live)/0.12),transparent_60%)]">
            {item.logo && <img src={item.logo} alt="" referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full scale-150 object-cover opacity-35 blur-3xl" onError={e => { e.currentTarget.style.display = 'none'; }} />}
          </div>}
        {/* Fondu vers le fond de page, comme une salle qui s'assombrit. */}
        <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-background via-background/55 to-background/0" />
        <div aria-hidden="true" className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-background/80 to-transparent" />
        <div aria-hidden="true" className="absolute inset-y-0 left-0 hidden w-2/3 bg-gradient-to-r from-background/80 to-transparent sm:block" />

        {!item.image && !item.logo && item.badge && <div aria-hidden="true" className="absolute right-14 top-[26%] drop-shadow-[0_0_60px_hsl(var(--primary)/0.35)] sm:right-20">{item.badge}</div>}
        {!item.image && item.logo && <img src={item.logo} alt="" referrerPolicy="no-referrer" className="absolute right-6 top-[22%] h-24 w-24 object-contain opacity-90 drop-shadow-[0_8px_30px_rgba(0,0,0,0.6)] sm:right-12 sm:top-1/4 sm:h-32 sm:w-32" onError={e => { e.currentTarget.style.display = 'none'; }} />}

        <div className={`hero-copy absolute inset-x-0 bottom-0 px-5 pb-14 sm:max-w-xl sm:px-10 sm:pb-12 ${index === i ? 'is-active' : ''}`}>
          <p className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-foreground/80">
            {item.live && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-live" />}
            {item.eyebrow}
          </p>
          <h2 className="mt-2 line-clamp-2 text-[32px] font-semibold leading-[1.05] tracking-[-0.02em] text-foreground [text-shadow:0_2px_24px_rgba(0,0,0,0.55)] sm:text-[40px]">{item.title}</h2>
          {item.meta && <p className="mt-2 line-clamp-1 font-mono text-[13px] text-foreground/75">{item.meta}</p>}
          {typeof item.progress === 'number' && <div className="mt-3 h-0.5 w-40 overflow-hidden rounded-full bg-foreground/20"><div className="h-full bg-primary" style={{ width: `${item.progress}%` }} /></div>}
          <button
            type="button"
            onClick={item.onPlay}
            className="press mt-5 inline-flex min-h-12 items-center gap-2.5 rounded-full bg-foreground px-6 text-[15px] font-semibold text-background transition-colors hover:bg-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <Play aria-hidden="true" className="h-4 w-4 fill-current" />{item.actionLabel}
          </button>
          {item.onDetails && <button
            type="button"
            aria-label={item.detailsLabel ?? `Fiche de ${item.title}`}
            onClick={item.onDetails}
            className="press ml-3 mt-5 inline-flex h-12 w-12 items-center justify-center rounded-full border border-foreground/30 align-top text-foreground transition-colors hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <Info aria-hidden="true" className="h-5 w-5" />
          </button>}
        </div>
      </article>)}
    </div>
    {items.length > 1 && <div className="absolute inset-x-0 bottom-5 flex justify-center gap-2 sm:bottom-6">
      {items.map((item, i) => <button
        key={item.key}
        type="button"
        aria-label={`Afficher ${item.title}`}
        aria-current={index === i}
        onClick={() => goTo(i)}
        className={`h-1.5 rounded-full transition-all duration-500 ease-out ${index === i ? 'w-6 bg-foreground' : 'w-1.5 bg-foreground/35 hover:bg-foreground/60'}`}
      />)}
    </div>}
  </section>;
}
