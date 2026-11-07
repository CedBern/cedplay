const fs = require('fs');

let vp = fs.readFileSync('application/src/components/VideoPlayer.tsx', 'utf8');

// 1. Add Ratio to lucide-react import
vp = vp.replace(
  "import { Play, Pause, Volume2, VolumeX, Maximize, Minimize, Loader2, AlertCircle, RefreshCw, ChevronDown, ChevronLeft, ChevronRight, Radio } from 'lucide-react';",
  "import { Play, Pause, Volume2, VolumeX, Maximize, Minimize, Loader2, AlertCircle, RefreshCw, ChevronDown, ChevronLeft, ChevronRight, Radio, Ratio } from 'lucide-react';"
);

// 2. Add aspectRatioMode state inside component
const stateTarget = "const [zapBuffer, setZapBuffer] = useState<string>('');";
const stateRepl = `const [zapBuffer, setZapBuffer] = useState<string>('');
  const [aspectRatioMode, setAspectRatioMode] = useState<'fit' | 'zoom' | 'stretch'>('fit');
  const toggleAspectRatio = useCallback(() => {
    setAspectRatioMode(prev => {
      if (prev === 'fit') {
        toast.info('Zoom plein écran');
        return 'zoom';
      }
      if (prev === 'zoom') {
        toast.info('Format étiré');
        return 'stretch';
      }
      toast.info('Format original (ajusté)');
      return 'fit';
    });
  }, []);`;

vp = vp.replace(stateTarget, stateRepl);

// 3. Update CardContent and <video>
const videoTarget = `<CardContent className="p-0 relative">
          {/* Video Element */}
          <video
            ref={videoRef}
            className="w-full h-full aspect-video"
            poster={activeChannel?.logo || channel.logo}
            controls={false}
            autoPlay
            playsInline
            muted={isMuted}
            aria-label={\`Lecteur vidéo : \${channel.name}\`}
          />`;

const videoRepl = `<CardContent className="p-0 relative w-full aspect-video bg-black flex items-center justify-center overflow-hidden">
          {/* Video Element */}
          <video
            ref={videoRef}
            className={\`w-full h-full bg-black transition-all \${
              aspectRatioMode === 'fit' ? 'object-contain' : aspectRatioMode === 'zoom' ? 'object-cover' : 'object-fill'
            }\`}
            poster={activeChannel?.logo || channel.logo}
            controls={false}
            autoPlay
            playsInline
            muted={isMuted}
            aria-label={\`Lecteur vidéo : \${channel.name}\`}
          />`;

vp = vp.replace(videoTarget, videoRepl);

// 4. Add Ratio button in controls before Fullscreen
const fsTarget = `{/* Fullscreen */}
            <Button
              variant="ghost"
              size="sm"
              aria-label={isFullscreen ? "Quitter le plein écran" : "Plein écran"}`;

const fsRepl = `{/* Format d'image (redimensionnement) */}
            <Button
              variant="ghost"
              size="sm"
              aria-label={\`Format d'image : \${aspectRatioMode === 'fit' ? 'Format original' : aspectRatioMode === 'zoom' ? 'Zoom plein écran' : 'Étiré'}\`}
              onClick={toggleAspectRatio}
              className="text-white hover:bg-white/20 text-xs px-2 h-8"
              title="Changer le format (Ajusté / Zoom / Étiré)"
            >
              <Ratio className="h-4 w-4 mr-1" />
              <span className="hidden sm:inline">{aspectRatioMode === 'fit' ? 'Ajusté' : aspectRatioMode === 'zoom' ? 'Zoom' : 'Étiré'}</span>
            </Button>

            {/* Fullscreen */}
            <Button
              variant="ghost"
              size="sm"
              aria-label={isFullscreen ? "Quitter le plein écran" : "Plein écran"}`;

vp = vp.replace(fsTarget, fsRepl);

fs.writeFileSync('application/src/components/VideoPlayer.tsx', vp, 'utf8');
console.log('VideoPlayer.tsx updated successfully.');
