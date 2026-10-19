/**
 * «VENTA DIGITAL DE RUBÉN» (tenant rroca-ruben) — PR-5, LOS DATOS DEL NEGOCIO (`admin/scripts/datos/negocio-rroca-ruben.json`).
 *
 * Lo que esta suite niega: que el catálogo no sea el que lee el flujo (`rrCatalogo`: ids `pack-completo`, `libro-bonos`, `closer-ventas`, `videos-ia`; precios 60, 32, 20 y 25 Bs); que el
 * id de un ítem (que `cargar-negocio.mjs` saca del nombre) deje de coincidir; que el archivo traiga un secreto, un teléfono real o una cuenta; y que sea APLICABLE mientras tenga marcadores
 * `REEMPLAZAR_*` (la misma guardia de publicación lo niega). No toca Firestore: la carga real es del script con «sí» de Andres.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Flujo } from '../../lib/flujo';
// @ts-expect-error el armador es un .mjs sin tipos
import { guardiaDePublicacion } from '../../../../Flujos/experimental/rroca-ruben/construir.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const REPO = join(AQUI, '../../../..');
const NEGOCIO = join(REPO, 'admin/scripts/datos/negocio-rroca-ruben.json');
const RR = join(REPO, 'Flujos/experimental/rroca-ruben/src/lib');
const TEXTO = readFileSync(NEGOCIO, 'utf8');
type Item = { nombre: string; precio: number; moneda: string; activo: boolean; descripcion: string };
const D = JSON.parse(TEXTO) as { negocio: Record<string, unknown>; catalogo: Item[] };

/** Misma `idDe` que `cargar-negocio.mjs`: el identificador del ítem sale del nombre. */
const idDe = (nombre: string): string => nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// El código del flujo, tal cual se despliega (cobro + avisos + rr), para preguntarle a `rrCatalogo` con el catálogo que la consola mostraría.
const CODIGO = ['cobro.js', 'avisos.js', 'rr.js'].map((a) => readFileSync(join(RR, a), 'utf8')).join('\n');
// El código evaluado es el de los archivos del propio repositorio (src/lib), no una entrada externa: solo prueba.
// nosemgrep: devsecops.js-eval-prohibido
const L = new Function(CODIGO + '\nreturn { rrCatalogo, rrAhorro };')() as { rrCatalogo: (c: unknown) => Record<string, number>; rrAhorro: (c: Record<string, number>) => number | null };

const ESPERADO: Record<string, number> = { 'pack-completo': 60, 'libro-bonos': 32, 'closer-ventas': 20, 'videos-ia': 25 };

