import {
  normalizeAppTemplate,
  normalizeAppTheme,
  type AppTemplateId,
  type AppThemeId,
} from "@contracts/settings";

export function applyAppTemplate(value: unknown): AppTemplateId {
  const template = normalizeAppTemplate(value);
  document.documentElement.dataset.posTemplate = template;
  return template;
}

export function applyAppTheme(value: unknown): AppThemeId {
  const theme = normalizeAppTheme(value);
  document.documentElement.dataset.posTheme = theme;
  return theme;
}
