import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * COMPILACIÓN DE LA PÁGINA PÚBLICA DEL CATÁLOGO (SEGUNDO SITIO DE HOSTING).
 *
 * Es una segunda compilación, y no un segundo `input` de `vite.config.ts`,
 * por dos razones que importan:
 *
 *  1. SALE EN OTRA CARPETA (`dist-catalogo/`). Cada sitio de Hosting publica
 *     una carpeta entera; si las dos páginas salieran juntas en `dist/`, el
 *     sitio público serviría también los fragmentos de la consola —con el SDK
 *     de Firebase y el código de sesión— y T-37 (admin/SEGURIDAD.md) no habría
 *     separado nada: solo el nombre del dominio.
 *  2. SU ÚNICA ENTRADA ES `catalogo.html`, que importa `publico/entrada.tsx`.
 *     Lo que esa entrada no importa no existe en el paquete. Lo comprueban
 *     `pruebas/modulos/catalogo-web/sitio-publico.test.ts` (sobre el código) y
 *     `scripts/modulos/catalogo-web/verificar-sitio-publico.mjs` (sobre el paquete compilado, en CI).
 *
 * Sin variables `VITE_*`: la página no tiene nada que configurar por ambiente.
 * Habla con las Functions por rutas relativas (`/api/catalogo/...`) que el
 * propio sitio reescribe; la dirección de este sitio la conoce solo el servidor
 * (`SITIO_PUBLICO`).
 */
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist-catalogo',
    emptyOutDir: true,
    // Sin sourcemaps: no se publica el código original.
    sourcemap: false,
    target: 'es2022',
    rollupOptions: {
      input: resolve(import.meta.dirname, 'catalogo.html'),
    },
  },
});
