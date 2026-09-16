// Settings persistence + threshold color logic.
// No DOM access except localStorage.

const STORAGE_KEY = "ugm-timer:settings:v1";

export const DEFAULT_SETTINGS = {
  thresholds: [
    { minutes: 15, color: "#f5c518", enabled: false },
    { minutes: 5, color: "#d02b2b", enabled: true },
    { minutes: 1, color: "#ff0000", enabled: false },
  ],
  baseColor: "#101418",
  defaultDurationMs: 30 * 60 * 1000,
  messageFontSize: 7, // vh
  flashOnZero: true,
  keepAwake: true,
  settingsVersion: 0,
};

function cloneDefaults() {
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return cloneDefaults();
    const parsed = JSON.parse(raw);
    // Merge with defaults so new fields introduced later don't break old saves.
    return { ...cloneDefaults(), ...parsed };
  } catch (err) {
    console.warn("Failed to load settings, using defaults.", err);
    return cloneDefaults();
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (err) {
    console.warn("Failed to save settings.", err);
  }
}

export function validateThreshold(minutes, color, existing = []) {
  const errors = [];
  if (existing.some((t) => t.minutes === minutes)) {
    errors.push("Duplicate threshold minutes.");
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
    errors.push("Color must be a hex value.");
  }
  return errors;
}

// Relative luminance (WCAG) to decide black or white foreground text.
export function readableForeground(hexColor) {
  const hex = hexColor.replace("#", "");
  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;

  const linear = (c) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const luminance =
    0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);

  return luminance > 0.5 ? "#000000" : "#ffffff";
}

// Pick the color for the given remaining time.
// Rule: sort thresholds descending by minutes, pick the LOWEST threshold
// whose minutes*60000 >= remaining (i.e. we've crossed into its window).
export function pickColor(settings, remainingMs) {
  const active = settings.thresholds
    .filter((t) => t.enabled)
    .slice()
    .sort((a, b) => a.minutes - b.minutes); // ascending

  let chosen = null;
  for (const t of active) {
    if (remainingMs <= t.minutes * 60 * 1000) {
      chosen = t;
      break;
    }
  }

  const bg = chosen ? chosen.color : settings.baseColor;
  const fg = readableForeground(bg);
  return { bg, fg };
}
