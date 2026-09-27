import { useEffect } from "react";
import {
  DEFAULT_APP_TEMPLATE,
  normalizeAppTemplate,
  normalizeAppTheme,
} from "@contracts/settings";
import { applyAppTemplate, applyAppTheme } from "@/lib/appTheme";
import { trpc } from "@/providers/trpc";

export default function AppThemeSync() {
  const { data } = trpc.catalog.getSettings.useQuery();
  const template = normalizeAppTemplate(data?.app_template);
  const theme = normalizeAppTheme(data?.app_theme);

  useEffect(() => {
    applyAppTemplate(template);
    applyAppTheme(theme);
  }, [template, theme]);

  useEffect(() => {
    return () => {
      applyAppTemplate(DEFAULT_APP_TEMPLATE);
    };
  }, []);

  return null;
}
