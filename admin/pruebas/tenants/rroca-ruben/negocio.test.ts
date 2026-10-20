/**
 * «VENTA DIGITAL DE RUBÉN» (tenant rroca-ruben) — PR-5, LOS DATOS DEL NEGOCIO (`admin/scripts/datos/negocio-rroca-ruben.json`).
 *
 * Lo que esta suite niega: que el catálogo no sea el que lee el flujo (`rrCatalogo`: ids `pack-completo`, `libro-bonos`, `closer-ventas`, `videos-ia`; precios 60, 32, 20 y 25 Bs); que el
 * id de un ítem (que `cargar-negocio.mjs` saca del nombre) deje de coincidir; que el archivo traiga un secreto, un teléfono real o una cuenta; y que sea APLICABLE mientras tenga marcadores
 * `REEMPLAZAR_*` (la misma guardia de publicación lo niega). No toca Firestore: la carga real es del script con «sí» de Andres.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { entornoDelEmulador } from '../../core/entorno-del-hijo.ts';
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

  it('declara lo que NO se sabe (garantía y devolución, factura, otros medios de pago, plazo de entrega exacto)', () => {
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
    // Sin plazo exacto (Andres, 20/10/2026): «en cuanto revisa el pago», nunca una cifra de horas.
    expect(String(D.negocio['instruccionesExtra'])).toMatch(/en cuanto revisa el pago/);
    expect(TEXTO).not.toMatch(/\b6 horas\b|\bseis horas\b/i);
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
          // Publicación de PRUEBA con lista restringida (la guardia de apertura exige declararla: sin lista sería abrir al público).
          { name: 'telefonosDePrueba', value: 'lista-de-prueba' },
        ] } } },
        { name: 'Negocio', parameters: { archivo: texto } },
      ],
    } as unknown as Flujo);
    const datos = { configBase: { avisoComprobanteEstado: 'APPROVED', avisoComprobantePlantilla: 'a', avisoConsultaEstado: 'APPROVED', avisoConsultaPlantilla: 'b', avisoPlantillaIdioma: 'es', telefonosDePrueba: 'lista-de-prueba' } };
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

describe('cargar-negocio.mjs --aplicar niega cualquier REEMPLAZAR_ fuera de los campos *Marcador (documento entero)', () => {
  const SCRIPT = join(REPO, 'admin/scripts/datos/cargar-negocio.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'rroca-neg-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  // Una tabla local con el número de recepción resuelto (8 dígitos de juguete): así lo único que puede frenar la carga son los demás marcadores.
  const local = join(dir, 'local.md');
  writeFileSync(local, '| `REEMPLAZAR_NUMERO_RECEPCION_RUBEN` | 71234567 | prueba |\n');
  const correr = (archivo: string, ...extra: string[]) => {
    const r = spawnSync(process.execPath, [SCRIPT, '--proyecto', 'proyecto-de-prueba', '--tenant', 'rroca-ruben', '--archivo', archivo, '--local', local, ...extra], { encoding: 'utf8', env: entornoDelEmulador(undefined) });
    return { codigo: r.status, salida: `${r.stdout}${r.stderr}` };
  };
  const copiaCon = (nombre: string, retoque: (d: Record<string, any>) => void): string => {
    const d = JSON.parse(TEXTO) as Record<string, any>;
    retoque(d);
    const ruta = join(dir, nombre);
    writeFileSync(ruta, JSON.stringify(d));
    return ruta;
  };
  const SIN_MARCADORES = (d: Record<string, any>): void => {
    d['_pendiente']['nombreDeRecepcion'] = 'dato real';
    d['negocio']['nombreNegocio'] = 'Nombre real';
  };

  it('el archivo versionado de hoy (nombre visible y nombre de recepción pendientes) se NIEGA con --aplicar y nombra dónde está cada uno', () => {
    const r = correr(NEGOCIO, '--aplicar');
    expect(r.codigo).toBe(2);
    expect(r.salida).toMatch(/NEGADO.*fuera de los campos \*Marcador/);
    expect(r.salida).toContain('negocio.nombreNegocio');
    expect(r.salida).toContain('_pendiente.nombreDeRecepcion');
    expect(r.salida).not.toContain('71234567');
  });

  for (const [nombre, retoque] of [
    ['en una descripción del catálogo', (d: Record<string, any>) => { d['catalogo'][0]['descripcion'] = 'Incluye REEMPLAZAR_DATO_QUE_FALTA hoy'; }],
    ['en una nota (clave que empieza con guion bajo)', (d: Record<string, any>) => { d['_fuente'] = 'nota con reemplazar_dato en minúsculas'; }],
    ['en una lista de textos (de una nota)', (d: Record<string, any>) => { d['_pendiente']['lista'] = ['una', 'REEMPLAZAR_OTRA']; }],
  ] as Array<[string, (d: Record<string, any>) => void]>) {
    it(`se NIEGA un marcador ${nombre}, aunque lo demás esté sustituido`, () => {
      const ruta = copiaCon(`otro-${nombre.length}.json`, (d) => { SIN_MARCADORES(d); retoque(d); });
      const r = correr(ruta, '--aplicar');
      expect(r.codigo, r.salida).toBe(2);
      expect(r.salida).toMatch(/NEGADO.*fuera de los campos \*Marcador/);
    });
  }

  it('los campos *Marcador NO cuentan como pendientes de esta barrera (los resuelve la tabla local)', () => {
    const ruta = copiaCon('solo-marcador.json', SIN_MARCADORES);
    const r = correr(ruta);   // en seco: la barrera no se dispara; lo que siga (Firestore) no importa aquí
    expect(r.salida).not.toMatch(/marcador sin dato/);
    expect(r.salida).not.toMatch(/fuera de los campos/);
  });
});
