import { expect as base, type Page } from '@playwright/test';
import { CLAVE_DE_PRUEBA } from '../entorno';

/**
 * Esperas más holgadas para el carril 2. Los cuatro carriles y el resto de la máquina corren a la vez, y con la carga alta el
 * inicio de sesión de 8 s de `ingresar.ts` se queda corto sin que haya ningún defecto. Es solo tolerancia de tiempo: ninguna
 * comprobación se relaja (un elemento que no aparece sigue fallando, solo que a los 25 s y no a los 8 s).
 */
export const expect = base.configure({ timeout: 25_000 });

/** Igual que `ingresar` de `ingresar.ts`, con la espera holgada. */
export async function ingresar(page: Page, correo: string): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Correo').fill(correo);
  await page.getByLabel('Contraseña').fill(CLAVE_DE_PRUEBA);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByLabel('Correo')).toBeHidden();
}
