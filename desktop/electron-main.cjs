const { app, dialog } = require('electron');

import('./electron-runtime.mjs')
  .then(({ startElectronRuntime }) => startElectronRuntime(require('electron')))
  .catch((error) => {
    const report = () => {
      dialog.showErrorBox('CedPlay — démarrage impossible', error?.message || String(error));
      app.exit(1);
    };
    if (app.isReady()) report();
    else app.whenReady().then(report);
  });
