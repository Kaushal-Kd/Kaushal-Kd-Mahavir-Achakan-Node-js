/**
 * Tailwind config for the Wedding Rent System desktop app.
 *
 * STRICT DESIGN SYSTEM (requirements §77):
 *   - Allowed brand colors: WHITE + #0C6EE1 ONLY.
 *   - No gradient utilities.
 *   - Grayscale for neutrals (text, borders, muted).
 *   - Semantic colors (red/yellow/green) are allowed ONLY for status feedback.
 */

const BRAND = '#0C6EE1';
const BRAND_HOVER = '#0A5CC0';
const BRAND_ACTIVE = '#094FA5';
const BRAND_LIGHT = '#E8F1FD';

export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: BRAND,
          hover: BRAND_HOVER,
          active: BRAND_ACTIVE,
          light: BRAND_LIGHT,
          50: '#F3F8FE',
          100: BRAND_LIGHT,
          200: '#D0E2FA',
          300: '#A8CAF6',
          400: '#6AA4EF',
          500: BRAND,
          600: BRAND_HOVER,
          700: BRAND_ACTIVE,
        },
        surface: '#FFFFFF',
      },
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
        mono: [
          '"JetBrains Mono"',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Monaco',
          'Consolas',
          'monospace',
        ],
      },
      fontSize: {
        xs: ['0.75rem', { lineHeight: '1rem' }],
        sm: ['0.875rem', { lineHeight: '1.25rem' }],
        base: ['0.9375rem', { lineHeight: '1.4rem' }],
      },
      boxShadow: {
        card: '0 1px 2px rgba(0,0,0,0.04)',
        pop: '0 4px 12px rgba(0,0,0,0.08)',
      },
      borderRadius: {
        DEFAULT: '0.5rem',
      },
    },
  },
  corePlugins: {
    backgroundImage: false,
    gradientColorStops: false,
  },
  plugins: [],
};
