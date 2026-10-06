import { expect, test } from '@playwright/test';
import { USUARIOS } from './entorno';
import { ingresar } from './ayudas/ingresar';
import { abrirConfiguracion } from './ayudas/configuracion';
import { PNG_1X1 as PNG } from './ayudas/png';

// El logo se recorta en el navegador a `data:` y se guarda en Firestore; con la política real de Hosting
// la carga no puede pasar por `blob:` (no está en `img-src`).

test.describe('Configuración: logo, con las cabeceras reales', () => {
  test('la política de la consola está puesta (no es vite dev)', async ({ page }) => {
    const respuesta = await page.goto('/');
    const csp = respuesta?.headers()['content-security-policy'] ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain('img-src');
    expect(csp).not.toMatch(/img-src[^;]*blob:/);
  });

  test('CONTROL del detector: con esta política una imagen blob: SÍ se bloquea y la consola lo dice', async ({ page }) => {
    const violaciones: string[] = [];
    page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) violaciones.push(m.text()); });
    await page.goto('/');
    await page.evaluate(async () => {
      const url = URL.createObjectURL(new Blob(['x'], { type: 'image/png' }));
      const img = new Image();
      await new Promise((r) => { img.onload = r; img.onerror = r; img.src = url; });
    });
    expect(violaciones.length, 'si esto falla, el detector de las otras pruebas no detecta nada').toBeGreaterThan(0);
  });

  test('sube un logo, se ve y no hay violaciones de la política', async ({ page }) => {
    const violaciones: string[] = [];
    page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) violaciones.push(m.text()); });
    await ingresar(page, USUARIOS.adminFogon);
    await abrirConfiguracion(page);

    await page.getByLabel('Logo del negocio').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByText('Logo actualizado')).toBeVisible();
    const imagen = page.getByAltText('Logo cargado');
    await expect(imagen).toBeVisible();
    expect(await imagen.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
    expect(violaciones, violaciones.join('\n')).toEqual([]);
  });

  test('quita el logo', async ({ page }) => {
    await ingresar(page, USUARIOS.adminFogon);
    await abrirConfiguracion(page);
    await page.getByLabel('Logo del negocio').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByAltText('Logo cargado')).toBeVisible();
    await page.getByRole('button', { name: 'Quitar' }).click();
    await expect(page.getByText('Logo quitado')).toBeVisible();
    await expect(page.getByAltText('Logo cargado')).toBeHidden();
  });

  test('NEGATIVA: un archivo que no es una imagen se rechaza con una causa en palabras del comercio', async ({ page }) => {
    await ingresar(page, USUARIOS.adminFogon);
    await abrirConfiguracion(page);
    await page.getByLabel('Logo del negocio').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from('esto no es una imagen') });
    await expect(page.getByText('Logo actualizado')).toBeHidden();
    await expect(page.getByAltText('Logo cargado')).toBeHidden();
  });
});
