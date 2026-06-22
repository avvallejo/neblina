import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// En desarrollo el frontend llama a rutas relativas "/api/..." y Vite las
// reenvía a la API. Local: http://localhost:3000. En Docker se sobreescribe con
// VITE_API_PROXY=http://api:3000 (nombre del servicio en la red de Compose).
const API_TARGET = process.env.VITE_API_PROXY || 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
    },
  },
});
