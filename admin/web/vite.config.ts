import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // Sin sourcemaps en producción: no se publica el código original del panel.
    sourcemap: false,
    target: 'es2022',
  },
  server: { port: 5230, strictPort: true },
});
