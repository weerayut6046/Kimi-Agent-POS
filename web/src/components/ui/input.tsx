import * as React from "react";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-slate-200/90 h-11 w-full min-w-0 rounded-xl border bg-white/70 px-3 py-1 text-base shadow-[inset_0_1px_1px_rgba(15,23,42,0.025),0_1px_2px_rgba(15,23,42,0.02)] backdrop-blur-sm transition-[color,background-color,border-color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium hover:border-violet-300/70 hover:bg-white/90 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:h-10 md:text-sm",
        "focus-visible:border-violet-400 focus-visible:bg-white focus-visible:ring-violet-500/20 focus-visible:ring-[4px]",
        "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  );
}

export { Input };
