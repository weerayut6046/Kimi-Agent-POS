import * as React from "react";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "file:text-foreground placeholder:text-muted-foreground/75 selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input h-11 w-full min-w-0 rounded-xl border bg-background/80 px-3.5 py-2 text-base shadow-[inset_0_1px_1px_rgba(15,39,52,0.025),0_1px_2px_rgba(15,39,52,0.035)] transition-[color,background-color,border-color,box-shadow] duration-150 outline-none file:mr-3 file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-semibold hover:border-primary/45 hover:bg-card disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted/60 disabled:opacity-60 md:text-sm [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-60",
        "focus-visible:border-primary focus-visible:bg-card focus-visible:ring-primary/12 focus-visible:ring-[4px] focus-visible:shadow-[0_8px_22px_rgba(15,39,52,0.08)]",
        "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  );
}

export { Input };
