import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'app.strangertalk.chat', appName: 'CampusMate', webDir: 'dist',
  server: { hostname: process.env.CAPACITOR_HOSTNAME || 'localhost', androidScheme: 'https' },
  android: { backgroundColor: '#0F1020', allowMixedContent: false },
  plugins: {
    // MainActivity applies system/keyboard insets once, outside the WebView.
    SystemBars: { insetsHandling: 'disable', style: 'DARK' },
    SplashScreen: { launchShowDuration: 900, backgroundColor: '#0F1020', showSpinner: false, androidScaleType: 'CENTER_INSIDE' }
  }
};
export default config;
