// Shared design tokens for Avyn's renderer UI.
//
// Captured from the "Avyn App.dc.html" Claude Design mockup (see
// issues/prd-visual-design.md and issues/qa/017-theme-tokens-fonts-base-styling.md).
// Every re-skinning issue should import from here instead of hand-copying hex
// values, so the palette and type system stay in one place.
//
// Fonts are self-hosted (see global.css's @font-face rules and
// src/renderer/src/assets/fonts/) — these font-family strings assume the
// local @font-face registrations, not a Google Fonts CDN load.

export const colors = {
  // Backgrounds
  bg: '#0a0b0d',
  bgPanel: '#111318',
  bgCard: '#131519',
  bgInput: '#0d0f12',

  // Borders
  borderDefault: '#23262c',
  borderSubtle: '#1d2026',
  borderInput: '#33383f',
  borderMenu: '#2f333b',

  // Text
  textPrimary: '#eef0f2',
  textSecondary: '#9aa0aa',
  textTertiary: '#5c6169',
  textBody: '#c8ccd1',

  // Accent
  accent: '#7c5cff',
  accentHover: '#8f74ff',

  // Status (triage pill / post state)
  pending: '#e0a53c',
  approved: '#35c98d',
  declined: '#ef5c5c',

  // Connection states (bot/Discord link)
  notConnected: '#5c6169',
  connecting: '#4f9eea',
  connected: '#35c98d',
  connError: '#ef5c5c'
} as const

export const fonts = {
  // Space Grotesk — weights 500/600/700
  heading: "'Space Grotesk', sans-serif",
  // IBM Plex Sans — weights 400/500/600
  body: "'IBM Plex Sans', sans-serif",
  // IBM Plex Mono — weights 400/500
  mono: "'IBM Plex Mono', monospace"
} as const

export const theme = {
  colors,
  fonts
} as const

export type ThemeColors = typeof colors
export type ThemeFonts = typeof fonts
export type Theme = typeof theme
