import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      position="top-right"
      gap={10}
      offset={16}
      mobileOffset={12}
      toastOptions={{
        duration: 4500,
        classNames: {
          toast:
            "!rounded-2xl !border-white/80 !bg-white/95 !p-4 !text-slate-800 !shadow-[0_18px_60px_rgba(15,23,42,0.18)] !ring-1 !ring-slate-200/70 !backdrop-blur-xl",
          title: "!text-sm !font-bold !text-slate-900",
          description: "!text-sm !leading-5 !text-slate-600",
          actionButton: "!rounded-lg !font-semibold",
          cancelButton: "!rounded-lg !font-semibold",
          closeButton:
            "!border-slate-200 !bg-white !text-slate-500 !shadow-sm hover:!text-slate-900",
        },
      }}
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
