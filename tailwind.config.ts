import type { Config } from 'tailwindcss'
import animate from 'tailwindcss-animate'

const config: Config = {
  darkMode: ['class'],
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // ── Background layers (from tokens.json) ──────────────────
        'bg-base':    'var(--color-bg-base)',
        'bg-surface': 'var(--color-bg-surface)',
        'bg-panel':   'var(--color-bg-panel)',
        'bg-divider': 'var(--color-bg-divider)',

        // ── Text ──────────────────────────────────────────────────
        'text-primary':   'var(--color-text-primary)',
        'text-secondary': 'var(--color-text-secondary)',
        'text-muted':     'var(--color-text-muted)',

        // ── Accent ────────────────────────────────────────────────
        'accent-start': 'var(--color-accent-start)',
        'accent-end':   'var(--color-accent-end)',

        // ── States ────────────────────────────────────────────────
        'state-hover':   'var(--color-state-hover)',
        'state-active':  'var(--color-state-active)',
        'state-danger':  'var(--color-state-danger)',
        'state-warning': 'var(--color-state-warning)',
        'state-success': 'var(--color-state-success)',

        // ── Audio meter zones ─────────────────────────────────────
        'meter-safe':    'var(--color-meter-safe)',
        'meter-caution': 'var(--color-meter-caution)',
        'meter-clip':    'var(--color-meter-clip)',

        // ── shadcn/ui compatibility aliases ───────────────────────
        border:     'var(--color-bg-divider)',
        input:      'var(--color-bg-divider)',
        ring:       'var(--color-accent-start)',
        background: 'var(--color-bg-base)',
        foreground: 'var(--color-text-primary)',
        primary: {
          DEFAULT:    'var(--color-accent-start)',
          foreground: 'var(--color-text-primary)',
        },
        secondary: {
          DEFAULT:    'var(--color-bg-panel)',
          foreground: 'var(--color-text-secondary)',
        },
        destructive: {
          DEFAULT:    'var(--color-state-danger)',
          foreground: 'var(--color-text-primary)',
        },
        muted: {
          DEFAULT:    'var(--color-bg-surface)',
          foreground: 'var(--color-text-muted)',
        },
        accent: {
          DEFAULT:    'var(--color-bg-panel)',
          foreground: 'var(--color-text-primary)',
        },
        popover: {
          DEFAULT:    'var(--color-bg-panel)',
          foreground: 'var(--color-text-primary)',
        },
        card: {
          DEFAULT:    'var(--color-bg-surface)',
          foreground: 'var(--color-text-primary)',
        },
      },

      borderRadius: {
        panel:  'var(--radius-panel)',
        input:  'var(--radius-input)',
        button: 'var(--radius-button)',
        pill:   'var(--radius-pill)',
        lg:     'var(--radius)',
        md:     'calc(var(--radius) - 2px)',
        sm:     'calc(var(--radius) - 4px)',
      },

      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Consolas', 'monospace'],
      },

      fontSize: {
        'heading-xl':  ['24px', { lineHeight: '32px', fontWeight: '600' }],
        'heading-lg':  ['22px', { lineHeight: '30px', fontWeight: '500' }],
        'heading-md':  ['18px', { lineHeight: '26px', fontWeight: '500' }],
        'panel-title': ['15px', { lineHeight: '20px', fontWeight: '500' }],
        'body':        ['13px', { lineHeight: '18px', fontWeight: '400' }],
        'caption':     ['11px', { lineHeight: '16px', fontWeight: '400' }],
        'mono':        ['12px', { lineHeight: '18px', fontWeight: '400' }],
      },

      height: {
        menubar:    'var(--size-menubar-height)',
        toolbar:    'var(--size-toolbar-height)',
        statusbar:  'var(--size-statusbar-height)',
        'panel-hd': 'var(--size-panel-header)',
      },

      minWidth: {
        dock: 'var(--size-dock-min-width)',
      },

      boxShadow: {
        panel: '0 1px 2px rgba(0, 0, 0, 0.35)',
        float: '0 12px 32px rgba(0, 0, 0, 0.55)',
        glow:  '0 0 18px rgba(138, 92, 255, 0.35)',
        modal: '0 24px 64px rgba(0, 0, 0, 0.65)',
      },

      backgroundImage: {
        'accent-gradient':        'linear-gradient(135deg, #8A5CFF 0%, #FF4FD8 100%)',
        'accent-gradient-subtle': 'linear-gradient(135deg, rgba(138,92,255,0.15) 0%, rgba(255,79,216,0.15) 100%)',
      },

      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to:   { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to:   { height: '0' },
        },
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in-right': {
          from: { transform: 'translateX(100%)' },
          to:   { transform: 'translateX(0)' },
        },
        // Studio Mode transition animations (duration applied via inline style)
        'program-fade': {
          '0%':   { opacity: '1' },
          '50%':  { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'program-slide': {
          '0%':   { opacity: '1', transform: 'translateX(0)' },
          '35%':  { opacity: '0', transform: 'translateX(-6%)' },
          '65%':  { opacity: '0', transform: 'translateX(6%)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'program-wipe': {
          '0%':   { clipPath: 'inset(0 0% 0 0)' },
          '50%':  { clipPath: 'inset(0 100% 0 0)' },
          '100%': { clipPath: 'inset(0 0% 0 0)' },
        },
      },

      animation: {
        'accordion-down':  'accordion-down 0.2s ease-out',
        'accordion-up':    'accordion-up 0.2s ease-out',
        'fade-in':         'fade-in 0.15s ease-out',
        'slide-in-right':  'slide-in-right 0.2s ease-out',
      },
    },
  },
  plugins: [animate],
}

export default config
