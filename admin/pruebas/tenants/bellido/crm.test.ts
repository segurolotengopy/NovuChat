/**
 * EL miniCRM EN EL FLUJO DE BELLIDO («Agenda mínima v0»; módulo `crm`, orden de Andres del 04/11/2026). Tres capas:
 *   · DATOS: el mapa de columnas de Bellido es válido y es el de Evy (misma plantilla de planilla).
 *   · RAMA: 8 nodos generados por el módulo, colgados de «Armar mensajes» sin quitar sus conexiones previas, en las DOS variantes; rangos que no llegan a la X (diagnóstico del equipo);
 *     la credencial exacta; la variante de prueba sin id de planilla; el código incluido del módulo (nunca copiado).
 *   · UNIDADES de `agmProspectoCrm` (función pura, vocabulario cerrado) con sus negaciones. El comportamiento en el flujo (turnos de punta a punta) está en
 *     el bloque «miniCRM» de `admin/pruebas/agenda-minima-flujo.test.ts`.
 * Mensajes por conversación: 0.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { compileFunction, runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-expect-error módulo .mjs sin tipos
import { hallazgosCrm, inyectarMapa, validarMapaCrm } from '../../../../Flujos/experimental/comun-sin-agente/construir-crm.mjs';

type J = Record<string, unknown>;
interface Nodo { name: string; type: string; position: [number, number]; parameters: J; credentials?: J }
interface Flujo { nodes: Nodo[]; connections: Record<string, { main: Array<Array<{ node: string }>> }>; settings: J }

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const leer = (r: string): string => readFileSync(join(RAIZ, r), 'utf8');
const leerJson = <T = J>(r: string): T => JSON.parse(leer(r)) as T;
const AM = 'Flujos/experimental/agenda-minima';
const PRODUCCION = leerJson<Flujo>(`${AM}/agenda-minima.v0.json`);
const PRUEBA = leerJson<Flujo>(`${AM}/agenda-minima.prueba.json`);
const MAPA = leerJson<{ crm: J }>('admin/scripts/datos/bellido/crm.json').crm;
const copia = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const NODOS_DE_CRM = ['Prospecto para la planilla', 'Buscar teléfono en planilla', 'Leer IDs de la planilla', 'Leer encabezados de la planilla', 'Decidir fila de la planilla', '¿Acción de la planilla?', 'Agregar fila', 'Actualizar fila'];
const CREDENCIAL = 'Google Sheets miniCRM (crm-bellido)';
const VARIANTES: Array<[string, Flujo]> = [['producción', PRODUCCION], ['prueba', PRUEBA]];

describe('datos: el mapa de columnas de Bellido', () => {
  it('es válido para el MISMO validador que corre en n8n', () => {
    expect(validarMapaCrm(MAPA)).toEqual([]);
  });
  it('es la plantilla de Evy MÁS las tres columnas nuevas (U, V, W) con el diagnóstico del equipo movido a la X, y con su propia nota y el título de O que usa el equipo de Bellido', () => {
    const evy = leerJson<{ crm: J }>('admin/scripts/datos/rroca-evy/rroca-evy.json').crm;
    const sin = (m: J): J => { const c = copia(m); delete c['_nota']; return c; };
    const esperado = sin(evy);
    Object.assign(esperado['columnas'] as J, {
      quePidio: { letra: 'O', titulo: 'Qué pidió (Nombre Niño)' }, servicioElegido: { letra: 'U', titulo: 'Servicio elegido' }, agendo: { letra: 'V', titulo: 'Agendó' }, fechaCita: { letra: 'W', titulo: 'Fecha y hora de la cita' },
    });
    (esperado['equipo'] as J)['diagnostico'] = { letra: 'X', titulo: 'Diagnóstico del equipo' };
    expect(sin(MAPA)).toEqual(esperado);
    expect(String(MAPA['_nota'])).toMatch(/Bellido/);
  });
  it('NIEGA: un mapa sin columnas obligatorias no es válido', () => {
    const roto = copia(MAPA); delete (roto['columnas'] as J)['telefono'];
    expect(validarMapaCrm(roto).length).toBeGreaterThan(0);
  });
  it('el archivo de datos no lleva ningún id de planilla ni URL de Google', () => {
    expect(leer('admin/scripts/datos/bellido/crm.json')).not.toMatch(/docs\.google\.com|spreadsheets\/d\/|[A-Za-z0-9_-]{40,}/);
  });
});

describe.each(VARIANTES)('rama del miniCRM (%s)', (_n, f) => {
  const por = (n: string): Nodo => f.nodes.find((x) => x.name === n)!;
  it('71 nodos, y los 8 de la rama están', () => {
    expect(f.nodes).toHaveLength(71);
    for (const n of NODOS_DE_CRM) expect(f.nodes.some((x) => x.name === n), n).toBe(true);
  });
  it('«Armar mensajes» sigue conectado a «¿Enviar de verdad?» y además a «Prospecto para la planilla»', () => {
    const destinos = (f.connections['Armar mensajes']?.main[0] ?? []).map((d) => d.node);
    expect(destinos).toContain('¿Enviar de verdad?');
    expect(destinos).toContain('Prospecto para la planilla');
    expect(destinos).toHaveLength(2);
  });
  it('las conexiones internas de la rama son las del módulo', () => {
    const a = (de: string, i = 0): string[] => (f.connections[de]?.main[i] ?? []).map((d) => d.node);
    expect(a('Prospecto para la planilla')).toEqual(['Buscar teléfono en planilla']);
    expect(a('Buscar teléfono en planilla')).toEqual(['Leer IDs de la planilla']);
    expect(a('Leer IDs de la planilla')).toEqual(['Leer encabezados de la planilla']);
    expect(a('Leer encabezados de la planilla')).toEqual(['Decidir fila de la planilla']);
    expect(a('Decidir fila de la planilla')).toEqual(['¿Acción de la planilla?']);
    expect(a('¿Acción de la planilla?', 0)).toEqual(['Agregar fila']);
    expect(a('¿Acción de la planilla?', 1)).toEqual(['Actualizar fila']);
  });
  it('la rama va debajo del envío (después en el lienzo) y ningún nodo comparte posición con otro', () => {
    expect(por('Prospecto para la planilla').position[1]).toBeGreaterThan(por('Armar mensajes').position[1]);
    expect(por('Prospecto para la planilla').position[1]).toBeGreaterThan(por('¿Enviar de verdad?').position[1]);
    const pos = f.nodes.map((n) => n.position.join(','));
    expect(new Set(pos).size).toBe(pos.length);
  });
  it('hallazgosCrm vacío: ningún rango llega a la X ni pasa de la W; retención en «none»', () => {
    expect(hallazgosCrm(f, MAPA)).toEqual([]);
    for (const n of f.nodes.filter((x) => x.type === 'n8n-nodes-base.googleSheets' && x.parameters['operation'] === 'read')) {
      const rango = String((((n.parameters['options'] as J)['dataLocationOnSheet'] as J)['values'] as J)['range']);
      expect(rango, n.name).toMatch(/^A\d+:(A|W)?$/);
      expect(rango).not.toMatch(/:[X-Z]/);
    }
    expect(String(por('Leer encabezados de la planilla').parameters['url'])).toMatch(/A3:W3/);
    expect(f.settings['saveDataSuccessExecution']).toBe('none');
    expect(f.settings['saveDataErrorExecution']).toBe('none');
    expect(f.settings['saveManualExecutions']).toBe(false);
  });
  it('los nodos de Google traen onError continueRegularOutput (no se debilita)', () => {
    for (const n of f.nodes.filter((x) => NODOS_DE_CRM.includes(x.name) && /googleSheets|httpRequest/.test(x.type))) expect((n as unknown as J)['onError'], n.name).toBe('continueRegularOutput');
  });
  it('la credencial es EXACTAMENTE «Google Sheets miniCRM (crm-bellido)» en los 4 nodos de Sheets y la consulta de encabezados, y en ningún otro', () => {
    const conGoogle = f.nodes.filter((n) => n.credentials && (n.credentials as J)['googleApi']);
    expect(conGoogle.map((n) => n.name).sort()).toEqual(['Actualizar fila', 'Agregar fila', 'Buscar teléfono en planilla', 'Leer IDs de la planilla', 'Leer encabezados de la planilla'].sort());
    for (const n of conGoogle) expect((((n.credentials as J)['googleApi']) as J)['name'], n.name).toBe(CREDENCIAL);
    expect(JSON.stringify(f)).not.toMatch(/crm-(rroca|walisuma|novuchat|qtaco)/);
  });
  it('el código del módulo se INCLUYE, no se copia: el nodo es crm.js (con el mapa) + el adaptador + el nodo del módulo', () => {
    const mod = (r: string): string => leer(`Flujos/src/modulos/crm/${r}`).trimEnd();
    const pros = String(por('Prospecto para la planilla').parameters['jsCode']);
    const dec = String(por('Decidir fila de la planilla').parameters['jsCode']);
    expect(pros).toBe(inyectarMapa(`${mod('crm.js')}\n${mod('nodo-prospecto.js')}\n`, MAPA));
    expect(dec).toContain(mod('adaptador-senales.js'));
    expect(dec).toContain(mod('nodo-decidir-fila.js'));
    expect(dec).not.toContain('@@crm-mapa');
  });
});

describe('id de la planilla', () => {
  const idDe = (f: Flujo): unknown => ((f.nodes.find((n) => n.name === 'Config base')!.parameters['assignments'] as { assignments: Array<{ name: string; value: unknown }> }).assignments.find((a) => a.name === 'planillaProspectosId')!.value);
  const hojaDe = (f: Flujo): unknown => ((f.nodes.find((n) => n.name === 'Config base')!.parameters['assignments'] as { assignments: Array<{ name: string; value: unknown }> }).assignments.find((a) => a.name === 'planillaProspectosHoja')!.value);
  it('producción lleva el marcador y la hoja Leads_CRM; la prueba lleva el id VACÍO (no escribe en ninguna planilla)', () => {
    expect(idDe(PRODUCCION)).toBe('REEMPLAZAR_PLANILLA_PROSPECTOS_ID_BELLIDO');
    expect(hojaDe(PRODUCCION)).toBe('Leads_CRM');
    expect(idDe(PRUEBA)).toBe('');
    expect(hojaDe(PRUEBA)).toBe('Leads_CRM');
  });
});

describe('guardia de hallazgosCrm sobre el flujo de Bellido (se NIEGA con mutaciones)', () => {
  for (const r of ['A3:X', 'A3:Y']) {
    it(`un rango de lectura ${r} es hallazgo`, () => {
      const f = copia(PRODUCCION);
      const n = f.nodes.find((x) => x.name === 'Buscar teléfono en planilla')!;
      ((((n.parameters['options'] as J)['dataLocationOnSheet'] as J)['values']) as J)['range'] = r;
      expect(hallazgosCrm(f, MAPA).join(' ')).toMatch(/diagnostico del equipo|pasa de la ultima letra/);
    });
  }
  it('retención de ejecuciones distinta de none es hallazgo', () => {
    const f = copia(PRODUCCION); f.settings['saveDataSuccessExecution'] = 'all';
    expect(hallazgosCrm(f, MAPA).join(' ')).toMatch(/retencion/);
  });
});

// ------------------------------------------------------------------------------------------------ la función pura
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const L: any = compileFunction(`${leer(`${AM}/src/lib/agenda.js`)}\nreturn { agmProspectoCrm, citasDeHermanos };`, [])();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const M: any = runInNewContext(`${inyectarMapa(leer('Flujos/src/modulos/crm/crm.js'), MAPA)}\n${leer('Flujos/src/modulos/crm/adaptador-senales.js')}\n({ crmDecidirFila, CRM_ADAPTADOR })`, {});
const TEL = ['591', '7', '00', '01234'].join('');
const AHORA = Date.UTC(2026, 9, 5, 14, 0, 0);
const base = (o: J = {}): J => ({ from: TEL, plan: 'menu', nombrePerfil: 'Ana Perez', nuevoContacto: true, ahoraMs: AHORA, ...o });
const prospecto = (o: J = {}): J | null => L.agmProspectoCrm(base(o)) as J | null;
type Col = { letra: string; titulo: string };
const TITULOS: string[] = (() => {
  const todas: Col[] = [...Object.values(MAPA['columnas'] as Record<string, Col>), ...Object.values(MAPA['equipo'] as Record<string, Col>)];
  return todas.filter((c) => c.letra <= 'W').sort((a, b) => a.letra.localeCompare(b.letra)).map((c) => c.titulo);
})();
function decidir(p: J): J {
  const salida = M.crmDecidirFila({ prospectos: [{ json: p }], busqueda: [], lecturaIds: [{ json: { row_number: 4, 'ID Lead': 'LEAD-1010' } }], encabezados: [{ json: { values: [TITULOS] } }], mapa: copia(MAPA), adaptador: M.CRM_ADAPTADOR, ahoraMs: AHORA }) as Array<{ json: J }>;
  return salida[0]!.json;
}
const celda = (r: J, campo: string): unknown => r[((MAPA['columnas'] as Record<string, Col>)[campo] as Col).titulo];

describe('unidades: agmProspectoCrm (vocabulario cerrado)', () => {
  it('un menú es un prospecto Tibio con el nombre del perfil y sin qué-pidió', () => {
    const p = prospecto()!;
    expect(p['telefono']).toBe(TEL);
    expect(p['nombre']).toBe('Ana Perez');
    expect(p['quePidio']).toBeUndefined();
    const r = decidir(p);
    expect(r['accionPlanilla']).toBe('agregar');
    expect(celda(r, 'clasificacion')).toBe('Tibio');
    expect(celda(r, 'calificacion')).toBe('Media');
  });
  it('una cita creada por el calendario: Agendar cita con el servicio, día y horario de la cita, y señal «aceptó agendar» (Caliente)', () => {
    const p = prospecto({ plan: 'crear', creada: true, servicio: 'control_nino_sano', inicioCita: '2026-10-08T15:00:00-04:00' })!;
    expect(p['quePidio']).toBe('Agendar cita (Control del niño sano)');
    expect(p['diaPreferido']).toBe('Jueves');
    expect(p['horarioPreferido']).toBe('Tarde');
    expect((p['senales'] as J)['aceptoAgendar']).toBe(true);
    const r = decidir(p);
    expect(celda(r, 'clasificacion')).toBe('Caliente');
    expect(celda(r, 'calificacion')).toBe('Alta');
  });
  it('reprogramar y cancelar salen de los hechos (borrado verificado), no de palabras', () => {
    expect(prospecto({ plan: 'crear', creada: true, reprogramo: true, servicio: 'control_nino_sano', inicioCita: '2026-10-08T09:00:00-04:00' })!['quePidio']).toBe('Reprogramar cita');
    expect(prospecto({ plan: 'crear', creada: true, reprogramo: true, inicioCita: '2026-10-08T09:00:00-04:00' })!['horarioPreferido']).toBe('Mañana');
    expect(prospecto({ plan: 'cancelar', cancelada: true })!['quePidio']).toBe('Cancelar cita');
  });
  it('NIEGA: un plan «crear» sin que el calendario haya creado nada NO marca el hecho', () => {
    const p = prospecto({ plan: 'crear', creada: false, servicio: 'control_nino_sano', inicioCita: '2026-10-08T15:00:00-04:00' })!;
    expect(String(p['quePidio'] ?? '')).not.toMatch(/Agendar cita|Reprogramar/);
    expect((p['senales'] as J)['aceptoAgendar']).toBe(false);
    expect(p['diaPreferido']).toBeUndefined();
  });
  it('NIEGA: un plan «cancelar» sin borrado verificado no dice «Cancelar cita»', () => {
    expect(prospecto({ plan: 'cancelar', cancelada: false })!['quePidio']).toBeUndefined();
  });
  it('pedir la dirección es Caliente (ubicación); derivar a recepción o al doctor queda en la columna de derivación', () => {
    const d = prospecto({ plan: 'respuesta_fija', clave: 'direccion' })!;
    expect(d['quePidio']).toBe('Ubicación');
    expect(celda(decidir(d), 'clasificacion')).toBe('Caliente');
    expect(prospecto({ plan: 'transferir', derivo: 'recepcion' })!['derivacion']).toBe('Consulta para recepción');
    // Al doctor NO va la columna R (el resumen común diría «Derivado a recepción.» y se contradiría): basta «Qué pidió».
    const dr = prospecto({ plan: 'contacto_doctor', derivo: 'doctor' })!;
    expect(dr['derivacion']).toBeUndefined();
    expect(dr['quePidio']).toBe('Hablar con el doctor');
    expect(String(celda(decidir(dr), 'resumen'))).not.toContain('Derivado a recepción');
    expect(celda(decidir(dr), 'derivacion')).toBeUndefined();
    expect(String(celda(decidir(prospecto({ plan: 'transferir', derivo: 'recepcion' })!), 'resumen'))).toContain('Derivado a recepción.');
  });
  it('NIEGA: el texto libre del cliente, los síntomas y los montos NO llegan al prospecto ni a la fila (el nombre del niño SÍ, solo en «Qué pidió» de una cita creada: ver la prueba siguiente)', () => {
    const sucio = {
      textoCliente: 'mi hijo Mateo Quispe tiene fiebre y tos desde ayer, le doy paracetamol, la consulta cuesta 250 Bs', texto: 'tiene fiebre', pacientes: [{ nombres: 'Mateo', apellidos: 'Quispe' }],
      motivo: 'diagnóstico de bronquitis', historial: [{ r: 'u', t: 'convulsiones' }], pregunta: 'cuánto sale la vacuna 150 Bs',
    };
    const p = prospecto({ plan: 'crear', creada: true, servicio: 'control_recien_nacido', inicioCita: '2026-10-08T15:00:00-04:00', ...sucio })!;
    const salida = JSON.stringify([p, decidir(p)]);
    for (const x of ['fiebre', 'tos', 'paracetamol', '250', '150', 'bronquitis', 'convulsiones', 'vacuna', 'diagn']) expect(salida, x).not.toContain(x);
    expect(salida).not.toMatch(/pag[oó]|acreditad/i);
    expect(Object.keys(p).sort()).toEqual(['agendo', 'anuncio', 'diaPreferido', 'fechaCita', 'horarioPreferido', 'nombre', 'nombreDePerfil', 'nuevoContacto', 'quePidio', 'senales', 'servicioElegido', 'telefono', 'ultimaInteraccionMs'].sort());
  });
  it('el pediatra ve el nombre del niño: «Qué pidió» de una cita CREADA lleva «Apellidos, Nombres»; sin cita creada, nunca (Andres, 08/11/2026)', () => {
    const base = { plan: 'crear', servicio: 'control_recien_nacido', inicioCita: '2026-10-08T15:00:00-04:00', pacientes: [{ nombres: 'Mateo', apellidos: 'Quispe' }] };
    const ok = prospecto({ ...base, creada: true })!;
    expect(String(ok['quePidio'])).toBe('Agendar cita (Control del recién nacido) — Quispe, Mateo');
    expect(String(celda(decidir(ok), 'quePidio'))).toContain('Quispe, Mateo');
    const hermanos = prospecto({ ...base, creada: true, pacientes: [{ nombres: 'Ana', apellidos: 'Perez' }, { nombres: 'Luis', apellidos: 'Perez' }] })!;
    expect(String(hermanos['quePidio'])).toContain('Perez, Ana / Perez, Luis');
    const no = prospecto({ ...base, creada: false })!;
    expect(JSON.stringify([no, decidir(no)])).not.toContain('Quispe');
    const sucio = prospecto({ ...base, creada: true, pacientes: [{ nombres: '=HYPERLINK("x") Mateo 250', apellidos: '<b>Quispe</b>' }] })!;
    expect(String(sucio['quePidio']).split(' — ')[1]).not.toMatch(/[=<>"()0-9]/);
  });
  it('el nombre del perfil se sanea: solo letras, espacios, apóstrofo y guion; nada de dígitos ni fórmulas', () => {
    const p = prospecto({ nombrePerfil: '=HYPERLINK("x") Ana 250 Bs <b>Perez</b> 😀' })!;
    expect(String(p['nombre'])).toMatch(/^[\p{L} '’-]*$/u);
    expect(String(p['nombre'])).not.toMatch(/[0-9=<>"()]/);
  });
  it('NIEGA: los medios no leídos, el error, el uso extendido, la suspensión y los turnos sin respuesta no dejan prospecto', () => {
    for (const plan of ['derivar_medio', 'imagen_sin_texto', 'audio_ilegible', 'error', 'uso_extendido', 'suspendido', 'nada', '']) expect(prospecto({ plan }), plan).toBeNull();
  });
  it('la EMERGENCIA deja fila con SOLO teléfono, nombre de perfil y «Emergencia»: sin texto del mensaje, sin qué-pidió, sin señales (Andres, 07/11/2026)', () => {
    const p = prospecto({ plan: 'emergencia', texto: 'mi hijo no respira y tiene fiebre', textoCliente: 'convulsiones', servicio: 'control_nino_sano', creada: true, inicioCita: '2026-10-08T15:00:00-04:00', clave: 'direccion', derivo: 'recepcion' })!;
    expect(Object.keys(p).sort()).toEqual(['nombre', 'nombreDePerfil', 'nuevoContacto', 'servicioElegido', 'telefono', 'ultimaInteraccionMs']);
    expect(p['servicioElegido']).toBe('Emergencia');
    const r = decidir(p);
    expect(r['accionPlanilla']).toBe('agregar');
    expect(celda(r, 'clasificacion')).toBeUndefined(); // sin señales no se clasifica
    const salida = JSON.stringify([p, r]);
    for (const x of ['respira', 'fiebre', 'convulsiones', 'Agendar', 'Ubicación', 'recepción', 'Derivado']) expect(salida, x).not.toContain(x);
    expect(p['agendo']).toBeUndefined();
  });
  it('«Servicio elegido»: de la elección o del plan del doctor, y solo de la lista cerrada', () => {
    expect(prospecto({ plan: 'ofrecer', servicio: 'control_recien_nacido', huecos: [] })!['servicioElegido']).toBe('Recién nacido');
    expect(prospecto({ plan: 'ofrecer', servicio: 'control_nino_sano', huecos: [] })!['servicioElegido']).toBe('Control niño sano');
    expect(prospecto({ plan: 'ofrecer', servicio: 'vacunas_otros' })!['servicioElegido']).toBe('Vacunas y/o otros');
    expect(prospecto({ plan: 'contacto_doctor', derivo: 'doctor' })!['servicioElegido']).toBe('Vacunas y/o otros');
    for (const servicio of ['desconocido', 'dolor de pecho', undefined]) expect(prospecto({ plan: 'menu', servicio })!['servicioElegido'], String(servicio)).toBeUndefined();
  });
  it('NIEGA: «Agendó» es «Sí» SOLO con el plan «crear» y la cita creada por el calendario (el hecho), nunca por lo dicho', () => {
    expect(prospecto({ plan: 'crear', creada: true, inicioCita: '2026-10-08T15:00:00-04:00' })!['agendo']).toBe('Sí');
    expect(prospecto({ plan: 'crear', creada: true, inicioCita: '2026-10-08T15:00:00-04:00' })!['fechaCita']).toBe(Date.parse('2026-10-08T15:00:00-04:00'));
    for (const o of [{ plan: 'crear', creada: false }, { plan: 'transferir', creada: true }, { plan: 'ofrecer', creada: true }, { plan: 'crear' }, { plan: 'crear', creada: 'true' }]) {
      const p = prospecto({ inicioCita: '2026-10-08T15:00:00-04:00', texto: 'ya agendé, listo, quedó agendada', ...o })!;
      expect(p['agendo'], JSON.stringify(o)).toBe('No');
      expect(p['fechaCita'], JSON.stringify(o)).toBeUndefined();
      expect(p['citaCancelada']).toBeUndefined();
    }
  });
  it('el candado que deshizo o falló la cita deja «No» (el plan ya no es «crear»)', () => {
    const p = prospecto({ plan: 'transferir', creada: false, derivo: 'recepcion', inicioCita: '2026-10-08T15:00:00-04:00' })!;
    expect(p['agendo']).toBe('No');
    expect(p['fechaCita']).toBeUndefined();
  });
  it('cancelar con borrado verificado: «No» y citaCancelada; una cancelación no verificada NO lo es', () => {
    const c = prospecto({ plan: 'cancelar', cancelada: true })!;
    expect([c['agendo'], c['citaCancelada']]).toEqual(['No', true]);
    expect(prospecto({ plan: 'cancelar', cancelada: false })!['citaCancelada']).toBeUndefined();
  });
  it('con dos hermanos (dos citas armadas de verdad) la fecha es la de la PRIMERA cita', () => {
    const citas = L.citasDeHermanos({ inicio: '2026-10-08T09:00:00-04:00', servicio: 'control_nino_sano', telefono: TEL, nombrePerfil: 'Ana Perez',
      pacientes: [{ nombres: 'Ana', apellidos: 'Perez Gomez' }, { nombres: 'Luis', apellidos: 'Perez Gomez' }] }) as Array<{ inicio: string }>;
    expect(citas).toHaveLength(2);
    expect(citas[1]!.inicio).not.toBe(citas[0]!.inicio);
    const p = prospecto({ plan: 'crear', creada: true, inicioCita: citas[0]!.inicio })!;
    expect(p['fechaCita']).toBe(Date.parse('2026-10-08T09:00:00-04:00'));
    expect(p['fechaCita']).not.toBe(Date.parse(citas[1]!.inicio));
  });
  it('cancelar con otras citas pendientes lleva cuántas quedan, la cancelada y la próxima (orden por hora)', () => {
    const p = prospecto({ plan: 'cancelar', cancelada: true, canceladaInicio: '2026-10-08T09:00:00-04:00', restantes: ['2026-10-12T10:00:00-04:00', '2026-10-09T10:00:00-04:00'] })!;
    expect([p['citasRestantes'], p['citaCanceladaMs'], p['proximaCitaMs']]).toEqual([2, Date.parse('2026-10-08T09:00:00-04:00'), Date.parse('2026-10-09T10:00:00-04:00')]);
    expect(prospecto({ plan: 'cancelar', cancelada: true })!['citasRestantes']).toBe(0);
  });
  it('NIEGA: sin teléfono válido no hay prospecto', () => {
    expect(prospecto({ from: '' })).toBeNull();
    expect(prospecto({ from: 'abc' })).toBeNull();
    expect(L.agmProspectoCrm(null)).toBeNull();
  });
  it('un servicio desconocido o inventado no entra al vocabulario', () => {
    const p = prospecto({ plan: 'ofrecer', servicio: 'dolor de pecho', huecos: ['2026-10-08T15:00:00-04:00'] })!;
    expect(p['quePidio']).toBe('Consultar horarios');
    expect(JSON.stringify(p)).not.toContain('pecho');
  });
});
