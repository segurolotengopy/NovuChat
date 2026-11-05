/**
 * LA BARRERA DE CÓDIGO `rrSeguro` de Rubén (revisión del PR #795). NEGANDO: todo texto que sale al cliente pasa por ella, así que además de negar ser una IA y de afirmar un pago, NUNCA dice
 * «sin pastillas», «curar», «desde la primera noche», «garantizado» (salud) ni «simulado» (el cobro de este flujo es REAL). Y el aviso a Rubén no reenvía el texto del cliente en
 * `sin_configuracion` ni en `qr_no_disponible`. Los ángulos de las campañas (dato) pasan los filtros de la redacción.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cargarLibrerias } from './librerias';
import { ANA, crear, hablar, mTexto, panelOk } from './mundo';

const L = cargarLibrerias('rrSeguro, rrNorm, rrExtraRedaccion, RR_SALUDO_MINIMO') as { rrSeguro: (t: string) => string; rrNorm: (t: string) => string; rrExtraRedaccion: (t: string, n: string, c?: object) => string; RR_SALUDO_MINIMO: string };

describe('rrSeguro: la salud y el cobro real viven también en la barrera de código', () => {
  it('NEGADOS: cada frase cae al mínimo', () => {
    for (const x of ['Duerme sin pastillas desde hoy.', 'Esto cura el insomnio.', 'Vas a dormir desde la primera noche.', 'Te garantizamos buenas noches.', 'Tu cobro simulado quedó listo.', 'Sin medicamentos y sin dudas.']) expect(L.rrSeguro(x), x).toBe(L.RR_SALUDO_MINIMO);
  });
  it('POSITIVOS: lo legítimo pasa tal cual (garantía no es garantizar; «accura» no es «cura»)', () => {
    for (const x of ['Sobre garantía o devolución, eso lo responde Rubén directamente.', 'Es un método práctico de 14 eslabones.']) expect(L.rrSeguro(x), x).toContain(x.slice(0, 20));
  });
});

describe('el ángulo de la portada es una instrucción que los filtros de redacción no rechazan', () => {
  const dir = dirname(fileURLToPath(import.meta.url));
  const datos = JSON.parse(readFileSync(join(dir, '../../../scripts/datos/rroca-ruben/campanas-rroca-ruben.json'), 'utf8')) as { anuncios: Array<{ id: string; angulo: string }> };
  it('ningún ángulo menciona lo que el filtro del modelo prohíbe (bono, pack, paquete)', () => {
    for (const a of datos.anuncios) expect(a.angulo, a.id).not.toMatch(/\b(bonos?|pack|paquete)\b/i);
    const portada = datos.anuncios.find((a) => a.id === 'portada-del-libro')!;
    expect(L.rrExtraRedaccion(portada.angulo, L.rrNorm(portada.angulo), {})).not.toMatch(/oferta_fuera_del_codigo/);
  });
});

describe('el aviso a Rubén no reenvía el texto del cliente donde no hace falta', () => {
  it('sin configuración y sin opciones de compra: el aviso no trae el mensaje del cliente', () => {
    const w = crear({ panel: 'cae' });
    const t = hablar(w, ANA, mTexto('ESTE-TEXTO-NO-DEBE-VIAJAR quiero comprar'));
    expect(t.avisos.length).toBeGreaterThan(0);
    for (const a of t.avisos) expect(a.cuerpo).not.toContain('ESTE-TEXTO-NO-DEBE-VIAJAR');
    const v = crear({ panel: panelOk({ catalogo: [] }) });
    const u = hablar(v, ANA, mTexto('ESTE-TEXTO-NO-DEBE-VIAJAR quiero comprar'));
    for (const a of u.avisos) expect(a.cuerpo).not.toContain('ESTE-TEXTO-NO-DEBE-VIAJAR');
  });
});
