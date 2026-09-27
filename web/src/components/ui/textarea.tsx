import * as React from "react";

import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "placeholder:text-muted-foreground/75 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 flex field-sizing-content min-h-24 w-full resize-y rounded-xl border border-input bg-background/80 px-3.5 py-3 text-base leading-6 shadow-[inset_0_1px_1px_rgba(15,39,52,0.025),0_1px_2px_rgba(15,39,52,0.035)] transition-[color,background-color,border-color,box-shadow] duration-150 outline-none hover:border-primary/45 hover:bg-card focus-visible:border-primary focus-visible:bg-card focus-visible:ring-[4px] focus-visible:ring-primary/12 focus-visible:shadow-[0_8px_22px_rgba(15,39,52,0.08)] disabled:cursor-not-allowed disabled:bg-muted/60 disabled:opacity-60 md:text-sm",
        className
      )}
      {...props}
    />
  );
}

export { Textarea };
