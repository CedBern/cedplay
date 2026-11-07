const fs = require('fs');

let vp = fs.readFileSync('application/src/components/VideoPlayer.tsx', 'utf8');

const buttonCode = `            {/* Format d'image (redimensionnement) */}
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

            `;

if (!vp.includes('title="Changer le format (Ajusté / Zoom / Étiré)"')) {
  vp = vp.replace('{/* Fullscreen */}', buttonCode + '{/* Fullscreen */}');
  fs.writeFileSync('application/src/components/VideoPlayer.tsx', vp, 'utf8');
  console.log('Button added successfully');
} else {
  console.log('Already added');
}
