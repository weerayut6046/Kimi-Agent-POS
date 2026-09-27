import type { ReactNode } from "react";
import { Inbox, type LucideIcon } from "lucide-react";
import { TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

type DataTableToolbarProps = {
  title: string;
  description?: string;
  count?: number;
  countLabel?: string;
  icon?: LucideIcon;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
};

/** Shared table header using the current POS actions and filters. */
export function DataTableToolbar({
  title,
  description,
  count,
  countLabel = "รายการ",
  icon: Icon,
  actions,
  children,
  className,
}: DataTableToolbarProps) {
  return (
    <div
      data-slot="data-table-toolbar"
      className={cn("min-w-0 space-y-4", className)}
    >
      <div
        data-slot="data-table-header"
        className="flex flex-wrap items-start justify-between gap-3"
      >
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            {Icon && (
              <Icon
                className="size-5 shrink-0 text-primary"
                aria-hidden="true"
              />
            )}
            <h2
              data-slot="data-table-title"
              className="font-heading text-base font-semibold text-foreground"
            >
              {title}
            </h2>
            {count !== undefined && (
              <span
                data-slot="data-table-count"
                className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium tabular-nums text-muted-foreground"
              >
                {count.toLocaleString("th-TH")} {countLabel}
              </span>
            )}
          </div>
          {description && (
            <p className="text-sm leading-6 text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {actions && (
          <div
            data-slot="data-table-actions"
            className="flex shrink-0 flex-wrap items-center gap-2"
          >
            {actions}
          </div>
        )}
      </div>
      {children && (
        <div
          data-slot="data-table-filters"
          className="flex min-w-0 flex-wrap items-center gap-3"
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function DataTableEmpty({
  colSpan,
  message,
  icon: Icon = Inbox,
}: {
  colSpan: number;
  message: string;
  icon?: LucideIcon;
}) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="whitespace-normal text-center">
        <div
          data-slot="table-empty"
          role="status"
          className="flex flex-col items-center gap-3 px-4 py-8 text-sm text-muted-foreground"
        >
          <span className="grid size-12 place-items-center rounded-xl bg-muted">
            <Icon className="size-6" aria-hidden="true" />
          </span>
          <span>{message}</span>
        </div>
      </TableCell>
    </TableRow>
  );
}
