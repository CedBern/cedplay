import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

/** Marge blanche imposée autour d'un QR code pour qu'un téléphone le reconnaisse. */
const QUIET_ZONE = 4;

function qrPath(text: string): { size: number; path: string } {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount();
  let path = '';
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (qr.isDark(row, col)) path += `M${col + QUIET_ZONE} ${row + QUIET_ZONE}h1v1h-1z`;
    }
  }
  return { size: count + QUIET_ZONE * 2, path };
}

/**
 * TV : connexion de l'abonnement depuis le téléphone. Le QR code mène à une page servie par
 * le téléviseur sur le réseau local ; l'adresse est aussi écrite pour un ordinateur.
 */
export function TvPairingCard({ url }: { url: string }) {
  const { size, path } = useMemo(() => qrPath(url), [url]);
  return <section data-tv-pairing aria-label="Connexion avec le téléphone" className="flex flex-col items-center gap-2.5 rounded-2xl border border-neutral-800 bg-neutral-900/50 p-4 text-center">
    <h3 className="text-[19px] font-semibold leading-tight text-foreground">Avec ton téléphone</h3>
    <svg role="img" aria-label="QR code de connexion" viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges" className="h-[156px] w-[156px] rounded-xl" style={{ background: '#fff' }}>
      <path d={path} fill="#000" />
    </svg>
    <p className="text-[13px] leading-snug text-neutral-300">
      Scanne le code, saisis tes identifiants sur le téléphone : la connexion démarre ici.
    </p>
    <p className="text-[12px] leading-snug text-neutral-400">
      Même réseau local que le téléviseur. Code valable 5 minutes. Échange HTTP non chiffré. Sans appareil photo, ouvre<br />
      <span className="break-all font-medium text-neutral-200">{url.replace(/^http:\/\//, '')}</span>
    </p>
  </section>;
}
