/**
 * miniCRM, PR-F0: lo que los flujos de las subcuentas necesitan del módulo (31/10/2026).
 *   · `crmVerificarEncabezados`: agregar una fila nueva exige la fila de encabezados COMPLETA (no solo la A); lectura vacía = no agrega.
 *   · el adaptador general de señales y el contrato `CRM_ADAPTADOR` (sin textos de cliente; el resumen jamás dice «pagó»).
 *   · `ramaCrm` (8 nodos generados) y `hallazgosCrm`: ningún rango de lectura llega a la letra de `equipo.diagnostico` ni pasa de la última del bot;
 *     la retención de ejecuciones distinta de `none` está prohibida.
 * Mensajes por conversación: 0 (ninguna de estas piezas envía).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileFunction } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { GLOBALES_FUERA_DEL_SANDBOX } from '../../lib/flujo.ts';
// @ts-expect-error módulo .mjs sin tipos
import { hallazgosCrm, injertarCrm, inyectarMapa, MARCA_MAPA, NODO_ENCABEZADOS, ramaCrm, rangoEncabezados, rutasPaqueteCrmSenales } from '../../../../Flujos/experimental/comun-sin-agente/construir-crm.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..', '..', '..', '..');
const MODULOS = join(RAIZ, 'Flujos', 'src', 'modulos');
const leer = (r: string) => readFileSync(join(MODULOS, r), 'utf8');
type J = Record<string, unknown>;
type Item = { json: J };
const clonar = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

const T = {
  id: 'ID Lead', fecha: 'Fecha', nombre: 'Nombre y Apellido', empresa: 'Empresa', telefono: 'Teléfono', etapa: 'Etapa Funnel', origen: 'Origen',
  calif: 'Calificación IA', resumen: 'Resumen', valor: 'Valor', resp: 'Responsable', estado: 'Estado Comercial', prox: 'Próxima Acción',
  clasif: 'Clasificación', quePidio: 'Qué pidió', dia: 'Día preferido', horario: 'Horario preferido', deriv: 'Derivación a recepción',
  ultima: 'Última interacción', ventana: 'Se cierra la ventana de 24 h', diag: 'Diagnóstico del equipo',
};
const MAPA = {
  filaEncabezados: 3, prefijoId: 'L-', primerId: 1,
  columnas: {
    id: { letra: 'A', titulo: T.id }, fecha: { letra: 'B', titulo: T.fecha }, nombre: { letra: 'C', titulo: T.nombre }, empresa: { letra: 'D', titulo: T.empresa },
    telefono: { letra: 'E', titulo: T.telefono }, etapaInicial: { letra: 'F', titulo: T.etapa }, origen: { letra: 'G', titulo: T.origen },
    calificacion: { letra: 'H', titulo: T.calif }, resumen: { letra: 'I', titulo: T.resumen },
    clasificacion: { letra: 'N', titulo: T.clasif }, quePidio: { letra: 'O', titulo: T.quePidio }, diaPreferido: { letra: 'P', titulo: T.dia },
    horarioPreferido: { letra: 'Q', titulo: T.horario }, derivacion: { letra: 'R', titulo: T.deriv }, ultimaInteraccion: { letra: 'S', titulo: T.ultima },
    ventana24h: { letra: 'T', titulo: T.ventana },
  } as Record<string, { letra: string; titulo: string }>,
  equipo: {
    valor: { letra: 'J', titulo: T.valor }, responsable: { letra: 'K', titulo: T.resp }, estado: { letra: 'L', titulo: T.estado },
    proximaAccion: { letra: 'M', titulo: T.prox }, diagnostico: { letra: 'U', titulo: T.diag },
  } as Record<string, { letra: string; titulo: string } | null>,
  extrasDelEquipo: {} as Record<string, string>,
  alCrear: { etapaInicial: '1. Nuevo', origen: 'Chatbot', origenAnuncio: 'Anuncio', estado: 'Activo' } as J,
};
const BOT = [T.id, T.fecha, T.nombre, T.empresa, T.telefono, T.etapa, T.origen, T.calif, T.resumen, T.valor, T.resp, T.estado, T.prox,
  T.clasif, T.quePidio, T.dia, T.horario, T.deriv, T.ultima, T.ventana]; // A..T: la U no se lee
const AHORA = Date.UTC(2026, 9, 31, 15, 0, 0);
const TEL = ['59', '17', '000', '020'].join('');
const ADAPT = leer('crm/adaptador-senales.js');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const M: any = compileFunction(`${inyectarMapa(leer('crm/crm.js'), MAPA)}\n${ADAPT}\nreturn { crmDecidirFila, crmVerificarEncabezados, crmAdaptadorValido, CRM_ADAPTADOR };`, [])();

const filaEnc = (extra: J = {}): Item => ({ json: { row_number: 4, ...Object.fromEntries(BOT.map((t) => [t, ''])), ...extra } });
const ids: Item[] = [{ json: { row_number: 4, [T.id]: 'L-7' } }];
const decidir = (p: J, encabezados?: Item[], ...adaptador: unknown[]) =>
  M.crmDecidirFila({ prospectos: [{ json: p }], busqueda: [], lecturaIds: ids, encabezados, mapa: clonar(MAPA), adaptador: adaptador.length ? adaptador[0] : M.CRM_ADAPTADOR, ahoraMs: AHORA })[0].json as J;

describe('verificar encabezados antes de AGREGAR', () => {
  const p = { telefono: TEL, nombre: 'Ana', senales: { pidioUbicacion: true } };
  it('con la fila completa y en orden, agrega', () => expect(decidir(p, [filaEnc()]).accionPlanilla).toBe('agregar'));
  it('sin la lectura (flujos anteriores) rige la comprobación de siempre', () => expect(decidir(p).accionPlanilla).toBe('agregar'));
  it('la lectura vacía (hoja sin filas de datos) NO agrega', () => {
    for (const vacia of [[], [{ json: {} }]]) {
      const r = decidir(p, vacia as Item[]);
      expect(r.accionPlanilla).toBe('nada');
      expect(String(r.veredictoPlanilla)).toMatch(/^encabezados_distintos: no se pudo leer la fila 3/);
    }
  });
  it.each(BOT.slice(1).map((t, i) => [t, i + 1] as [string, number]))('un encabezado cambiado en «%s» (no la A) NO agrega', (titulo) => {
    const f = filaEnc(); const cambiado: J = {};
    for (const [k, v] of Object.entries(f.json)) cambiado[k === titulo ? titulo + ' (editado)' : k] = v;
    const r = decidir(p, [{ json: cambiado }]);
    expect(r.accionPlanilla).toBe('nada');
    expect(r.veredictoPlanilla).toBe(`encabezados_distintos: la fila 3 no tiene «${titulo}»`);
  });
  it('dos columnas del equipo intercambiadas, o una columna de más, NO agregan', () => {
    const base = Object.entries(filaEnc().json);
    const i = base.findIndex(([k]) => k === T.valor);
    const cruzado = [...base]; [cruzado[i], cruzado[i + 1]] = [cruzado[i + 1], cruzado[i]];
    expect(decidir(p, [{ json: Object.fromEntries(cruzado) }]).accionPlanilla).toBe('nada');
    expect(String(decidir(p, [filaEnc({ Sobrante: '' })]).veredictoPlanilla)).toMatch(/columnas de más/);
  });
  it('una lectura que falló no agrega y dice solo el código del error', () => {
    const r = decidir(p, [{ json: {}, error: { message: 'PERMISSION_DENIED para el usuario Ana' } } as Item]);
    expect(r.accionPlanilla).toBe('nada');
    expect(String(r.veredictoPlanilla)).toMatch(/^no_leida: .*PERMISSION_DENIED$/);
    expect(String(r.veredictoPlanilla)).not.toMatch(/Ana/);
  });
  it('crmVerificarEncabezados devuelve vacío si coincide y el motivo si no', () => {
    expect(M.crmVerificarEncabezados(MAPA, [filaEnc()])).toBe('');
    expect(M.crmVerificarEncabezados(MAPA, undefined)).toMatch(/no se pudo leer/);
  });
});

describe('adaptador general de señales y contrato CRM_ADAPTADOR', () => {
  it('cumple el contrato', () => expect(M.crmAdaptadorValido(M.CRM_ADAPTADOR)).toEqual([]));
  it.each([[undefined], [null], [{}], [{ calificar: () => 'x', resumir: () => '', prioridad: [] }], [{ calificar: 1, resumir: () => '', prioridad: ['a'] }], [{ calificar: () => 'x', resumir: () => '', prioridad: [1] }]])(
    'un adaptador inválido (%j) no escribe nada', (malo) => {
      const r = decidir({ telefono: TEL, nombre: 'Ana' }, [filaEnc()], malo);
      expect(r).toMatchObject({ accionPlanilla: 'nada', veredictoPlanilla: 'adaptador_invalido' });
    });
  it.each([
    [{ aceptoAgendar: true }, 'Alta'], [{ pidioUbicacion: true }, 'Alta'], [{ pidioLlamada: true }, 'Alta'], [{}, 'Media'],
    [{ llegoPorAnuncio: true }, 'Media'], [{ preguntoPrecioYCerro: true }, 'Baja'], [{ noEsPaciente: true, pidioUbicacion: true }, 'Descalificado'],
  ] as Array<[J, string]>)('señales %j: calificación %s', (senales, esperada) => expect(M.CRM_ADAPTADOR.calificar({ senales })).toBe(esperada));
  it('sin señales o con señales raras, Media (nunca revienta)', () => {
    for (const raro of [undefined, null, 'x', 5, []]) expect(M.CRM_ADAPTADOR.calificar({ senales: raro })).toBe('Media');
    expect(M.CRM_ADAPTADOR.calificar(undefined)).toBe('Media');
  });
  it('la escala va de menor a mayor: Alta pisa todo y Media no pisa Descalificado', () => expect(M.CRM_ADAPTADOR.prioridad).toEqual(['Baja', 'Media', 'Descalificado', 'Alta']));
  it('el resumen usa solo textos y nunca escribe «false», «[object Object]» ni «pag»', () => {
    const r = M.CRM_ADAPTADOR.resumir({ quePidio: 'Precio', diaPreferido: 'lunes', horarioPreferido: 'en la tarde', derivacion: true }, true, 'Alta');
    expect(r).toBe('Derivado a recepción.'); // el texto libre del cliente NO se copia al resumen
    const raros = M.CRM_ADAPTADOR.resumir({ quePidio: false, diaPreferido: { a: 1 }, horarioPreferido: ['x'], derivacion: false }, false, 'Media');
    expect(raros).toBe('');
    expect(M.CRM_ADAPTADOR.resumir({ quePidio: false }, true, 'Media')).toBe('Escribió por WhatsApp.');
    for (const t of [r, raros]) expect(t).not.toMatch(/false|object|pag/i);
  });
  it('el resumen no empieza con un signo de fórmula y se acota', () => {
    expect(M.CRM_ADAPTADOR.resumir({ quePidio: '=1+1', diaPreferido: '+x' }, false, 'Media')).toBe(''); // no copia el texto libre
    expect(M.CRM_ADAPTADOR.resumir({ quePidio: 'x'.repeat(900), derivacion: 'y'.repeat(900) }, false, 'Media').length).toBeLessThanOrEqual(400);
  });
  it('el adaptador no trae textos ni nombres de cliente', () => expect(ADAPT).not.toMatch(/Rubén|Antonio|Evy|Emma|Q'Taco|Bellido|NovuChat|doctora/i));
});

describe('el nodo «Decidir fila» con el paquete de señales', () => {
  const [crm, adapt, nodo] = ['crm/crm.js', 'crm/adaptador-senales.js', 'crm/nodo-decidir-fila.js'].map(leer);
  const codigo = [inyectarMapa(crm, MAPA), adapt, nodo].join('\n');
  const correr = (nodos: Record<string, Item[]>) => {
    const $ = (n: string) => { if (!(n in nodos)) throw new Error(`nodo sin ejecutar: ${n}`); return { all: () => nodos[n], first: () => nodos[n][0] }; };
    const vacios = GLOBALES_FUERA_DEL_SANDBOX;
    return compileFunction(codigo, ['$input', '$', ...vacios])({ all: () => ids }, $, ...vacios.map(() => undefined)) as Array<{ json: J }>;
  };
  const base = { 'Prospecto para la planilla': [{ json: { telefono: TEL, nombre: 'Ana', senales: { pidioUbicacion: true } } }], 'Buscar teléfono en planilla': [] as Item[] };
  it('con «Leer encabezados» comprueba la fila completa', () => {
    expect(correr({ ...base, [NODO_ENCABEZADOS]: [filaEnc()] })[0].json.accionPlanilla).toBe('agregar');
    expect(correr({ ...base, [NODO_ENCABEZADOS]: [{ json: {} }] })[0].json.accionPlanilla).toBe('nada');
  });
  it('con el paquete de señales, sin esa lectura NO agrega (cierra en falla)', () => expect(correr(base)[0].json.accionPlanilla).toBe('nada'));
  it('sin ese nodo en el flujo (captación y chat, adaptador propio) sigue como antes', () => {
    const cod = [inyectarMapa(crm, MAPA), leer('captacion/crm-captacion.js'), nodo].join('\n');
    const $ = (n: string) => { if (!(n in base)) throw new Error(`nodo sin ejecutar: ${n}`); return { all: () => (base as Record<string, Item[]>)[n], first: () => (base as Record<string, Item[]>)[n][0] }; };
    const vacios = GLOBALES_FUERA_DEL_SANDBOX;
    const r = compileFunction(cod, ['$input', '$', ...vacios])({ all: () => ids }, $, ...vacios.map(() => undefined)) as Array<{ json: J }>;
    expect(r[0].json.accionPlanilla).toBe('agregar');
  });
  it('usa CRM_ADAPTADOR: la calificación sale de las señales', () => expect(correr({ ...base, [NODO_ENCABEZADOS]: [filaEnc()] })[0].json[T.calif]).toBe('Alta'));
});

describe('ramaCrm: 8 nodos generados', () => {
  const rama = ramaCrm({ credencial: '@@cred:crm' });
  it('son 8, con nombres únicos, y cada conexión apunta a un nodo de la rama', () => {
    expect(rama.nodes).toHaveLength(8);
    const nombres = rama.nodes.map((n: { name: string }) => n.name);
    expect(new Set(nombres).size).toBe(8);
    for (const [de, c] of Object.entries(rama.connections as Record<string, { main: Array<Array<{ node: string }>> }>)) {
      expect(nombres).toContain(de);
      for (const salida of c.main) for (const d of salida) expect(nombres).toContain(d.node);
    }
  });
  it('«Leer encabezados» va antes de «Decidir fila»', () => expect(rama.connections[NODO_ENCABEZADOS].main[0][0].node).toBe('Decidir fila de la planilla'));
  it('sin credencial calculada (@@cred:) no se genera', () => {
    for (const mala of [undefined, '', 'Google Sheets miniCRM (crm-otro)', '@@cred:otra', '@@cred:crm2', 7]) expect(() => ramaCrm({ credencial: mala })).toThrow(/@@cred/);
  });
  it('toda credencial de la rama es la que se pasó', () => {
    for (const n of rama.nodes) if (n.credentials) expect(n.credentials.googleApi.name).toBe('@@cred:crm');
  });
  it('el paquete de señales existe y no lleva el adaptador de captación', () => {
    const r = rutasPaqueteCrmSenales();
    expect(r['crm-decidir-senales'].map((x: string) => x.split('/').pop())).toEqual(['crm.js', 'adaptador-senales.js', 'nodo-decidir-fila.js']);
  });

  function flujoArmado() {
    const nodes = clonar(rama.nodes) as Array<{ name: string; parameters: J }>;
    nodes.find((n) => n.name === 'Decidir fila de la planilla')!.parameters.jsCode = MARCA_MAPA;
    return injertarCrm({ nodes, connections: {}, settings: { executionOrder: 'v1', saveDataSuccessExecution: 'none', saveDataErrorExecution: 'none', saveExecutionProgress: false, saveManualExecutions: false } }, MAPA);
  }
  const rangoDe = (f: { nodes: Array<{ name: string; parameters: J }> }, nombre: string) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (f.nodes.find((n) => n.name === nombre)!.parameters as any).options.dataLocationOnSheet.values.range as string;

  it('el injerto fija los rangos: A..T, A..T4 y A: ninguno llega a la U', () => {
    const f = flujoArmado();
    expect(rangoDe(f, 'Buscar teléfono en planilla')).toBe('A3:T');
    expect(rangoDe(f, NODO_ENCABEZADOS)).toBe('A3:T4');
    expect(rangoDe(f, 'Leer IDs de la planilla')).toBe('A3:A');
    expect(rangoEncabezados(MAPA)).toBe('A3:T4');
    expect(hallazgosCrm(f, MAPA)).toEqual([]);
  });
  it.each([['A3:U'], ['A3:U4'], ['A3:V'], ['A3:Z4']])('se NIEGA un rango como %s (llega a la U o pasa de la T)', (rango) => {
    for (const nombre of ['Buscar teléfono en planilla', NODO_ENCABEZADOS, 'Leer IDs de la planilla']) {
      const f = flujoArmado();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (f.nodes.find((n: { name: string }) => n.name === nombre).parameters as any).options.dataLocationOnSheet.values.range = rango;
      const h = hallazgosCrm(f, MAPA) as string[];
      expect(h.length).toBeGreaterThan(0);
      expect(h.join(' ')).toMatch(/letra U|pasa de la ultima/);
    }
  });
  it('un rango que no se puede leer como A<fila>:<letra> también es hallazgo', () => {
    const f = flujoArmado();
    f.nodes.find((n: { name: string }) => n.name === 'Buscar teléfono en planilla').parameters.options.dataLocationOnSheet.values.range = 'B3:T';
    expect(hallazgosCrm(f, MAPA).join(' ')).toMatch(/no es A<fila>/);
  });
  it.each([
    ['saveDataSuccessExecution', 'all'], ['saveDataSuccessExecution', undefined], ['saveDataErrorExecution', 'all'], ['saveDataErrorExecution', 'default'], ['saveExecutionProgress', true], ['saveManualExecutions', true], ['saveManualExecutions', undefined],
  ])('la retención %s = %s está prohibida', (campo, valor) => {
    const f = flujoArmado();
    (f.settings as J)[campo] = valor;
    expect((hallazgosCrm(f, MAPA) as string[]).join(' ')).toMatch(/retencion/);
  });
  it('un flujo sin settings tampoco pasa', () => {
    const f = flujoArmado(); delete f.settings;
    expect((hallazgosCrm(f, MAPA) as string[]).join(' ')).toMatch(/retencion/);
  });
  it('si «Leer encabezados» lee otro rango, es hallazgo', () => {
    const f = flujoArmado();
    f.nodes.find((n: { name: string }) => n.name === NODO_ENCABEZADOS).parameters.options.dataLocationOnSheet.values.range = 'A3:I4';
    expect(hallazgosCrm(f, MAPA).join(' ')).toMatch(/tiene que leer exactamente A3:T4/);
  });
});

describe('los flujos que ya llevan miniCRM siguen cumpliendo', () => {
  const casos: Array<[string, string, string]> = [
    ['captacion-minima', 'captacion-minima.novuchat.json', 'captacion-minima/novuchat.json'],
    ['chat-novuchat', 'chat-novuchat.novuchat.json', 'chat-novuchat/novuchat.json'],
  ];
  it.each(casos)('%s: sin hallazgos de rango ni de retención', (dir, json, datos) => {
    const flujo = JSON.parse(readFileSync(join(RAIZ, 'Flujos', 'experimental', dir, json), 'utf8'));
    const mapa = (JSON.parse(readFileSync(join(RAIZ, 'admin', 'scripts', 'datos', datos), 'utf8')) as J).crm;
    expect(hallazgosCrm(flujo, mapa)).toEqual([]);
  });
});
