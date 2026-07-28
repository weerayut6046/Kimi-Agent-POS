import * as React from "react";

const MOBILE_BREAKPOINT = 768;
const getServerSnapshot = () => false;

export function useIsMobile(breakpoint = MOBILE_BREAKPOINT) {
  const mediaQuery = `(max-width: ${breakpoint - 1}px)`;
  const subscribe = React.useCallback(
    (onStoreChange: () => void) => {
      const query = window.matchMedia(mediaQuery);
      query.addEventListener("change", onStoreChange);
      return () => query.removeEventListener("change", onStoreChange);
    },
    [mediaQuery]
  );
  const getSnapshot = React.useCallback(
    () => window.matchMedia(mediaQuery).matches,
    [mediaQuery]
  );

  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
