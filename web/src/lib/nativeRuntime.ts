import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { Network, type ConnectionStatus } from "@capacitor/network";
import { StatusBar, Style } from "@capacitor/status-bar";
import { onlineManager } from "@tanstack/react-query";

export const NATIVE_NETWORK_EVENT = "pumppos:native-network";

let initialized = false;

function publishNetworkStatus(status: ConnectionStatus) {
  document.documentElement.dataset.networkStatus = status.connected
    ? "online"
    : "offline";
  onlineManager.setOnline(status.connected);
  window.dispatchEvent(
    new CustomEvent<ConnectionStatus>(NATIVE_NETWORK_EVENT, {
      detail: status,
    }),
  );
}

async function refreshNetworkStatus() {
  publishNetworkStatus(await Network.getStatus());
}

/**
 * Installs the small amount of native lifecycle behavior that a browser does
 * not provide reliably inside an Android/iOS WebView.
 */
export async function initializeNativeRuntime(): Promise<void> {
  if (initialized || !Capacitor.isNativePlatform()) return;
  initialized = true;

  document.documentElement.dataset.nativePlatform = Capacitor.getPlatform();

  await refreshNetworkStatus();
  await Network.addListener("networkStatusChange", publishNetworkStatus);

  await App.addListener("appStateChange", state => {
    if (state.isActive) void refreshNetworkStatus();
  });

  await App.addListener("backButton", event => {
    if (event.canGoBack) {
      window.history.back();
      return;
    }
    void App.minimizeApp();
  });

  await StatusBar.setStyle({ style: Style.Dark });
}
