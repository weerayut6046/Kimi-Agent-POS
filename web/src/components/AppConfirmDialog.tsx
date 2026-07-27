import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertTriangle, Check, Info, ShieldAlert, X } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

type ConfirmVariant = "danger" | "warning" | "info";

export type ConfirmOptions = {
  description: ReactNode;
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmVariant;
};

type ConfirmRequest = Required<
  Pick<ConfirmOptions, "title" | "confirmLabel" | "cancelLabel" | "variant">
> &
  Pick<ConfirmOptions, "description"> & {
    resolve: (confirmed: boolean) => void;
  };

type ConfirmDialogContextValue = {
  confirm: (options: ConfirmOptions | string) => Promise<boolean>;
};

const ConfirmDialogContext = createContext<ConfirmDialogContextValue | null>(
  null
);

const variantStyles: Record<
  ConfirmVariant,
  { icon: typeof AlertTriangle; iconClassName: string; actionClassName: string }
> = {
  danger: {
    icon: ShieldAlert,
    iconClassName:
      "border-red-100 bg-gradient-to-br from-red-50 to-orange-50 text-red-600 shadow-red-100/80",
    actionClassName:
      "bg-gradient-to-r from-red-600 to-rose-600 text-white shadow-lg shadow-red-200/70 hover:from-red-700 hover:to-rose-700 focus-visible:ring-red-500",
  },
  warning: {
    icon: AlertTriangle,
    iconClassName:
      "border-amber-100 bg-gradient-to-br from-amber-50 to-orange-50 text-amber-600 shadow-amber-100/80",
    actionClassName:
      "bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-lg shadow-amber-200/70 hover:from-amber-600 hover:to-orange-600 focus-visible:ring-amber-500",
  },
  info: {
    icon: Info,
    iconClassName:
      "border-blue-100 bg-gradient-to-br from-blue-50 to-cyan-50 text-blue-600 shadow-blue-100/80",
    actionClassName:
      "bg-gradient-to-r from-blue-600 to-cyan-600 text-white shadow-lg shadow-blue-200/70 hover:from-blue-700 hover:to-cyan-700 focus-visible:ring-blue-500",
  },
};

export function AppConfirmDialogProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const requestRef = useRef<ConfirmRequest | null>(null);

  const confirm = useCallback(
    (options: ConfirmOptions | string) =>
      new Promise<boolean>(resolve => {
        const normalized =
          typeof options === "string"
            ? { description: options }
            : options;
        const nextRequest: ConfirmRequest = {
          description: normalized.description,
          title: normalized.title ?? "ยืนยันการทำรายการ",
          confirmLabel: normalized.confirmLabel ?? "ยืนยัน",
          cancelLabel: normalized.cancelLabel ?? "ยกเลิก",
          variant: normalized.variant ?? "danger",
          resolve,
        };

        requestRef.current?.resolve(false);
        requestRef.current = nextRequest;
        setRequest(nextRequest);
      }),
    []
  );

  const settle = useCallback((confirmed: boolean) => {
    const currentRequest = requestRef.current;
    if (!currentRequest) return;

    requestRef.current = null;
    setRequest(null);
    currentRequest.resolve(confirmed);
  }, []);

  const value = useMemo(() => ({ confirm }), [confirm]);
  const styles = request ? variantStyles[request.variant] : variantStyles.danger;
  const Icon = styles.icon;

  return (
    <ConfirmDialogContext.Provider value={value}>
      {children}
      <AlertDialog
        open={request != null}
        onOpenChange={open => {
          if (!open) settle(false);
        }}
      >
        <AlertDialogContent className="overflow-y-auto border-white/80 bg-white/95 p-0 shadow-[0_32px_100px_rgba(15,23,42,0.28)] ring-1 ring-slate-200/70 backdrop-blur-2xl sm:max-w-[460px]">
          <div
            className={cn(
              "h-1.5 w-full",
              request?.variant === "warning"
                ? "bg-gradient-to-r from-amber-400 via-orange-500 to-amber-400"
                : request?.variant === "info"
                  ? "bg-gradient-to-r from-blue-500 via-cyan-400 to-blue-500"
                  : "bg-gradient-to-r from-red-500 via-rose-500 to-orange-400"
            )}
          />
          <div className="px-5 pb-5 pt-4 sm:px-7 sm:pb-7 sm:pt-5">
            <AlertDialogHeader className="items-center gap-3 text-center sm:items-start sm:text-left">
              <div
                className={cn(
                  "grid size-14 shrink-0 place-items-center rounded-2xl border shadow-lg",
                  styles.iconClassName
                )}
              >
                <Icon className="size-7" strokeWidth={2.2} />
              </div>
              <div className="space-y-1.5">
                <AlertDialogTitle className="font-heading text-xl font-bold tracking-tight text-slate-900">
                  {request?.title}
                </AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="whitespace-pre-line text-sm leading-6 text-slate-600">
                    {request?.description}
                  </div>
                </AlertDialogDescription>
              </div>
            </AlertDialogHeader>

            <AlertDialogFooter className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-2">
              <AlertDialogCancel
                className="m-0 min-h-11 rounded-xl border-slate-200 bg-white px-4 font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                onClick={() => settle(false)}
              >
                <X className="size-4" />
                {request?.cancelLabel}
              </AlertDialogCancel>
              <AlertDialogAction
                className={cn(
                  "min-h-11 rounded-xl border-0 px-4 font-semibold",
                  styles.actionClassName
                )}
                onClick={() => settle(true)}
              >
                <Check className="size-4" strokeWidth={2.5} />
                {request?.confirmLabel}
              </AlertDialogAction>
            </AlertDialogFooter>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmDialogContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAppConfirm() {
  const context = useContext(ConfirmDialogContext);
  if (!context) {
    throw new Error(
      "useAppConfirm must be used within AppConfirmDialogProvider"
    );
  }
  return context.confirm;
}
