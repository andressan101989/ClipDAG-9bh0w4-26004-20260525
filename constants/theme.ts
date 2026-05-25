// ClipDAG Design System — Instagram/TikTok Modern Dark Theme
export const Colors = {
  // ── Base surfaces ──────────────────────────────────────────────────────────
  bg: '#0A0A0F',
  surface: '#111118',
  surfaceElevated: '#18181F',
  surfaceHighlight: '#21212C',
  overlay: 'rgba(10,10,15,0.85)',

  // ── Borders ────────────────────────────────────────────────────────────────
  border: '#2C2C3A',
  borderSubtle: '#1E1E28',
  borderHighlight: '#3D3D52',

  // ── Text ──────────────────────────────────────────────────────────────────
  textPrimary: '#F5F5F7',
  textSecondary: '#A0A0B8',
  textSubtle: '#5A5A72',
  textInverse: '#0A0A0F',
  textOnBrand: '#FFFFFF',

  // ── Brand / Accent — Purple-Blue-Pink gradient palette ────────────────────
  primary: '#7C5CFF',       // Violet — primary actions
  primaryDim: '#7C5CFF18',
  primaryGlow: '#7C5CFF44',
  primaryLight: '#A385FF',

  secondary: '#FF2D78',     // Hot pink — likes / social
  secondaryDim: '#FF2D7818',
  secondaryLight: '#FF6FA8',

  accent: '#00E5A0',        // Mint green — success / earnings
  accentDim: '#00E5A018',
  accentLight: '#4FFFC0',

  blue: '#2D9EFF',          // Sky blue — info / links
  blueDim: '#2D9EFF18',

  warning: '#FFB800',       // Amber — premium / gold
  warningDim: '#FFB80018',

  purple: '#B44FFF',        // Deep purple — special
  purpleDim: '#B44FFF18',

  // ── Semantic ──────────────────────────────────────────────────────────────
  success: '#00E5A0',
  error: '#FF3B5C',
  info: '#2D9EFF',

  // ── Gradient arrays (use with LinearGradient) ─────────────────────────────
  gradientBrand:    ['#7C5CFF', '#FF2D78'] as string[],
  gradientBrandSoft:['#7C5CFF44', '#FF2D7844'] as string[],
  gradientCool:     ['#2D9EFF', '#7C5CFF'] as string[],
  gradientEarn:     ['#00E5A0', '#2D9EFF'] as string[],
  gradientDark:     ['#18181F', '#0A0A0F'] as string[],
  gradientOverlay:  ['transparent', 'rgba(10,10,15,0.96)'] as string[],
  gradientCardTop:  ['rgba(10,10,15,0.6)', 'transparent'] as string[],
  gradientCardBottom: ['transparent', 'rgba(10,10,15,0.92)'] as string[],

  // Legacy aliases (keep existing code from breaking)
  primaryDim2: '#7C5CFF22',
};

export const Spacing = {
  xs:  4,
  sm:  8,
  md:  16,
  lg:  24,
  xl:  32,
  xxl: 48,
  xxxl: 64,
};

export const Radius = {
  xs:   4,
  sm:   8,
  md:   12,
  lg:   16,
  xl:   24,
  xxl:  32,
  full: 9999,
};

export const FontSize = {
  xs:     11,
  sm:     13,
  md:     15,
  lg:     17,
  xl:     20,
  xxl:    24,
  xxxl:   30,
  display: 38,
};

export const FontWeight = {
  regular:   '400' as const,
  medium:    '500' as const,
  semibold:  '600' as const,
  bold:      '700' as const,
  extrabold: '800' as const,
};

export const Shadow = {
  brand: {
    shadowColor: '#7C5CFF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 12,
  },
  pink: {
    shadowColor: '#FF2D78',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 8,
  },
  subtle: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 4,
  },
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
  },
  // Legacy alias
  glow: {
    shadowColor: '#7C5CFF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  pinkGlow: {
    shadowColor: '#FF2D78',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 6,
  },
};

export default { Colors, Spacing, Radius, FontSize, FontWeight, Shadow };
