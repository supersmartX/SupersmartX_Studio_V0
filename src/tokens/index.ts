/**
 * SupersmartX Studio — Design Tokens
 *
 * Canonical source of truth for all visual design values.
 * Components MUST reference these tokens instead of hardcoded values.
 *
 * Convention:
 *   Color.Primary       → semantic color
 *   Text.Heading        → typography style
 *   Space.16            → spacing scale (px value)
 *   Radius.12           → border radius (px value)
 *   Elevation.Modal     → shadow preset
 *   Icon.Sm             → icon size
 *   Motion.Duration.Fast → animation timing
 *   Layer.Modal         → z-index
 */

// ─── Color ──────────────────────────────────────────────────────────────────

export const Color = {
  // Canvas (backgrounds)
  Canvas: {
    Base:    '#09090B',
    Surface: '#111113',
    Elevated:'#18181B',
    Overlay: '#27272A',
    Subtle:  '#2E2E32',
  },

  // Border
  Border: {
    Subtle:   '#1C1C1F',
    Default:  '#27272A',
    Strong:   '#3F3F46',
  },

  // Text
  Text: {
    Primary:   '#FAFAFA',
    Secondary: '#A1A1AA',
    Muted:     '#52525B',
  },

  // Accent (brand)
  Accent: {
    Base:   '#7C3AED',
    Hover:  '#8B5CF6',
    Dark:   '#6D28D9',
    Muted:  'rgba(124, 58, 237, 0.12)',
  },

  // Semantic
  Success:  '#22C55E',
  Warning:  '#F59E0B',
  Error:    '#EF4444',
  Recording:'#EF4444',

  // Input
  Input: '#1A1A1A',

  // Brand
  Discord:      '#5865F2',
  DiscordHover: '#4752C4',
  Coffee:       '#FFDD00',
  CoffeeHover:  '#FFEA4D',
  GoogleBlue:   '#4285F4',
  GoogleGreen:  '#34A853',
  GoogleYellow: '#FBBC05',
  GoogleRed:    '#EA4335',
} as const;

// ─── Typography ─────────────────────────────────────────────────────────────

export const Text = {
  // Display (hero / page headings)
  Display: {
    Size:       '3rem',      // 48px
    Weight:     '800',
    lineHeight: '1.1',
    tracking:   '-0.02em',
  },

  // Heading 1
  H1: {
    Size:       '1.875rem',  // 30px
    Weight:     '700',
    lineHeight: '1.2',
    tracking:   '-0.01em',
  },

  // Heading 2
  H2: {
    Size:       '1.5rem',    // 24px
    Weight:     '600',
    lineHeight: '1.3',
    tracking:   '-0.005em',
  },

  // Heading 3
  H3: {
    Size:       '1.125rem',  // 18px
    Weight:     '600',
    lineHeight: '1.4',
    tracking:   '0',
  },

  // Body (default)
  Body: {
    Size:       '0.875rem',  // 14px
    Weight:     '400',
    lineHeight: '1.5',
    tracking:   '0',
  },

  // Body Small
  BodySm: {
    Size:       '0.8125rem', // 13px
    Weight:     '400',
    lineHeight: '1.5',
    tracking:   '0',
  },

  // Caption
  Caption: {
    Size:       '0.75rem',   // 12px
    Weight:     '400',
    lineHeight: '1.4',
    tracking:   '0',
  },

  // Overline (labels, badges)
  Overline: {
    Size:       '0.6875rem', // 11px
    Weight:     '500',
    lineHeight: '1.4',
    tracking:   '0.02em',
  },

  // Micro (tiny labels, kbd)
  Micro: {
    Size:       '0.625rem',  // 10px
    Weight:     '500',
    lineHeight: '1.3',
    tracking:   '0.03em',
  },

  // Nano (absolute smallest)
  Nano: {
    Size:       '0.5625rem', // 9px
    Weight:     '500',
    lineHeight: '1.3',
    tracking:   '0.04em',
  },
} as const;

// ─── Spacing ────────────────────────────────────────────────────────────────
// 4px base grid. All values in px.

export const Space = {
  0:   0,
  2:   2,
  4:   4,
  6:   6,
  8:   8,
  10:  10,
  12:  12,
  14:  14,
  16:  16,
  20:  20,
  24:  24,
  28:  28,
  32:  32,
  40:  40,
  48:  48,
  56:  56,
  64:  64,
  80:  80,
  96:  96,
} as const;

// Named aliases for common usage
export const Spacing = {
  /** 0px */
  None:    Space[0],
  /** 2px — tight inset, icon padding */
  '3xs':   Space[2],
  /** 4px — micro gap, inline spacing */
  '2xs':   Space[4],
  /** 6px — compact gap */
  xs:      Space[6],
  /** 8px — small gap, button padding */
  sm:      Space[8],
  /** 10px — input vertical padding */
  md:      Space[10],
  /** 12px — card padding, section gap */
  lg:      Space[12],
  /** 16px — standard section padding */
  xl:      Space[16],
  /** 20px — medium section padding */
  '2xl':   Space[20],
  /** 24px — large section padding */
  '3xl':   Space[24],
  /** 32px — page-level padding */
  '4xl':   Space[32],
  /** 40px — large gap */
  '5xl':   Space[40],
  /** 48px — hero spacing */
  '6xl':   Space[48],
  /** 64px — section dividers */
  '7xl':   Space[64],
  /** 80px — major section spacing */
  '8xl':   Space[80],
} as const;

