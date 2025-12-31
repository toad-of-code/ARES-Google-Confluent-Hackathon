/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        sciFiTeal: '#00fff2',
        sciFiDark: '#0a0a12',
        panelBg: '#12121a',
        safeGreen: '#00ff41',
        dangerRed: '#ff2a2a',
      },
      fontFamily: {
        mono: ['"Fira Code"', 'monospace'], 
      },
    },
  },
  plugins: [],
}