describe('negocio-rroca-ruben.json: el catálogo es el que espera el flujo', () => {
  it('tiene exactamente los 4 productos, con los ids que salen del nombre y los precios de Rubén', () => {
    expect(D.catalogo).toHaveLength(4);
    const porId = Object.fromEntries(D.catalogo.map((it) => [idDe(it.nombre), it.precio]));
    expect(porId).toEqual(ESPERADO);
  });

  it('moneda BOB en todo, ítems activos y precios numéricos positivos', () => {
    expect(D.negocio['moneda']).toBe('BOB');
    for (const it of D.catalogo) {
      expect(it.moneda).toBe('BOB');
      expect(it.activo).toBe(true);
      expect(typeof it.precio).toBe('number');
      expect(it.precio).toBeGreaterThan(0);
    }
  });

  it('`rrCatalogo` del flujo lee los 4 productos con esos precios (con el catálogo como lo sirve la consola: id + precio)', () => {
    const consola = { catalogo: D.catalogo.map((it) => ({ id: idDe(it.nombre), precio: it.precio })) };
    expect(L.rrCatalogo(consola)).toEqual({ pack: 60, libro: 32, closer: 20, videos: 25 });
    expect(L.rrAhorro(L.rrCatalogo(consola))).toBe(17);
  });

  it('negando: un id que cambia (por un nombre distinto) deja al producto fuera del catálogo del flujo', () => {
    const consola = { catalogo: D.catalogo.map((it) => ({ id: idDe(it.nombre === 'Pack completo' ? 'Pack total' : it.nombre), precio: it.precio })) };
    expect(L.rrCatalogo(consola)['pack']).toBeUndefined();
  });

  it('el tratamiento es «tu», sin voseo en los textos', () => {
    expect(D.negocio['tratamiento']).toBe('tu');
    expect(TEXTO).not.toMatch(/\b(vos|tenés|querés|podés|sos)\b/i);
  });

  it('declara lo que NO se sabe (garantía y devolución, factura, otros medios de pago, otro plazo de entrega)', () => {
    const no = (D.negocio['datosQueNoTenemos'] as string[]).join('|');
    for (const x of [/garant/, /factura/, /medios de pago/, /plazo de entrega/]) expect(no).toMatch(x);
  });

  it('DECISIONES DEL 19/10: horario abierto 24/7 (explícito, sin marcador), F4 desaparece (ningún dato de enlaces) y F5 es texto, no marcador', () => {
    const h = D.negocio['horarios'] as Record<string, string>;
    for (const dia of ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom']) expect(h[dia], dia).toBe('00:00-23:59');
    expect((D as unknown as { _pendiente: Record<string, string> })._pendiente['horarioDeRecepcion']).toBe('Abierto siempre (24/7)');
    // NovuChat no entrega enlaces: ninguna clave ni marcador de enlaces de entrega, en ninguna grafía.
    expect(TEXTO).not.toMatch(/enlacesDeEntrega|ENLACES_ENTREGA/i);
    expect(Object.keys((D as unknown as { _pendiente: object })._pendiente)).not.toContain('enlacesDeEntrega');
    // La garantía/devolución es un texto que pasa con el autor, no un marcador; y no promete.
    const pol = String(D.negocio['politicaCancelacion']);
    expect(pol).not.toMatch(/REEMPLAZAR_/);
    expect(pol).toMatch(/no las promete/);
    // El negocio no promete que el bot entregue ni que ya se envió.
    expect(String(D.negocio['instruccionesExtra'])).toMatch(/hasta en 24 horas/);
    expect(String(D.negocio['instruccionesExtra'])).toMatch(/nunca entrega ni envía enlaces/);
    expect(TEXTO).not.toMatch(/ya te lo enviamos/i);
  });
});

describe('negocio-rroca-ruben.json: repositorio público y marcadores', () => {
  it('no trae secretos, teléfonos reales, cuentas, enlaces de entrega ni secuencias largas de dígitos', () => {
    expect(TEXTO).not.toMatch(/\b\d{10,}\b/);
    expect(TEXTO).not.toMatch(/(token|secret|api[_-]?key|bearer|password|contrase)/i);
    expect(TEXTO).not.toMatch(/https?:\/\//i);
    expect(TEXTO).not.toMatch(/\+\d{6,}/);
    expect(TEXTO).not.toMatch(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i);
  });

  const PENDIENTES = [
    'REEMPLAZAR_NOMBRE_VISIBLE_RUBEN', 'REEMPLAZAR_NUMERO_RECEPCION_RUBEN',
    'REEMPLAZAR_NOMBRE_RECEPCION_RUBEN',
  ];
  it('lleva un marcador por cada dato que Rubén todavía no dio', () => {
    for (const m of PENDIENTES) expect(TEXTO, m).toContain(m);
    expect([...new Set(TEXTO.match(/REEMPLAZAR_[A-Z0-9_]+/g))].sort()).toEqual([...PENDIENTES].sort());
  });

  it('NO es aplicable mientras tenga marcadores: la guardia de publicación lo niega, y con todos sustituidos pasa', () => {
    // Se arma un "flujo" mínimo con el archivo como contenido y las plantillas aprobadas: lo único que puede negarlo son los marcadores del archivo.
    const envolver = (texto: string): Flujo => ({
      nodes: [
        { name: 'Config base', parameters: { assignments: { assignments: [
          { name: 'avisoComprobanteEstado', value: 'APPROVED' }, { name: 'avisoComprobantePlantilla', value: 'aviso_comprobante_recibido' },
          { name: 'avisoConsultaEstado', value: 'APPROVED' }, { name: 'avisoConsultaPlantilla', value: 'aviso_consulta_para_ruben' }, { name: 'avisoPlantillaIdioma', value: 'es' },
        ] } } },
        { name: 'Negocio', parameters: { archivo: texto } },
      ],
    } as unknown as Flujo);
    const datos = { configBase: { avisoComprobanteEstado: 'APPROVED', avisoComprobantePlantilla: 'a', avisoConsultaEstado: 'APPROVED', avisoConsultaPlantilla: 'b', avisoPlantillaIdioma: 'es' } };
    const h = guardiaDePublicacion({ flujo: envolver(TEXTO), datos }) as string[];
    expect(h).toHaveLength(PENDIENTES.length);
    for (const m of PENDIENTES) expect(h.join('|')).toContain(m);
    expect(guardiaDePublicacion({ flujo: envolver(TEXTO.replace(/REEMPLAZAR_[A-Z0-9_]+/g, 'dato-real')), datos })).toEqual([]);
  });

  it('el número de recepción va como marcador de la tabla local (numeroRecepcionMarcador), nunca el número', () => {
    expect(D.negocio['numeroRecepcionMarcador']).toBe('REEMPLAZAR_NUMERO_RECEPCION_RUBEN');
    expect(D.negocio).not.toHaveProperty('numeroRecepcion');
  });
});
