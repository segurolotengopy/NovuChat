import { expect, type Page } from '@playwright/test';
import { CLAVE_DE_PRUEBA } from '../entorno';

/**
 * Entra a la consola con correo y contraseña (el camino de los comercios; el de Google no se automatiza).
 * `esperaMs` alarga la espera de la salida de la pantalla de ingreso (8 s por omisión) para las corridas con la máquina cargada.
 */
export async function ingresar(page: Page, correo: string, esperaMs = 8_000): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Correo').fill(correo);
  await page.getByLabel('Contraseña').fill(CLAVE_DE_PRUEBA);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByLabel('Correo')).toBeHidden({ timeout: esperaMs });
}
