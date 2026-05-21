// client/tailwind.config.js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Brand palette — deep teal + electric cyan + warm dark
        brand: {
          50: '#f0fdfb',
          100: '#ccfbf4',
          200: '#99f6ea',
          300: '#5eead8',
          400: '#2dd4bf',
          500: '#14b8a6',
          600: '#0d9488',
          700: '#0f766e',
          800: '#115e59',
          900: '#134e4a',
        },
        accent: {
          cyan: '#22d3ee',
          teal: '#2dd4bf',
          amber: '#fbbf24',
          rose: '#fb7185',
          violet: '#a78bfa',
        },
        dark: {
          950: '#040d0c',
          900: '#071a19',
          800: '#0d2421',
          700: '#122e2b',
          600: '#1a3d39',
          500: '#235550',
        },
      },
      fontFamily: {
        display: ['"Clash Display"', '"Space Grotesk"', 'sans-serif'],
        body: ['"DM Sans"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      animation: {
        'fade-in': 'fadeIn 0.4s ease forwards',
        'slide-up': 'slideUp 0.4s cubic-bezier(0.16,1,0.3,1) forwards',
        'slide-down': 'slideDown 0.3s cubic-bezier(0.16,1,0.3,1) forwards',
        'scale-in': 'scaleIn 0.3s cubic-bezier(0.16,1,0.3,1) forwards',
        'pulse-glow': 'pulseGlow 2s ease-in-out infinite',
        'blink-dot': 'blinkDot 1s ease-in-out infinite',
        'waveform': 'waveform 1.2s ease-in-out infinite',
        'float': 'float 3s ease-in-out infinite',
        'shimmer': 'shimmer 2s linear infinite',
      },
      keyframes: {
        fadeIn: { from: { opacity: 0 }, to: { opacity: 1 } },
        slideUp: { from: { opacity: 0, transform: 'translateY(20px)' }, to: { opacity: 1, transform: 'translateY(0)' } },
        slideDown: { from: { opacity: 0, transform: 'translateY(-10px)' }, to: { opacity: 1, transform: 'translateY(0)' } },
        scaleIn: { from: { opacity: 0, transform: 'scale(0.95)' }, to: { opacity: 1, transform: 'scale(1)' } },
        pulseGlow: { '0%,100%': { boxShadow: '0 0 20px rgba(34,211,238,0.3)' }, '50%': { boxShadow: '0 0 40px rgba(34,211,238,0.7)' } },
        blinkDot: { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.2 } },
        waveform: { '0%,100%': { transform: 'scaleY(0.4)' }, '50%': { transform: 'scaleY(1)' } },
        float: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-8px)' } },
        shimmer: { '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } },
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'mesh-dark': 'radial-gradient(at 40% 20%, hsla(180,100%,12%,1) 0px, transparent 50%), radial-gradient(at 80% 0%, hsla(189,100%,8%,1) 0px, transparent 50%), radial-gradient(at 0% 50%, hsla(174,100%,10%,1) 0px, transparent 50%)',
        'shimmer-gradient': 'linear-gradient(90deg, transparent 0%, rgba(34,211,238,0.1) 50%, transparent 100%)',
      },
      boxShadow: {
        'glow-sm': '0 0 10px rgba(34,211,238,0.2)',
        'glow': '0 0 20px rgba(34,211,238,0.3)',
        'glow-lg': '0 0 40px rgba(34,211,238,0.4)',
        'glow-rose': '0 0 20px rgba(251,113,133,0.4)',
        'inner-glow': 'inset 0 0 20px rgba(34,211,238,0.05)',
        'card': '0 1px 3px rgba(0,0,0,0.5), 0 8px 24px rgba(0,0,0,0.3)',
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
        '4xl': '2rem',
      },
    },
  },
  plugins: [],
};