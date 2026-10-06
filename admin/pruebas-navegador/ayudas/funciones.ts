import type { Page } from '@playwright/test';

/**
 * Simula UNA Function llamable (`httpsCallable`) para probar cómo reacciona la PANTALLA a lo que contesta el servidor. No prueba la
 * Function (esa tiene sus propias pruebas): no hay emulador de Functions en esta suite. Devuelve lo que la pantalla le mandó
 * (el cuerpo de la llamada), para comprobar qué datos envió.
 */
export async function simularFuncion(
  page: Page,
  nombre: string,
  contestar: { resultado: unknown } | { estado: number; error: { message: string; status: string } },
): Promise<{ llamadas: unknown[] }> {
  const llamadas: unknown[] = [];
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
  await page.route(new RegExp(`/${nombre}$`), async (ruta) => {
    const peticion = ruta.request();
    if (peticion.method() === 'OPTIONS') { await ruta.fulfill({ status: 204, headers: cors }); return; }
    llamadas.push((peticion.postDataJSON() as { data?: unknown } | null)?.data);
    if ('resultado' in contestar) await ruta.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ result: contestar.resultado }) });
    else await ruta.fulfill({ status: contestar.estado, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ error: contestar.error }) });
  });
  return { llamadas };
}
