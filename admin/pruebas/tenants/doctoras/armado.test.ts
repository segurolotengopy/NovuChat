/**
 * LAS DOCTORAS (tenants rroca-evy y rroca-emma) — EL ARMADO. Los JSON versionados salen de `construir.mjs` (UNA plantilla + UN código + los datos de cada tenant), nunca a mano.
 *
 * Qué prueba, negando:
 *   1. los JSON de cada tenant están AL DÍA con lo que arma la plantilla (`--verificar`), y se cuentan: ≤ 48 nodos;
 *   2. cada GUARDIA rechaza su violación (una prueba por guardia, con el caso límite): WhatsApp Trigger, `subscriptions`, receptor con «Continue on Fail», `wabaIdEsperado` como expresión, sin descartar
 *      repetidos entre ejecuciones, entrada de prueba en producción, receptor en la prueba, anfitrión fuera de la lista, retención, orden, zona, marcadores `REEMPLAZAR_` fuera de su lugar, el reporte
 *      del entrante abajo en el lienzo;
 *   3. los DATOS solo traen marcadores `REEMPLAZAR_*` para identificadores y rutas, rechazan formas inválidas y rechazan los textos que prometen resultado, dan precio o llevan un enlace;
 *   4. el SANEO del repo público (sin teléfonos completos, sin tokens) y la REGLA MULTI-TENANT: ningún literal de una doctora en `src/` (nombre, clínica, producto, dirección);
 *   5. la librería `dr.js`: la ficha por teléfono olvida a las 48 h y recuerda solo los últimos ids; la baja y el riesgo se detectan con las expresiones de Antonio.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { J } from '../../lib/flujo';
import { TENANTS, datosDe, flujoDe, negocioDe } from './mundo';

const AQUI = dirname(fileURLToPath(import.meta.url));
const REPO = join(AQUI, '../../../..');
const CARPETA = join(REPO, 'Flujos/experimental/doctoras');
const DATOS = join(REPO, 'admin/scripts/datos/doctoras');
const mod = (await import(pathToFileURL(join(CARPETA, 'construir.mjs')).href)) as {
  construir: (o?: J) => Array<{ archivo: string; tenant: string; nodos: number; alDia: boolean; existia: boolean; versionado: string[] }>;
  guardias: (v: 'produccion' | 'prueba', f: J) => string[];
  cargarDatos: (r: string) => J;
  erroresDeDoctora: (d: J) => string[];
  tenantsConDatos: () => string[];
  anfitrionPermitido: (u: string, n?: string) => boolean;
  TOPE_DE_NODOS: number;
  TEXTOS_DE_CONTENIDO: string[];
  PALABRAS_PROHIBIDAS: RegExp;
};
const clon = <T>(f: T): T => JSON.parse(JSON.stringify(f)) as T;
const nodo = (f: J, n: string): J => (f['nodes'] as J[]).find((x) => x['name'] === n) as J;
const PRODUCCION = flujoDe('rroca-evy') as unknown as J;
const PRUEBA = flujoDe('rroca-evy', true) as unknown as J;
/** Los nodos de cada variante en esta etapa (cambia con la conversación; el tope es 48). */
const NODOS = { produccion: 43, prueba: 38 };

