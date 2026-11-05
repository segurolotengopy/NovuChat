/**
 * LA VARIANTE DE ENSAYO DE RUBÉN EN EL DEMO A (`rroca-ruben.ensayo-demo-a.json`, procedimiento en `docs/ensayo/LEEME.md` §9).
 *
 * Se prueba negando primero. Qué se exige:
 *   1. el interruptor de un solo teléfono (`avisarAlPropioNumero`) vale SOLO el booleano true, SOLO en «Config base» y SOLO en `ensayo-demo-a.json`:
 *      `construir.mjs` falla si la clave aparece en cualquier otro archivo de datos, y las guardias fallan si un JSON de producción o de prueba la trae;
 *   2. el ensayo es la producción MENOS la rama del miniCRM y la entrada del receptor, MÁS un WhatsApp Trigger: ni un nodo ni una conexión de envío de más (0 mensajes agregados);
 *   3. credenciales por NOMBRE, solo las del Demo A; ninguna de producción de Rubén, ninguna de otro cliente, ninguna de Google; ningún nodo que habla con Graph lleva la de la ingesta;
 *   4. marcadores: solo los dos del ensayo, y ningún identificador ni teléfono real;
 *   5. la variante NUNCA se publica sobre el número de Rubén (`--publicable` la rechaza);
 *   6. con el interruptor, el aviso y el botón de «Rubén» llegan a quien escribe; sin él (la producción) no.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import type { J } from '../../lib/flujo';
import { ANA, REC, crear, hablar, leerFlujo, mTexto, panelOk } from './mundo';
import { entornoDelEmulador } from '../../core/entorno-del-hijo.ts';

const AQUI = dirname(fileURLToPath(import.meta.url));
const REPO = join(AQUI, '../../../..');
const CARPETA = join(REPO, 'Flujos/experimental/rroca-ruben');
const DATOS = join(REPO, 'admin/scripts/datos/rroca-ruben');
const mod = (await import(pathToFileURL(join(CARPETA, 'construir.mjs')).href)) as {
  construir: (o?: J) => unknown[];
  construirEnsayo: (o?: J) => { archivo: string; nodos: number; alDia: boolean; existia: boolean; versionado: string[] };
  guardias: (v: 'produccion' | 'prueba' | 'ensayo-demo-a', f: J) => string[];
  guardiaDePublicacion: (o: J) => string[];
  cargarDatos: (r?: string) => J;
  cargarDatosEnsayo: (r?: string, b?: string) => J;
  vigilarInterruptor: (carpeta?: string) => void;
  interruptorDeEnsayo: (f: J, donde?: string) => void;
  esDelEnsayo: (f: J, d?: J) => boolean;
  TOPE_DE_NODOS: number;
  NODOS_DE_CRM: string[];
  CREDENCIALES_DEL_DEMO_A: Record<string, string[]>;
};
const ENSAYO = JSON.parse(readFileSync(join(CARPETA, 'rroca-ruben.ensayo-demo-a.json'), 'utf8')) as J;
const PRODUCCION = leerFlujo('rroca-ruben.json') as unknown as J;
const PRUEBA = leerFlujo('rroca-ruben.prueba.json') as unknown as J;
const clon = (f: J): J => JSON.parse(JSON.stringify(f)) as J;
const nodo = (f: J, n: string): J => (f['nodes'] as J[]).find((x) => x['name'] === n) as J;
const nombres = (f: J): string[] => (f['nodes'] as J[]).map((n) => n['name'] as string);
const asig = (f: J): J[] => nodo(f, 'Config base')['parameters']['assignments']['assignments'] as J[];
const valorBase = (f: J, k: string): unknown => asig(f).find((a) => a['name'] === k)?.['value'];
const hallazgos = (f: J): string => mod.guardias('ensayo-demo-a', f).join(' | ');
const CLAVE = 'avisarAlPropioNumero';

const temporales: string[] = [];
afterAll(() => { for (const d of temporales) rmSync(d, { recursive: true, force: true }); });
/** Una copia de la carpeta de datos de Rubén, en un temporal, para romperla sin tocar el repositorio. */
function copiaDeDatos(): string {
  const d = mkdtempSync(join(tmpdir(), 'rr-datos-'));
  temporales.push(d);
  cpSync(DATOS, d, { recursive: true });
  return d;
}

