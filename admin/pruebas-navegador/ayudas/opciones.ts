import type { Page } from '@playwright/test';

/**
 * Abre el menú plegable «⋯ Opciones» del detalle de una conversación (Tomar/Devolver, No contactar, Bloquear, Abrir en WhatsApp,
 * Adjuntar, Grabar y sus textos de ayuda). Idempotente: solo hace clic si el <details> está cerrado.
 */
export async function abrirOpciones(page: Page): Promise<void> {
  const menu = page.locator('details.cv-opciones');
  await menu.waitFor({ state: 'attached' });
  if (!(await menu.evaluate((el) => (el as HTMLDetailsElement).open))) await menu.locator('summary').click();
}
