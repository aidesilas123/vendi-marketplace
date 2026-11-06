import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.vendi.app',
  appName: 'Vendi',
  webDir: 'out',
  server: {
    errorPath: 'error.html',
  },
  plugins: {
    StatusBar: {
      overlaysWebView: true,
    },
    SystemBars: {
      style: 'DEFAULT',
    },
  },
};

export default config;