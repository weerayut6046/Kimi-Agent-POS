import { useEffect, useState, type ComponentType } from "react";

type DeferredToasterProps = {
  richColors?: boolean;
  closeButton?: boolean;
};

export default function DeferredToaster(props: DeferredToasterProps) {
  const [Toaster, setToaster] =
    useState<ComponentType<DeferredToasterProps> | null>(null);

  useEffect(() => {
    let active = true;
    const loadToaster = () => {
      window.removeEventListener("pointerdown", loadToaster);
      window.removeEventListener("keydown", loadToaster);
      void import("@/components/ui/sonner").then(module => {
        if (active) {
          setToaster(() => module.Toaster);
        }
      });
    };

    window.addEventListener("pointerdown", loadToaster, { once: true });
    window.addEventListener("keydown", loadToaster, { once: true });
    return () => {
      active = false;
      window.removeEventListener("pointerdown", loadToaster);
      window.removeEventListener("keydown", loadToaster);
    };
  }, []);

  return Toaster ? <Toaster {...props} /> : null;
}
