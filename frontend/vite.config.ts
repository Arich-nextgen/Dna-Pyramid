import { defineConfig } from 'vite';
export default defineConfig({base:process.env.VITE_BROWSER_PYTHON==='true'?'/':'/app/',server:{proxy:{'/api':'http://127.0.0.1:8000','/healthz':'http://127.0.0.1:8000'}}});
