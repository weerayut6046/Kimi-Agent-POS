export type AssistantAction =
  | {
      kind: "navigate";
      label: string;
      path: string;
    }
  | {
      kind: "download_daily_report";
      label: string;
      date: string;
    }
  | {
      kind: "download_sales_range";
      label: string;
      from: string;
      to: string;
    };
