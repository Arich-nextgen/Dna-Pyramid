import { defineConfig } from 'vite';

const browserPython = process.env.VITE_BROWSER_PYTHON === 'true';
const base = process.env.VITE_APP_BASE ?? (browserPython ? '/' : '/app/');

export default defineConfig({
  base,
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8000',
      '/healthz': 'http://127.0.0.1:8000',
    },
  },
});
