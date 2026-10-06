import { expect, type Page } from '@playwright/test';

export const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'] as const;

/** Abre «Configuración» y espera a que el formulario haya cargado lo guardado. */
export async function abrirConfiguracion(page: Page): Promise<void> {
  const encabezado = page.getByRole('heading', { name: 'Configuración del negocio' });
  if (!(await encabezado.isVisible())) await page.getByRole('link', { name: 'Configuración', exact: true }).click();
  await expect(encabezado).toBeVisible();
  await expect(page.getByText('Cargando')).toBeHidden();
}

/** Carga un día: abierto de `desde` a `hasta`, o cerrado. */
export async function cargarDia(page: Page, dia: (typeof DIAS)[number], horas: { desde: string; hasta: string } | 'cerrado'): Promise<void> {
  const fila = page.locator('.horario-dia', { has: page.getByText(dia, { exact: true }) });
  const cerrado = fila.getByLabel('Cerrado');
  if (horas === 'cerrado') {
    await cerrado.check();
    return;
  }
  await cerrado.uncheck();
  await page.getByLabel(`${dia}, desde`).fill(horas.desde);
  await page.getByLabel(`${dia}, hasta`).fill(horas.hasta);
}

/** El mensaje de resultado de «Guardar». Hay otro `role=status` fijo («pendiente de revisión», de la clase `ayuda`): no es este. */
export const resultadoDeGuardar = (page: Page) => page.locator('p[role="status"]:not(.ayuda)');
