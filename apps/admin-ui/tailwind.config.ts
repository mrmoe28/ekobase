import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Dark mode palette
        'dark-bg': '#1E1F20',
        'dark-sidebar': '#131314',
        'dark-surface': '#26272A',
        'dark-border': '#3C4043',
        'dark-text': '#E3E3E3',
        'dark-muted': '#9AA0A6',
        'dark-accent': '#A8C7FA',
        // Light mode palette
        'light-bg': '#FFFFFF',
        'light-sidebar': '#F0F4F9',
        'light-surface': '#F8F9FA',
        'light-border': '#E0E0E0',
        'light-text': '#202124',
        'light-muted': '#5F6368',
        'light-accent': '#1A73E8',
      },
      borderRadius: {
        card: '12px',
      },
      transitionDuration: {
        DEFAULT: '150ms',
      },
      transitionTimingFunction: {
        DEFAULT: 'ease',
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

export default config
