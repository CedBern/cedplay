import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.lecteur.iptv',
  appName: 'CedPlay',
  webDir: 'dist',
  loggingBehavior: 'none',
  server: {
    androidScheme: 'http',
    cleartext: true,
  },
};

export default config;
