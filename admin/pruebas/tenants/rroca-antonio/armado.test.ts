/**
 * «EL PUENTE» DE ANTONIO (tenant rroca-antonio) — PR-A: EL ARMADO. Los JSON versionados salen de `construir.mjs` (plantilla + código + datos), nunca a mano.
 *
 * Qué prueba, negando:
 *   1. los dos JSON están AL DÍA con lo que arma la plantilla (`--verificar`), y se cuentan: ≤ 48 nodos, 36 en producción y 31 en prueba;
 *   2. cada GUARDIA rechaza su violación (una prueba por guardia, con el caso límite): WhatsApp Trigger, `subscriptions`, receptor con «Continue on Fail», `wabaIdEsperado` como expresión, sin descartar repetidos
 *      entre ejecuciones, entrada de prueba en producción, receptor en la prueba, anfitrión fuera de la lista, retención, orden, zona, marcadores `REEMPLAZAR_` fuera de su lugar, el reporte del entrante abajo en el lienzo;
 *   3. los DATOS solo traen marcadores `REEMPLAZAR_*` para identificadores y rutas, y rechazan formas inválidas;
 *   4. el SANEO del repo público (sin teléfonos completos, sin tokens) y la REGLA DE ZONAS (ningún `.js` de Antonio nombra a otro cliente);
 *   5. la librería `ra.js`: la ficha por teléfono olvida a las 48 h y recuerda solo los últimos ids.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { J } from '../../lib/flujo';

const AQUI = dirname(fileURLToPath(import.meta.url));
const REPO = join(AQUI, '../../../..');
const CARPETA = join(REPO, 'Flujos/experimental/rroca-antonio');
const mod = (await import(pathToFileURL(join(CARPETA, 'construir.mjs')).href)) as {
  construir: (o?: J) => Array<{ archivo: string; nodos: number; alDia: boolean; existia: boolean; versionado: string[] }>;
  guardias: (v: 'produccion' | 'prueba', f: J) => string[];
  cargarDatos: (r?: string) => J;
  anfitrionPermitido: (u: string, n?: string) => boolean;
  TOPE_DE_NODOS: number;
};
const leerJson = (a: string): J => JSON.parse(readFileSync(join(CARPETA, a), 'utf8')) as J;
const PRODUCCION = leerJson('rroca-antonio.json');
const PRUEBA = leerJson('rroca-antonio.prueba.json');
const clon = (f: J): J => JSON.parse(JSON.stringify(f)) as J;
const nodo = (f: J, n: string): J => (f['nodes'] as J[]).find((x) => x['name'] === n) as J;

describe('el armado: lo versionado es lo que arma la plantilla', () => {
  it('`--verificar`: los dos JSON están al día, sin guardias violadas', () => {
    const r = mod.construir({ verificar: true });
    expect(r.map((x) => x.archivo)).toEqual(['rroca-antonio.json', 'rroca-antonio.prueba.json']);
    for (const x of r) {
      expect(x.existia, x.archivo).toBe(true);
      expect(x.alDia, x.archivo).toBe(true);
      expect(x.versionado, x.archivo).toEqual([]);
    }
  });

  it('nodos: producción 46 y prueba 41 (≤ 48); la prueba cambia el receptor (6) por la «Entrada de prueba» (1)', () => {
    expect((PRODUCCION['nodes'] as J[]).length).toBe(46);
    expect((PRUEBA['nodes'] as J[]).length).toBe(41);
    expect(mod.TOPE_DE_NODOS).toBe(48);
  });

  it('el núcleo: Config base, Carga de entrada, Traer configuración, Config del negocio, Normalizar entrada, ¿Reportar? y Reportar (entrante), Puerta del turno', () => {
    for (const n of ['Config base', 'Carga de entrada', 'Traer configuración', 'Config del negocio', 'Normalizar entrada', '¿Reportar? (entrante)', 'Reportar mensaje (entrante)', 'Puerta del turno']) {
      expect(nodo(PRODUCCION, n), n).toBeDefined();
      expect(nodo(PRUEBA, n), n).toBeDefined();
    }
  });

  it('ajustes: orden v1, zona America/La_Paz, sin guardar ejecuciones exitosas ni el progreso, y SIN la marca de no publicable (PR-B: la conversación está completa)', () => {
    for (const f of [PRODUCCION, PRUEBA]) {
      expect(f['settings']).toMatchObject({ executionOrder: 'v1', timezone: 'America/La_Paz', saveDataSuccessExecution: 'none', saveDataErrorExecution: 'all', saveExecutionProgress: false });
      expect(f['meta']).toBeUndefined();
    }
  });

  it('la cadena de envío es la común (con lote de 1 y 1,5 s) y «¿Meta aceptó?» está entre «¿Reportar? (saliente)» y «Reportar mensaje (saliente)»', () => {
    const c = PRODUCCION['connections'] as J;
    expect(c['¿Reportar? (saliente)'].main[0].map((x: J) => x['node'])).toEqual(['¿Meta aceptó?']);
    expect(c['¿Meta aceptó?'].main[0].map((x: J) => x['node'])).toEqual(['Reportar mensaje (saliente)']);
    const env = nodo(PRODUCCION, 'Enviar a WhatsApp');
    expect(env['parameters'].options.batching.batch).toEqual({ batchSize: 1, batchInterval: 1500 });
    expect(env['onError']).toBe('continueRegularOutput');
    // El reporte saliente lee la entrada del nodo «Normalizar entrada» (no de uno que no existe en este flujo).
    expect(JSON.stringify(nodo(PRODUCCION, 'Reportar mensaje (saliente)'))).toContain("$('Normalizar entrada')");
    expect(JSON.stringify(PRODUCCION)).not.toContain('Interpretar entrada');
  });

  it('«Armar mensajes» cuelga también de «Resumen del turno», que es el nodo más bajo del lienzo (corre al final con executionOrder v1)', () => {
    const c = PRODUCCION['connections'] as J;
    expect(c['Armar mensajes'].main[0].map((x: J) => x['node'])).toContain('Resumen del turno');
    const ys = (PRODUCCION['nodes'] as J[]).filter((n) => ['Resumen del turno', '¿Enviar de verdad?'].includes(n['name'])).map((n) => n['position'][1]);
    const resumen = nodo(PRODUCCION, 'Resumen del turno')['position'][1];
    expect(Math.max(...ys)).toBe(resumen);
  });
});

describe('las guardias: cada una rechaza su violación', () => {
  const hallazgos = (v: 'produccion' | 'prueba', f: J): string => mod.guardias(v, f).join(' | ');
  it('los JSON limpios no tienen hallazgos', () => {
    expect(mod.guardias('produccion', PRODUCCION)).toEqual([]);
    expect(mod.guardias('prueba', PRUEBA)).toEqual([]);
  });
  it('un WhatsApp Trigger (prohibición 7)', () => {
    const f = clon(PRODUCCION); (f['nodes'] as J[]).push({ name: 'WhatsApp Trigger', type: 'n8n-nodes-base.whatsAppTrigger', parameters: {}, position: [0, 0] });
    expect(hallazgos('produccion', f)).toMatch(/WhatsApp Trigger/);
  });
  it('«subscriptions» o «subscribed_apps» en cualquier parte del flujo', () => {
    for (const s of ['/subscriptions', 'subscribed_apps']) {
      const f = clon(PRODUCCION); nodo(f, 'Config base')['notes'] = `llama a ${s}`;
      expect(hallazgos('produccion', f), s).toMatch(/subscri/);
    }
  });
  it('un agente, una memoria o un modelo de chat de n8n', () => {
    for (const t of ['@n8n/n8n-nodes-langchain.agent', '@n8n/n8n-nodes-langchain.memoryBufferWindow', '@n8n/n8n-nodes-langchain.lmChatGoogleGemini']) {
      const f = clon(PRODUCCION); (f['nodes'] as J[]).push({ name: 'X', type: t, parameters: {}, position: [0, 0] });
      expect(hallazgos('produccion', f), t).toMatch(/agente, memoria o modelo/);
    }
  });
  it('más de 48 nodos', () => {
    const f = clon(PRODUCCION);
    for (let i = (f['nodes'] as J[]).length; i < 49; i++) (f['nodes'] as J[]).push({ name: `Relleno ${i}`, type: 'n8n-nodes-base.noOp', parameters: {}, position: [0, 0] });
    expect(hallazgos('produccion', f)).toMatch(/49 nodos y el tope es 48/);
    (f['nodes'] as J[]).pop();
    expect(hallazgos('produccion', f)).not.toMatch(/el tope es 48/);
  });
  it('la marca `meta.noPublicable` de PR-A ya no va (la conversación está completa); la guardia de publicación es del PR-C', () => {
    const f = clon(PRODUCCION); f['meta'] = { noPublicable: 'x' };
    expect(hallazgos('produccion', f)).toMatch(/noPublicable/);
  });
  it('falta un nodo de la conversación completa o del aviso a Antonio (sin el aviso, los textos que prometen revisión no tendrían respaldo)', () => {
    for (const n of ['Cotejar en el servidor', 'Conversar con el modelo', 'Armar avisos', '¿Hay avisos?', 'Enviar aviso']) {
      const f = clon(PRODUCCION); f['nodes'] = (f['nodes'] as J[]).filter((x) => x['name'] !== n);
      expect(hallazgos('produccion', f), n).toMatch(/conversación completa/);
    }
  });
  it('«Enviar aviso» sin `onError: continueRegularOutput` (un rechazo de Meta cortaría el turno) o sin colgar de «Armar mensajes»', () => {
    const f = clon(PRODUCCION); delete nodo(f, 'Enviar aviso')['onError'];
    expect(hallazgos('produccion', f)).toMatch(/onError/);
    const g = clon(PRODUCCION); (g['connections'] as J)['Enviar aviso'] = { main: [[]] };
    expect(hallazgos('produccion', g)).toMatch(/no cuelga de «Armar mensajes»/);
  });
  it('el reporte saliente sin el evento `no_contactar` (condición dura del contrato del rescate)', () => {
    const f = clon(PRODUCCION); const r = nodo(f, 'Reportar mensaje (saliente)'); r['parameters'].jsonBody = String(r['parameters'].jsonBody).replace(/no_contactar/g, 'otro');
    expect(hallazgos('produccion', f)).toMatch(/no_contactar/);
  });
  it('la PRUEBA con una credencial de producción de Gemini o de Graph (los nodos de medios, el aviso y el modelo van con las de prueba)', () => {
    const g = clon(PRUEBA); nodo(g, 'Conversar con el modelo')['credentials'] = { googlePalmApi: { id: '', name: 'Google Gemini(PaLM) Api account' } };
    expect(hallazgos('prueba', g)).toMatch(/credencial de producción en «Conversar con el modelo»/);
    const h = clon(PRUEBA); nodo(h, 'Descargar medio')['credentials'] = { httpHeaderAuth: { id: '', name: 'Graph WhatsApp Antonio (Bearer)' } };
    expect(hallazgos('prueba', h)).toMatch(/credencial de producción en «Descargar medio»/);
  });
  it('la «Entrada de prueba» en producción, y el receptor en la prueba', () => {
    const f = clon(PRODUCCION); (f['nodes'] as J[]).push(clon(nodo(PRUEBA, 'Entrada de prueba')));
    expect(hallazgos('produccion', f)).toMatch(/Entrada de prueba/);
    const g = clon(PRUEBA); (g['nodes'] as J[]).push(clon(nodo(PRODUCCION, 'Entrega del receptor')));
    expect(hallazgos('prueba', g)).toMatch(/Entrega del receptor/);
  });
  it('la «Entrada de prueba» sin credencial de cabecera', () => {
    const g = clon(PRUEBA); delete nodo(g, 'Entrada de prueba')['credentials'];
    expect(hallazgos('prueba', g)).toMatch(/credencial de cabecera/);
  });
  it('un webhook que no es el de su variante', () => {
    const f = clon(PRODUCCION); (f['nodes'] as J[]).push({ name: 'Otro webhook', type: 'n8n-nodes-base.webhook', parameters: {}, position: [0, 0] });
    expect(hallazgos('produccion', f)).toMatch(/no corresponde a esta variante/);
  });
  it('«Continue on Fail» u `onError` en el verificador, y en «¿Firma válida?»', () => {
    const f = clon(PRODUCCION); nodo(f, 'Verificar firma con el receptor')['onError'] = 'continueRegularOutput';
    expect(hallazgos('produccion', f)).toMatch(/Continue on Fail/);
    const g = clon(PRODUCCION); nodo(g, '¿Firma válida?')['continueOnFail'] = true;
    expect(hallazgos('produccion', g)).toMatch(/¿Firma válida\?/);
  });
  it('`wabaIdEsperado` como EXPRESIÓN (nunca un valor fijo)', () => {
    const f = clon(PRODUCCION);
    const v = nodo(f, 'Verificar firma con el receptor');
    v['parameters'].jsonBody = String(v['parameters'].jsonBody).replace(/wabaIdEsperado: "[^"]*"/, 'wabaIdEsperado: $json.body.value.metadata.waba_id');
    expect(hallazgos('produccion', f)).toMatch(/wabaIdEsperado/);
  });
  it('«Descartar repetidos» que no descarta entre ejecuciones', () => {
    const f = clon(PRODUCCION); nodo(f, 'Descartar repetidos')['parameters'].operation = 'removeDuplicateInputItems';
    expect(hallazgos('produccion', f)).toMatch(/entre ejecuciones/);
  });
  it('falta un nodo de la entrada verificada del receptor', () => {
    const f = clon(PRODUCCION); f['nodes'] = (f['nodes'] as J[]).filter((n) => n['name'] !== 'Aceptar (200)');
    expect(hallazgos('produccion', f)).toMatch(/Aceptar \(200\)/);
  });
  it('falta un nodo del contrato con los módulos comunes de medios', () => {
    const f = clon(PRODUCCION); f['nodes'] = (f['nodes'] as J[]).filter((n) => n['name'] !== 'Obtener URL del medio (general)');
    expect(hallazgos('produccion', f)).toMatch(/contrato con los módulos comunes de medios/);
  });
  it('un nodo HTTP que habla con un anfitrión fuera de la lista (y los parecidos engañosos)', () => {
    for (const url of ['https://evil.example/x', 'http://graph.facebook.com/x', 'https://graph.facebook.com.evil.example/x', 'https://evil.example/graph.facebook.com']) {
      const f = clon(PRODUCCION); nodo(f, 'Traer configuración')['parameters'].url = url;
      expect(hallazgos('produccion', f), url).toMatch(/anfitrión fuera de la lista/);
    }
    expect(mod.anfitrionPermitido('https://graph.facebook.com/v26.0/x')).toBe(true);
    // La única excepción por nombre: «Descargar medio» baja de la URL que devuelve Meta.
    expect(mod.anfitrionPermitido('={{ $json.url }}', 'Descargar medio')).toBe(true);
    expect(mod.anfitrionPermitido('={{ $json.url }}', 'Otro nodo')).toBe(false);
  });
  it('retención de ejecuciones, `errorWorkflow`, orden y zona horaria', () => {
    const cambios: Array<[string, unknown, RegExp]> = [
      ['saveDataSuccessExecution', 'all', /retención/], ['saveDataErrorExecution', 'none', /retención/], ['saveExecutionProgress', true, /retención/],
      ['errorWorkflow', 'x', /errorWorkflow/], ['executionOrder', 'v0', /executionOrder/], ['timezone', 'UTC', /timezone/],
    ];
    for (const [campo, valor, re] of cambios) {
      const f = clon(PRODUCCION); (f['settings'] as J)[campo] = valor;
      expect(hallazgos('produccion', f), campo).toMatch(re);
    }
  });
  it('un marcador `REEMPLAZAR_` fuera de «Config base», el receptor y la ruta de prueba', () => {
    const f = clon(PRODUCCION); nodo(f, 'Decidir turno')['notes'] = 'REEMPLAZAR_ALGO';
    expect(hallazgos('produccion', f)).toMatch(/trae un marcador REEMPLAZAR_/);
  });
  it('«Reportar mensaje (entrante)» debajo de la rama que responde (el aviso de uso extendido no saldría nunca)', () => {
    for (const abajo of ['Puerta del turno', '¿Bajar medio?', 'Decidir turno', 'Armar mensajes']) {
      const f = clon(PRODUCCION); nodo(f, 'Reportar mensaje (entrante)')['position'] = [1400, nodo(f, abajo)['position'][1] + 10];
      expect(hallazgos('produccion', f), abajo).toMatch(new RegExp(`arriba de «${abajo.replace(/[?()¿]/g, '.')}`));
    }
  });
});

describe('los datos: solo marcadores para identificadores y rutas', () => {
  const ruta = join(REPO, 'admin/scripts/datos/rroca-antonio/rroca-antonio.json');
  const datos = mod.cargarDatos(ruta);
  it('los identificadores y las rutas son marcadores `REEMPLAZAR_*` (repo público); el modelo es gemini-3.5-flash-lite', () => {
    const d = datos as { receptor: J; pruebaRuta: string; configBase: J };
    for (const v of [...Object.values(d.receptor), d.pruebaRuta, d.configBase['phoneNumberIdEsperado'], d.configBase['numeroRecepcion'], d.configBase['telefonosDePrueba']]) expect(String(v)).toMatch(/^REEMPLAZAR_[A-Z0-9_]+$/);
    expect(d.configBase['modelo']).toBe('gemini-3.5-flash-lite');
    // Ya no hay línea de protección: el asistente no atiende denuncias y no cita recursos.
    expect(d.configBase).not.toHaveProperty('lineaProteccion');
    // Las plantillas YA existen en Meta (de Antonio) y están APPROVED (Meta las aprobó): sus nombres son dato; un estado distinto de APPROVED deja sin aviso fuera de la ventana (lo niegan venta.test.ts y negadas.test.ts).
    expect(d.configBase['avisoComprobantePlantilla']).toBe('aviso_comprobante_recibido');
    expect(d.configBase['avisoConsultaPlantilla']).toBe('aviso_consulta_para_antonio');
    expect(d.configBase['avisoConsultaEstado']).toBe('APPROVED');
    expect(d.configBase['avisoPlantillaIdioma']).toBe('es');
    expect(d.configBase['avisoComprobanteEstado']).toBe('APPROVED');
    expect(d.configBase['plazoEntregaHoras']).toBe(6);
    expect(d.configBase['temperatura']).toBe(0.4);
    expect(d.configBase['prefijosPermitidos']).toBe('591');
  });
  it('el JSON armado lleva los marcadores solo en «Config base», el receptor y la ruta de prueba, y ningún teléfono completo', () => {
    const texto = JSON.stringify(PRODUCCION) + JSON.stringify(PRUEBA);
    expect(texto).not.toMatch(/\b\d{11,}\b/);
    expect(texto).not.toMatch(/EAA[A-Za-z0-9]{20,}|Bearer [A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{20,}/);
  });
  it('rechaza una forma inválida: ruta del receptor real, versión de Graph, prefijo, modelo, teléfono de prueba', () => {
    const base = JSON.parse(readFileSync(ruta, 'utf8')) as J;
    const intentos: Array<(d: J) => void> = [
      (d) => { d['receptor'].ruta = 'abc123'; },
      (d) => { d['configBase'].waGraphVersion = 'latest'; },
      (d) => { d['configBase'].prefijosPermitidos = '+591'; },
      (d) => { d['configBase'].modelo = 'gpt-4'; },
      (d) => { d['configBase'].modelo = 'gemini-2.5-pro'; },
      (d) => { d['configBase'].plazoEntregaHoras = 24; },
      (d) => { d['configBase'].temperatura = 1.5; },
      (d) => { d['configBase'].avisoComprobanteEstado = 'APROBADA'; },
      (d) => { d['configBase'].garantiaTexto = 'corto'; },
      (d) => { d['configBase'].telefonosDePrueba = '123'; },
      (d) => { d['pruebaRuta'] = 'ruta-real'; },
      (d) => { delete d['configBase'].nombreNegocio; },
      (d) => { d['configBase'].extra = { a: 1 }; },
    ];
    // Carpeta temporal fuera del repositorio, solo para esta prueba.
    const dir = mkdtempSync(join(tmpdir(), 'rroca-antonio-datos-'));
    try {
      for (const [i, cambio] of intentos.entries()) {
        const d = clon(base); cambio(d);
        const tmp = join(dir, `datos-${i}.json`);
        writeFileSync(tmp, JSON.stringify(d));
        expect(() => mod.cargarDatos(tmp), `intento ${i}`).toThrow(/datos no válidos/);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('zona: nada de otro cliente en el código de Antonio', () => {
  const archivos = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? archivos(join(dir, e.name)) : [join(dir, e.name)]));
  const propios = archivos(join(CARPETA, 'src')).filter((f) => f.endsWith('.js'));
  it('ningún `.js` de Antonio nombra a otro cliente ni a otro negocio', () => {
    expect(propios.length).toBeGreaterThan(5);
    for (const f of propios) {
      const sinComentarios = readFileSync(f, 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
      expect(sinComentarios, f).not.toMatch(/rub[eé]n|bellido|platinum|q'?taco|novuchat|rroca-ruben/i);
    }
  });
  it('los textos que salen al cliente no niegan ser una IA, no prometen ni afirman un pago', () => {
    const t = readFileSync(join(CARPETA, 'src/lib/ra.js'), 'utf8');
    const textos = [...t.matchAll(/^const RA_TEXTO_[A-Z_]+ = '([^']*)'/gm)].map((m) => m[1]!);
    expect(textos.length).toBeGreaterThan(0);
    for (const x of textos) {
      expect(x).not.toMatch(/acreditad|verificad|validad|recibimos tu pago/i);
      expect(x).not.toMatch(/\bno soy (un |una )?(bot|ia|asistente|robot)\b|\bsoy (una )?persona\b|humano/i);
    }
  });
});

describe('ra.js: la ficha por teléfono', () => {
  // El código evaluado es el de un archivo del propio repositorio (src/lib), no una entrada externa: solo prueba.
  // nosemgrep: devsecops.js-eval-prohibido
  const ra = new Function(readFileSync(join(CARPETA, 'src/lib/ra.js'), 'utf8') + '\nreturn { raFichaVigente, raYaVisto, raRecordarIds, raBarrer, RA_OLVIDO_MS, RA_TOPE_IDS, RA_TOPE_FICHAS };')() as J;
  it('una ficha de más de 48 horas se olvida; una vigente conserva sus ids', () => {
    const ahora = 1_000_000_000_000;
    expect(ra.raFichaVigente({ ultimoMs: ahora - ra.RA_OLVIDO_MS - 1, ultimosIds: ['a'] }, ahora).ultimosIds).toEqual([]);
    expect(ra.raFichaVigente({ ultimoMs: ahora - 1000, ultimosIds: ['a'] }, ahora).ultimosIds).toEqual(['a']);
  });
  it('lo que no es una ficha (arreglo, texto, nulo) es una ficha nueva', () => {
    for (const raro of [null, undefined, [], 'x', 3]) expect(ra.raFichaVigente(raro, 1).ultimosIds).toEqual([]);
  });
  it('recuerda solo los últimos 40 ids y descarta los vacíos y los de más de 200 caracteres', () => {
    const f = ra.raFichaVigente(null, 1);
    ra.raRecordarIds(f, Array.from({ length: 50 }, (_, i) => `id${i}`));
    expect(f.ultimosIds).toHaveLength(ra.RA_TOPE_IDS);
    expect(f.ultimosIds[39]).toBe('id49');
    ra.raRecordarIds(f, ['', 'x'.repeat(201), 3]);
    expect(f.ultimosIds).toHaveLength(ra.RA_TOPE_IDS);
    expect(ra.raYaVisto(f, 'id49')).toBe(true);
    expect(ra.raYaVisto(f, 'id0')).toBe(false);
    expect(ra.raYaVisto(f, '')).toBe(false);
  });
  it('el barrido saca las fichas viejas o sin hora y no deja pasar de 1.000 (cada ficha guarda hasta 15 mensajes de memoria)', () => {
    const ahora = 10 ** 12;
    const mapa: J = { a: { ultimoMs: ahora - ra.RA_OLVIDO_MS - 1 }, b: { ultimoMs: 0 }, c: { ultimoMs: ahora } };
    ra.raBarrer(mapa, ahora);
    expect(Object.keys(mapa)).toEqual(['c']);
    const grande: J = {};
    for (let i = 0; i < ra.RA_TOPE_FICHAS + 3; i++) grande[`k${i}`] = { ultimoMs: ahora - i };
    ra.raBarrer(grande, ahora);
    expect(Object.keys(grande)).toHaveLength(ra.RA_TOPE_FICHAS);
    expect(grande['k0']).toBeDefined();
  });
});
