export interface DesktopUpdateEnvironment {
  isPackaged: boolean;
  isPortable: boolean;
  isWindowsStore: boolean;
}

/**
 * NSIS releases use electron-updater and GCS. Microsoft Store packages are
 * updated by the Store and must never launch the legacy updater.
 */
export function shouldStartLegacyUpdater(
  environment: DesktopUpdateEnvironment
): boolean {
  return (
    environment.isPackaged &&
    !environment.isPortable &&
    !environment.isWindowsStore
  );
}
