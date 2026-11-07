/** Le nom est porté par le texte voisin ; le symbole reste décoratif. */
export function BrandMark({ className = 'h-9 w-9' }: { className?: string }) {
  return <img src="/cedplay-icon.svg" alt="" aria-hidden="true" width="108" height="108" className={`shrink-0 ${className}`} />;
}
