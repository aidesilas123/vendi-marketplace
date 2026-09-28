import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.campus.marketplace',
  appName: 'Vendi',
  webDir: 'out',
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