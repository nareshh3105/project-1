// Typed constants derived from tokens.json
// These are the single source of truth for use in non-Tailwind contexts (canvas, Konva, charts)

export const COLOR = {
  bg: {
    base:    '#0B0B0F',
    surface: '#14141C',
    panel:   '#1C1C27',
    divider: '#2A2A3A',
  },
  text: {
    primary:   '#FFFFFF',
    secondary: '#B9B9C9',
    muted:     '#6C6C80',
  },
  accent: {
    start: '#8A5CFF',
    end:   '#FF4FD8',
  },
  state: {
    hover:   'rgba(255,255,255,0.06)',
    active:  'rgba(138,92,255,0.18)',
    danger:  '#FF5470',
    warning: '#FFC857',
    success: '#3DDC97',
  },
  meter: {
    safe:    '#3DDC97',
    caution: '#FFC857',
    clip:    '#FF5470',
  },
} as const

export const GRADIENT = {
  accent:       'linear-gradient(135deg, #8A5CFF 0%, #FF4FD8 100%)',
  accentSubtle: 'linear-gradient(135deg, rgba(138,92,255,0.15) 0%, rgba(255,79,216,0.15) 100%)',
} as const

export const RADIUS = {
  panel:  12,
  input:  8,
  button: 6,
  pill:   999,
} as const

export const SIZE = {
  menubarHeight:   32,
  toolbarHeight:   40,
  statusbarHeight: 24,
  panelHeader:     36,
  dockMinWidth:    200,
  iconSm: 16,
  iconMd: 20,
  iconLg: 24,
  buttonSm: 28,
  buttonMd: 32,
  buttonLg: 40,
} as const

export const FONT = {
  sans: 'Inter, system-ui, sans-serif',
  mono: 'JetBrains Mono, Consolas, monospace',
} as const

export const SHADOW = {
  panel: '0 1px 2px rgba(0,0,0,0.35)',
  float: '0 12px 32px rgba(0,0,0,0.55)',
  glow:  '0 0 18px rgba(138,92,255,0.35)',
  modal: '0 24px 64px rgba(0,0,0,0.65)',
} as const