describe('el armado: lo versionado es lo que arma la plantilla', () => {
  it('`--verificar`: el JSON de ensayo está al día y sin guardias violadas; tiene 51 nodos (64 - 8 del miniCRM - 6 del receptor + 1 Trigger)', () => {
    const r = mod.construirEnsayo({ verificar: true });
    expect(r).toMatchObject({ archivo: 'rroca-ruben.ensayo-demo-a.json', existia: true, alDia: true, versionado: [] });
    expect(r.nodos).toBe(51);
    expect((ENSAYO['nodes'] as J[]).length).toBe(51);
    expect(51).toBeLessThanOrEqual(mod.TOPE_DE_NODOS);
  });

  it('la producción y la prueba NO cambian: `construir --verificar` las deja al día, con 64 y 59 nodos', () => {
    const r = mod.construir({ verificar: true }) as Array<{ archivo: string; alDia: boolean; versionado: string[]; nodos: number }>;
    expect(r.map((x) => [x.archivo, x.nodos, x.alDia])).toEqual([['rroca-ruben.json', 64, true], ['rroca-ruben.prueba.json', 59, true]]);
    for (const x of r) expect(x.versionado).toEqual([]);
  });

  it('nodos: el ensayo es la producción sin los 8 del miniCRM y los 6 del receptor, y con UN WhatsApp Trigger; nada más', () => {
    const prod = new Set(nombres(PRODUCCION)); const ens = new Set(nombres(ENSAYO));
    const seVan = [...prod].filter((n) => !ens.has(n)).sort();
    expect(seVan).toEqual([...mod.NODOS_DE_CRM, 'Entrega del receptor', 'Verificar firma con el receptor', '¿Firma válida?', 'Aceptar (200)', 'Rechazar (401)', 'Descartar repetidos'].sort());
    expect([...ens].filter((n) => !prod.has(n))).toEqual(['WhatsApp Trigger']);
    expect(nodo(ENSAYO, 'WhatsApp Trigger')['type']).toBe('n8n-nodes-base.whatsAppTrigger');
    expect((ENSAYO['nodes'] as J[]).filter((n) => n['type'] === 'n8n-nodes-base.webhook')).toEqual([]);
    expect(ENSAYO['connections']['WhatsApp Trigger']).toEqual({ main: [[{ node: 'Config base', type: 'main', index: 0 }]] });
  });

  it('CERO mensajes agregados: los nodos y las conexiones de envío son los de producción (solo cambian credenciales); el código cambia SOLO en «Armar avisos» y «Armar mensajes»', () => {
    const comunes = nombres(ENSAYO).filter((n) => n !== 'WhatsApp Trigger');
    for (const n of comunes) {
      const a = clon(nodo(PRODUCCION, n)); const b = clon(nodo(ENSAYO, n));
      delete a['credentials']; delete b['credentials'];
      if (n === 'Config base') continue;
      if (n === 'Armar avisos' || n === 'Armar mensajes') { expect(b['parameters']['jsCode'], n).not.toBe(a['parameters']['jsCode']); a['parameters']['jsCode'] = b['parameters']['jsCode']; }
      expect(b, n).toEqual(a);
    }
    // Las conexiones entre nodos comunes son las mismas (el miniCRM y el receptor eran ramas aparte).
    const vivos = new Set(comunes);
    const conexiones = (f: J): J => Object.fromEntries(Object.entries(f['connections'] as J).filter(([de]) => vivos.has(de)).map(([de, s]) => [de, (s['main'] as J[][]).map((salida) => salida.filter((c) => vivos.has(c['node'])))]));
    const prod = conexiones(PRODUCCION);
    const ens = Object.fromEntries(Object.entries(conexiones(ENSAYO)));
    expect(ens).toEqual(prod);
    // Y el código cambia SOLO en el punto del interruptor: lo demás es idéntico, byte a byte.
    for (const n of ['Armar avisos', 'Armar mensajes']) {
      const a = nodo(PRODUCCION, n)['parameters']['jsCode'] as string; const b = nodo(ENSAYO, n)['parameters']['jsCode'] as string;
      expect(b.length).toBeGreaterThan(a.length);
      expect(b.replaceAll("(base.avisarAlPropioNumero === true || base.avisarAlPropioNumero === 'true')", 'false').replace("desde: false ? '' : from", 'desde: from')).toBe(a);
    }
  });

  it('el JSON no trae ningún identificador ni teléfono ni token: solo los dos marcadores del ensayo, y solo en «Config base»', () => {
    const texto = JSON.stringify(ENSAYO);
    expect(texto).not.toMatch(/\b\d{10,}\b/);
    expect(texto).not.toMatch(/EAA[A-Za-z0-9]{20,}|Bearer [A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{20,}/);
    expect([...new Set(texto.match(/REEMPLAZAR_[A-Z0-9_]+/g))].sort()).toEqual(['REEMPLAZAR_NUMERO_AVISO_ENSAYO', 'REEMPLAZAR_PHONE_NUMBER_ID']);
    for (const n of ENSAYO['nodes'] as J[]) if (n['name'] !== 'Config base') expect(JSON.stringify(n), n['name']).not.toMatch(/REEMPLAZAR_[A-Z0-9]{3}/);
    expect(valorBase(ENSAYO, 'phoneNumberIdEsperado')).toBe('REEMPLAZAR_PHONE_NUMBER_ID');
    expect(valorBase(ENSAYO, 'numeroRecepcion')).toBe('REEMPLAZAR_NUMERO_AVISO_ENSAYO');
  });
});

describe('el interruptor `avisarAlPropioNumero`: solo true, solo en «Config base», solo en el archivo de datos del ensayo', () => {
  it('el JSON de ensayo lo trae como el booleano true; la producción y la prueba NO lo traen (ni en «Config base» ni leído por su código)', () => {
    const a = asig(ENSAYO).find((x) => x['name'] === CLAVE);
    expect(a).toMatchObject({ value: true, type: 'boolean' });
    for (const f of [PRODUCCION, PRUEBA]) {
      expect(asig(f).some((x) => x['name'] === CLAVE)).toBe(false);
      for (const n of f['nodes'] as J[]) expect(String(n['parameters']?.['jsCode'] ?? ''), n['name']).not.toMatch(/base\.avisarAlPropioNumero/);
    }
  });

  it('cualquier valor distinto del booleano true en los datos del ensayo se RECHAZA (false, "true", "false", 0, 1, vacío, objeto, lista)', () => {
    for (const malo of [false, 'true', 'false', 0, 1, '', {}, [], null]) {
      const d = copiaDeDatos();
      const e = JSON.parse(readFileSync(join(d, 'ensayo-demo-a.json'), 'utf8')) as J;
      e['configBase'][CLAVE] = malo;
      writeFileSync(join(d, 'ensayo-demo-a.json'), JSON.stringify(e));
      expect(() => mod.cargarDatosEnsayo(join(d, 'ensayo-demo-a.json'), join(d, 'rroca-ruben.json')), JSON.stringify(malo)).toThrow(/solo vale el booleano true|solo texto, número o booleano/);
    }
    // Sin la clave, el ensayo con un solo teléfono no funcionaría: también se rechaza.
    const d = copiaDeDatos();
    const e = JSON.parse(readFileSync(join(d, 'ensayo-demo-a.json'), 'utf8')) as J;
    delete e['configBase'][CLAVE];
    writeFileSync(join(d, 'ensayo-demo-a.json'), JSON.stringify(e));
    expect(() => mod.cargarDatosEnsayo(join(d, 'ensayo-demo-a.json'), join(d, 'rroca-ruben.json'))).toThrow(/falta/);
  });

  it('la clave FUERA de «configBase» del archivo del ensayo (en la raíz, en credenciales) se rechaza', () => {
    for (const donde of ['raiz', 'credenciales']) {
      const d = copiaDeDatos();
      const e = JSON.parse(readFileSync(join(d, 'ensayo-demo-a.json'), 'utf8')) as J;
      if (donde === 'raiz') e[CLAVE] = true; else e['credenciales'][CLAVE] = 'x';
      writeFileSync(join(d, 'ensayo-demo-a.json'), JSON.stringify(e));
      expect(() => mod.cargarDatosEnsayo(join(d, 'ensayo-demo-a.json'), join(d, 'rroca-ruben.json')), donde).toThrow(/solo vale en configBase/);
    }
  });

  it('`construir` FALLA si la clave aparece en cualquier OTRO archivo de datos (rroca-ruben.json, negocio, campañas…), aunque sea heredada', () => {
    for (const archivo of ['rroca-ruben.json', 'negocio-rroca-ruben.json', 'campanas-rroca-ruben.json']) {
      const d = copiaDeDatos();
      const ruta = join(d, archivo);
      writeFileSync(ruta, readFileSync(ruta, 'utf8').replace(/^\{/, `{"${CLAVE}": true,`));
      expect(() => mod.vigilarInterruptor(d), archivo).toThrow(new RegExp(`${archivo}: «${CLAVE}» es un interruptor solo de ensayo`));
      expect(() => mod.construir({ datos: join(d, 'rroca-ruben.json'), verificar: true }), archivo).toThrow(/interruptor solo de ensayo/);
      expect(() => mod.construirEnsayo({ datos: join(d, 'ensayo-demo-a.json'), base: join(d, 'rroca-ruben.json'), verificar: true }), archivo).toThrow(/interruptor solo de ensayo/);
    }
    // Negativo: la carpeta tal cual está limpia.
    expect(() => mod.vigilarInterruptor()).not.toThrow();
  });

  it('`cargarDatos` (los datos de producción) rechaza la clave en «configBase»', () => {
    const d = copiaDeDatos();
    const p = JSON.parse(readFileSync(join(d, 'rroca-ruben.json'), 'utf8')) as J;
    p['configBase'][CLAVE] = true;
    writeFileSync(join(d, 'rroca-ruben.json'), JSON.stringify(p));
    expect(() => mod.cargarDatos(join(d, 'rroca-ruben.json'))).toThrow(/interruptor solo de ensayo/);
  });

  it('`--verificar` falla si un JSON de PRODUCCIÓN o de PRUEBA trae la clave en «Config base» o la lee su código', () => {
    for (const [variante, base] of [['produccion', PRODUCCION], ['prueba', PRUEBA]] as const) {
      const conClave = clon(base); asig(conClave).push({ id: `cb_${CLAVE}`, name: CLAVE, type: 'boolean', value: true });
      expect(mod.guardias(variante, conClave).join(' | '), variante).toContain(`«Config base» trae «${CLAVE}» (interruptor solo de ensayo)`);
      const conLectura = clon(base); const p = nodo(conLectura, 'Armar avisos')['parameters']; p['jsCode'] = `${p['jsCode'] as string}\nconst x = base.${CLAVE} === true;`;
      expect(mod.guardias(variante, conLectura).join(' | '), variante).toContain(`lee «${CLAVE}»`);
      expect(mod.guardias(variante, base), variante).toEqual([]);
    }
    // Un archivo versionado de producción con la clave haría fallar `--verificar` (lo comprueba `construir`, que corre `guardias` sobre el versionado).
  });

  it('el ensayo exige la clave en true y SOLO la leen «Armar avisos» y «Armar mensajes»', () => {
    const sin = clon(ENSAYO); sin['nodes'] = ENSAYO['nodes'];
    const f1 = clon(ENSAYO); asig(f1).splice(asig(f1).findIndex((a) => a['name'] === CLAVE), 1);
    expect(hallazgos(f1)).toContain('tiene que traer «avisarAlPropioNumero» como el booleano true');
    for (const malo of [false, 'true', 1]) { const f = clon(ENSAYO); asig(f).find((a) => a['name'] === CLAVE)!['value'] = malo; expect(hallazgos(f), String(malo)).toContain('como el booleano true'); }
    const f2 = clon(ENSAYO); nodo(f2, 'Decidir turno')['parameters']['jsCode'] += `\nconst x = base.${CLAVE} === true;`;
    expect(hallazgos(f2)).toContain('solo «Armar avisos» y «Armar mensajes» leen');
    for (const n of ['Armar avisos', 'Armar mensajes']) {
      const f = clon(ENSAYO); nodo(f, n)['parameters']['jsCode'] = nodo(f, n)['parameters']['jsCode'].replaceAll(`base.${CLAVE}`, 'base.otra');
      expect(hallazgos(f), n).toContain(`«${n}» no lee el interruptor`);
    }
    expect(mod.guardias('ensayo-demo-a', ENSAYO)).toEqual([]);
  });

  it('si el código de «Armar avisos» o «Armar mensajes» cambia y el reemplazo ya no encuentra su sitio, el armado FALLA (nunca silencioso)', () => {
    for (const n of ['Armar avisos', 'Armar mensajes']) {
      const f = clon(PRODUCCION);
      nodo(f, n)['parameters']['jsCode'] = (nodo(f, n)['parameters']['jsCode'] as string).replace('cfg.numeroRecepcion', 'cfg.otraCosa');
      expect(() => mod.interruptorDeEnsayo(f), n).toThrow(new RegExp(`«${n}» cambió`));
    }
    // Duplicado: el reemplazo exige UNA sola aparición.
    const f = clon(PRODUCCION); const p = nodo(f, 'Armar avisos')['parameters'];
    p['jsCode'] = `${p['jsCode'] as string}\n${(p['jsCode'] as string).match(/avDestinatarios\('completo:'[^\n]*false\)/)![0]}`;
    expect(() => mod.interruptorDeEnsayo(f)).toThrow(/«Armar avisos» cambió/);
    // Negativo: sobre la producción de verdad, funciona.
    const bien = clon(PRODUCCION); expect(() => mod.interruptorDeEnsayo(bien)).not.toThrow();
  });
});

describe('credenciales: solo las del Demo A, por nombre', () => {
  it('cada credencial del ensayo es del Demo A; ninguna de Google, de Rubén ni de otro cliente; la herramienta la resuelve por id', () => {
    const permitidas = mod.CREDENCIALES_DEL_DEMO_A;
    for (const n of ENSAYO['nodes'] as J[]) {
      for (const [tipo, c] of Object.entries((n['credentials'] ?? {}) as J)) {
        expect(permitidas[tipo], `${n['name']} ${tipo}`).toContain(c['name']);
        expect(c['name'], String(n['name'])).not.toMatch(/bellido|platinum|q'?taco|segurolo|otp|aab1|receptor|ruben|rubén|miniCRM/i);
        expect(c['id'], 'el id va vacío: lo pone la herramienta').toBe('');
      }
    }
    // Gemini: la de producción del Demo A, en los cuatro nodos que llaman al modelo.
    for (const n of ['Transcribir audio', 'Describir documento', 'Describir imagen', 'Conversar con el modelo']) expect(nodo(ENSAYO, n)['credentials']['googlePalmApi']['name'], n).toBe('Google Gemini(PaLM) Api account');
    // Todo nodo que habla con Graph lleva la credencial «Graph WhatsApp Demo A (Bearer)» (la herramienta la cambia a la predefinida), nunca la de la ingesta.
    const graph = (ENSAYO['nodes'] as J[]).filter((n) => n['type'] === 'n8n-nodes-base.httpRequest' && /^=?https:\/\/graph\.facebook\.com\//.test(String(n['parameters']['url'])));
    expect(graph.map((n) => n['name']).sort()).toEqual(['Avisar falla del guardado', 'Enviar a WhatsApp', 'Enviar aviso', 'Enviar respaldo', 'Obtener URL del medio (general)', 'Pedir el medio a Meta (guardado)'].sort());
    for (const n of graph) expect(n['credentials']['httpHeaderAuth']['name'], String(n['name'])).toBe('Graph WhatsApp Demo A (Bearer)');
    expect(JSON.stringify(ENSAYO)).not.toMatch(/googleApi|Google Sheets/);
  });

  it('se rechaza una credencial de producción de Rubén, la del miniCRM, una de otro cliente o la de la ingesta en un nodo de Graph', () => {
    const cambiar = (n: string, tipo: string, nombre: string): J => { const f = clon(ENSAYO); nodo(f, n)['credentials'][tipo]['name'] = nombre; return f; };
    expect(hallazgos(cambiar('Traer configuración', 'httpHeaderAuth', 'NovuChat ingesta (Ruben)'))).toContain('que no es una credencial del Demo A');
    expect(hallazgos(cambiar('Enviar a WhatsApp', 'httpHeaderAuth', 'Graph WhatsApp Ruben (Bearer)'))).toContain('que no es una credencial del Demo A');
    expect(hallazgos(cambiar('Conversar con el modelo', 'googlePalmApi', 'Gemini — pruebas (no producción)'))).toContain('que no es una credencial del Demo A');
    expect(hallazgos(cambiar('WhatsApp Trigger', 'whatsAppTriggerApi', 'AAB1-WA-Prod receptor'))).toContain('«WhatsApp Trigger» tiene que llevar la credencial «WhatsApp OAuth account»');
    expect(hallazgos(cambiar('Traer configuración', 'httpHeaderAuth', 'NovuChat ingesta (Bellido)'))).toMatch(/que no es una credencial del Demo A/);
    const ingestaEnGraph = cambiar('Enviar aviso', 'httpHeaderAuth', 'Cierres NovuChat A (auto)');
    expect(hallazgos(ingestaEnGraph)).toContain('«Enviar aviso» llama a graph.facebook.com sin la credencial de Graph del Demo A');
    const conPlanilla = clon(ENSAYO); nodo(conPlanilla, 'Traer configuración')['credentials']['googleApi'] = { id: '', name: 'Google Sheets miniCRM (crm-rroca-ruben)' };
    expect(hallazgos(conPlanilla)).toMatch(/credencial de Google/);
  });

  it('los datos del ensayo rechazan una credencial que no es del Demo A, o un Graph con otro nombre', () => {
    for (const [campo, malo] of [['ingesta', 'NovuChat ingesta (Ruben)'], ['gemini', 'Gemini — pruebas (no producción)'], ['trigger', 'Trigger de Ruben'], ['graph', 'Graph WhatsApp Ruben (Bearer)'], ['graph', 'WhatsApp account']] as const) {
      const d = copiaDeDatos();
      const e = JSON.parse(readFileSync(join(d, 'ensayo-demo-a.json'), 'utf8')) as J;
      e['credenciales'][campo] = malo;
      writeFileSync(join(d, 'ensayo-demo-a.json'), JSON.stringify(e));
      expect(() => mod.cargarDatosEnsayo(join(d, 'ensayo-demo-a.json'), join(d, 'rroca-ruben.json')), `${campo}: ${malo}`).toThrow(/credenciales\.(ingesta|gemini|trigger|graph)/);
    }
  });
});

describe('la entrada, el miniCRM y lo demás que el ensayo no lleva', () => {
  it('se rechaza: el receptor o la «Entrada de prueba», un Webhook, ningún Trigger o dos, y la rama del miniCRM', () => {
    const conReceptor = clon(ENSAYO); (conReceptor['nodes'] as J[]).push(clon(nodo(PRODUCCION, 'Entrega del receptor')));
    expect(hallazgos(conReceptor)).toContain('contiene «Entrega del receptor»');
    const conPrueba = clon(ENSAYO); (conPrueba['nodes'] as J[]).push(clon(nodo(PRUEBA, 'Entrada de prueba')));
    expect(hallazgos(conPrueba)).toContain('contiene «Entrada de prueba»');
    expect(hallazgos(conPrueba)).toContain('el webhook «Entrada de prueba» no corresponde');
    const sinTrigger = clon(ENSAYO); sinTrigger['nodes'] = (sinTrigger['nodes'] as J[]).filter((n) => n['name'] !== 'WhatsApp Trigger');
    expect(hallazgos(sinTrigger)).toContain('tiene que llevar exactamente un «WhatsApp Trigger» (lleva 0)');
    const dos = clon(ENSAYO); (dos['nodes'] as J[]).push({ ...clon(nodo(ENSAYO, 'WhatsApp Trigger')), id: 'otro', name: 'Otro Trigger' });
    expect(hallazgos(dos)).toContain('(lleva 2)');
    for (const n of mod.NODOS_DE_CRM) {
      const f = clon(ENSAYO); (f['nodes'] as J[]).push({ id: n, name: n, type: 'n8n-nodes-base.noOp', typeVersion: 1, position: [0, 0], parameters: {} });
      expect(hallazgos(f), n).toContain(`lleva el nodo «${n}» del miniCRM`);
    }
    for (const n of mod.NODOS_DE_CRM) expect(nombres(ENSAYO)).not.toContain(n);
  });

  it('un WhatsApp Trigger sigue prohibido en producción y en prueba (prohibición 7); el del ensayo no pasa por esas variantes', () => {
    for (const [v, base] of [['produccion', PRODUCCION], ['prueba', PRUEBA]] as const) {
      const f = clon(base); (f['nodes'] as J[]).push(clon(nodo(ENSAYO, 'WhatsApp Trigger')));
      expect(mod.guardias(v, f).join(' | ')).toContain('contiene un WhatsApp Trigger (prohibición 7');
    }
    // La producción NO se acepta como ensayo ni al revés.
    expect(hallazgos(PRODUCCION)).toMatch(/tiene que llevar exactamente un «WhatsApp Trigger»/);
    expect(mod.guardias('produccion', ENSAYO).join(' | ')).toContain('falta el nodo «Entrega del receptor»');
  });

  it('«Config base»: sin planilla, sin modo prueba, sin plantillas APPROVED de la WABA de Rubén y solo los dos marcadores del ensayo', () => {
    expect(valorBase(ENSAYO, 'planillaProspectosId')).toBe('');
    expect(valorBase(ENSAYO, 'telefonosDePrueba')).toBeUndefined();
    expect(valorBase(ENSAYO, 'avisoComprobanteEstado')).toBe('PENDING');
    expect(valorBase(ENSAYO, 'avisoConsultaEstado')).toBe('PENDING');
    const planilla = clon(ENSAYO); asig(planilla).find((a) => a['name'] === 'planillaProspectosId')!['value'] = 'abcdefghijklmnopqrstuvwxy';
    expect(hallazgos(planilla)).toContain('«planillaProspectosId» tiene que ir vacío');
    const aprobada = clon(ENSAYO); asig(aprobada).find((a) => a['name'] === 'avisoConsultaEstado')!['value'] = 'APPROVED';
    expect(hallazgos(aprobada)).toContain('no puede ser APPROVED');
    const prueba = clon(ENSAYO); asig(prueba).push({ id: 'x', name: 'telefonosDePrueba', type: 'string', value: 'x' });
    expect(hallazgos(prueba)).toContain('no lleva «telefonosDePrueba»');
    const marcador = clon(ENSAYO); asig(marcador).push({ id: 'x', name: 'otro', type: 'string', value: 'REEMPLAZAR_TELEFONOS_DE_PRUEBA' });
    expect(hallazgos(marcador)).toContain('el marcador REEMPLAZAR_TELEFONOS_DE_PRUEBA');
    const fuera = clon(ENSAYO); nodo(fuera, 'Traer configuración')['parameters']['url'] = 'REEMPLAZAR_RUTA_X';
    expect(hallazgos(fuera)).toContain('trae un marcador REEMPLAZAR_');
  });

  it('el cobro NO cambia: el flujo de Rubén solo conoce el cobro real (nada de `cobroSimuladoActivo` en true, en ninguna variante)', () => {
    expect(valorBase(ENSAYO, 'cobroSimuladoActivo')).toBe(false);
    for (const [v, base] of [['produccion', PRODUCCION], ['prueba', PRUEBA], ['ensayo-demo-a', ENSAYO]] as const) {
      const f = clon(base); asig(f).find((a) => a['name'] === 'cobroSimuladoActivo')!['value'] = true;
      expect(mod.guardias(v, f).join(' | '), v).toContain('cobroSimuladoActivo está en true');
    }
    const d = copiaDeDatos();
    const e = JSON.parse(readFileSync(join(d, 'ensayo-demo-a.json'), 'utf8')) as J;
    e['configBase']['cobroSimuladoActivo'] = true;
    writeFileSync(join(d, 'ensayo-demo-a.json'), JSON.stringify(e));
    expect(() => mod.cargarDatosEnsayo(join(d, 'ensayo-demo-a.json'), join(d, 'rroca-ruben.json'))).toThrow(/solo conoce el cobro real/);
  });

  it('el tope de nodos y la retención valen también para el ensayo', () => {
    const f = clon(ENSAYO); for (let i = 0; i < 20; i++) (f['nodes'] as J[]).push({ id: `x${i}`, name: `Extra ${i}`, type: 'n8n-nodes-base.noOp', typeVersion: 1, position: [0, 0], parameters: {} });
    expect(hallazgos(f)).toContain(`el tope es ${mod.TOPE_DE_NODOS}`);
    const g = clon(ENSAYO); g['settings']['saveDataSuccessExecution'] = 'all';
    expect(hallazgos(g)).toContain('ajustes de retención');
  });
});

describe('la variante NO puede publicarse sobre el número de Rubén', () => {
  const negocio = JSON.parse(readFileSync(join(DATOS, 'negocio-rroca-ruben.json'), 'utf8')) as J;
  const datos = mod.cargarDatos();
  const todo = (f: J, d: J = datos): string => mod.guardiaDePublicacion({ flujo: f, datos: d, negocio, anuncios: 4 }).join(' | ');

  it('`guardiaDePublicacion` rechaza el JSON de ensayo, un JSON con el interruptor o con un Trigger, un nombre «ensayo» y datos con la clave', () => {
    expect(todo(ENSAYO)).toContain('nunca se publica sobre el número de Rubén');
    const conClave = clon(PRODUCCION); asig(conClave).push({ id: 'x', name: CLAVE, type: 'boolean', value: true });
    expect(todo(conClave)).toContain('nunca se publica sobre el número de Rubén');
    const conTrigger = clon(PRODUCCION); (conTrigger['nodes'] as J[]).push(clon(nodo(ENSAYO, 'WhatsApp Trigger')));
    expect(todo(conTrigger)).toContain('nunca se publica sobre el número de Rubén');
    const conNombre = clon(PRODUCCION); conNombre['name'] = 'Venta digital de Rubén (ENSAYO)';
    expect(todo(conNombre)).toContain('nunca se publica sobre el número de Rubén');
    const datosConClave = { ...datos, configBase: { ...(datos['configBase'] as J), [CLAVE]: true } };
    expect(todo(PRODUCCION, datosConClave)).toContain('nunca se publica sobre el número de Rubén');
    // Negativo: la producción no es del ensayo.
    expect(todo(PRODUCCION)).not.toContain('nunca se publica sobre el número de Rubén');
    expect(mod.esDelEnsayo(PRODUCCION, datos)).toBe(false);
    expect(mod.esDelEnsayo(PRUEBA, datos)).toBe(false);
    expect(mod.esDelEnsayo(ENSAYO, datos)).toBe(true);
  });

  it('`construir.mjs --publicable --flujo <ensayo>` sale 1, aun con los marcadores sustituidos y las plantillas aprobadas', () => {
    const d = mkdtempSync(join(tmpdir(), 'rr-publicable-'));
    temporales.push(d);
    const listo = JSON.parse(JSON.stringify(ENSAYO).replace(/REEMPLAZAR_[A-Z0-9_]+/g, 'valorsustituido')) as J;
    for (const k of ['avisoComprobanteEstado', 'avisoConsultaEstado']) asig(listo).find((a) => a['name'] === k)!['value'] = 'APPROVED';
    writeFileSync(join(d, 'ensayo.json'), JSON.stringify(listo));
    const r = spawnSync(process.execPath, [join(CARPETA, 'construir.mjs'), '--publicable', '--anuncios', '4', '--flujo', join(d, 'ensayo.json')], { encoding: 'utf8', env: entornoDelEmulador(undefined) });
    expect(r.status, r.stdout + r.stderr).toBe(1);
    expect(r.stderr).toContain('nunca se publica sobre el número de Rubén');
    // Los datos del ensayo como `--datos` tampoco sirven.
    const r2 = spawnSync(process.execPath, [join(CARPETA, 'construir.mjs'), '--publicable', '--anuncios', '4', '--datos', join(DATOS, 'ensayo-demo-a.json')], { encoding: 'utf8', env: entornoDelEmulador(undefined) });
    expect(r2.status).toBe(1);
  });

  it('`publicar-flujo.sh` trata el flujo de ensayo como el conversacional de Rubén (estricto), por el nombre del flujo', () => {
    // El nombre empieza con «NovuChat — Venta digital de Rub…», que es lo que activa la guardia estricta del script.
    expect(String(ENSAYO['name']).toLowerCase().startsWith('novuchat — venta digital de rub')).toBe(true);
    expect(existsSync(join(REPO, 'scripts/publicar-flujo.sh'))).toBe(true);
  });
});

describe('con el interruptor, el aviso y el botón de «Rubén» llegan a quien escribe; sin él, no', () => {
  const ENSAYO_VIVO = ENSAYO as unknown as Parameters<typeof crear>[0] extends infer O ? (O extends { flujo?: infer F } ? F : never) : never;
  const PROD_VIVO = PRODUCCION as unknown as typeof ENSAYO_VIVO;
  // Quien prueba es a la vez el cliente y la recepción: escribe desde el número de recepción.
  const PRUEBA_DE_ENSAYO = { base: { avisoComprobanteEstado: 'PENDING', avisoConsultaEstado: 'PENDING' }, panel: panelOk() } as const;
  // El Trigger entrega la carga de WhatsApp en la raíz (no la del receptor).
  const hablarPorTrigger = (m: ReturnType<typeof crear>, from: string, texto: string): ReturnType<typeof m.turno> =>
    m.turno({ messaging_product: 'whatsapp', metadata: { display_phone_number: '59100000001', phone_number_id: '59100000042' }, contacts: [{ profile: { name: 'Ana Pérez' }, wa_id: from }], messages: [{ from, id: `wamid.T${texto.length}${Math.random().toString(36).slice(2, 8)}`, timestamp: '1', ...mTexto(texto) }] } as J, {});
  const PREGUNTA = 'vi el video, ¿precio y devolución?';

  it('ensayo: escribiendo desde el número de recepción, el aviso SALE a ese mismo número y la respuesta trae el botón «Rubén»', () => {
    const m = crear({ flujo: ENSAYO_VIVO, ...PRUEBA_DE_ENSAYO });
    // Un primer mensaje abre la ficha (la ventana de «Rubén» es su último mensaje al bot: con un solo teléfono es el mismo).
    hablarPorTrigger(m, REC, 'hola');
    const t = hablarPorTrigger(m, REC, PREGUNTA);
    expect(t.avisos, JSON.stringify(t.avisos)).toHaveLength(1);
    expect(t.avisos[0]!.a).toBe(REC);
    expect(t.mensajes[0]?.payload['interactive']?.type).toBe('cta_url');
  });

  it('producción (sin el interruptor): el mismo teléfono NO recibe aviso ni botón (un empleado no se avisa a sí mismo)', () => {
    const m = crear({ flujo: PROD_VIVO, ...PRUEBA_DE_ENSAYO });
    hablar(m, REC, mTexto('hola'));
    const t = hablar(m, REC, mTexto(PREGUNTA));
    expect(t.avisos).toHaveLength(0);
    expect(t.mensajes[0]?.payload['interactive']?.type).not.toBe('cta_url');
  });

  it('ensayo, límite conocido: en el PRIMER turno de una conversación nueva el aviso no sale (la ventana de «Rubén» es la ficha de quien prueba y aún no existe); el segundo turno sí lo manda (probado en el primer caso de este bloque)', () => {
    const m = crear({ flujo: ENSAYO_VIVO, ...PRUEBA_DE_ENSAYO });
    const primero = hablarPorTrigger(m, REC, PREGUNTA);
    expect(primero.avisos).toHaveLength(0);
  });

  it('ensayo con OTRO teléfono: el aviso va a la recepción y el botón al cliente, como siempre (el interruptor no cambia el caso normal)', () => {
    const m = crear({ flujo: ENSAYO_VIVO, ...PRUEBA_DE_ENSAYO });
    hablarPorTrigger(m, REC, 'hola'); // abre la ventana de «Rubén»
    const t = hablarPorTrigger(m, ANA, PREGUNTA);
    expect(t.avisos).toHaveLength(1);
    expect(t.avisos[0]!.a).toBe(REC);
    expect(t.mensajes[0]?.payload['interactive']?.type).toBe('cta_url');
  });
});
