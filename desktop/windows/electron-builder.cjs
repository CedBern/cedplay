module.exports = {
  appId: 'fr.cedplay.desktop',
  productName: 'CedPlay',
  executableName: 'CedPlay',
  electronVersion: '45.3.2',
  asar: false,
  npmRebuild: false,
  publish: null,
  compression: 'normal',
  directories: {
    app: 'stage/app',
    output: '../../dist-desktop',
    buildResources: '.',
  },
  files: ['package.json', 'desktop/**', 'application/dist/**'],
  extraResources: [
    { from: 'stage/bin', to: 'bin', filter: ['ffmpeg.exe', 'ffprobe.exe'] },
    { from: 'stage/licenses', to: 'licenses', filter: ['**/*'] },
  ],
  win: {
    target: [
      { target: 'nsis', arch: ['x64'] },
      { target: 'zip', arch: ['x64'] },
    ],
    icon: '../cedplay.ico',
    // Pas de certificat Authenticode : signature désactivée, mais l'icône et les
    // métadonnées de CedPlay.exe restent appliquées (resedit, sans outil externe).
    // `signAndEditExecutable: false` laissait l'icône et le nom « Electron ».
    signExecutable: false,
    artifactName: 'CedPlay-${version}-Windows-${arch}.${ext}',
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowElevation: false,
    allowToChangeInstallationDirectory: true,
    deleteAppDataOnUninstall: false,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'CedPlay',
    runAfterFinish: false,
    installerLanguages: ['fr_FR'],
    artifactName: 'CedPlay-${version}-Windows-${arch}-Setup.${ext}',
  },
};