// ─── Radius ─────────────────────────────────────────────────────────────────
// Border radius tokens. Values in px.

export const Radius = {
  /** 0px — no radius */
  None:  0,
  /** 2px — subtle rounding (kbd, small badges) */
  XS:    2,
  /** 4px — focus ring */
  SM:    4,
  /** 6px — small elements (badges, tags, chips) */
  MD:    6,
  /** 8px — buttons, inputs, nav items */
  LG:    8,
  /** 12px — cards, modals, panels */
  XL:    12,
  /** 16px — large cards, hero containers */
  '2XL': 16,
  /** 9999px — full rounding (pills, circles) */
  Full:  9999,
} as const;

// ─── Elevation (Shadows) ───────────────────────────────────────────────────

export const Elevation = {
  /** No shadow */
  None: 'none',
  /** Subtle lift (cards at rest) */
  SM:   '0 1px 2px 0 rgba(0, 0, 0, 0.3)',
  /** Medium lift (hovered cards, dropdowns) */
  MD:   '0 4px 6px -1px rgba(0, 0, 0, 0.4), 0 2px 4px -2px rgba(0, 0, 0, 0.3)',
  /** High lift (tooltips, popovers) */
  LG:   '0 10px 15px -3px rgba(0, 0, 0, 0.5), 0 4px 6px -4px rgba(0, 0, 0, 0.4)',
  /** Very high lift (toast, floating panels) */
  XL:   '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.4)',
  /** Maximum lift (modals, overlays) */
  '2XL':'0 25px 50px -12px rgba(0, 0, 0, 0.6)',
  /** Accent glow */
  Glow: '0 0 20px rgba(124, 58, 237, 0.3)',
  /** Recording glow */
  GlowRecording: '0 0 20px rgba(239, 68, 68, 0.3)',
} as const;

// ─── Icon Sizes ─────────────────────────────────────────────────────────────

export const Icon = {
  /** 12px — inline badges, tiny indicators */
  XS:    12,
  /** 14px — compact UI, small buttons */
  SM:    14,
  /** 16px — default icon size, buttons, nav */
  MD:    16,
  /** 18px — prominent icons */
  LG:    18,
  /** 20px — feature icons, transport controls */
  XL:    20,
  /** 24px — hero icons, large buttons */
  '2XL': 24,
  /** 32px — empty states, placeholders */
  '3XL': 32,
  /** 40px — feature callouts */
  '4XL': 40,
  /** 48px — onboarding, welcome */
  '5XL': 48,
} as const;

// ─── Motion ─────────────────────────────────────────────────────────────────

export const Motion = {
  Duration: {
    /** 100ms — micro-interactions (hover, focus) */
    Instant: '100ms',
    /** 150ms — fast transitions (color, opacity) */
    Fast:    '150ms',
    /** 200ms — standard transitions (scale, slide) */
    Normal:  '200ms',
    /** 250ms — moderate transitions (drawer slide) */
    Slow:    '250ms',
    /** 300ms — deliberate transitions (progress, camera) */
    Slower:  '300ms',
    /** 500ms — page-level transitions (modal backdrop) */
    Slowest: '500ms',
  },

  Easing: {
    /** Standard ease-out */
    Default:       'cubic-bezier(0.16, 1, 0.3, 1)',
    /** Smooth deceleration */
    EaseOut:       'ease-out',
    /** Smooth acceleration */
    EaseIn:        'ease-in',
    /** Smooth both directions */
    EaseInOut:     'ease-in-out',
    /** Spring-like overshoot */
    Spring:        'cubic-bezier(0.34, 1.56, 0.64, 1)',
    /** Linear (no easing) */
    Linear:        'linear',
  },
} as const;

// ─── Layer (Z-Index) ───────────────────────────────────────────────────────
// Named z-index tokens to prevent magic numbers.

export const Layer = {
  /** In-page overlays (badges, timers, small indicators) */
  Base:    0,
  /** In-page overlays (badges, timers) */
  Overlay: 10,
  /** Bottom nav (mobile) */
  Nav:     20,
  /** Sticky header */
  Header:  30,
  /** Tooltips, countdown, focal guide */
  Float:   50,
  /** Standard modals */
  Modal:   100,
  /** Side panel drawers */
  Drawer:  150,
  /** Welcome / onboarding modal (above modals) */
  Onboard: 200,
  /** Toast notifications (always on top) */
  Toast:   300,
} as const;

// ─── Breakpoints (reference only — Tailwind handles responsive) ─────────────

export const Breakpoint = {
  SM:  '640px',
  MD:  '768px',
  LG:  '1024px',
  XL:  '1280px',
  '2XL':'1536px',
} as const;

// ─── Min-Size (touch targets) ──────────────────────────────────────────────

export const TouchTarget = {
  /** Minimum 44×44px for WCAG 2.5.5 */
  Min: 44,
  /** Comfortable 48×48px */
  Comfortable: 48,
} as const;
