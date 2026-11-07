import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Gauge, Check } from 'lucide-react';

interface QualitySelectorProps {
  currentQuality: string;
  availableQualities: string[];
  onQualityChange: (qualityIndex: number) => void;
  disabled?: boolean;
}

export function QualitySelector({ 
  currentQuality, 
  availableQualities, 
  onQualityChange, 
  disabled = false 
}: QualitySelectorProps) {
  if (availableQualities.length <= 1) {
    return null; // Don't show selector if only one quality available
  }

  const getQualityLabel = (quality: string) => {
    if (quality === 'auto') return 'Auto';
    return quality;
  };

  const getQualityDescription = (quality: string) => {
    if (quality === 'auto') return 'Adaptation automatique basée sur la connexion';
    const height = parseInt(quality.replace('p', ''));
    if (height >= 1080) return 'Haute définition';
    if (height >= 720) return 'Haute définition (720p)';
    if (height >= 480) return 'Qualité moyenne';
    return 'Qualité de base';
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button 
          size="sm" 
          variant="secondary" 
          className="h-6 px-2 text-xs flex items-center gap-1"
          disabled={disabled}
        >
          <Gauge className="h-3 w-3" />
          {getQualityLabel(currentQuality)}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-64" align="end">
        <DropdownMenuLabel className="flex items-center gap-2">
          <Gauge className="h-4 w-4" />
          Qualité Vidéo
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {availableQualities.map((quality, index) => {
          const isSelected = quality === currentQuality;
          return (
            <DropdownMenuItem 
              key={index}
              onClick={() => onQualityChange(index)}
              className="flex items-center justify-between gap-2 cursor-pointer"
            >
              <div className="flex flex-col">
                <span className="font-medium">{getQualityLabel(quality)}</span>
                <span className="text-xs text-muted-foreground">
                  {getQualityDescription(quality)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {quality === 'auto' && (
                  <Badge variant="outline" className="text-[10px] px-1">
                    Recommandé
                  </Badge>
                )}
                {isSelected && (
                  <Check className="h-4 w-4 text-green-500" />
                )}
              </div>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
