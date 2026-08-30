import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // Sin sourcemaps en producción: no se publica el código original del panel.
    sourcemap: false,
    target: 'es2022',
  },
  server: {
    port: 5230,
    strictPort: true,
    // MODO DE SONDEO, para máquinas donde el kernel llegó al límite de
    // INSTANCIAS de inotify. Sin esto Vite muere al arrancar con
    // «ENOSPC: System limit for number of file watchers reached», que es el
    // mismo fallo que tumba a `firebase emulators:start` (ver admin/LEEME.md).
    //
    // El sondeo no usa inotify: relee los archivos cada `interval`. Gasta algo
    // más de CPU y por eso NO está activo por defecto. Se enciende con
    // `VITE_SONDEO=true`, que es lo que hace `pnpm web:dev:sondeo`.
    //
    // Es un rodeo, no el arreglo. El arreglo lo hace Andres con sudo.
    ...(process.env['VITE_SONDEO'] === 'true'
      ? { watch: { usePolling: true, interval: 400 } }
      : {}),
  },
});
