import React from 'react';

export interface PlatformLogoProps {
  platformId?: string | null | undefined;
  name?: string | undefined;
  size?: 'sm' | 'md' | 'lg' | 'xl' | undefined;
  compact?: boolean | undefined;
  className?: string | undefined;
}

const sizeClasses: Record<'sm' | 'md' | 'lg' | 'xl', string> = {
  sm: 'w-6 h-6',
  md: 'w-8 h-8',
  lg: 'w-12 h-12',
  xl: 'w-16 h-16',
};

/**
 * Composant de logo vectoriel SVG autonome pour les plateformes de streaming et chaînes.
 * Ne dépend d'aucun CDN externe, fonctionne 100% hors-ligne.
 */
export const PlatformLogo: React.FC<PlatformLogoProps> = ({
  platformId,
  name = '',
  size = 'md',
  compact = false,
  className = '',
}) => {
  const chosenSize = compact ? 'sm' : size;
  const containerClass = `relative shrink-0 rounded-lg overflow-hidden flex items-center justify-center select-none shadow-sm ${sizeClasses[chosenSize]} ${className}`;

  const id = (platformId || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  switch (id) {
    case 'netflix':
      return (
        <div className={containerClass} title={name || 'Netflix'}>
          <svg viewBox="0 0 48 48" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <rect width="48" height="48" rx="8" fill="#141414" />
            <path d="M14 8h5.5v32H14V8z" fill="#E50914" />
            <path d="M28.5 8H34v32h-5.5V8z" fill="#E50914" />
            <path d="M14 8h5.8l14.2 32h-5.8L14 8z" fill="#E50914" />
            <path d="M14 8l14.5 32H23L14 17.5V8z" fill="#B81D24" opacity="0.95" />
          </svg>
        </div>
      );

    case 'disneyplus':
    case 'disney':
      return (
        <div className={containerClass} title={name || 'Disney+'}>
          <svg viewBox="0 0 48 48" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <defs>
              <linearGradient id="disney-bg" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
                <stop stopColor="#040714" />
                <stop offset="1" stopColor="#113CCF" />
              </linearGradient>
              <linearGradient id="disney-arc" x1="10" y1="36" x2="38" y2="12" gradientUnits="userSpaceOnUse">
                <stop stopColor="#113CCF" stopOpacity="0" />
                <stop offset="0.5" stopColor="#42C4F6" />
                <stop offset="1" stopColor="#FFFFFF" />
              </linearGradient>
            </defs>
            <rect width="48" height="48" rx="8" fill="url(#disney-bg)" />
            <path d="M10 32C12 20 22 13 36 12C26 15 16 23 13 34" stroke="url(#disney-arc)" strokeWidth="2.2" strokeLinecap="round" />
            <polygon points="36,12 37.5,14 39.5,14 38,15.5 38.5,17.5 37,16 35.5,17.5 36,15.5 34.5,14 36.5,14" fill="#FFFFFF" />
            <path d="M14 18c0 0 7-3 10.5 1.5c3 4 1 9-4 9.5c-3.5.5-5.5-1.5-5.5-3.5c0-3 3.5-4.5 7-4.5c3.5 0 4.5 1.5 4.5 1.5M16 16v15" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M33 24v8M29 28h8" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        </div>
      );

    case 'primevideo':
    case 'amazonprime':
    case 'prime':
      return (
        <div className={containerClass} title={name || 'Prime Video'}>
          <svg viewBox="0 0 48 48" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <rect width="48" height="48" rx="8" fill="#0A111E" />
            <text x="8" y="24" fill="#FFFFFF" fontFamily="system-ui, sans-serif" fontWeight="800" fontSize="12" letterSpacing="-0.5">prime</text>
            <path d="M10 29c7.5 5 18 5 25.5-1" stroke="#00A8E1" strokeWidth="2.5" strokeLinecap="round" />
            <path d="M33 26l4.5 2l-1.5 4.5" fill="none" stroke="#00A8E1" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      );

    case 'max':
    case 'hbomax':
    case 'hbo':
      return (
        <div className={containerClass} title={name || 'Max'}>
          <svg viewBox="0 0 48 48" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <rect width="48" height="48" rx="8" fill="#002BE7" />
            <text x="24" y="30" fill="#FFFFFF" fontFamily="system-ui, -apple-system, sans-serif" fontWeight="900" fontSize="17" textAnchor="middle" letterSpacing="0.8">MAX</text>
            <circle cx="24" cy="23.5" r="2.2" fill="#002BE7" />
          </svg>
        </div>
      );

    case 'appletv':
    case 'appletvplus':
      return (
        <div className={containerClass} title={name || 'Apple TV+'}>
          <svg viewBox="0 0 48 48" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <rect width="48" height="48" rx="8" fill="#1C1C1E" />
            <path d="M16.5 16.2c.8-1 1.3-2.3 1.1-3.6-1.1.1-2.4.7-3.1 1.7-.7.8-1.3 2.1-1.1 3.4 1.2.1 2.4-.6 3.1-1.5z" fill="#FFFFFF" />
            <path d="M17.6 18.5c-1.8-.1-3.3 1-4.2 1-1 0-2.2-.9-3.7-.9-1.9 0-3.6 1.1-4.6 2.8-2 3.4-.5 8.5 1.4 11.3.9 1.4 2.1 2.9 3.5 2.8 1.4-.1 2-.9 3.6-.9 1.6 0 2.1.9 3.6.9 1.5 0 2.5-1.4 3.4-2.7 1.1-1.5 1.5-3 1.5-3.1-.1 0-2.9-1.1-2.9-4.4 0-2.7 2.2-4.1 2.3-4.2-1.3-1.8-3.2-2.5-3.9-2.6z" fill="#FFFFFF" />
            <text x="23.5" y="29.5" fill="#FFFFFF" fontFamily="system-ui, sans-serif" fontWeight="700" fontSize="12" letterSpacing="-0.2">tv+</text>
          </svg>
        </div>
      );

    case 'canalplus':
    case 'canal':
    case 'mycanal':
      return (
        <div className={containerClass} title={name || 'Canal+'}>
          <svg viewBox="0 0 48 48" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <rect width="48" height="48" rx="8" fill="#111111" />
            <rect x="2" y="2" width="44" height="44" rx="7" stroke="#333333" strokeWidth="1" />
            <text x="7" y="28" fill="#FFFFFF" fontFamily="system-ui, sans-serif" fontWeight="900" fontSize="10.5" letterSpacing="0.8">CANAL</text>
            <rect x="37" y="20.5" width="4.5" height="4.5" rx="1" fill="#FFFFFF" />
            <path d="M39.25 18.5v8.5M35 22.75h8.5" stroke="#111111" strokeWidth="1.6" />
          </svg>
        </div>
      );

    case 'paramountplus':
    case 'paramount':
      return (
        <div className={containerClass} title={name || 'Paramount+'}>
          <svg viewBox="0 0 48 48" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <rect width="48" height="48" rx="8" fill="#0064FF" />
            <g fill="#FFFFFF" opacity="0.95">
              <circle cx="12" cy="27" r="1.1" />
              <circle cx="14" cy="21" r="1.1" />
              <circle cx="18" cy="16" r="1.1" />
              <circle cx="24" cy="14" r="1.2" />
              <circle cx="30" cy="16" r="1.1" />
              <circle cx="34" cy="21" r="1.1" />
              <circle cx="36" cy="27" r="1.1" />
            </g>
            <polygon points="24,17 14,35 34,35" fill="#FFFFFF" />
            <polygon points="24,17 21,35 27,35" fill="#DCEAFF" />
            <path d="M37 28v5M34.5 30.5h5" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
        </div>
      );

    case 'crunchyroll':
      return (
        <div className={containerClass} title={name || 'Crunchyroll'}>
          <svg viewBox="0 0 48 48" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <rect width="48" height="48" rx="8" fill="#141519" />
            <circle cx="24" cy="24" r="14" fill="#F47521" />
            <path d="M26 12a12 12 0 1 1-12 12c0-5 3-9 7-11c-2 2-3 5-3 8a8 8 0 1 0 8-8c0-.3 0-.7 0-1z" fill="#141519" />
            <circle cx="27.5" cy="23.5" r="3.5" fill="#F47521" />
          </svg>
        </div>
      );

    case 'adn':
      return (
        <div className={containerClass} title={name || 'ADN'}>
          <svg viewBox="0 0 48 48" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <rect width="48" height="48" rx="8" fill="#0A1120" />
            <polygon points="12,30 18,15 24,30" fill="#00A3E0" />
            <polygon points="24,30 30,15 36,30" fill="#E50914" />
            <text x="24" y="41" fill="#FFFFFF" fontFamily="system-ui, sans-serif" fontWeight="900" fontSize="9" textAnchor="middle">ADN</text>
          </svg>
        </div>
      );

    case 'youtube':
    case 'yt':
      return (
        <div className={containerClass} title={name || 'YouTube'}>
          <svg viewBox="0 0 48 48" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <rect width="48" height="48" rx="8" fill="#FF0000" />
            <polygon points="20,16 32,24 20,32" fill="#FFFFFF" />
          </svg>
        </div>
      );

    case 'twitch':
      return (
        <div className={containerClass} title={name || 'Twitch'}>
          <svg viewBox="0 0 48 48" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <rect width="48" height="48" rx="8" fill="#9146FF" />
            <path d="M12 11h24v17h-6l-4 5v-5h-14V11z" fill="#FFFFFF" />
            <rect x="19" y="17" width="2.8" height="5.5" fill="#9146FF" />
            <rect x="26" y="17" width="2.8" height="5.5" fill="#9146FF" />
          </svg>
        </div>
      );

    case 'plutotv':
    case 'pluto':
      return (
        <div className={containerClass} title={name || 'Pluto TV'}>
          <svg viewBox="0 0 48 48" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <rect width="48" height="48" rx="8" fill="#000000" />
            <ellipse cx="24" cy="20" rx="14" ry="7" stroke="#00B5E2" strokeWidth="2.5" fill="none" transform="rotate(-25 24 20)" />
            <ellipse cx="24" cy="20" rx="14" ry="7" stroke="#FFE600" strokeWidth="2" fill="none" transform="rotate(35 24 20)" />
            <circle cx="24" cy="20" r="5" fill="#E6007E" />
            <text x="24" y="39" fill="#FFFFFF" fontFamily="system-ui, sans-serif" fontWeight="800" fontSize="7.5" textAnchor="middle">pluto tv</text>
          </svg>
        </div>
      );

    case 'molotov':
    case 'molotovtv':
      return (
        <div className={containerClass} title={name || 'Molotov TV'}>
          <svg viewBox="0 0 48 48" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <rect width="48" height="48" rx="8" fill="#0F7CE0" />
            <path d="M24 8c2.5 4 8 8 8 15a8 8 0 0 1-16 0c0-5 3.5-9 6-11c.6 2 1.8 3.5 2.5 3.5c0-3.5-.5-5.5-.5-7.5z" fill="#FF9900" />
            <path d="M24 16c1.5 2.5 4.5 5 4.5 8.5a4.5 4.5 0 0 1-9 0c0-3 2-5 3.5-6.5c.3 1 1 1.8 1.3 1.8c0-1.8-.3-2.8-.3-3.8z" fill="#FFFF00" />
            <text x="24" y="39" fill="#FFFFFF" fontFamily="system-ui, sans-serif" fontWeight="900" fontSize="8" textAnchor="middle" letterSpacing="0.4">MOLOTOV</text>
          </svg>
        </div>
      );

    case 'rakutentv':
    case 'rakuten':
      return (
        <div className={containerClass} title={name || 'Rakuten TV'}>
          <svg viewBox="0 0 48 48" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <rect width="48" height="48" rx="8" fill="#BF0000" />
            <text x="13" y="28" fill="#FFFFFF" fontFamily="system-ui, sans-serif" fontWeight="900" fontSize="20">R</text>
            <text x="27" y="26" fill="#FFFFFF" fontFamily="system-ui, sans-serif" fontWeight="700" fontSize="9.5">TV</text>
            <path d="M11 34c8 3 18 3 24 0" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>
      );

    case 'tf1plus':
    case 'tf1':
    case 'mytf1':
      return (
        <div className={containerClass} title={name || 'TF1+'}>
          <svg viewBox="0 0 48 48" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <rect width="48" height="48" rx="8" fill="#002B7F" />
            <rect x="7" y="15" width="13" height="18" rx="2" fill="#0049B7" />
            <text x="13.5" y="28" fill="#FFFFFF" fontFamily="system-ui, sans-serif" fontWeight="900" fontSize="12" textAnchor="middle">TF</text>
            <rect x="21" y="15" width="10" height="18" rx="2" fill="#E50019" />
            <text x="26" y="28" fill="#FFFFFF" fontFamily="system-ui, sans-serif" fontWeight="900" fontSize="13" textAnchor="middle">1</text>
            <path d="M37 20v8M33 24h8" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        </div>
      );

    case 'm6plus':
    case 'm6':
    case '6play':
      return (
        <div className={containerClass} title={name || 'M6+'}>
          <svg viewBox="0 0 48 48" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <rect width="48" height="48" rx="8" fill="#581C87" />
            <circle cx="20" cy="24" r="11" fill="#C026D3" />
            <text x="20" y="30.5" fill="#FFFFFF" fontFamily="system-ui, sans-serif" fontWeight="900" fontSize="16" textAnchor="middle">6</text>
            <path d="M36 20v8M32 24h8" stroke="#FFFFFF" strokeWidth="2.8" strokeLinecap="round" />
          </svg>
        </div>
      );

    case 'francetv':
    case 'france2':
    case 'france3':
    case 'france4':
    case 'france5':
    case 'franceinfo':
      return (
        <div className={containerClass} title={name || 'france.tv'}>
          <svg viewBox="0 0 48 48" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <rect width="48" height="48" rx="8" fill="#181B20" />
            <g transform="translate(9, 11)">
              <rect x="0" y="0" width="4.5" height="11" rx="2" fill="#002E7A" />
              <rect x="6" y="0" width="4.5" height="11" rx="2" fill="#0072CE" />
              <rect x="12" y="0" width="4.5" height="11" rx="2" fill="#00A3E0" />
              <rect x="18" y="0" width="4.5" height="11" rx="2" fill="#00D084" />
              <rect x="24" y="0" width="4.5" height="11" rx="2" fill="#FFB81C" />
            </g>
            <text x="24" y="35" fill="#FFFFFF" fontFamily="system-ui, sans-serif" fontWeight="700" fontSize="8.5" textAnchor="middle" letterSpacing="-0.3">france·tv</text>
          </svg>
        </div>
      );

    case 'arte':
      return (
        <div className={containerClass} title={name || 'Arte'}>
          <svg viewBox="0 0 48 48" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <rect width="48" height="48" rx="8" fill="#FA5000" />
            <text x="24" y="31" fill="#FFFFFF" fontFamily="system-ui, sans-serif" fontWeight="900" fontSize="16" textAnchor="middle" letterSpacing="-0.5">arte</text>
          </svg>
        </div>
      );

    case 'dazn':
      return (
        <div className={containerClass} title={name || 'DAZN'}>
          <svg viewBox="0 0 48 48" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <rect width="48" height="48" rx="8" fill="#000000" />
            <text x="24" y="30" fill="#F8FF00" fontFamily="system-ui, sans-serif" fontWeight="900" fontSize="13" textAnchor="middle" letterSpacing="1">DAZN</text>
          </svg>
        </div>
      );

    case 'plex':
      return (
        <div className={containerClass} title={name || 'Plex'}>
          <svg viewBox="0 0 48 48" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <rect width="48" height="48" rx="8" fill="#1F2326" />
            <path d="M18 12l10 12l-10 12h7l10-12l-10-12h-7z" fill="#E5A00D" />
          </svg>
        </div>
      );

    case 'ocs':
      return (
        <div className={containerClass} title={name || 'OCS'}>
          <svg viewBox="0 0 48 48" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <rect width="48" height="48" rx="8" fill="#1C1917" />
            <text x="24" y="29" fill="#FF5500" fontFamily="system-ui, sans-serif" fontWeight="900" fontSize="15" textAnchor="middle" letterSpacing="1">OCS</text>
            <path d="M12 34h24" stroke="#FF5500" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>
      );

    case 'beinsports':
    case 'bein':
      return (
        <div className={containerClass} title={name || 'beIN SPORTS'}>
          <svg viewBox="0 0 48 48" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <rect width="48" height="48" rx="8" fill="#5B2C82" />
            <text x="24" y="22" fill="#FFFFFF" fontFamily="system-ui, sans-serif" fontWeight="800" fontSize="10" textAnchor="middle">beIN</text>
            <text x="24" y="34" fill="#FFA500" fontFamily="system-ui, sans-serif" fontWeight="900" fontSize="8.5" textAnchor="middle" letterSpacing="0.5">SPORTS</text>
          </svg>
        </div>
      );

    case 'eurosport':
      return (
        <div className={containerClass} title={name || 'Eurosport'}>
          <svg viewBox="0 0 48 48" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <rect width="48" height="48" rx="8" fill="#001E50" />
            <circle cx="24" cy="18" r="6" stroke="#FFFFFF" strokeWidth="1.5" strokeDasharray="3 2" fill="none" />
            <polygon points="24,14 25.5,17 28.5,17 26,19 27,22 24,20.5 21,22 22,19 19.5,17 22.5,17" fill="#FFFFFF" />
            <text x="24" y="35" fill="#FFFFFF" fontFamily="system-ui, sans-serif" fontWeight="900" fontSize="6.5" textAnchor="middle" letterSpacing="0.5">EUROSPORT</text>
          </svg>
        </div>
      );

    default:
      // Monogramme fallback propre
      return (
        <div className={`${containerClass} bg-muted text-foreground font-semibold`} title={name}>
          <span className={`uppercase tracking-wide ${compact ? 'text-[9px]' : 'text-xs'}`}>
            {(name || platformId || 'TV').replace(/[^A-Za-z0-9]/g, '').slice(0, 3)}
          </span>
        </div>
      );
  }
};
