const fs = require('fs');

let vp = fs.readFileSync('application/src/components/VideoPlayer.tsx', 'utf8');

// 1. Insert aspectRatioMode state
const stateTarget = "const [zapBuffer, setZapBuffer] = useState('');";
const stateRepl = `const [zapBuffer, setZapBuffer] = useState('');
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

if (!vp.includes('const [aspectRatioMode, setAspectRatioMode]')) {
  vp = vp.replace(stateTarget, stateRepl);
}

// 2. Update CardContent and <video>
const videoTarget = 'className="w-full h-full aspect-video"';
const videoRepl = 'className={`w-full h-full bg-black transition-all ${aspectRatioMode === \'fit\' ? \'object-contain\' : aspectRatioMode === \'zoom\' ? \'object-cover\' : \'object-fill\'}`}';

if (vp.includes(videoTarget)) {
  vp = vp.replace(videoTarget, videoRepl);
  vp = vp.replace('<CardContent className="p-0 relative">', '<CardContent className="p-0 relative w-full aspect-video bg-black flex items-center justify-center overflow-hidden">');
}

fs.writeFileSync('application/src/components/VideoPlayer.tsx', vp, 'utf8');
console.log('Done!');
