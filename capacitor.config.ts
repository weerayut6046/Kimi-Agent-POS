import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.kimiagent.pos",
  appName: "PumpPOS",
  webDir: "dist/public",
  backgroundColor: "#0b2854",
  loggingBehavior: "debug",
  server: {
    hostname: "localhost",
    androidScheme: "https",
    iosScheme: "capacitor",
  },
  android: {
    allowMixedContent: false,
  },
  ios: {
    contentInset: "never",
    preferredContentMode: "mobile",
  },
  plugins: {
    App: {
      disableBackButtonHandler: true,
    },
    SplashScreen: {
      launchShowDuration: 800,
      launchAutoHide: true,
      launchFadeOutDuration: 200,
      backgroundColor: "#0b2854",
      showSpinner: false,
    },
    StatusBar: {
      overlaysWebView: true,
      style: "DARK",
      backgroundColor: "#0b2854",
    },
  },
};

export default config;
