/**
 * EL miniCRM DE Q'TACO 3727 (módulo `crm`, 06/11/2026). Especificación y prueba de aceptación de Auxiliar 1 (12 puntos), decisiones de Andres: D1 = opción (b) (sin ampliar el contrato de columnas
 * del core), D2 = tope de 81 nodos. Tres capas:
 *   · UNIDADES: `vmProspectoCrm` (librería `src/lib/crm.js`, lo que «Armar mensajes» calcula) y `crmDecidirFila` (el módulo, con el adaptador de señales + el de Q'Taco).
 *   · FLUJO: el JSON versionado en el n8n de mentira con dobles de Google Sheets.
 *   · EL REQUISITO CLAVE DE ANDRES: «los nodos NO afectan las respuestas». La secuencia de mensajes al cliente y los avisos es IDÉNTICA con la planilla, sin la rama, con Google caído y con el cálculo
 *     del prospecto lanzando; ningún nodo nuevo envía a Meta (0 mensajes por conversación agregados).
 * Cada prueba de la aceptación lleva su número («A1» a «A12») y su negativo (la suite se pone roja si se rompe cualquiera).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { compileFunction } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type Flujo, type J } from './lib/flujo';
import type { Doble, ResultadoTurno } from './lib/n8n-de-mentira';
// @ts-expect-error módulo .mjs sin tipos
import { hallazgosCrm, inyectarMapa } from '../../Flujos/experimental/comun-sin-agente/construir-crm.mjs';
import { AHORA, CLIENTE, estadoDe, boton, crear, editarJson, idDeBoton, leer, nodoDe, panel, texto, turno, verificarEnCopia, type Mundial } from './lib/venta-minima-mundo';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const VM = join(RAIZ, 'Flujos', 'experimental', 'venta-minima');
const F3727 = 'venta-minima.qtaco-3727.json';
const CRM = leer(F3727);
const DATOS = JSON.parse(readFileSync(join(RAIZ, 'admin/scripts/datos/venta-minima/qtaco-3727.json'), 'utf8')) as J;
const MAPA = DATOS['crm'] as J;
const NODOS_DE_CRM = ['Prospecto para la planilla', 'Buscar teléfono en planilla', 'Leer IDs de la planilla', 'Leer encabezados de la planilla', 'Decidir fila de la planilla', '¿Acción de la planilla?', 'Agregar fila', 'Actualizar fila'];
const copia = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const mod = (r: string): string => readFileSync(join(RAIZ, 'Flujos', 'src', 'modulos', r), 'utf8');
const lib = (n: string): string => readFileSync(join(VM, 'src', 'lib', n), 'utf8');

// ------------------------------------------------------------------------------------------------ el código, tal como corre en n8n
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const L: any = compileFunction(`${lib('comun.js')}\n${lib('pedido.js')}\n${lib('crm.js')}\nreturn { vmProspectoCrm, vmCrmClave, vmCrmMarcarVisto, vmCrmActiva, vmCrmResumen, vmCrmNombre };`, [])();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const M: any = compileFunction(`${inyectarMapa(mod('crm/crm.js'), MAPA)}\n${mod('crm/adaptador-senales.js')}\n${lib('crm-planilla.js')}\nreturn { crmDecidirFila, CRM_ADAPTADOR };`, [])();

const TEL = '59100000011';
type Col = { letra: string; titulo: string };
const TITULOS: string[] = (() => {
  const todas: Col[] = [...Object.values(MAPA['columnas'] as Record<string, Col>), ...Object.values(MAPA['equipo'] as Record<string, Col>)];
  return todas.filter((c) => c.letra <= 'T').sort((a, b) => a.letra.localeCompare(b.letra)).map((c) => c.titulo);
})();
const fila = (n: number, extra: J = {}): { json: J } => ({ json: Object.fromEntries([['row_number', n], ...TITULOS.map((t) => [t, ''])].map(([k, v]) => [k, extra[k as string] ?? v])) });
const ENCABEZADOS = [{ json: { values: [TITULOS] } as J }];
const IDS = [{ json: { row_number: 4, 'ID Lead': 'LEAD-1010' } }];
const celda = (r: J, campo: string): unknown => r[((MAPA['columnas'] as Record<string, Col>)[campo] as Col).titulo];

const PEDIDO = { pedidoId: 'ped-abc', codigo: 'K7P2', nItems: 4, total: 84, modalidad: 'recojo', entrega: { nombre: 'Carlos Pérez' } };
/** Un turno ya resuelto, con lo que «Armar mensajes» le pasa a `vmProspectoCrm`. */
const turnoCrm = (o: J = {}): J => ({ from: TEL, plan: { ruta: 'menu', pedido: null }, pedidoEstado: null, nombrePerfil: 'Carlos Pérez', avisoSalio: false, ahoraMs: AHORA, anteriorMs: null, ...o });
const prospecto = (o: J = {}): J | null => L.vmProspectoCrm(turnoCrm(o)) as J | null;
function decidir(p: J, existentes: Array<{ json: J }> = [], ahoraMs = AHORA): J {
  const salida = M.crmDecidirFila({ prospectos: [{ json: p }], busqueda: existentes, lecturaIds: IDS, encabezados: ENCABEZADOS, mapa: copia(MAPA), adaptador: M.CRM_ADAPTADOR, ahoraMs }) as Array<{ json: J }>;
  expect(salida).toHaveLength(1);
  return salida[0]!.json;
}