describe('el armado: lo versionado es lo que arma la plantilla', () => {
  it('hay un archivo de datos por doctora y cada uno arma sus DOS JSON', () => {
    expect([...mod.tenantsConDatos()].sort()).toEqual(TENANTS.filter((t) => readdirSync(DATOS).includes(`${t}.json`)).sort());
    expect(mod.tenantsConDatos()).toHaveLength(2);
  });

  it('`--verificar`: los JSON de cada doctora están al día, sin guardias violadas', () => {
    const r = mod.construir({ verificar: true });
    expect(r.length).toBe(mod.tenantsConDatos().length * 2);
    for (const x of r) {
      expect(x.existia, x.archivo).toBe(true);
      expect(x.alDia, x.archivo).toBe(true);
      expect(x.versionado, x.archivo).toEqual([]);
    }
  });

  it('nodos: la producción y la prueba cuentan lo esperado (≤ 48); la prueba cambia el receptor (6) por la «Entrada de prueba» (1)', () => {
    expect((PRODUCCION['nodes'] as J[]).length).toBe(NODOS.produccion);
    expect((PRUEBA['nodes'] as J[]).length).toBe(NODOS.prueba);
    expect(NODOS.produccion - NODOS.prueba).toBe(5);
    expect(mod.TOPE_DE_NODOS).toBe(48);
  });

  it('el núcleo: Config base, Carga de entrada, Traer configuración, Config del negocio, Normalizar entrada, ¿Reportar? y Reportar (entrante), Puerta del turno', () => {
    for (const n of ['Config base', 'Carga de entrada', 'Traer configuración', 'Config del negocio', 'Normalizar entrada', '¿Reportar? (entrante)', 'Reportar mensaje (entrante)', 'Puerta del turno']) {
      expect(nodo(PRODUCCION, n), n).toBeDefined();
      expect(nodo(PRUEBA, n), n).toBeDefined();
    }
  });

  it('ajustes: orden v1, zona America/La_Paz, sin guardar ejecuciones exitosas ni el progreso ni las fallidas: datos de salud, opción B de DISENO.md', () => {
    for (const f of [PRODUCCION, PRUEBA]) {
      expect(f['settings']).toMatchObject({ executionOrder: 'v1', timezone: 'America/La_Paz', saveDataSuccessExecution: 'none', saveDataErrorExecution: 'none', saveExecutionProgress: false });
    }
  });

  it('la cadena de envío es la común (con lote de 1 y 1,5 s) y «¿Meta aceptó?» está entre «¿Reportar? (saliente)» y «Reportar mensaje (saliente)»', () => {
    const c = PRODUCCION['connections'] as J;
    expect(c['¿Reportar? (saliente)'].main[0].map((x: J) => x['node'])).toEqual(['¿Meta aceptó?']);
    expect(c['¿Meta aceptó?'].main[0].map((x: J) => x['node'])).toEqual(['Reportar mensaje (saliente)']);
    const env = nodo(PRODUCCION, 'Enviar a WhatsApp');
    expect(env['parameters'].options.batching.batch).toEqual({ batchSize: 1, batchInterval: 1500 });
    expect(env['onError']).toBe('continueRegularOutput');
    expect(JSON.stringify(nodo(PRODUCCION, 'Reportar mensaje (saliente)'))).toContain("$('Normalizar entrada')");
    // (El comentario de `avisos.js`, incluido desde venta-minima, nombra ese nodo: lo que importa es que ningún nodo ni conexión lo lea.)
    expect(JSON.stringify({ c, n: (PRODUCCION['nodes'] as J[]).map((x) => ({ ...x, parameters: { ...x['parameters'], jsCode: undefined } })) })).not.toContain('Interpretar entrada');
  });

  it('«Armar mensajes» cuelga también de «Resumen del turno», que es el nodo más bajo del lienzo (corre al final con executionOrder v1)', () => {
    const c = PRODUCCION['connections'] as J;
    expect(c['Armar mensajes'].main[0].map((x: J) => x['node'])).toContain('Resumen del turno');
    const ys = (PRODUCCION['nodes'] as J[]).filter((n) => ['Resumen del turno', '¿Enviar de verdad?'].includes(n['name'])).map((n) => n['position'][1]);
    expect(Math.max(...ys)).toBe(nodo(PRODUCCION, 'Resumen del turno')['position'][1]);
  });

  it('el reporte saliente solo lleva el evento `no_contactar` (nada de cobro: estos flujos no cobran ni abren QR)', () => {
    const cuerpo = String(nodo(PRODUCCION, 'Reportar mensaje (saliente)')['parameters'].jsonBody);
    expect(cuerpo).toContain("m.evento === 'no_contactar'");
    expect(cuerpo).not.toMatch(/reglaCobro|referencia|monto|qr_enviado/);
    for (const prohibido of ['Cotejar en el servidor', 'Interpretar lectura', '¿Cotejar?']) expect(nodo(PRODUCCION, prohibido), prohibido).toBeUndefined();
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
  it('falta un nodo del contrato con los módulos comunes de medios', () => {
    for (const n of ['Normalizar entrada', 'Config del negocio', 'Obtener URL del medio (general)', 'Preparar transcripción', 'Preparar imagen', 'Medio no aceptado']) {
      const f = clon(PRODUCCION); f['nodes'] = (f['nodes'] as J[]).filter((x) => x['name'] !== n);
      expect(hallazgos('produccion', f), n).toMatch(new RegExp(`falta el nodo «${n}»`.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')));
    }
  });
  it('el reporte saliente sin el evento `no_contactar`, y el entrante sin la baja o el riesgo escritos', () => {
    const f = clon(PRODUCCION); nodo(f, 'Reportar mensaje (saliente)')['parameters'].jsonBody = "={{ JSON.stringify({ telefono: 'x' }) }}";
    expect(hallazgos('produccion', f)).toMatch(/no reporta el evento `no_contactar`/);
    const g = clon(PRODUCCION); nodo(g, 'Reportar mensaje (entrante)')['parameters'].jsonBody = String(nodo(g, 'Reportar mensaje (entrante)')['parameters'].jsonBody).replace('t.bajaEscrita === true', 'false');
    expect(hallazgos('produccion', g)).toMatch(/no reporta `no_contactar` por la baja ni por el riesgo escritos/);
  });
  it('el receptor: «Continue on Fail», `onError`, `wabaIdEsperado` como expresión y repetidos sin descartar entre ejecuciones', () => {
    const a = clon(PRODUCCION); nodo(a, 'Verificar firma con el receptor')['onError'] = 'continueRegularOutput';
    expect(hallazgos('produccion', a)).toMatch(/Continue on Fail/);
    const b = clon(PRODUCCION); nodo(b, 'Verificar firma con el receptor')['parameters'].jsonBody = String(nodo(b, 'Verificar firma con el receptor')['parameters'].jsonBody).replace(/wabaIdEsperado: "[^"]+"/, 'wabaIdEsperado: $json.waba');
    expect(hallazgos('produccion', b)).toMatch(/wabaIdEsperado.*FIJO/);
    const c = clon(PRODUCCION); nodo(c, 'Descartar repetidos')['parameters'].operation = 'removeDuplicateInputItems';
    expect(hallazgos('produccion', c)).toMatch(/entre ejecuciones/);
    const d = clon(PRODUCCION); nodo(d, '¿Firma válida?')['continueOnFail'] = true;
    expect(hallazgos('produccion', d)).toMatch(/¿Firma válida\?» no puede llevar/);
  });
  it('«Entrada de prueba» en producción, el receptor en la prueba y la prueba sin credencial de cabecera', () => {
    const a = clon(PRODUCCION); (a['nodes'] as J[]).push({ name: 'Entrada de prueba', type: 'n8n-nodes-base.webhook', parameters: {}, position: [0, 0] });
    expect(hallazgos('produccion', a)).toMatch(/Entrada de prueba/);
    const b = clon(PRUEBA); (b['nodes'] as J[]).push({ name: 'Entrega del receptor', type: 'n8n-nodes-base.webhook', parameters: {}, position: [0, 0] });
    expect(hallazgos('prueba', b)).toMatch(/entrada del receptor/);
    const c = clon(PRUEBA); delete nodo(c, 'Entrada de prueba')['credentials'];
    expect(hallazgos('prueba', c)).toMatch(/credencial de cabecera/);
  });
  it('la prueba con una credencial de producción (Graph o Gemini) y un nodo HTTP fuera de la lista de anfitriones', () => {
    const a = clon(PRUEBA); nodo(a, 'Describir imagen')['credentials'].googlePalmApi.name = 'Google Gemini(PaLM) Api account';
    expect(hallazgos('prueba', a)).toMatch(/credencial de producción en «Describir imagen»/);
    const b = clon(PRUEBA); nodo(b, 'Enviar a WhatsApp')['credentials'].httpHeaderAuth.name = 'Graph WhatsApp Dra. Evy (Bearer)';
    expect(hallazgos('prueba', b)).toMatch(/credencial de producción en «Enviar a WhatsApp»/);
    for (const url of ['https://evil.example/x', 'https://graph.facebook.com.evil.example/x', 'http://graph.facebook.com/x']) {
      const f = clon(PRODUCCION); nodo(f, 'Traer configuración')['parameters'].url = url;
      expect(hallazgos('produccion', f), url).toMatch(/anfitrión fuera de la lista/);
    }
    expect(mod.anfitrionPermitido('https://graph.facebook.com/v26.0/1/messages')).toBe(true);
  });
  it('retención, orden de ramas y zona horaria', () => {
    const a = clon(PRODUCCION); (a['settings'] as J)['saveDataSuccessExecution'] = 'all';
    expect(hallazgos('produccion', a)).toMatch(/retención/);
    const e = clon(PRODUCCION); (e['settings'] as J)['saveDataErrorExecution'] = 'all';
    expect(hallazgos('produccion', e)).toMatch(/retención/);
    const b = clon(PRODUCCION); (b['settings'] as J)['executionOrder'] = 'v0';
    expect(hallazgos('produccion', b)).toMatch(/executionOrder/);
    const c = clon(PRODUCCION); (c['settings'] as J)['timezone'] = 'UTC';
    expect(hallazgos('produccion', c)).toMatch(/timezone/);
    const d = clon(PRODUCCION); (d['settings'] as J)['errorWorkflow'] = 'x';
    expect(hallazgos('produccion', d)).toMatch(/errorWorkflow/);
  });
  it('un marcador REEMPLAZAR_ fuera de «Config base», el receptor y la ruta de prueba', () => {
    const f = clon(PRODUCCION); nodo(f, 'Normalizar entrada')['notes'] = 'REEMPLAZAR_ALGO';
    expect(hallazgos('produccion', f)).toMatch(/trae un marcador REEMPLAZAR_/);
  });
  it('«Reportar mensaje (entrante)» abajo en el lienzo', () => {
    const f = clon(PRODUCCION); nodo(f, 'Reportar mensaje (entrante)')['position'] = [0, 99999];
    expect(hallazgos('produccion', f)).toMatch(/tiene que ir arriba de/);
  });
});

describe('los DATOS de cada doctora', () => {
  const evy = (): J => clon(datosDe('rroca-evy'));
  const archivoTemporal = (d: J): { ruta: string; limpiar: () => void } => {
    const dir = mkdtempSync(join(tmpdir(), 'doctoras-'));
    const ruta = join(dir, 'rroca-evy.json');
    writeFileSync(ruta, JSON.stringify(d));
    return { ruta, limpiar: () => rmSync(dir, { recursive: true, force: true }) };
  };
  const carga = (d: J): string => { const t = archivoTemporal(d); try { mod.cargarDatos(t.ruta); return ''; } catch (e) { return (e as Error).message; } finally { t.limpiar(); } };

  it('los datos reales cargan limpios', () => {
    for (const t of mod.tenantsConDatos()) expect(() => mod.cargarDatos(join(DATOS, `${t}.json`))).not.toThrow();
  });
  it('solo marcadores REEMPLAZAR_* para identificadores y rutas: una ruta o un verificador reales se niegan', () => {
    const a = evy(); a['receptor'].ruta = 'a1b2c3d4e5f6'; expect(carga(a)).toMatch(/receptor\.ruta: tiene que ser un marcador/);
    const b = evy(); b['receptor'].urlVerificador = 'https://interno.example/verificar'; expect(carga(b)).toMatch(/receptor\.urlVerificador: tiene que ser un marcador/);
    const c = evy(); c['pruebaRuta'] = 'ruta-real'; expect(carga(c)).toMatch(/pruebaRuta: tiene que ser un marcador/);
    const d = evy(); d['configBase'].numeroRecepcion = '59170000000x'; expect(carga(d)).toMatch(/configBase\.numeroRecepcion: forma no válida/);
  });
  it('el ÚNICO modelo es gemini-3.5-flash-lite (guardia de datos)', () => {
    const a = evy(); a['configBase'].modelo = 'gemini-2.5-pro'; expect(carga(a)).toMatch(/configBase\.modelo: forma no válida/);
  });
  it('el bloque `doctora` va en `doctora`, no en `configBase`; y le faltan campos: se nombra cuál', () => {
    const a = evy(); a['configBase'].doctora = '{}'; expect(carga(a)).toMatch(/configBase\.doctora/);
    const b = evy(); b['doctora'].direccion = 'Av. X # 1'; expect(carga(b)).toMatch(/doctora\.direccion: la dirección se lee de la Consola/);
    const c = evy(); delete c['doctora']; expect(carga(c)).toMatch(/doctora: falta el bloque/);
    const d = evy(); delete d['doctora'].textos.precio; expect(carga(d)).toMatch(/doctora\.textos\.precio: falta/);
    const e = evy(); d['doctora'].tratamientos = []; expect(carga(e) + carga(d)).toMatch(/tratamientos: de 1 a 6/);
  });
  it('ningún texto de la doctora promete resultado, dice «ideal para», da un monto o lleva un enlace (salvedades 1, 2, 6, 14 y 15)', () => {
    for (const malo of ['El efecto es inmediato.', 'Lograrás firmeza desde la primera sesión.', 'Es ideal para ti.', 'Resultado garantizado.', 'Te quedará como la foto.', 'Un efecto lifting.', 'La valoración vale 250 Bs.', 'Mira https://ejemplo.com', 'Escríbenos a wa.me/591', 'Ubicación en Google Maps']) {
      const d = evy(); d['doctora'].textos.gratis = malo;
      expect(mod.erroresDeDoctora(d['doctora']).join('|'), malo).toMatch(/doctora\.textos\.gratis/);
    }
  });
  it('ningún arte se envía por el asistente (`enviable` tiene que ser false): el comparativo trae «efecto lifting inmediato»', () => {
    const d = evy(); d['doctora'].artes[0].enviable = true;
    expect(mod.erroresDeDoctora(d['doctora']).join('|')).toMatch(/enviable: tiene que ser false/);
  });
  it('un texto no puede llevar «@@» ni «{{» (no se cuela en el armado ni en una expresión de n8n)', () => {
    for (const m of ['@@dato:x@@', '{{ $json }}']) {
      const d = evy(); d['doctora'].textos.pensar = m;
      expect(mod.erroresDeDoctora(d['doctora']).join('|'), m).toMatch(/doctora\.textos\.pensar/);
    }
  });
  it('los textos de contenido que cada doctora aporta están todos (la lista es la que lee el código)', () => {
    const d = datosDe('rroca-evy');
    expect(Object.keys(d['doctora'].textos).sort()).toEqual([...mod.TEXTOS_DE_CONTENIDO].sort());
  });
});

describe('el SANEO del repo público y la regla multi-tenant', () => {
  const archivos = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? archivos(join(dir, e.name)) : [join(dir, e.name)]));
  const SRC = archivos(join(CARPETA, 'src')).filter((a) => a.endsWith('.js'));

  it('ningún JSON ni archivo de datos trae un teléfono completo, un token o una ruta de webhook real', () => {
    const textos = [...readdirSync(CARPETA).filter((a) => a.endsWith('.json')).map((a) => join(CARPETA, a)), ...readdirSync(DATOS).map((a) => join(DATOS, a))].map((a) => [a, readFileSync(a, 'utf8')]);
    for (const [ruta, t] of textos) {
      expect(t, ruta).not.toMatch(/\b5917\d{7}\b|\b5917\d{6}\b/);   // un celular boliviano completo
      expect(t, ruta).not.toMatch(/EAA[A-Za-z0-9]{20,}|Bearer [A-Za-z0-9._-]{20,}|AIza[A-Za-z0-9_-]{20}/);
      expect(t, ruta).not.toMatch(/\/webhook\/[0-9a-f-]{20,}/i);
    }
  });

  it('MULTI-TENANT: ningún literal de una doctora (nombre, clínica, producto, dirección) en `src/` (código común)', () => {
    const literales = new Set<string>(['Evy', 'Emma', 'Enma', 'DentalCor', 'Radiesse', 'HArmonyCa', 'Sculptra', 'Piraí', 'Sapocó', 'Pauserna', 'Cotoca', 'Spa Medic', 'Rojas', 'Aguilera', 'Mozer']);
    for (const t of mod.tenantsConDatos()) {
      const d = (datosDe(t as 'rroca-evy')['doctora'] as J);
      for (const campo of ['nombreCorto', 'nombreCompleto', 'clinica', 'direccion']) for (const w of String(campo === 'direccion' ? negocioDe(t as 'rroca-evy')['direccion'] : d[campo]).split(/[^\p{L}]+/u)) if (w.length >= 5 && !/^(Clínica|Avenida|anillo|segundo|Santa|Calle|Medic|Canal|entre)$/i.test(w)) literales.add(w);
      for (const tr of d['tratamientos'] as J[]) literales.add(String(tr['nombre']).replace(/[®™]/g, ''));
    }
    for (const a of SRC) {
      const t = readFileSync(a, 'utf8');
      for (const l of literales) expect(new RegExp(`(?<![\\p{L}])${l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'iu').test(t), `${a.replace(REPO, '')} nombra «${l}»`).toBe(false);
    }
  });

  it('el JSON de una doctora no lleva ningún literal de la otra', () => {
    const tenants = mod.tenantsConDatos();
    if (tenants.length < 2) return;
    const nombres = (t: string): string[] => {
      const d = datosDe(t as 'rroca-evy')['doctora'] as J;
      return [...String(d['nombreCompleto']).split(' '), ...String(d['clinica']).split(' '), ...(d['tratamientos'] as J[]).map((x) => String(x['nombre']))].filter((w) => w.length >= 5 && !/^(Clínica|Radiesse®)$/.test(w));
    };
    for (const a of tenants) for (const b of tenants.filter((x) => x !== a)) {
      const json = readFileSync(join(CARPETA, `doctoras.${a}.json`), 'utf8');
      for (const w of nombres(b)) if (!nombres(a).includes(w)) expect(json.includes(w), `${a} nombra «${w}» de ${b}`).toBe(false);
    }
  });

  it('el armador no escribe fuera de su carpeta ni con enlaces simbólicos: copia de trabajo y `--verificar` sin datos de un tenant', () => {
    const dir = mkdtempSync(join(tmpdir(), 'doctoras-datos-'));
    try {
      cpSync(DATOS, dir, { recursive: true });
      expect(() => mod.construir({ carpetaDeDatos: dir, verificar: true })).not.toThrow();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('dr.js: la ficha por teléfono, la baja y el riesgo', () => {
  // El código evaluado es el de `src/lib/dr.js` del propio repositorio, no una entrada externa: solo prueba.
  const lib = new Function(`${readFileSync(join(CARPETA, 'src/lib/dr.js'), 'utf8')}\nreturn { drFichaVigente, drFichaBase, drBarrer, drRecordarIds, drEsBaja, drEsRiesgo, drNorm, drDatos, drDatoLleno, DR_OLVIDO_MS, DR_TOPE_FICHAS, DR_TOPE_IDS };`)() as J; // nosemgrep: devsecops.js-eval-prohibido
  it('la ficha se olvida a las 48 h exactas (47 h 59 min no) y recuerda solo los últimos 40 ids', () => {
    const t0 = 1_000_000_000_000;
    const f = { ...lib.drFichaBase(), ultimoMs: t0, saludado: true, consentimiento: 'si', nombre: 'Ana' };
    expect(lib.drFichaVigente(f, t0 + 48 * 3600_000 - 60_000).saludado).toBe(true);
    expect(lib.drFichaVigente(f, t0 + 48 * 3600_000 + 1).saludado).toBe(false);
    const g = lib.drFichaBase();
    lib.drRecordarIds(g, Array.from({ length: 60 }, (_, i) => `wamid.${i}`));
    expect(g.ultimosIds).toHaveLength(40);
    expect(g.ultimosIds[39]).toBe('wamid.59');
  });
  it('el mapa de fichas se barre: fuera las de más de 48 h y, pasadas 1.000, las más viejas', () => {
    const ahora = 2_000_000_000_000;
    const mapa: J = {};
    for (let i = 0; i < 1100; i++) mapa[`5910000${String(i).padStart(4, '0')}`] = { ultimoMs: ahora - i * 1000 };
    mapa['viejo'] = { ultimoMs: ahora - 49 * 3600_000 };
    lib.drBarrer(mapa, ahora);
    expect(Object.keys(mapa)).toHaveLength(1000);
    expect(mapa['viejo']).toBeUndefined();
  });
  it('una ficha corrupta (no objeto, campos de otro tipo, claves raras) vuelve a una ficha base sin romper', () => {
    for (const mala of [null, 'x', 7, [], { etapa: 'hackeada', consentimiento: 'tal vez', usados: ['<script>'], interes: '../../etc', avisosConsulta: { 'a b': 1 } }]) {
      const f = lib.drFichaVigente(mala, Date.now());
      expect(f.etapa).toBe('inicio');
      expect(f.consentimiento).toBe('');
      expect(f.usados).toEqual([]);
      expect(f.interes).toBe('');
      expect(f.avisosConsulta).toEqual({});
    }
  });
  it('la baja (regex de Antonio) acepta tú, usted y voseo, y NO marca relatos de terceros ni quejas', () => {
    for (const si of ['no me escribas más', 'No me escriba más por favor', 'no me escribás', 'dejen de escribirme', 'Stop', 'quiero darme de baja', 'bórrame de la lista', 'no quiero recibir más mensajes']) expect(lib.drEsBaja(si), si).toBe(true);
    for (const no of ['mi ex no deja de escribirme', 'le dije que no me escriba más', 'no me llegó el mensaje', 'hola, quiero saber el horario', 'no me duele', 'no sé si escribirte']) expect(lib.drEsBaja(no), no).toBe(false);
  });
  it('el riesgo (violencia o miedo hacia la pareja) se detecta; el interés por la valoración, no', () => {
    for (const si of ['mi pareja me pega', 'le tengo miedo a mi esposo', 'me amenaza', 'quiero suicidarme']) expect(lib.drEsRiesgo(lib.drNorm(si)), si).toBe(true);
    for (const no of ['quiero agendar mi valoración', 'tengo miedo a las agujas', 'me da miedo verme operada']) expect(lib.drEsRiesgo(lib.drNorm(no)), no).toBe(false);
  });
  it('el dato de la doctora llega como texto JSON; un dato ilegible deja el bloque vacío y un marcador cuenta como vacío', () => {
    expect(lib.drDatos({ doctora: '{"clinica":"X"}' }).clinica).toBe('X');
    expect(lib.drDatos({ doctora: '{roto' })).toEqual({});
    expect(lib.drDatos(null)).toEqual({});
    expect(lib.drDatoLleno('REEMPLAZAR_HORARIO')).toBe('');
    expect(lib.drDatoLleno(' lunes ')).toBe('lunes');
  });
});
