import { Badge } from '@/components/ui/badge';
import { Wifi, WifiOff, Signal } from 'lucide-react';
import type { NetworkStatus } from '@/hooks/useNetworkStatus';

interface ConnectionQualityProps {
  networkStatus: NetworkStatus;
  className?: string;
}

export function ConnectionQuality({ networkStatus, className = '' }: ConnectionQualityProps) {
  const getQualityLevel = () => {
    if (!networkStatus.isOnline) return 'offline';
    
    const { effectiveType, downlink } = networkStatus;
    
    if (effectiveType === '4g' && downlink > 10) return 'excellent';
    if (effectiveType === '4g' || (effectiveType === '3g' && downlink > 5)) return 'good';
    if (effectiveType === '3g' || downlink > 1) return 'fair';
    return 'poor';
  };

  const qualityLevel = getQualityLevel();

  const getQualityConfig = () => {
    switch (qualityLevel) {
      case 'offline':
        return {
          icon: WifiOff,
          text: 'Hors ligne',
          variant: 'destructive' as const,
          color: 'text-red-500'
        };
      case 'poor':
        return {
          icon: Signal,
          text: 'Connexion faible',
          variant: 'destructive' as const,
          color: 'text-red-500'
        };
      case 'fair':
        return {
          icon: Signal,
          text: 'Connexion moyenne',
          variant: 'secondary' as const,
          color: 'text-yellow-500'
        };
      case 'good':
        return {
          icon: Wifi,
          text: 'Bonne connexion',
          variant: 'default' as const,
          color: 'text-blue-500'
        };
      case 'excellent':
        return {
          icon: Wifi,
          text: 'Excellente connexion',
          variant: 'default' as const,
          color: 'text-green-500'
        };
      default:
        return {
          icon: Wifi,
          text: 'Connexion inconnue',
          variant: 'secondary' as const,
          color: 'text-gray-500'
        };
    }
  };

  const config = getQualityConfig();
  const Icon = config.icon;

  const getDetailedInfo = () => {
    if (!networkStatus.isOnline) return 'Aucune connexion internet';
    
    const parts = [];
    if (networkStatus.effectiveType !== 'unknown') {
      parts.push(`Type: ${networkStatus.effectiveType.toUpperCase()}`);
    }
    if (networkStatus.downlink > 0) {
      parts.push(`Débit: ${networkStatus.downlink.toFixed(1)} Mbps`);
    }
    if (networkStatus.rtt > 0) {
      parts.push(`Latence: ${networkStatus.rtt}ms`);
    }
    
    return parts.length > 0 ? parts.join(' • ') : 'Informations de connexion indisponibles';
  };

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Badge variant={config.variant} className="flex items-center gap-1">
        <Icon className={`h-3 w-3 ${config.color}`} />
        <span className="text-xs">{config.text}</span>
      </Badge>
      <div className="text-xs text-muted-foreground hidden md:block">
        {getDetailedInfo()}
      </div>
    </div>
  );
}