// ================================================================================================ UNIDADES
describe('vmProspectoCrm: qué es un evento y qué dice el prospecto (hechos del código, no del modelo)', () => {
  it('pedido confirmado: Caliente, «Pedido», resumen «N.º <código>, <n> ítems, Bs <total>, delivery|recojo»', () => {
    const p = prospecto({ plan: { ruta: 'pedido:qr', pedido: PEDIDO } })!;
    expect(p['senales']).toMatchObject({ inicioCompra: true });
    expect(p['quePidio']).toBe('Pedido');
    expect(p['resumenVenta']).toBe('N.º K7P2, 4 ítems, Bs 84, recojo');
    const r = decidir(p);
    expect(r['accionPlanilla']).toBe('agregar');
    expect(celda(r, 'clasificacion')).toBe('Caliente');
    expect(celda(r, 'calificacion')).toBe('Alta');
    expect(celda(r, 'resumen')).toBe("'N.º K7P2, 4 ítems, Bs 84, recojo");
    expect(celda(r, 'quePidio')).toBe("'Pedido");
    expect(celda(r, 'origen')).toBe('Chatbot WhatsApp IA');
  });
  it('un ítem va en singular, el total con centavos lleva coma y el delivery se dice', () => {
    expect(prospecto({ plan: { ruta: 'pedido:sin_qr', pedido: { ...PEDIDO, nItems: 1, total: 21.5, modalidad: 'delivery' } }, pasoSalio: true })!['resumenVenta']).toBe('N.º K7P2, 1 ítem, Bs 21,50, delivery');
  });
  it('comprobante: «comprobante recibido, datos coinciden | no coinciden | ilegible»; sin cotejo solo «comprobante recibido»', () => {
    const dice = (resultado: string): unknown => prospecto({ plan: { ruta: `comprobante:${resultado}`, pedido: PEDIDO } })!['resumenVenta'];
    expect(dice('cuadra')).toBe('N.º K7P2, 4 ítems, Bs 84, recojo, comprobante recibido, datos coinciden');
    expect(dice('no_cuadra')).toBe('N.º K7P2, 4 ítems, Bs 84, recojo, comprobante recibido, datos no coinciden');
    expect(dice('ilegible')).toBe('N.º K7P2, 4 ítems, Bs 84, recojo, comprobante recibido, ilegible');
    expect(dice('sin_cotejo')).toBe('N.º K7P2, 4 ítems, Bs 84, recojo, comprobante recibido');
    expect(prospecto({ plan: { ruta: 'comprobante:cuadra', pedido: PEDIDO } })!['quePidio']).toBe('');   // «Eligió» no dice «Comprobante»
  });
  it('un comprobante simulado o ya cotejado NO es un evento (ni se escribe nada)', () => {
    for (const r of ['simulado', 'ya_cotejado', 'otra_cosa']) expect(prospecto({ plan: { ruta: `comprobante:${r}`, pedido: PEDIDO }, anteriorMs: AHORA - 1000 }), r).toBeNull();
  });
  it('si el plan no trae el pedido (primer comprobante ilegible), sale del estado', () => {
    const p = prospecto({ plan: { ruta: 'comprobante:ilegible', pedido: null }, pedidoEstado: PEDIDO })!;
    expect(p['resumenVenta']).toContain('N.º K7P2');
  });
  it('reserva solicitada: Caliente, «Reserva», con el código', () => {
    const p = prospecto({ plan: { ruta: 'reserva:enviada', aviso: { tipo: 'reserva', datos: { codigo: 'R5X9' } } }, pasoSalio: true })!;
    expect(p['quePidio']).toBe('Reserva');
    expect(p['senales']).toMatchObject({ inicioCompra: true });
    expect(p['resumenVenta']).toBe('Reserva N.º R5X9');
  });
  it('primer contacto de la ventana: Tibio, sin «Eligió»; dentro de las 24 h sin evento no hay prospecto', () => {
    const p = prospecto({ plan: { ruta: 'menu' } })!;
    expect(p['quePidio']).toBe('');
    expect(celda(decidir(p), 'clasificacion')).toBe('Tibio');
    expect(prospecto({ plan: { ruta: 'menu' }, anteriorMs: AHORA - 3600_000 })).toBeNull();
    expect(prospecto({ plan: { ruta: 'menu' }, anteriorMs: AHORA - 25 * 3600_000 })).not.toBeNull();
  });
  it('lo primero que hizo fue ver la carta: Frío (y no baja a un cliente ya Caliente)', () => {
    const p = prospecto({ plan: { ruta: 'carta' } })!;
    expect(celda(decidir(p), 'clasificacion')).toBe('Frío');
    const caliente = decidir(p, [fila(7, { 'Teléfono WhatsApp': TEL, 'Clasificación': 'Caliente' })]);
    expect(caliente['Clasificación']).toBeUndefined();
  });
  it('la derivación solo cuenta si el aviso SALIÓ (hecho); entonces la columna «Derivación a recepción» dice «Sí»', () => {
    expect(prospecto({ plan: { ruta: 'transferir:x' }, avisoSalio: false, anteriorMs: AHORA - 1000 })).toBeNull();
    const p = prospecto({ plan: { ruta: 'transferir:x' }, avisoSalio: true, anteriorMs: AHORA - 1000 })!;
    expect(celda(decidir(p), 'derivacion')).toBe("'Sí");
  });
  it('NO van: dirección, referencia, ubicación, notas, líneas, imagen ni datos del comprobante', () => {
    const ped = { ...PEDIDO, entrega: { nombre: 'Carlos', direccion: 'Av. Secreta 999', referencia: 'portón rojo' }, direccion: 'Av. Secreta 999', referencia: 'portón rojo', notaPedido: 'sin cebolla por favor',
      lineas: [{ nombre: 'Tacos de Birria', cantidad: 4 }], ubicacion: { lat: -16.5, lng: -68.1 }, mediaId: 'media-77', banco: 'Banco Ejemplo', cuenta: '***4321' };
    for (const ruta of ['pedido:qr', 'comprobante:cuadra']) {
      const p = prospecto({ plan: { ruta, pedido: ped } })!;
      const dicho = JSON.stringify([p, decidir(p)]);
      expect(dicho, ruta).not.toMatch(/Secreta|portón|cebolla|Tacos de Birria|-16\.5|media-77|Banco Ejemplo|4321/);
    }
  });
  it('el nombre: el del perfil de WhatsApp si existe; si no, el que dio al pedir (sin pisar uno ya dado con el del perfil)', () => {
    expect(prospecto({ plan: { ruta: 'pedido:qr', pedido: PEDIDO }, nombrePerfil: 'Ana Gómez' })).toMatchObject({ nombre: 'Ana Gómez', nombreDePerfil: true });
    expect(prospecto({ plan: { ruta: 'pedido:qr', pedido: PEDIDO }, nombrePerfil: '' })).toMatchObject({ nombre: 'Carlos Pérez', nombreDePerfil: false });
    const previa = [fila(7, { 'Teléfono WhatsApp': TEL, 'Nombre y Apellido': 'Carlos Pérez Rojas' })];
    const r = decidir(prospecto({ plan: { ruta: 'pedido:qr', pedido: PEDIDO }, nombrePerfil: 'Charly 😎' })!, previa);
    expect(r['accionPlanilla']).toBe('actualizar');
    expect(r['Nombre y Apellido']).toBeUndefined();
  });
  it('vmCrmActiva: solo con id y hoja y fuera del modo prueba; sin dato `crm` el flujo no lo activa', () => {
    expect(L.vmCrmActiva({ planillaProspectosId: 'x'.repeat(30), planillaProspectosHoja: 'Leads_CRM' }, false)).toBe(true);
    expect(L.vmCrmActiva({ planillaProspectosId: 'x'.repeat(30), planillaProspectosHoja: 'Leads_CRM' }, true)).toBe(false);
    expect(L.vmCrmActiva({ planillaProspectosId: '', planillaProspectosHoja: '' }, false)).toBe(false);
    expect(L.vmCrmActiva({}, false)).toBe(false);
    expect(L.vmCrmActiva(null, false)).toBe(false);
  });
  it('vmCrmMarcarVisto: devuelve el instante anterior, anota el nuevo POR HASH (nunca el teléfono), poda lo vencido y limita el mapa', () => {
    const sd: J = {};
    const clave = L.vmCrmClave(TEL) as string;
    expect(clave).toMatch(/^h[0-9a-f]{1,14}$/);
    expect(clave).not.toContain(TEL);
    expect(L.vmCrmClave(`+${TEL}`)).toBe(clave);
    expect(L.vmCrmClave('59100000012')).not.toBe(clave);
    expect(L.vmCrmMarcarVisto(sd, TEL, 1_800_000_000_000)).toBeNull();
    expect(L.vmCrmMarcarVisto(sd, `+${TEL}`, 1_800_000_060_000)).toBe(1_800_000_000_000);
    sd['crmVisto']['hviejo'] = 1_800_000_000_000 - 200 * 24 * 3600_000;
    L.vmCrmMarcarVisto(sd, TEL, 1_800_000_120_000);
    expect(Object.keys(sd['crmVisto'])).toEqual([clave]);
    expect(JSON.stringify(sd)).not.toContain(TEL);
    expect(L.vmCrmMarcarVisto(null, TEL, 1)).toBeNull();
  });
});

