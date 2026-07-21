import * as React from "react";

import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "placeholder:text-muted-foreground aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 flex field-sizing-content min-h-20 w-full rounded-xl border border-slate-200/90 bg-white/70 px-3 py-2 text-base shadow-[inset_0_1px_1px_rgba(15,23,42,0.025)] backdrop-blur-sm transition-[color,background-color,border-color,box-shadow] outline-none hover:border-violet-300 hover:bg-white/90 focus-visible:border-violet-400 focus-visible:bg-white focus-visible:ring-[4px] focus-visible:ring-violet-500/20 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className
      )}
      {...props}
    />
  );
}

export { Textarea };
