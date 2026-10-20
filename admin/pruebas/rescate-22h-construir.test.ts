/**
 * RESCATE DE 22 H — EL ARMADO (`Flujos/experimental/rescate-22h/construir.mjs`).
 *
 * Lo que esta suite niega: que el JSON versionado difiera de lo que se arma; que el flujo lleve un webhook, un WhatsApp Trigger, otro disparador u otro
 * cron; que llame a un anfitrión fuera de la lista; que una credencial lleve id; que un `REEMPLAZAR_` salga de «Config base»; que «Config base» tenga
 * `modoPrueba` o un `listaDePrueba` que no sea booleano; que el texto fijo o el saludo no sean válidos; que use los datos estáticos de n8n; que las
 * ejecuciones fallidas guarden datos (`saveDataErrorExecution` tiene que ser exactamente «none»); que pase de 16 nodos; que un dato inválido se acepte;
 * que se publique con marcadores; y que lo COMÚN (la cadena de envío, el filtro, la librería) esté copiado en vez de incluido.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { entornoDelEmulador } from './core/entorno-del-hijo.ts';
import type { Flujo, J } from './lib/flujo';
// @ts-expect-error el armador es un .mjs sin tipos
import { AQUI, RS_URL_INGESTA, RS_URL_RECLAMAR, TOPE_DE_NODOS, archivoDe, construir, estadoDelContrato, guardiaDePublicacion, guardias, tenantsConRescate } from '../../Flujos/experimental/rescate-22h/construir.mjs';
import { nodosDeEnvio } from '../../Flujos/experimental/comun-sin-agente/src/envio.mjs';

const ESTA = dirname(fileURLToPath(import.meta.url));
const RESCATE: string = AQUI;
const DATOS = join(ESTA, '../scripts/datos/rroca-ruben/rescate-22h.json');
const leer = (ruta: string): string => readFileSync(ruta, 'utf8');
const RUBEN = JSON.parse(leer(join(RESCATE, archivoDe('rroca-ruben')))) as Flujo;
const copia = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const nodo = (f: Flujo, n: string) => f.nodes.find((x) => x.name === n)!;
const asignacion = (f: Flujo, nombre: string) => ((nodo(f, 'Config base').parameters['assignments'] as J)['assignments'] as J[]).find((a) => a['name'] === nombre)!;
const hallazgos = (f: Flujo): string => (guardias(f) as string[]).join(' | ');

const temporales: string[] = [];
afterAll(() => { for (const d of temporales) rmSync(d, { recursive: true, force: true }); });
function datosTemporales(cambios: (d: J) => void): string {
  const dir = mkdtempSync(join(tmpdir(), 'rescate22h-'));
  temporales.push(dir);
  const d = JSON.parse(leer(DATOS)) as J;
  cambios(d);
  const ruta = join(dir, 'rescate-22h.json');
  writeFileSync(ruta, JSON.stringify(d));
  return ruta;
}

describe('armado: --todos --verificar y el tope de nodos', () => {
  it('`construir.mjs --todos --verificar` sale en 0 y dice que el JSON de Rubén está al día', () => {
    const r = spawnSync(process.execPath, [join(RESCATE, 'construir.mjs'), '--todos', '--verificar'], { encoding: 'utf8', env: entornoDelEmulador(undefined) });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('rescate-22h.rroca-ruben.json al día');
  });

  it('un argumento desconocido, o pedir un tenant y --todos a la vez, NO escribe nada: sale en 2', () => {
    for (const args of [['--ayuda'], ['--tenant', 'rroca-ruben', '--todos'], []]) {
      const r = spawnSync(process.execPath, [join(RESCATE, 'construir.mjs'), ...args], { encoding: 'utf8', env: entornoDelEmulador(undefined) });
      expect(r.status, args.join(' ')).toBe(2);
    }
  });

  it('el JSON versionado reproduce lo que se arma, byte a byte, y sus guardias están limpias', () => {
    const r = construir({ tenant: 'rroca-ruben', verificar: true }) as { alDia: boolean; versionado: string[]; nodos: number };
    expect(r.alDia).toBe(true);
    expect(r.versionado).toEqual([]);
    expect(guardias(RUBEN)).toEqual([]);
  });

  it(`pasa de ${TOPE_DE_NODOS} nodos: nunca (hoy son 13)`, () => {
    expect(TOPE_DE_NODOS).toBe(16);
    expect(RUBEN.nodes.length).toBe(13);
    const grande = copia(RUBEN);
    while (grande.nodes.length <= 16) grande.nodes.push({ ...copia(grande.nodes[0]!), id: `x${grande.nodes.length}`, name: `Relleno ${grande.nodes.length}` });
    expect(hallazgos(grande)).toMatch(/tope es 16/);
  });

  it('`tenantsConRescate` encuentra a Rubén y a nadie más (Antonio no tiene datos)', () => {
    expect(tenantsConRescate()).toEqual(['rroca-ruben']);
  });
});

describe('guardias: cada una con su caso negativo', () => {
  it('un webhook agregado', () => {
    const f = copia(RUBEN);
    f.nodes.push({ id: 'w', name: 'Entrada', type: 'n8n-nodes-base.webhook', parameters: { path: 'x' } });
    expect(hallazgos(f)).toMatch(/webhook/);
  });
  it('un WhatsApp Trigger (prohibición 7)', () => {
    const f = copia(RUBEN);
    f.nodes.push({ id: 'w', name: 'Entrada', type: 'n8n-nodes-base.whatsAppTrigger', parameters: {} });
    expect(hallazgos(f)).toMatch(/WhatsApp Trigger/);
  });
  it('otro disparador, o un segundo programado', () => {
    const f = copia(RUBEN);
    f.nodes.push({ id: 'm', name: 'Manual', type: 'n8n-nodes-base.manualTrigger', parameters: {} });
    expect(hallazgos(f)).toMatch(/disparador/);
    const g = copia(RUBEN);
    g.nodes.push({ ...copia(nodo(g, 'Cada 10 minutos')), id: 'otro', name: 'Otro programado' });
    expect(hallazgos(g)).toMatch(/2 disparadores programados/);
  });
  it('otro cron', () => {
    const f = copia(RUBEN);
    (nodo(f, 'Cada 10 minutos').parameters['rule'] as J)['interval'][0]['expression'] = '* * * * *';
    expect(hallazgos(f)).toMatch(/\*\/10/);
  });
  it('una URL a otro anfitrión, también una de la consola que no es una de las dos', () => {
    const f = copia(RUBEN);
    nodo(f, 'Reclamar rescates').parameters['url'] = 'https://example.org/reclamarRescates';
    expect(hallazgos(f)).toMatch(/anfitrión/);
    const g = copia(RUBEN);
    nodo(g, 'Reclamar rescates').parameters['url'] = 'https://us-east1-novuchat-demo.cloudfunctions.net/otraFuncion';
    expect(hallazgos(g)).toMatch(/anfitrión/);
  });
  it('«subscriptions» o «subscribed_apps»', () => {
    const f = copia(RUBEN);
    nodo(f, 'Armar rescate').notes = 'llama a subscribed_apps';
    expect(hallazgos(f)).toMatch(/subscribed_apps/);
  });
  it('una credencial con id', () => {
    const f = copia(RUBEN);
    (nodo(f, 'Reclamar rescates').credentials as J)['httpHeaderAuth'].id = 'abc';
    expect(hallazgos(f)).toMatch(/credencial/);
  });
  it('un REEMPLAZAR_ fuera de «Config base»', () => {
    const f = copia(RUBEN);
    nodo(f, 'Preparar rescates').notes = 'REEMPLAZAR_ALGO';
    expect(hallazgos(f)).toMatch(/Preparar rescates.*REEMPLAZAR_/);
    const g = copia(RUBEN);
    (g as J)['staticData'] = { x: 'REEMPLAZAR_OTRO' };
    expect(hallazgos(g)).toMatch(/fuera de «Config base»/);
  });
  it('`modoPrueba` en «Config base»', () => {
    const f = copia(RUBEN);
    ((nodo(f, 'Config base').parameters['assignments'] as J)['assignments'] as J[]).push({ id: 'cb_modoPrueba', name: 'modoPrueba', type: 'boolean', value: true });
    expect(hallazgos(f)).toMatch(/modoPrueba/);
  });
  it('`listaDePrueba` que no es booleano, o que falta', () => {
    const f = copia(RUBEN);
    asignacion(f, 'listaDePrueba')['value'] = 'true';
    expect(hallazgos(f)).toMatch(/listaDePrueba/);
    const g = copia(RUBEN);
    const lista = (nodo(g, 'Config base').parameters['assignments'] as J)['assignments'] as J[];
    lista.splice(lista.findIndex((a) => a['name'] === 'listaDePrueba'), 1);
    expect(hallazgos(g)).toMatch(/listaDePrueba/);
  });
  for (const [nombre, texto] of [
    ['sin «?»', 'Hola, soy el asistente virtual de Rubén. Quedó pendiente tu consulta sobre el libro.'],
    ['con dígitos', 'Hola, soy el asistente virtual de Rubén. Quedó pendiente tu consulta 24 horas. ¿Te quedó alguna duda?'],
    ['con un enlace', 'Hola, soy el asistente virtual de Rubén. Mira www.ejemplo.com ahora mismo. ¿Te quedó alguna duda?'],
    ['sin «asistente virtual»', 'Hola, soy Rubén. Quedó pendiente tu consulta sobre el libro. ¿Te quedó alguna duda?'],
  ] as const) {
    it(`un texto fijo ${nombre}`, () => {
      const f = copia(RUBEN);
      asignacion(f, 'rescateTextoFijo')['value'] = texto;
      expect(hallazgos(f)).toMatch(/rescateTextoFijo/);
    });
  }
  it('un saludo que no dice «asistente virtual»', () => {
    const f = copia(RUBEN);
    asignacion(f, 'rescateSaludo')['value'] = 'Hola, soy Rubén y te escribo.';
    expect(hallazgos(f)).toMatch(/rescateSaludo/);
  });
  it('los datos estáticos de n8n', () => {
    const f = copia(RUBEN);
    nodo(f, 'Armar rescate').parameters['jsCode'] += "\nconst sd = $getWorkflowStaticData('global');";
    expect(hallazgos(f)).toMatch(/datos estáticos/);
  });
  it('`errorWorkflow`', () => {
    const f = copia(RUBEN);
    (f.settings as J)['errorWorkflow'] = 'otro';
    expect(hallazgos(f)).toMatch(/errorWorkflow/);
  });
  it('retención: las ejecuciones fallidas no guardan datos (exactamente «none»; «all» y cualquier otro valor se rechazan)', () => {
    expect((RUBEN.settings as J)['saveDataErrorExecution']).toBe('none');
    for (const valor of ['all', 'None', undefined]) {
      const f = copia(RUBEN);
      (f.settings as J)['saveDataErrorExecution'] = valor;
      expect(hallazgos(f), String(valor)).toMatch(/saveDataErrorExecution/);
    }
    const g = copia(RUBEN);
    (g.settings as J)['saveDataSuccessExecution'] = 'all';
    expect(hallazgos(g)).toMatch(/saveDataSuccessExecution/);
  });
  it('orden, zona y tiempo de ejecución', () => {
    for (const [clave, valor, patron] of [['executionOrder', 'v0', /executionOrder/], ['timezone', 'UTC', /timezone/], ['executionTimeout', 120, /executionTimeout/], ['saveManualExecutions', true, /saveManualExecutions/]] as const) {
      const f = copia(RUBEN);
      (f.settings as J)[clave] = valor;
      expect(hallazgos(f), clave).toMatch(patron);
    }
  });
  it('un fallo del reclamo, la preparación o el armado no se puede tragar, y el reclamo no se reintenta', () => {
    for (const n of ['Reclamar rescates', 'Preparar rescates', 'Armar rescate']) {
      const f = copia(RUBEN);
      nodo(f, n).onError = 'continueRegularOutput';
      expect(hallazgos(f), n).toMatch(/Continue on Fail/);
    }
    const g = copia(RUBEN);
    nodo(g, 'Reclamar rescates').retryOnFail = true;
    expect(hallazgos(g)).toMatch(/no se reintenta/);
  });
  it('la puerta de la entrega: sin «¿Meta aceptó?», o con el reporte colgado de otro lado, se rechaza', () => {
    const f = copia(RUBEN);
    f.nodes = f.nodes.filter((n) => n.name !== '¿Meta aceptó?');
    expect(hallazgos(f)).toMatch(/falta «¿Meta aceptó\?»/);
    const g = copia(RUBEN);
    g.connections['¿Falló el envío?'] = { main: [[{ node: 'Enviar respaldo', type: 'main', index: 0 }], [{ node: '¿Reportar? (saliente)', type: 'main', index: 0 }]] };
    expect(hallazgos(g)).toMatch(/«¿Falló el envío\?» tiene que enviar su salida/);
  });
  it('SIN respaldo (M-4): ni el nodo «Enviar respaldo» ni un destino en la salida «con fallo» de «¿Falló el envío?»', () => {
    expect(RUBEN.nodes.some((n) => n.name === 'Enviar respaldo')).toBe(false);
    expect((RUBEN.connections as J)['¿Falló el envío?'].main[0]).toEqual([]);
    const f = copia(RUBEN);
    f.nodes.push({ id: 'r', name: 'Enviar respaldo', type: 'n8n-nodes-base.httpRequest', parameters: { url: 'https://graph.facebook.com/v26.0/1/messages' } });
    expect(hallazgos(f)).toMatch(/«Enviar respaldo» no puede existir/);
    const g = copia(RUBEN);
    (g.connections as J)['¿Falló el envío?'].main[0] = [{ node: '¿Meta aceptó?', type: 'main', index: 0 }];
    expect(hallazgos(g)).toMatch(/salida «con fallo»/);
  });
  it('«¿Hay historial?»: sin ella, o con sus salidas cruzadas, se rechaza (sin historial no hay llamada a Gemini)', () => {
    const f = copia(RUBEN);
    f.nodes = f.nodes.filter((n) => n.name !== '¿Hay historial?');
    expect(hallazgos(f)).toMatch(/falta «¿Hay historial\?»/);
    const g = copia(RUBEN);
    g.connections['¿Hay historial?'] = { main: [[{ node: 'Redactar rescate', type: 'main', index: 0 }], [{ node: 'Redactar rescate', type: 'main', index: 0 }]] };
    expect(hallazgos(g)).toMatch(/salida «no» SOLO a «Armar rescate»/);
  });
  it('lista BLANCA de tipos de nodo y de credencial, y nombre del flujo con su forma', () => {
    for (const tipo of ['n8n-nodes-base.executeCommand', 'n8n-nodes-base.function', 'n8n-nodes-base.merge', 'n8n-nodes-base.wait']) {
      const f = copia(RUBEN);
      f.nodes.push({ id: 'x', name: 'Extra', type: tipo, parameters: {} });
      expect(hallazgos(f), tipo).toMatch(/tipo no admitido/);
    }
    const g = copia(RUBEN);
    (nodo(g, 'Reclamar rescates') as J)['credentials'] = { oAuth2Api: { id: '', name: 'x' } };
    expect(hallazgos(g)).toMatch(/credencial de un tipo no admitido/);
    const h = copia(RUBEN);
    h.name = 'Otro flujo';
    expect(hallazgos(h)).toMatch(/nombre del flujo/);
  });
  it('el orden: Reclamar → Preparar → ¿Hay historial? → Redactar → Armar → ¿Enviar de verdad?', () => {
    const f = copia(RUBEN);
    f.connections['Preparar rescates'] = { main: [[{ node: 'Armar rescate', type: 'main', index: 0 }]] };
    expect(hallazgos(f)).toMatch(/Preparar rescates.*no está conectado a «¿Hay historial\?»/);
    const g = copia(RUBEN);
    g.connections['Armar rescate'] = { main: [[]] };
    expect(hallazgos(g)).toMatch(/Armar rescate.*¿Enviar de verdad\?/);
  });
});

describe('datos inválidos', () => {
  const rechaza = (ruta: string, tenant: string, patron: RegExp) => expect(() => construir({ tenant, datos: ruta, verificar: true })).toThrow(patron);
  it('un tenant con mayúsculas, o que no coincide con el del archivo', () => {
    rechaza(DATOS, 'Rroca-Ruben', /tenant/);
    rechaza(datosTemporales((d) => { d['tenant'] = 'otro'; }), 'rroca-ruben', /tenant/);
  });
  it('una credencial vacía o ausente', () => {
    rechaza(datosTemporales((d) => { d['credenciales'].graph = ''; }), 'rroca-ruben', /credenciales\.graph/);
    rechaza(datosTemporales((d) => { delete d['credenciales'].gemini; }), 'rroca-ruben', /credenciales\.gemini/);
  });
  it('una clave no admitida en «Config base» (p. ej. `modoPrueba`) y un `listaDePrueba` que no es booleano', () => {
    rechaza(datosTemporales((d) => { d['configBase'].modoPrueba = true; }), 'rroca-ruben', /modoPrueba: clave no admitida/);
    rechaza(datosTemporales((d) => { d['configBase'].listaDePrueba = 'true'; }), 'rroca-ruben', /listaDePrueba/);
    rechaza(datosTemporales((d) => { delete d['configBase'].listaDePrueba; }), 'rroca-ruben', /listaDePrueba: falta/);
  });
  it('un dato que sería una expresión de n8n, o una marca del armador', () => {
    rechaza(datosTemporales((d) => { d['configBase'].rescateContexto = '={{ 1 }}'; }), 'rroca-ruben', /rescateContexto/);
    rechaza(datosTemporales((d) => { d['configBase'].rescateQuien = 'Rubén {{ x }}'; }), 'rroca-ruben', /rescateQuien/);
    rechaza(datosTemporales((d) => { d['configBase'].rescateQuien = '@@dato:x@@'; }), 'rroca-ruben', /rescateQuien/);
  });
  it('un texto fijo o un saludo inválidos, y teléfonos mal formados', () => {
    rechaza(datosTemporales((d) => { d['configBase'].rescateTextoFijo = 'Hola, soy Rubén. ¿Te quedó alguna duda sobre el libro?'; }), 'rroca-ruben', /rescateTextoFijo/);
    rechaza(datosTemporales((d) => { d['configBase'].rescateSaludo = 'Hola'; }), 'rroca-ruben', /rescateSaludo/);
    rechaza(datosTemporales((d) => { d['configBase'].telefonosDePrueba = '123'; }), 'rroca-ruben', /telefonosDePrueba/);
    rechaza(datosTemporales((d) => { d['configBase'].telefonosExcluidos = 'abc'; }), 'rroca-ruben', /telefonosExcluidos/);
  });
  it('el nombre del flujo con otra forma, y una versión de Graph que el nodo no aceptaría al ejecutar', () => {
    rechaza(datosTemporales((d) => { d['nombreFlujo'] = 'Otro nombre'; }), 'rroca-ruben', /nombreFlujo/);
    rechaza(datosTemporales((d) => { d['configBase'].waGraphVersion = 'v26.10'; }), 'rroca-ruben', /waGraphVersion/);
    rechaza(datosTemporales((d) => { d['configBase'].waGraphVersion = '26.0'; }), 'rroca-ruben', /waGraphVersion/);
  });
  it('un tenant sin archivo de datos (Antonio todavía no tiene)', () => {
    expect(() => construir({ tenant: 'rroca-antonio', verificar: true })).toThrow(/no existe el archivo de datos/);
  });
});

describe('contrato del consumidor: el tenant declara la prueba negativa de su batería', () => {
  const rechaza = (ruta: string, patron: RegExp) => expect(() => construir({ tenant: 'rroca-ruben', datos: ruta, verificar: true })).toThrow(patron);
  it('Rubén lo declara como pendiente del PR-B, explícito (no inventa una ruta)', () => {
    const d = JSON.parse(leer(DATOS)) as J;
    expect(d['contratoConsumidor']).toEqual({ estado: 'pendiente-pr-b' });
    expect(estadoDelContrato(d['contratoConsumidor'])).toEqual({ pendiente: true, errores: [] });
  });
  it('un tenant que no declara nada falla con un mensaje claro', () => {
    rechaza(datosTemporales((d) => { delete d['contratoConsumidor']; }), /contratoConsumidor: falta/);
    rechaza(datosTemporales((d) => { d['contratoConsumidor'] = {}; }), /contratoConsumidor.prueba/);
  });
  it('una ruta que no existe, o que sale del repo, o un estado que no es el admitido, se rechazan', () => {
    rechaza(datosTemporales((d) => { d['contratoConsumidor'] = { prueba: 'admin/pruebas/no-existe.test.ts' }; }), /no existe/);
    rechaza(datosTemporales((d) => { d['contratoConsumidor'] = { prueba: '../fuera.test.ts' }; }), /ruta relativa/);
    rechaza(datosTemporales((d) => { d['contratoConsumidor'] = { prueba: '/etc/passwd' }; }), /ruta relativa/);
    rechaza(datosTemporales((d) => { d['contratoConsumidor'] = { estado: 'listo' }; }), /pendiente-pr-b/);
  });
  it('una prueba que existe pasa; con un `caso` que no contiene, no', () => {
    const ok = datosTemporales((d) => { d['contratoConsumidor'] = { prueba: 'admin/pruebas/rescate-22h-construir.test.ts', caso: 'contrato del consumidor' }; });
    expect((construir({ tenant: 'rroca-ruben', datos: ok, verificar: true }) as { nodos: number }).nodos).toBe(13);
    rechaza(datosTemporales((d) => { d['contratoConsumidor'] = { prueba: 'admin/pruebas/rescate-22h-construir.test.ts', caso: `${'NO'}_${'ESTA'}_ZZ` }; }), /no contiene/);
  });
});

describe('publicación: no sale con marcadores', () => {
  it('el JSON de Rubén lleva marcadores (el repositorio es público) y `--publicable` sale en 1 nombrándolos', () => {
    const r = spawnSync(process.execPath, [join(RESCATE, 'construir.mjs'), '--publicable', '--tenant', 'rroca-ruben'], { encoding: 'utf8', env: entornoDelEmulador(undefined) });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('REEMPLAZAR_TELEFONOS_RESCATE_RROCA_RUBEN');
    expect(r.stderr).toContain('REEMPLAZAR_PHONE_NUMBER_ID_RROCA_RUBEN');
    expect(r.stderr, 'mientras el contrato esté pendiente tampoco se publica').toContain('pendiente-pr-b');
  });
  it('con los marcadores sustituidos, la guardia lo deja pasar; basta uno sin sustituir para negarlo', () => {
    const lleno = copia(RUBEN);
    asignacion(lleno, 'phoneNumberId')['value'] = '123456789';
    asignacion(lleno, 'telefonosDePrueba')['value'] = '70011122';
    expect(guardiaDePublicacion({ flujo: lleno })).toEqual([]);
    asignacion(lleno, 'telefonosDePrueba')['value'] = 'REEMPLAZAR_TELEFONOS_RESCATE_RROCA_RUBEN';
    expect((guardiaDePublicacion({ flujo: lleno }) as string[]).join('|')).toMatch(/REEMPLAZAR_TELEFONOS/i);
  });
  it('`--publicable` no se mezcla con --verificar ni con --todos', () => {
    for (const extra of ['--verificar', '--todos']) {
      const r = spawnSync(process.execPath, [join(RESCATE, 'construir.mjs'), '--publicable', '--tenant', 'rroca-ruben', extra], { encoding: 'utf8', env: entornoDelEmulador(undefined) });
      expect(r.status, extra).toBe(2);
    }
  });
});

describe('«no se copia»: dos tenants iguales salvo los datos', () => {
  const rutaA = datosTemporales((d) => { d['tenant'] = 'prueba-a'; d['nombreFlujo'] = 'NovuChat — Rescate 22 h (prueba-a)'; });
  const rutaB = datosTemporales((d) => {
    d['tenant'] = 'prueba-b';
    d['nombreFlujo'] = 'NovuChat — Rescate 22 h (prueba-b)';
    d['credenciales'] = { ingesta: 'Ingesta B', graph: 'Graph B', gemini: 'Gemini B' };
    Object.assign(d['configBase'], {
      phoneNumberId: '987654321', listaDePrueba: false, telefonosDePrueba: '70011133', rescateQuien: 'Otra Marca',
      rescateSaludo: 'Hola, soy el asistente virtual de Otra Marca.',
      rescateTextoFijo: 'Hola, soy el asistente virtual de Otra Marca. Quedó pendiente tu consulta. ¿Te quedó alguna duda?', quienPromete: 'marca',
    });
  });
  const A = JSON.parse((construir({ tenant: 'prueba-a', datos: rutaA, verificar: true }) as { texto: string }).texto) as Flujo;
  const B = JSON.parse((construir({ tenant: 'prueba-b', datos: rutaB, verificar: true }) as { texto: string }).texto) as Flujo;
  const sinDatos = (f: Flujo): Flujo => {
    const c = copia(f);
    c.name = '';
    (nodo(c, 'Config base').parameters['assignments'] as J)['assignments'] = [];
    for (const n of c.nodes) for (const cred of Object.values(n.credentials ?? {})) cred.name = '';
    return c;
  };
  it('los dos JSON difieren SOLO en el nombre, en las asignaciones de «Config base» y en los nombres de las credenciales', () => {
    expect(A.name).not.toBe(B.name);
    expect(JSON.stringify(A)).not.toBe(JSON.stringify(B));
    expect(JSON.stringify(sinDatos(A))).toBe(JSON.stringify(sinDatos(B)));
    expect(JSON.stringify(sinDatos(A))).toBe(JSON.stringify(sinDatos(copia(RUBEN))));
  });
  it('la cadena de envío es la del módulo común (no una copia): idéntica a `nodosDeEnvio`, salvo «Enviar respaldo» (que se quita a propósito)', () => {
    const comun = nodosDeEnvio({ credenciales: { graph: 'Graph B', ingesta: 'Ingesta B' }, ingestaUrl: RS_URL_INGESTA, armado: 'Armar rescate', config: 'Config base', entrada: 'Config base', desde: [1680, 300] }) as { nodes: unknown[] };
    const propios = new Set(['Cada 10 minutos', 'Config base', 'Reclamar rescates', 'Preparar rescates', '¿Hay historial?', 'Redactar rescate', 'Armar rescate', '¿Meta aceptó?']);
    expect(B.nodes.filter((n) => !propios.has(n.name))).toEqual((comun.nodes as { name: string }[]).filter((n) => n.name !== 'Enviar respaldo'));
    expect(B.nodes.length).toBe(13);
  });
  it('los nodos Code INCLUYEN la librería y el filtro (byte a byte), no una copia retocada', () => {
    const rescate = leer(join(RESCATE, 'src/rescate.js')).trimEnd();
    const filtro = leer(join(ESTA, '../../Flujos/experimental/comun-sin-agente/src/filtro-redaccion.js')).trimEnd();
    expect(String(nodo(B, 'Preparar rescates').parameters['jsCode'])).toContain(rescate);
    const armar = String(nodo(B, 'Armar rescate').parameters['jsCode']);
    expect(armar).toContain(rescate);
    expect(armar).toContain(filtro);
    expect(String(nodo(B, 'Preparar rescates').parameters['jsCode'])).not.toContain('function cmNorm');
  });
  it('las URL de las Functions son las constantes del módulo', () => {
    expect(nodo(B, 'Reclamar rescates').parameters['url']).toBe(RS_URL_RECLAMAR);
    expect(nodo(B, 'Reportar mensaje (saliente)').parameters['url']).toBe(RS_URL_INGESTA);
  });
});