// ================================================================================================ «Eligió», «Reserva» y «Pedido» (07/11/2026)
describe('vmProspectoCrm: Eligió (O), Reserva (P) y Pedido (Q); celda en blanco si no concretó, nunca «No»', () => {
  const RES = { ruta: 'reserva:enviada', aviso: { tipo: 'reserva', datos: { codigo: 'R5X9' } } };
  it('el botón de pedido o de reserva escribe UNA vez «Eligió»; los turnos siguientes dentro del mismo paso no escriben', () => {
    const ped = prospecto({ plan: { ruta: 'pedido_pide' }, pasoAntes: 'menu', pasoDespues: 'pedido', anteriorMs: AHORA - 1000 })!;
    expect(ped['quePidio']).toBe('Pedido');
    expect(ped['diaPreferido']).toBeUndefined();
    expect(ped['horarioPreferido']).toBeUndefined();
    expect(celda(decidir(ped), 'quePidio')).toBe("'Pedido");
    const res = prospecto({ plan: { ruta: 'reserva_pide' }, pasoAntes: undefined, pasoDespues: 'reserva', anteriorMs: AHORA - 1000 })!;
    expect(res['quePidio']).toBe('Reserva');
    // los pasos reales de la familia: `pedido`, `pedido_datos`, `pedido_entrega`, `pedido_confirmar`, `reserva`, `reserva_confirmar`; pasar de uno a otro de la MISMA familia no es elección
    const pares: Array<[string, string]> = [['pedido', 'pedido_datos'], ['pedido_datos', 'pedido_entrega'], ['pedido_entrega', 'pedido_confirmar'], ['pedido_confirmar', 'pedido'], ['reserva', 'reserva_confirmar'], ['reserva_confirmar', 'reserva']];
    for (const [antes, despues] of pares) expect(prospecto({ plan: { ruta: 'x' }, pasoAntes: antes, pasoDespues: despues, anteriorMs: AHORA - 1000 }), `${antes} -> ${despues}`).toBeNull();
    // de otra familia a la exacta `pedido` o `reserva` sí es elección
    expect(prospecto({ plan: { ruta: 'x' }, pasoAntes: 'menu', pasoDespues: 'pedido', anteriorMs: AHORA - 1000 })!['quePidio']).toBe('Pedido');
    expect(prospecto({ plan: { ruta: 'x' }, pasoAntes: 'pedido_confirmar', pasoDespues: 'reserva', anteriorMs: AHORA - 1000 })!['quePidio']).toBe('Reserva');
    expect(prospecto({ plan: { ruta: 'pedido_pide' }, pasoAntes: 'pedido_datos', pasoDespues: 'pedido_entrega', anteriorMs: AHORA - 1000 })).toBeNull();
    expect(prospecto({ plan: { ruta: 'reserva_pide' }, pasoAntes: 'reserva', pasoDespues: 'reserva_confirmar', anteriorMs: AHORA - 1000 })).toBeNull();
    // un paso que no es de pedido ni de reserva no es elección
    expect(prospecto({ plan: { ruta: 'menu' }, pasoAntes: 'menu', pasoDespues: 'esperando_comprobante', anteriorMs: AHORA - 1000 })).toBeNull();
  });
  it('un primer contacto de la ventana que ya está en pedido o reserva cuenta como elección; la carta conserva el Frío', () => {
    const p = prospecto({ plan: { ruta: 'pedido_datos' }, pasoAntes: 'pedido', pasoDespues: 'pedido', anteriorMs: AHORA - 30 * 3600_000 })!;
    expect(p['quePidio']).toBe('Pedido');
    const frio = prospecto({ plan: { ruta: 'carta' }, pasoAntes: 'menu', pasoDespues: 'pedido' })!;
    expect(frio['senales']).toMatchObject({ preguntoPrecioYCerro: true, inicioCompra: false });
  });
  it('reserva con aviso salido: P dice «Enviada <fecha-hora>»; con el aviso caído se rebaja a elección: O «Reserva», sin P, sin Caliente ni resumen', () => {
    const ok = prospecto({ plan: RES, pasoSalio: true, pasoAntes: 'reserva_confirmar', pasoDespues: 'menu' })!;
    expect(ok['quePidio']).toBe('Reserva');
    expect(ok['diaPreferido']).toBe('Enviada ' + new Date(AHORA - 4 * 3600_000).toISOString().slice(0, 16).replace('T', ' '));
    const r = decidir(ok);
    expect(celda(r, 'diaPreferido')).toMatch(/^'Enviada \d{4}-\d\d-\d\d \d\d:\d\d$/);
    const caido = prospecto({ plan: RES, pasoSalio: false, pasoAntes: 'reserva_confirmar', pasoDespues: 'menu' })!;
    expect(caido['quePidio']).toBe('Reserva');
    expect(caido['diaPreferido']).toBeUndefined();
    expect(caido['resumenVenta']).toBeUndefined();
    expect(caido['senales']).toMatchObject({ inicioCompra: false });
    const rc = decidir(caido);
    expect(celda(rc, 'diaPreferido')).toBeUndefined();
    expect(celda(rc, 'quePidio')).toBe("'Reserva");
    expect(celda(rc, 'clasificacion')).not.toBe('Caliente');
    expect(JSON.stringify(rc)).not.toMatch(/No\b/);
  });
  it('pedido: con QR (o QR simulado) Q dice «Registrado»; sin QR o QR vencido sin aviso salido se rebaja a elección (simétrico a la reserva)', () => {
    const q = (ruta: string, pasoSalio: boolean): J => prospecto({ plan: { ruta, pedido: PEDIDO }, pasoSalio })!;
    expect(q('pedido:qr', false)['horarioPreferido']).toMatch(/^Registrado \d{4}-\d\d-\d\d \d\d:\d\d$/);
    expect(q('pedido:qr_simulado', false)['horarioPreferido']).toMatch(/^Registrado /);
    for (const ruta of ['pedido:sin_qr', 'pedido:qr_vencido']) {
      expect(q(ruta, true)['horarioPreferido'], ruta).toMatch(/^Registrado /);
      expect(q(ruta, false)['horarioPreferido'], ruta).toBeUndefined();
      expect(q(ruta, false)['quePidio'], ruta).toBe('Pedido');
      expect(q(ruta, false)['resumenVenta'], ruta).toBeUndefined();
      expect(q(ruta, false)['senales'], ruta).toMatchObject({ inicioCompra: false });
      expect(celda(decidir(q(ruta, false)), 'horarioPreferido'), ruta).toBeUndefined();
    }
    expect(q('pedido:qr', true)['diaPreferido']).toBeUndefined();
    expect(celda(decidir(q('pedido:qr', true)), 'horarioPreferido')).toMatch(/^'Registrado /);
  });
  it('pedido seguido de elegir reserva no pisa P ni Q; un contacto a 24-48 h no borra «Eligió»', () => {
    // O es la ÚLTIMA elección (aquí pasa de «Pedido» a «Reserva»); lo concretado queda en P y Q, que no se pisan entre sí.
    const previa = fila(9, { 'Teléfono WhatsApp': TEL, 'Nombre y Apellido': 'Carlos', 'Clasificación': 'Caliente', 'Eligió': 'Pedido', 'Pedido': 'Registrado 2026-10-05 10:00' });
    const eleccion = decidir(prospecto({ plan: { ruta: 'reserva_pide' }, pasoAntes: 'menu', pasoDespues: 'reserva', anteriorMs: AHORA - 1000 })!, [previa]);
    expect(eleccion['Pedido']).toBeUndefined();
    expect(eleccion['Reserva']).toBeUndefined();
    expect(eleccion['Eligió']).toBe('Reserva');
    const contacto = decidir(prospecto({ plan: { ruta: 'menu' }, anteriorMs: AHORA - 30 * 3600_000 })!, [previa]);
    expect(contacto['Eligió']).toBeUndefined();
    expect(contacto['Pedido']).toBeUndefined();
  });
  it('la fecha va en hora de La Paz (UTC-4) también cerca de la medianoche UTC', () => {
    const casos: Array<[string, string]> = [['2026-10-06T02:30:00Z', '2026-10-05 22:30'], ['2026-10-06T03:59:00Z', '2026-10-05 23:59'], ['2026-10-06T04:00:00Z', '2026-10-06 00:00']];
    for (const [utc, paz] of casos) expect(prospecto({ plan: RES, pasoSalio: true, ahoraMs: Date.parse(utc) })!['diaPreferido']).toBe('Enviada ' + paz);
  });
  it('nunca dice pagado, acreditado, simulado ni verificado, en ningún evento', () => {
    const todos = [prospecto({ plan: { ruta: 'pedido:qr_simulado', pedido: PEDIDO }, pasoSalio: true })!, prospecto({ plan: { ruta: 'pedido:sin_qr', pedido: PEDIDO }, pasoSalio: true })!, prospecto({ plan: RES, pasoSalio: true })!,
      prospecto({ plan: { ruta: 'x' }, pasoAntes: 'menu', pasoDespues: 'pedido_datos' })!];
    expect(JSON.stringify(todos)).not.toMatch(/pagad|acreditad|simulad|verificad/i);
  });
  it('negación: sin `pasoSalio` verdadero no se anota «Reserva» ni «Pedido sin QR» (si se mutara el código, esta prueba falla)', () => {
    const src = lib('crm.js');
    expect(src).toContain('x.pasoSalio === true');
    const mutado = src.split('x.pasoSalio === true').join('true');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Lm: any = compileFunction(`${lib('comun.js')}\n${lib('pedido.js')}\n${mutado}\nreturn { vmProspectoCrm };`, [])();
    const mut = Lm.vmProspectoCrm(turnoCrm({ plan: RES, pasoSalio: false })) as J;
    // con la mutación el aviso caído SÍ escribiría: la prueba real lo detecta
    expect(mut['diaPreferido']).toBeDefined();
    expect(prospecto({ plan: RES, pasoSalio: false })!['diaPreferido']).toBeUndefined();
  });
  it('un mapa con un campo desconocido sigue rechazado (no se amplió el contrato)', () => {
    const mapa = copia(MAPA) as J;
    (mapa['columnas'] as J)['campoNuevo'] = { letra: 'V', titulo: 'Otro' };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const V: any = compileFunction(`${inyectarMapa(mod('crm/crm.js'), MAPA)}\nreturn { crmValidarMapa };`, [])();
    expect(V.crmValidarMapa(copia(MAPA))).toEqual([]);
    expect((V.crmValidarMapa(mapa) as string[]).join('|')).toContain('no es una columna del bot');
  });
});


// ================================================================================================ A5, A6, A7, A8, A9 sobre el módulo
describe('aceptación (unidades)', () => {
  it('A5 cobro real: ningún texto escrito dice «pagado», «acreditado» ni «simulado» (todos los eventos)', () => {
    const todos: J[] = [
      prospecto({ plan: { ruta: 'pedido:qr', pedido: PEDIDO } })!, prospecto({ plan: { ruta: 'pedido:qr_simulado', pedido: { ...PEDIDO, simulado: true } } })!,
      ...['cuadra', 'no_cuadra', 'ilegible', 'sin_cotejo'].map((r) => prospecto({ plan: { ruta: `comprobante:${r}`, pedido: PEDIDO } })!),
      prospecto({ plan: { ruta: 'reserva:enviada' }, pasoSalio: true })!, prospecto({ plan: { ruta: 'menu' }, pasoAntes: 'menu', pasoDespues: 'pedido_datos' })!, prospecto({ plan: { ruta: 'menu' } })!, prospecto({ plan: { ruta: 'carta' } })!,
    ];
    for (const p of todos) {
      const escrito = [decidir(p), decidir(p, [fila(7, { 'Teléfono WhatsApp': TEL })])].map((x) => JSON.stringify(x)).join(' ');
      expect(escrito).not.toMatch(/pagad|acreditad|simulad|pago|verificad/i);
    }
    // el estado del comprobante usa SOLO esas tres formas
    const estados = ['cuadra', 'no_cuadra', 'ilegible'].map((r) => String(prospecto({ plan: { ruta: `comprobante:${r}`, pedido: PEDIDO } })!['resumenVenta']).replace(/^.*comprobante recibido, /, ''));
    expect(estados).toEqual(['datos coinciden', 'datos no coinciden', 'ilegible']);
  });
  it('A6 el total escrito es el calculado por el código (nunca un total que traiga el texto del modelo)', () => {
    const plan = { ruta: 'pedido:qr', pedido: PEDIDO, total: 5, resumen: 'Total Bs 5', mensajes: [{ cuerpo: 'Tu total es Bs 5' }] };
    expect(prospecto({ plan })!['resumenVenta']).toBe('N.º K7P2, 4 ítems, Bs 84, recojo');
  });
  it('A7 no pisa al equipo: una fila con J a M y «Diagnóstico del equipo» llenos conserva esos valores tras actualizar', () => {
    const equipo = { 'Valor Estimado ($)': '500', 'Responsable Comercial': 'Marta', 'Estado Comercial': 'Negociando', 'Próxima Acción / Fecha': 'Llamar el viernes', 'Diagnóstico del equipo': 'nota interna' };
    const previa = fila(9, { 'Teléfono WhatsApp': TEL, 'Nombre y Apellido': 'Carlos', 'Clasificación': 'Tibio', ...equipo });
    const r = decidir(prospecto({ plan: { ruta: 'pedido:qr', pedido: PEDIDO } })!, [previa]);
    expect(r['accionPlanilla']).toBe('actualizar');
    expect(r['row_number']).toBe(9 + 2);
    for (const k of Object.keys(equipo)) expect(r[k], k).toBeUndefined();
    expect(JSON.stringify(r)).not.toMatch(/Marta|Negociando|nota interna|Llamar el viernes/);
    expect(r['Clasificación']).toBe('Caliente');
  });
  it('A8 teléfono con otro formato encuentra la misma fila; 48 h: misma fila dentro, fila nueva fuera', () => {
    for (const formato of [`+${TEL}`, `'${TEL}`, `${TEL.slice(0, 3)} ${TEL.slice(3)}`]) {
      const r = decidir(prospecto({ plan: { ruta: 'pedido:qr', pedido: PEDIDO }, anteriorMs: AHORA - 3600_000 })!, [fila(5, { 'Teléfono WhatsApp': formato })]);
      expect(r['accionPlanilla'], formato).toBe('actualizar');
    }
    const dentro = prospecto({ plan: { ruta: 'pedido:qr', pedido: PEDIDO }, anteriorMs: AHORA - 47 * 3600_000 })!;
    expect(dentro['nuevoContacto']).toBe(false);
    expect(decidir(dentro, [fila(5, { 'Teléfono WhatsApp': TEL })])['accionPlanilla']).toBe('actualizar');
    const fuera = prospecto({ plan: { ruta: 'pedido:qr', pedido: PEDIDO }, anteriorMs: AHORA - 49 * 3600_000 })!;
    expect(fuera['nuevoContacto']).toBe(true);
    expect(decidir(fuera, [fila(5, { 'Teléfono WhatsApp': TEL })])['accionPlanilla']).toBe('agregar');
  });
  it('A8 de las varias filas del mismo teléfono se actualiza la más reciente', () => {
    const r = decidir(prospecto({ plan: { ruta: 'pedido:qr', pedido: PEDIDO }, anteriorMs: AHORA - 1000 })!, [fila(5, { 'Teléfono WhatsApp': TEL }), fila(9, { 'Teléfono WhatsApp': TEL }), fila(7, { 'Teléfono WhatsApp': TEL })]);
    expect(r['row_number']).toBe(9 + 2);
  });
  it('A9 neutralización: un nombre que empieza con =, +, - o @ sale con apóstrofo; un nombre con emoji no rompe nada', () => {
    for (const nombre of ['=HYPERLINK("x")', '+5917000', '-cmd', '@usuario', '=1+1']) {
      const r = decidir({ ...prospecto({ plan: { ruta: 'pedido:qr', pedido: PEDIDO } })!, nombre, nombreDePerfil: false });
      const escrito = String(celda(r, 'nombre'));
      expect(escrito, nombre).toMatch(/^'[^=+\-@]/);
    }
    const emoji = prospecto({ plan: { ruta: 'pedido:qr', pedido: PEDIDO }, nombrePerfil: '🌮 Ana 😀 María' })!;
    expect(emoji['nombre']).toBe('Ana María');
    expect(celda(decidir(emoji), 'nombre')).toBe("'Ana María");
    expect(() => prospecto({ plan: { ruta: 'pedido:qr', pedido: PEDIDO }, nombrePerfil: '😀😀😀' })).not.toThrow();
    // los textos libres no se interpretan como fórmula: el resumen y «Eligió» van con apóstrofo al agregar
    expect(String(celda(decidir(prospecto({ plan: { ruta: 'pedido:qr', pedido: PEDIDO } })!), 'resumen'))).toMatch(/^'/);
  });
});

// ================================================================================================ EL FLUJO
const ID_HOJA = 'HojaDePruebaDeQTacoParaElMiniCrm0001';
const BASE_CON_PLANILLA = { planillaProspectosId: ID_HOJA, planillaProspectosHoja: 'Leads_CRM' };
interface Planilla { dobles: Record<string, Doble>; escrituras: J[]; actualizaciones: J[]; lecturas: string[] }
function planilla(o: { filas?: Array<{ json: J }>; ids?: Array<{ json: J }>; enc?: Array<{ json: J }>; caida?: boolean } = {}): Planilla {
  const p: Planilla = { dobles: {}, escrituras: [], actualizaciones: [], lecturas: [] };
  const cae = (): never => { throw new Error('Google no responde (503)'); };
  const lee = (nombre: string, datos: Array<{ json: J }>): Doble => (ll) => { if (o.caida) cae(); p.lecturas.push(`${nombre}|${String((((ll.parametros['options'] as J)['dataLocationOnSheet'] as J)['values'] as J)['range'])}`); return datos.map((x) => x.json); };
  p.dobles['Buscar teléfono en planilla'] = lee('buscar', o.filas ?? []);
  p.dobles['Leer IDs de la planilla'] = lee('ids', o.ids ?? IDS);
  p.dobles['Leer encabezados de la planilla'] = (ll) => { if (o.caida) cae(); p.lecturas.push(`enc|${decodeURIComponent(String(ll.parametros['url'])).replace(/^.*!(A\d+:[A-Z]+\d+)$/, '$1')}`); return (o.enc ?? ENCABEZADOS).map((x) => x.json); };
  p.dobles['Agregar fila'] = (ll) => { if (o.caida) cae(); p.escrituras.push(ll.item); return {}; };
  p.dobles['Actualizar fila'] = (ll) => { if (o.caida) cae(); p.actualizaciones.push(ll.item); return {}; };
  return p;
}

/** El mundo de Q'Taco 3727 con la hoja de prueba (o sin ella) y los dobles de Google montados. */
function mundo(o: { flujo?: Flujo; conHoja?: boolean; pl?: Planilla; panelExtra?: J } = {}): Mundial {
  const w = crear({}, o.flujo ?? CRM, o.conHoja === false ? {} : BASE_CON_PLANILLA);
  for (const [k, v] of Object.entries(o.pl?.dobles ?? {})) w.mundo.dobles[k] = v;
  const monto = (): number => Number(w.estado['monto'] ?? 84);
  w.mundo.dobles['Leer comprobante (imagen)'] = () => ({ content: { parts: [{ text: JSON.stringify({ monto: String(monto()), cuentaDestino: '***4321', nombreCuenta: 'Q TACO SRL', fecha: '05/10/2026', hora: '10:05', banco: 'Banco Ejemplo' }) }] } });
  return w;
}
const IMAGEN: J = { type: 'image', image: { id: 'media-9', mime_type: 'image/jpeg' } };
const EXT_PEDIDO = (extra: J = {}): J => ({ lineas: [{ producto: 'tacos de birria', cantidad: 4, forma: 'unidad', detalle: '' }], entrega: 'recojo', direccion: '', referencia: '', nombre: '', quiereHablar: false, ...extra });
const EXT_RESERVA: J = { personas: 4, fecha: '2026-10-09', hora: '20:00', zona: 'salón', nombre: 'Carlos Pérez', celebracion: '', requerimiento: '' };

/** Lo que el cliente y el restaurante reciben en un turno: lo único que el miniCRM NO puede alterar. */
const salida = (t: ResultadoTurno): J => JSON.parse(JSON.stringify({
  mensajes: t.mensajes.map((m) => [m.nodo, m.a, m.tipo, m.cuerpo, m.payload, m.ok]),
  avisos: t.avisos.map((m) => [m.nodo, m.a, m.tipo, m.cuerpo, m.payload, m.ok]),
  cierres: t.llamadas.cierre, ingesta: t.llamadas.ingesta, cotejo: t.llamadas.cotejo, fallo: t.fallo ? t.fallo.mensaje : null,
}).replace(/wamid[._]ENT\d+/g, 'wamid.ENT'));   // el id del mensaje ENTRANTE lo numera el arnés de pruebas (un contador global): no es salida del flujo

/** La conversación completa: saludo, pedido (QR), comprobante que cuadra, reserva, derivación. Devuelve los turnos en orden. */
function conversacion(w: Mundial, extraccionPedido: J = EXT_PEDIDO()): { nombre: string; t: ResultadoTurno }[] {
  const out: { nombre: string; t: ResultadoTurno }[] = [];
  const paso = (nombre: string, m: J, tolerar = true): ResultadoTurno => { const t = turno(w, m, tolerar); out.push({ nombre, t }); return t; };
  paso('saludo', texto('hola'));
  w.estado.extraccion = extraccionPedido;
  const resumen = paso('pedido (resumen)', texto('quiero 4 tacos de birria'));
  const qr = paso('pedido (QR)', boton(idDeBoton(resumen, 'Confirmar pedido'), 'Confirmar pedido'));
  const abierto = qr.llamadas.ingesta.find((x) => x['evento'] === 'qr_enviado');
  const ref = String(abierto?.['referencia'] ?? '');
  const total = Number(abierto?.['monto']);
  w.estado['monto'] = total;
  w.mundo.dobles['Traer configuración'] = () => ({ statusCode: 200, body: { ...panel(), cobro: { activo: true, qr: { url: 'https://qr.ejemplo.invalid/qtaco.png' }, pendiente: true, monto: total, pedido: ref } } });
  paso('comprobante', IMAGEN);
  w.mundo.dobles['Traer configuración'] = () => ({ statusCode: 200, body: panel() });
  w.estado.extraccion = EXT_RESERVA;
  paso('reserva (pide)', boton('m|reserva', 'Reservar mesa'));
  paso('reserva (datos)', texto('quiero reservar una mesa'));
  paso('reserva (envía)', boton('r|enviar', 'Reservar'));
  paso('derivación', texto('quiero hablar con una persona'));
  return out;
}
const sinLaRama = (): Flujo => {
  const f = copia(CRM);
  f.nodes = f.nodes.filter((n) => !NODOS_DE_CRM.includes(n.name));
  for (const k of NODOS_DE_CRM) delete f.connections[k];
  f.connections['Armar mensajes'] = { main: [(f.connections['Armar mensajes']?.main?.[0] ?? []).filter((c) => !NODOS_DE_CRM.includes(c.node))] };
  return f;
};
const conPrueba = (f: Flujo, js: (codigo: string) => string): Flujo => {
  const c = copia(f);
  const n = c.nodes.find((x) => x.name === 'Armar mensajes')!;
  n.parameters['jsCode'] = js(String(n.parameters['jsCode']));
  return c;
};
const CIERRE_TRY = '} catch (e) { AM_prospectoCrm = null; }';
const FORZADO = "\nfunction vmProspectoCrm() { throw new Error('prospecto inesperado'); }";
const corrioLaRama = (t: ResultadoTurno): boolean => t.ejecutados.has('Prospecto para la planilla') && t.ejecutados.has('Decidir fila de la planilla');

describe('flujo: «Reserva» (P) y «Pedido» (Q) solo con lo que de verdad salió', () => {
  const SIN_AVISO = { error: { message: 'rechazado' } };
  type Hoja = ReturnType<typeof planilla>;
  /** Lo que el turno escribió en la hoja (los dobles de Google guardan el ítem que recibieron). */
  const escritas = (pl: Hoja, antes: number): J[] => [...pl.escrituras, ...pl.actualizaciones].slice(antes);
  const total = (pl: Hoja): number => pl.escrituras.length + pl.actualizaciones.length;
  const caerAvisos = (w: Mundial): void => { w.mundo.dobles['Enviar aviso'] = () => SIN_AVISO; w.mundo.dobles['Aviso de respaldo'] = () => SIN_AVISO; };
  const enviaReserva = (o: { flujo?: Flujo; cae?: boolean } = {}): J[] => {
    const pl = planilla();
    const w = mundo({ pl, flujo: o.flujo });
    if (o.cae) caerAvisos(w);
    turno(w, texto('hola'));
    w.estado.extraccion = EXT_RESERVA;
    turno(w, boton('m|reserva', 'Reservar mesa'));
    turno(w, texto('quiero reservar una mesa'));
    const antes = total(pl);
    turno(w, boton('r|enviar', 'Reservar'));
    return escritas(pl, antes);
  };
  const pedidoSinQr = (cae: boolean): J[] => {
    const pl = planilla();
    const w = mundo({ pl });
    w.mundo.dobles['Traer configuración'] = () => ({ statusCode: 200, body: { ...panel(), cobro: { activo: false } } });
    if (cae) caerAvisos(w);
    turno(w, texto('hola'));
    w.estado.extraccion = EXT_PEDIDO();
    const resumen = turno(w, texto('quiero 4 tacos de birria'));
    const antes = total(pl);
    turno(w, boton(idDeBoton(resumen, 'Confirmar pedido'), 'Confirmar pedido'));
    return escritas(pl, antes);
  };
  it('el turno que envía la reserva escribe P «\'Enviada …»; con «Enviar aviso» caído no escribe P y O dice «Reserva»', () => {
    const ok = enviaReserva();
    expect(ok).toHaveLength(1);
    expect(String(ok[0]!['Reserva'])).toMatch(/^'Enviada \d{4}-\d\d-\d\d \d\d:\d\d$/);
    const caido = enviaReserva({ cae: true });
    expect(caido).toHaveLength(1);
    expect(caido[0]!['Reserva']).toBeUndefined();
    expect(caido[0]!['Eligió']).toBe("'Reserva");
  });
  it('pedido con QR escribe Q «\'Registrado …»; sin QR con el aviso salido también; sin QR y sin aviso no escribe Q', () => {
    const pl = planilla();
    const w = mundo({ pl });
    const ts = conversacion(w);
    expect(ts.find((x) => x.nombre === 'pedido (QR)')).toBeDefined();
    expect(pl.escrituras.some((e) => String(e['Pedido'] ?? '').startsWith("'Registrado ")), 'el turno del QR escribe Q').toBe(true);
    expect(String([...pl.escrituras, ...pl.actualizaciones].map((e) => e['Pedido']).find((v) => v !== undefined))).toMatch(/^'Registrado \d{4}-\d\d-\d\d \d\d:\d\d$/);
    const conAviso = pedidoSinQr(false);
    expect(conAviso).toHaveLength(1);
    expect(String(conAviso[0]!['Pedido'])).toMatch(/^'Registrado /);
    const sinAviso = pedidoSinQr(true);
    expect(sinAviso).toHaveLength(1);
    expect(sinAviso[0]!['Pedido']).toBeUndefined();
    expect(sinAviso[0]!['Eligió']).toBe("'Pedido");
  });
  it('negación: si `pasoSalio` llegara undefined, la prueba del aviso salido FALLA (la mutación se detecta)', () => {
    const mutado = conPrueba(CRM, (js) => { expect(js).toContain('pasoSalio: AM_PASO'); return js.replace('pasoSalio: AM_PASO', 'pasoSalio: undefined'); });
    const mut = enviaReserva({ flujo: mutado });
    expect(mut[0]!['Reserva']).toBeUndefined();   // el código bueno escribe P aquí (prueba de arriba): con la mutación no, así que esa prueba se pone roja
  });
});

describe('flujo: el miniCRM escribe lo que debe, una vez por evento', () => {
  it('saludo -> UNA fila (Tibio); pedido -> actualiza (Caliente, «N.º …»); comprobante -> actualiza «comprobante recibido, datos coinciden»', () => {
    const pl = planilla();
    const w = mundo({ pl });
    const turnos = conversacion(w);
    expect(turnos.every((x) => x.t.fallo === null)).toBe(true);
    // 1. el saludo agregó la fila (la hoja de prueba no guarda: cada evento posterior vuelve a «agregar»; lo que importa es qué dice cada escritura y que sea UNA por turno)
    const porTurno = turnos.map((x) => (x.t.porNodo['Agregar fila'] ?? []).length + (x.t.porNodo['Actualizar fila'] ?? []).length);
    expect(porTurno).toEqual([1, 1, 1, 1, 1, 0, 1, 1]);   // saludo, elige pedido (resumen), QR, comprobante, elige reserva, (datos: nada), envía, derivación
    expect(pl.escrituras[0]!['Clasificación']).toBe('Tibio');
    expect(pl.escrituras[0]!['ID Lead']).toBe('LEAD-1011');
    expect(String(pl.escrituras[0]!['Teléfono WhatsApp'])).toBe(`'${CLIENTE}`);
    // la hoja de prueba no cambia entre turnos (el doble no guarda): cada evento posterior busca la fila y, como no hay, agrega otra; lo que importa es QUÉ dice cada escritura
    const escrito = [...pl.escrituras, ...pl.actualizaciones];
    const resumenes = escrito.map((e) => String(e['Resumen Chatbot IA'] ?? ''));
    expect(resumenes.some((r) => /^'N\.º \S+, 4 ítems, Bs 84, recojo$/.test(r))).toBe(true);
    expect(resumenes.some((r) => /^'N\.º \S+, 4 ítems, Bs 84, recojo, comprobante recibido, datos coinciden$/.test(r))).toBe(true);
    expect(escrito.some((e) => e['Eligió'] === "'Reserva")).toBe(true);
    expect(escrito.some((e) => String(e['Reserva'] ?? '').startsWith("'Enviada "))).toBe(true);
    expect(escrito.some((e) => e['Derivación a recepción'] === "'Sí")).toBe(true);
  });
  it('un turno sin evento (el cliente sigue conversando dentro de la ventana) no toca Google', () => {
    const pl = planilla();
    const w = mundo({ pl });
    turno(w, texto('hola'));
    pl.escrituras.length = 0; pl.actualizaciones.length = 0; pl.lecturas.length = 0;
    const t = turno(w, texto('¿dónde están ubicados?'));
    expect(corrioLaRama(t)).toBe(false);
    expect(pl.lecturas).toEqual([]);
  });
  it('A4 un solo evento por turno: el turno del comprobante (con el pedido ya guardado) escribe UNA fila/actualización', () => {
    const pl = planilla();
    const w = mundo({ pl });
    const ts = conversacion(w);
    const comp = ts.find((x) => x.nombre === 'comprobante')!.t;
    expect(comp.porNodo['Prospecto para la planilla'] ?? []).toHaveLength(1);
    expect(comp.porNodo['Decidir fila de la planilla'] ?? []).toHaveLength(1);
    expect((comp.porNodo['Agregar fila'] ?? []).length + (comp.porNodo['Actualizar fila'] ?? []).length).toBe(1);
    const p = (comp.porNodo['Prospecto para la planilla'] ?? [])[0]!;
    expect(String(p['resumenVenta'])).toMatch(/N\.º \S+, 4 ítems, Bs 84, recojo, comprobante recibido, datos coinciden/);
    expect(p['quePidio']).toBe('');
  });
  it('A4 (módulo) pedido + comprobante en el MISMO turno: un prospecto, una acción, una escritura', () => {
    const p = prospecto({ plan: { ruta: 'comprobante:cuadra', pedido: PEDIDO, aviso: { tipo: 'comprobante', datos: PEDIDO } } })!;
    expect(Array.isArray(p)).toBe(false);
    expect(p['resumenVenta']).toMatch(/^N\.º K7P2.*comprobante recibido, datos coinciden$/);
    const salidaDecidir = M.crmDecidirFila({ prospectos: [{ json: p }], busqueda: [], lecturaIds: IDS, encabezados: ENCABEZADOS, mapa: copia(MAPA), adaptador: M.CRM_ADAPTADOR, ahoraMs: AHORA }) as unknown[];
    expect(salidaDecidir).toHaveLength(1);
  });
  it('A6 (flujo) el total escrito es el calculado: aunque el modelo extraiga un «total» distinto, la hoja dice Bs 84 = el monto del QR', () => {
    const pl = planilla();
    const w = mundo({ pl });
    const ts = conversacion(w, EXT_PEDIDO({ total: 5, resumen: 'Bs 5', precio: 1 }));
    const qr = ts.find((x) => x.nombre === 'pedido (QR)')!.t;
    expect(qr.llamadas.ingesta.find((x) => x['evento'] === 'qr_enviado')?.['monto']).toBe(84);
    const resumenes = [...pl.escrituras, ...pl.actualizaciones].map((e) => String(e['Resumen Chatbot IA'] ?? ''));
    expect(resumenes.filter((r) => /Bs/.test(r)).every((r) => /Bs 84,/.test(r))).toBe(true);
    expect(resumenes.join('|')).not.toMatch(/Bs 5\b/);
  });
  it('A5 (flujo) nada de lo escrito en toda la conversación dice «pagado», «acreditado» ni «simulado»', () => {
    const pl = planilla();
    conversacion(mundo({ pl }));
    const todo = JSON.stringify([...pl.escrituras, ...pl.actualizaciones]);
    expect(todo.length).toBeGreaterThan(100);
    expect(todo).not.toMatch(/pagad|acreditad|simulad|\bpago\b/i);
  });
  it('A8 (flujo) la memoria de n8n: dentro de 48 h se actualiza la fila más reciente; pasadas 48 h se AGREGA una fila nueva', () => {
    const previa = (n: number): { json: J } => fila(n, { 'Teléfono WhatsApp': `+${CLIENTE}`, 'Nombre y Apellido': 'Carlos', 'Clasificación': 'Tibio' });
    const pl = planilla({ filas: [previa(5), previa(9)] });
    const w = mundo({ pl });
    turno(w, texto('hola'));                       // primer contacto: sin registro previo, actualiza la más reciente
    expect(pl.actualizaciones.length + pl.escrituras.length).toBeLessThanOrEqual(1);
    pl.escrituras.length = 0; pl.actualizaciones.length = 0;
    w.mundo.avanzar(26 * 60);                      // 26 h: ventana nueva, dentro de las 48 h
    turno(w, texto('hola de nuevo'));
    expect(pl.escrituras).toHaveLength(0);         // dentro de las 48 h NO se agrega una fila: se actualiza la más reciente
    expect(pl.actualizaciones).toHaveLength(1);
    expect(pl.actualizaciones[0]!['row_number']).toBe(9 + 2);
    const sd = (w.mundo.sd['ventaMinima'] as J)['crmVisto'] as J;
    expect(Object.keys(sd)).toEqual([L.vmCrmClave(CLIENTE)]);
    expect(JSON.stringify(w.mundo.sd)).not.toContain(CLIENTE);
    w.mundo.avanzar(50 * 60);                      // 50 h sin mensajes
    turno(w, texto('buenas'));
    expect(pl.escrituras).toHaveLength(1);
    expect(pl.escrituras[0]!['ID Lead']).toBe('LEAD-1011');
  });
  it('sin id de planilla (marcador / vacío / variante de prueba) NO calcula el prospecto, ni consulta Google', () => {
    const pl = planilla();
    const w = mundo({ pl, conHoja: false });
    const ts = conversacion(w);
    for (const { t } of ts) {
      expect(corrioLaRama(t)).toBe(false);
      for (const s of t.porNodo['Armar mensajes'] ?? []) expect(s['guardarPlanilla']).toBe(false);
    }
    expect(pl.lecturas).toEqual([]);
    expect(Object.keys((w.mundo.sd['ventaMinima'] as J)['crmVisto'] ?? {})).toEqual([]);
  });
  it('las lecturas llegan hasta la T (nunca a la U) y la de los IDs solo a la A', () => {
    const pl = planilla();
    turno(mundo({ pl }), texto('hola'));
    expect(pl.lecturas).toContain('buscar|A3:T');
    expect(pl.lecturas).toContain('ids|A3:A');
    expect(pl.lecturas).toContain('enc|A3:T3');
    expect(pl.lecturas.some((l) => /:U|:V/.test(l))).toBe(false);
  });
  it('encabezados distintos (la hoja viva no coincide) -> no agrega', () => {
    const pl = planilla({ enc: [{ json: { values: [['ID Lead', 'Otra cosa']] } as J }] });
    const t = turno(mundo({ pl }), texto('hola'));
    expect(corrioLaRama(t)).toBe(true);
    expect(pl.escrituras).toEqual([]);
    expect(String((t.porNodo['Decidir fila de la planilla'] ?? [])[0]?.['veredictoPlanilla'])).toMatch(/^encabezados_distintos/);
  });
});

// ================================================================================================ EL REQUISITO CLAVE: NO AFECTAN LAS RESPUESTAS
describe('I-1: si el estado no quedó comprometido, la hoja NO recibe un pedido que no existe', () => {
  const hastaConfirmar = (pl: Planilla, flujo: Flujo = CRM): { w: Mundial; id: string } => {
    const w = mundo({ pl, flujo });
    turno(w, texto('hola'));
    w.estado.extraccion = EXT_PEDIDO();
    const resumen = turno(w, texto('quiero 4 tacos de birria'));
    pl.escrituras.length = 0; pl.actualizaciones.length = 0; pl.lecturas.length = 0;
    return { w, id: idDeBoton(resumen, 'Confirmar pedido') };
  };
  const SIN_PUERTA = (js: string): string => js.replace(/\{\n  let descartar = false;[\s\S]*?if \(descartar\) return \[\];\n\}\n/, '');
  const sinPuerta = (): Flujo => { const f = copia(CRM); const n = nodoDe(f, 'Prospecto para la planilla'); n.parameters['jsCode'] = SIN_PUERTA(String(n.parameters['jsCode'])); return f; };
  it('control: con el servidor sano el QR confirma el pedido y la hoja SÍ recibe «Pedido» con su N.º', () => {
    const pl = planilla();
    const { w, id } = hastaConfirmar(pl);
    const t = turno(w, boton(id, 'Confirmar pedido'));
    expect(t.mensajes.some((m) => m.tipo === 'image')).toBe(true);
    expect(pl.escrituras.length + pl.actualizaciones.length).toBe(1);
    expect(String([...pl.escrituras, ...pl.actualizaciones][0]!['Resumen Chatbot IA'])).toMatch(/N\.º \S+, 4 ítems, Bs 84, recojo/);
  });
  it('Comprometer turno en 5xx: solo sale el genérico, el pedido no se guardó y la hoja NO recibe nada', () => {
    const pl = planilla();
    const { w, id } = hastaConfirmar(pl);
    w.sesion.servidor.fallar = (c: J) => ((c['sesion'] as J)['accion'] === 'comprometer' ? 503 : null);
    const t = turno(w, boton(id, 'Confirmar pedido'), true);
    expect(t.mensajes.some((m) => m.tipo === 'image')).toBe(false);
    expect(t.ejecutados.has('Prospecto para la planilla')).toBe(true);   // la rama arrancó…
    expect(t.ejecutados.has('Buscar teléfono en planilla')).toBe(false);  // …y la puerta cortó antes de tocar Google
    expect(pl.lecturas).toEqual([]);
    expect(pl.escrituras).toEqual([]);
    expect(pl.actualizaciones).toEqual([]);
  });
  it('Comprometer turno con CONFLICTO de versión sin hecho externo: el turno cede sin enviar nada y la hoja NO recibe nada', () => {
    const pl = planilla();
    const { w, id } = hastaConfirmar(pl);
    w.sesion.servidor.antesDeComprometer = (c: J) => {
      w.sesion.servidor.antesDeComprometer = null;
      if ((c['sesion'] as J)['accion'] === 'comprometer') w.sesion.sembrar(CLIENTE, { ...estadoDe(w), paso: 'menu' }, w.sesion.pedidos(CLIENTE));
    };
    const t = turno(w, boton(id, 'Confirmar pedido'), true);
    expect(t.mensajes).toHaveLength(0);
    expect(pl.lecturas).toEqual([]);
    expect(pl.escrituras).toEqual([]);
    expect(pl.actualizaciones).toEqual([]);
  });
  it('MUTACIÓN: sin la puerta, el mismo 5xx y el mismo conflicto SÍ escriben un pedido que no existe (la prueba de arriba detecta la puerta)', () => {
    const pl = planilla();
    const { w, id } = hastaConfirmar(pl, sinPuerta());
    w.sesion.servidor.fallar = (c: J) => ((c['sesion'] as J)['accion'] === 'comprometer' ? 503 : null);
    turno(w, boton(id, 'Confirmar pedido'), true);
    expect(pl.escrituras.length + pl.actualizaciones.length).toBeGreaterThan(0);
    const pl2 = planilla();
    const r2 = hastaConfirmar(pl2, sinPuerta());
    r2.w.sesion.servidor.antesDeComprometer = (c: J) => {
      r2.w.sesion.servidor.antesDeComprometer = null;
      if ((c['sesion'] as J)['accion'] === 'comprometer') r2.w.sesion.sembrar(CLIENTE, { ...estadoDe(r2.w), paso: 'menu' }, r2.w.sesion.pedidos(CLIENTE));
    };
    turno(r2.w, boton(r2.id, 'Confirmar pedido'), true);
    expect(pl2.escrituras.length + pl2.actualizaciones.length).toBeGreaterThan(0);
  });
  it('la puerta existe en el JSON y no cambia nada para un turno que no compromete (el saludo sigue escribiendo)', () => {
    expect(String(nodoDe(CRM, 'Prospecto para la planilla').parameters['jsCode'])).toContain('if (descartar) return [];');
    expect(SIN_PUERTA(String(nodoDe(CRM, 'Prospecto para la planilla').parameters['jsCode']))).not.toContain('descartar');
    const pl = planilla();
    turno(mundo({ pl }), texto('hola'));
    expect(pl.escrituras).toHaveLength(1);
  });
});

describe('los nodos del miniCRM NO afectan las respuestas (A2, A3)', () => {
  const baseline = (): Array<{ nombre: string; s: J }> => conversacion(mundo({ flujo: sinLaRama(), conHoja: false })).map((x) => ({ nombre: x.nombre, s: salida(x.t) }));
  const igual = (otros: { nombre: string; t: ResultadoTurno }[], etiqueta: string): void => {
    const base = baseline();
    expect(otros.map((x) => x.nombre)).toEqual(base.map((x) => x.nombre));
    otros.forEach((x, i) => expect(salida(x.t), `${etiqueta}: «${x.nombre}»`).toEqual(base[i]!.s));
  };
  it('control: el baseline (sin la rama) responde de verdad en todos los casos normales', () => {
    const base = conversacion(mundo({ flujo: sinLaRama(), conHoja: false }));
    const por = Object.fromEntries(base.map((x) => [x.nombre, x.t]));
    expect(por['saludo']!.mensajes.length).toBeGreaterThan(0);
    expect(por['pedido (QR)']!.mensajes.some((m) => m.tipo === 'image')).toBe(true);
    expect(por['comprobante']!.mensajes.length).toBeGreaterThan(0);
    expect(por['comprobante']!.avisos.length).toBeGreaterThan(0);
    expect(por['reserva (envía)']!.mensajes.length).toBeGreaterThan(0);
    expect(por['reserva (envía)']!.avisos.length).toBeGreaterThan(0);
    expect(por['derivación']!.mensajes.length).toBeGreaterThan(0);
    expect(base.every((x) => x.t.fallo === null)).toBe(true);
  });
  it('A2 con el miniCRM encendido (saludo, pedido, comprobante, reserva, derivación) la secuencia de mensajes y avisos es IDÉNTICA a la del flujo sin los 8 nodos', () => {
    const pl = planilla();
    igual(conversacion(mundo({ pl })), 'con planilla');
    expect(pl.escrituras.length + pl.actualizaciones.length).toBeGreaterThan(3);   // no es una prueba vacía: SÍ escribió
  });
  it('A2 con el id vacío (miniCRM apagado) es idéntica', () => {
    igual(conversacion(mundo({ conHoja: false })), 'apagado');
  });
  it('A2 con Google CAÍDO (todos los nodos de Google fallan) el cliente recibe lo mismo y no se escribe nada', () => {
    const pl = planilla({ caida: true });
    igual(conversacion(mundo({ pl })), 'Google caído');
    expect(pl.escrituras).toEqual([]);
    expect(pl.actualizaciones).toEqual([]);
  });
  it('A2 con las lecturas devolviendo basura (sin filas, errores de Google como ítems) el cliente recibe lo mismo', () => {
    const pl = planilla({ filas: [{ json: { error: { message: 'quota' } } }], ids: [{ json: { error: { message: 'quota' } } }], enc: [{ json: { error: { message: 'quota' } } }] });
    igual(conversacion(mundo({ pl })), 'lecturas con error');
    expect(pl.escrituras).toEqual([]);
  });
  it('A3 con `vmProspectoCrm` forzado a lanzar: el turno responde igual, «Armar mensajes» devuelve la respuesta y no hay salida hacia la planilla', () => {
    const pl = planilla();
    const forzado = conPrueba(CRM, (js) => {
      expect(js.includes(CIERRE_TRY)).toBe(true);
      return js + FORZADO;
    });
    const ts = conversacion(mundo({ flujo: forzado, pl }));
    igual(ts, 'prospecto lanza');
    for (const { t } of ts) {
      expect(corrioLaRama(t)).toBe(false);
      expect(t.ejecutados.has('Armar mensajes')).toBe(true);
      for (const s of t.porNodo['Armar mensajes'] ?? []) { expect(s['guardarPlanilla']).toBe(false); expect(s['prospectoPlanilla']).toBeNull(); expect(Array.isArray(s['salida'])).toBe(true); }
    }
    expect(pl.lecturas).toEqual([]);
    expect(pl.escrituras).toEqual([]);
  });
  it('A3, la mutación: sin el try/catch el mismo fallo SÍ tumba el turno (la protección de arriba es real)', () => {
    const sinProteccion = conPrueba(CRM, (js) => js.replace(CIERRE_TRY, '} finally { }') + FORZADO);
    const w = mundo({ flujo: sinProteccion, pl: planilla() });
    expect(() => turno(w, texto('hola'))).toThrow();
  });
  it('A2 la secuencia sigue igual si falla un envío: Meta rechaza el principal (respaldo en texto) con y sin planilla', () => {
    const con = (flujo: Flujo, conHoja: boolean): J => {
      const w = crear({ 'Enviar a WhatsApp': 'error explícito (media ID vencido)' }, flujo, conHoja ? BASE_CON_PLANILLA : {});
      for (const [k, v] of Object.entries(planilla().dobles)) w.mundo.dobles[k] = v;
      return salida(turno(w, texto('hola'), true));
    };
    expect(con(CRM, true)).toEqual(con(sinLaRama(), false));
  });
  it('A2 ningún nodo del miniCRM llama a Meta ni envía: 0 mensajes por conversación agregados (ni mensajes ni avisos salen de un nodo de la rama)', () => {
    const pl = planilla();
    const ts = conversacion(mundo({ pl }));
    const delCrm = new Set(NODOS_DE_CRM);
    for (const { t } of ts) {
      expect([...t.mensajes, ...t.avisos].filter((m) => delCrm.has(m.nodo))).toEqual([]);
      expect(t.registro.filter((r) => delCrm.has(r.nodo) && r.rol !== null)).toEqual([]);
    }
    for (const n of CRM.nodes.filter((x) => delCrm.has(x.name))) {
      expect(JSON.stringify(n.parameters), n.name).not.toMatch(/graph\.facebook\.com|messaging_product|\/messages/);
      if (n.type === 'n8n-nodes-base.httpRequest') expect(String(n.parameters['url']), n.name).toMatch(/^=\{\{ 'https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\//);
    }
    const mensajes = (f: Flujo, hoja: boolean): number => conversacion(mundo({ flujo: f, conHoja: hoja, pl: planilla() })).reduce((a, x) => a + x.t.mensajes.length + x.t.avisos.length, 0);
    expect(mensajes(CRM, true)).toBe(mensajes(sinLaRama(), false));
  });
  it('el negativo de A2: un nodo de la rama que enviara a Meta hace fallar `construir.mjs --verificar`', () => {
    const r = verificarEnCopia((vm) => editarJson(vm, F3727, (f) => {
      nodoDe(f, 'Agregar fila').type = 'n8n-nodes-base.httpRequest';
      nodoDe(f, 'Agregar fila').parameters = { method: 'POST', url: '=https://graph.facebook.com/v26.0/123/messages' };
    }));
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/miniCRM: «Agregar fila» envía a Meta|menciona graph\.facebook\.com/);
  });
  it('el negativo de A2 con mayúsculas: una llamada a Graph que no es /messages, escrita en mayúsculas, también hace fallar `--verificar`', () => {
    const r = verificarEnCopia((vm) => editarJson(vm, F3727, (f) => {
      nodoDe(f, 'Agregar fila').type = 'n8n-nodes-base.httpRequest';
      nodoDe(f, 'Agregar fila').parameters = { method: 'POST', url: '=https://GRAPH.facebook.com/v26.0/123/subscribed_apps' };
    }));
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/menciona graph\.facebook\.com/);
  });
});

// ================================================================================================ LA ACEPTACIÓN SOBRE EL JSON (A1, A10, A11, A12)
describe('aceptación sobre el JSON versionado', () => {
  const y = (f: Flujo, n: string): number => (nodoDe(f, n).position as [number, number])[1];
  it('A1 posición: el primer nodo de la rama está debajo de «Enviar a WhatsApp» y de «¿Registrar cierre?», encima de «Resumen del turno», que sigue siendo el más bajo', () => {
    const primero = y(CRM, 'Prospecto para la planilla');
    expect(primero).toBe(700);
    expect(primero).toBeGreaterThan(y(CRM, 'Enviar a WhatsApp'));
    expect(primero).toBeGreaterThan(y(CRM, '¿Registrar cierre?'));
    for (const n of NODOS_DE_CRM) expect(y(CRM, n), n).toBeLessThan(y(CRM, 'Resumen del turno'));
    const cuelgan = new Set<string>(['Armar mensajes']);
    const cola = ['Armar mensajes'];
    while (cola.length) for (const salidas of CRM.connections[cola.shift()!]?.['main'] ?? []) for (const c of salidas ?? []) if (!cuelgan.has(c.node)) { cuelgan.add(c.node); cola.push(c.node); }
    expect(Math.max(...CRM.nodes.filter((n) => cuelgan.has(n.name)).map((n) => (n.position as [number, number])[1]))).toBe(y(CRM, 'Resumen del turno'));
    // en el orden de ejecución (executionOrder v1) la rama corre DESPUÉS del envío, del cierre y del resumen
    const hijos = (CRM.connections['Armar mensajes']?.['main']?.[0] ?? []).map((c) => c.node);
    expect(hijos).toEqual(['¿Comprometer turno?', 'Prospecto para la planilla']);
  });
  it('A1 en el mundo: la rama corre al final, después del envío al cliente, del cierre y del resumen', () => {
    const pl = planilla();
    const w = mundo({ pl });
    turno(w, texto('hola'));
    w.estado.extraccion = EXT_PEDIDO();
    const resumen = turno(w, texto('quiero 4 tacos de birria'));
    const t = turno(w, boton(idDeBoton(resumen, 'Confirmar pedido'), 'Confirmar pedido'));
    const o = t.orden;
    const pos = (n: string): number => o.lastIndexOf(n);
    expect(corrioLaRama(t)).toBe(true);
    for (const antes of ['Enviar a WhatsApp', 'Registrar cierre', 'Resumen del turno']) expect(o.indexOf('Prospecto para la planilla'), antes).toBeGreaterThan(pos(antes));
  });
  for (const [titulo, cambia] of [
    ['A1 negativo: la rama por encima de «Enviar a WhatsApp» hace fallar --verificar', (f: Flujo) => { for (const n of f.nodes) if (NODOS_DE_CRM.includes(n.name)) (n.position as [number, number])[1] -= 600; }],
    ['A1 negativo: la rama por debajo de «Resumen del turno» hace fallar --verificar', (f: Flujo) => { for (const n of f.nodes) if (NODOS_DE_CRM.includes(n.name)) (n.position as [number, number])[1] += 600; }],
  ] as [string, (f: Flujo) => void][]) {
    it(titulo, () => {
      const r = verificarEnCopia((vm) => editarJson(vm, F3727, cambia));
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/miniCRM/);
    });
  }
  it('A10 sin credenciales de otro tenant: todos los nodos de Google usan «Google Sheets miniCRM (crm-qtaco)» y `hallazgosCrm` no encuentra nada', () => {
    const nombres = CRM.nodes.filter((n) => NODOS_DE_CRM.includes(n.name)).flatMap((n) => Object.values(n.credentials ?? {}).map((c) => c.name));
    expect(nombres.length).toBe(5);
    expect(new Set(nombres)).toEqual(new Set(['Google Sheets miniCRM (crm-qtaco)']));
    expect(hallazgosCrm(CRM, MAPA)).toEqual([]);
    const ajena = verificarEnCopia((vm) => editarJson(vm, F3727, (f) => { for (const c of Object.values(nodoDe(f, 'Leer IDs de la planilla').credentials ?? {})) c.name = 'Google Sheets miniCRM (crm-rroca-ruben)'; }));
    expect(ajena.status).not.toBe(0);
    expect(ajena.stderr).toMatch(/credencial/);
  });
  it('A10 el id de la hoja no aparece en ningún archivo versionado: solo el marcador (JSON, datos, plantilla)', () => {
    const base = nodoDe(CRM, 'Config base').parameters['assignments']['assignments'] as J[];
    expect(base.find((a) => a['name'] === 'planillaProspectosId')?.['value']).toBe('REEMPLAZAR_PLANILLA_PROSPECTOS_ID_QTACO_3727');
    expect((DATOS['configBase'] as J)['planillaProspectosId']).toBe('REEMPLAZAR_PLANILLA_PROSPECTOS_ID_QTACO_3727');
    for (const f of [F3727, 'flujo.plantilla.json', 'venta-minima.qtaco.json', 'venta-minima.prueba.json', 'venta-minima.ensayo-demo-a.json']) {
      const t = readFileSync(join(VM, f), 'utf8');
      expect(t, f).not.toContain(ID_HOJA);
      expect(t, f).not.toMatch(/docs\.google\.com\/spreadsheets|spreadsheets\/d\/[A-Za-z0-9_-]{25,}/);
    }
    const real = verificarEnCopia((vm) => editarJson(vm, F3727, (f) => {
      const a = (nodoDe(f, 'Config base').parameters['assignments']['assignments'] as J[]).find((x) => x['name'] === 'planillaProspectosId')!;
      a['value'] = 'AbCdEfGhIjKlMnOpQrStUvWxYzAbCdEfGh';
    }));
    expect(real.status).not.toBe(0);
    expect(real.stderr).toMatch(/planillaProspectosId/);
  });
  // El modelo de M-OCR (venta-minima-flujo.test.ts): un nodo degradado a su peor caso (intentos × timeout), los demás con 1 s típico. Google Sheets no admite un timeout por parámetro: se supone el de «Extraer» (15 s por intento).
  const SUPUESTO_SIN_TIMEOUT_S = 15;       // (solo si un nodo perdiera su timeout explícito; hoy los 4 de Sheets llevan 10 s y el HTTP 20 s)
  const PEOR_ACTUAL_S = 58;                 // el peor caso del comprobante de hoy (M-OCR / DISENO.md)
  const CAMINO = ['Buscar teléfono en planilla', 'Leer IDs de la planilla', 'Leer encabezados de la planilla', 'Actualizar fila'];   // agregar o actualizar: una sola de las dos
  const peorDeCadaNodo = (f: Flujo): Record<string, number> => Object.fromEntries(CAMINO.map((nombre) => {
    const n = nodoDe(f, nombre) as unknown as J;
    const op = (n['parameters']['options'] ?? {}) as J;
    const timeout = typeof op['timeout'] === 'number' ? op['timeout'] / 1000 : SUPUESTO_SIN_TIMEOUT_S;
    const intentos = n['retryOnFail'] === true ? Number(n['maxTries'] ?? 3) : 1;
    const espera = n['retryOnFail'] === true ? (intentos - 1) * Number(n['waitBetweenTries'] ?? 1000) / 1000 : 0;
    return [nombre, intentos * timeout + espera];
  }));
  const peorCaso = (f: Flujo): number => PEOR_ACTUAL_S + (CAMINO.length - 1) + Math.max(...Object.values(peorDeCadaNodo(f)));
  it('A11 peor caso de tiempo: el turno más lento de hoy (58 s) más el peor caso de los nodos de Google cabe en el tope de ejecución de 120 s', () => {
    const limite = Number((CRM.settings as J)['executionTimeout']);
    expect(limite).toBe(120);
    const peor = peorDeCadaNodo(CRM);
    expect(peor['Leer encabezados de la planilla']).toBe(20);
    expect(peorCaso(CRM)).toBeLessThan(limite);
    for (const n of ['Buscar teléfono en planilla', 'Leer IDs de la planilla', 'Agregar fila', 'Actualizar fila']) expect((nodoDe(CRM, n).parameters['options'] as J)['timeout'], n).toBe(10000);
    for (const n of ['Prospecto para la planilla', 'Decidir fila de la planilla']) expect((nodoDe(CRM, n) as unknown as J)['onError'], n).toBe('continueRegularOutput');
    // la suma de TODOS los nodos de Google a su peor caso a la vez (cota pesimista): se declara; por eso la rama corre DESPUÉS del cliente (A1) y no puede retrasar nada de lo que él recibe
    expect(Object.values(peor)).toEqual([10, 10, 20, 10]);
    expect(Object.values(peor).reduce((a, b) => a + b, 0)).toBe(50);
    // si un nodo de Sheets perdiera su timeout explícito vuelve el supuesto de 15 s y la cota pesimista pasa del tope
    const sin = copia(CRM);
    for (const n of sin.nodes) if (n.type === 'n8n-nodes-base.googleSheets') delete (n.parameters['options'] as J)['timeout'];
    expect(Object.values(peorDeCadaNodo(sin)).reduce((a, b) => a + b, 0) + PEOR_ACTUAL_S).toBeGreaterThan(limite);
    expect(y(CRM, 'Prospecto para la planilla')).toBeGreaterThan(y(CRM, 'Enviar a WhatsApp'));
  });
  it('A11, el negativo: si un nodo de Google gana intentos o un timeout largo, la cuenta se pone roja (no es tautológica)', () => {
    const base = peorCaso(CRM);
    expect(base).toBeGreaterThan(60);   // 58 + 3 + 20
    const con = (cambia: (n: J) => void, nombre: string): number => { const c = copia(CRM); cambia(nodoDe(c, nombre) as unknown as J); return peorCaso(c); };
    expect(con((n) => { n['parameters']['options']['timeout'] = 60000; }, 'Leer encabezados de la planilla')).toBeGreaterThanOrEqual(120);
    expect(con((n) => { n['retryOnFail'] = true; n['maxTries'] = 8; }, 'Buscar teléfono en planilla')).toBeGreaterThanOrEqual(120);
  });
  it('A12 `construir.mjs --verificar` en 0 para todas las salidas; `executionOrder: v1` y retención `none` en el 3727', () => {
    const r = verificarEnCopia(() => undefined);
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    expect(r.stdout).toContain('venta-minima.qtaco-3727.json al día');
    expect(r.stdout).toContain('venta-minima.qtaco.json al día');
    expect(r.stdout).toContain('venta-minima.prueba.json al día');
    expect(CRM.settings).toMatchObject({ executionOrder: 'v1', saveDataSuccessExecution: 'none', saveDataErrorExecution: 'none', saveExecutionProgress: false, saveManualExecutions: false, executionTimeout: 120 });
  });
  it('A12 negativo: si el 3727 guardara las ejecuciones (retención `all`, con datos de la hoja), `--verificar` FALLA con ese motivo', () => {
    const r = verificarEnCopia((vm) => editarJson(vm, F3727, (f) => { (f.settings as J)['saveDataSuccessExecution'] = 'all'; }));
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/saveDataSuccessExecution «none»|la retencion de ejecuciones tiene que ser none/);
  });
  it('A12 negativo: si la ejecución dejara de ser `executionOrder: v1` el JSON versionado deja de coincidir y `--verificar` FALLA', () => {
    const r = verificarEnCopia((vm) => editarJson(vm, F3727, (f) => { (f.settings as J)['executionOrder'] = 'v0'; }));
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/difiere de lo que arma la plantilla/);
  });
  it('el tope de nodos de producción es 81 y el 3727 lleva exactamente 8 nodos más que el vivo', () => {
    const vivo = leer('venta-minima.qtaco.json');
    expect(CRM.nodes.length).toBe(vivo.nodes.length + 8);
    expect(readFileSync(join(VM, 'construir.mjs'), 'utf8')).toMatch(/const TOPE_DE_NODOS = 81;/);
    expect(CRM.nodes.length).toBeLessThanOrEqual(81);
  });
});

describe('sin el dato `crm` no se activa nada (las demás salidas)', () => {
  it('el vivo, la prueba y el ensayo no llevan un solo nodo de la planilla; «Armar mensajes» no escribe y su configuración la deja vacía', () => {
    for (const f of ['venta-minima.qtaco.json', 'venta-minima.prueba.json', 'venta-minima.ensayo-demo-a.json']) {
      const flujo = leer(f);
      expect(flujo.nodes.filter((n) => NODOS_DE_CRM.includes(n.name)), f).toEqual([]);
      expect((flujo.connections['Armar mensajes']?.['main']?.[0] ?? []).map((c) => c.node), f).toEqual(['¿Comprometer turno?']);
    }
  });
  it('aunque se le diera un id de hoja al flujo vivo, no hay nada que escriba (no tiene la rama): el cliente recibe lo mismo', () => {
    const vivo = leer('venta-minima.qtaco.json');
    const con = conversacion(crear({}, vivo, BASE_CON_PLANILLA)).map((x) => salida(x.t));
    const sin = conversacion(crear({}, vivo, {})).map((x) => salida(x.t));
    expect(con).toEqual(sin);
  });
  it('la librería nueva solo se pega en «Armar mensajes»: ningún otro nodo trae `vmProspectoCrm`', () => {
    for (const f of ['venta-minima.qtaco.json', F3727, 'venta-minima.prueba.json']) {
      const con = leer(f).nodes.filter((n) => String(n.parameters['jsCode'] ?? '').includes('function vmProspectoCrm('));
      expect(con.map((n) => n.name), f).toEqual(['Armar mensajes']);
    }
  });
});
