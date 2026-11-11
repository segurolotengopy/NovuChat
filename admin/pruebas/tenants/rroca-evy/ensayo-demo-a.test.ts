/**
 * LA VARIANTE DE ENSAYO DE EVY EN EL DEMO A (`rroca-evy.ensayo-demo-a.json`, procedimiento en `docs/ensayo/LEEME.md` §10). Copia del patrón de Rubén (`../rroca-ruben/ensayo-demo-a.test.ts`).
 *
 * Se prueba negando primero. Qué se exige:
 *   1. el interruptor de un solo teléfono (`avisarAlPropioNumero`) vale SOLO el booleano true, SOLO en «Config base» y SOLO en `ensayo-demo-a.json`:
 *      `construir.mjs` falla si la clave aparece en cualquier otro archivo de datos, y las guardias fallan si un JSON de producción o de prueba la trae;
 *   2. el ensayo es la producción MENOS la rama del miniCRM y la entrada del receptor, MÁS un WhatsApp Trigger: ni un nodo ni una conexión de envío de más (0 mensajes agregados);
 *   3. credenciales por NOMBRE, solo las del Demo A; ninguna de producción de Evy, ninguna de otro cliente, ninguna de Google; ningún nodo que habla con Graph lleva la de la ingesta;
 *      el destino de cada nodo HTTP se verifica contra una lista de permitidos;
 *   4. marcadores: solo los dos del ensayo, y ningún identificador ni teléfono real;
 *   5. la variante NUNCA se publica sobre el número de Evy (`--publicable` la rechaza);
 *   6. con el interruptor, el aviso y el botón a la recepción llegan a quien escribe; sin él (la producción) no;
 *   7. la producción y la prueba no cambian: `--verificar` las deja al día y ninguna trae el interruptor.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import type { Flujo, J } from '../../lib/flujo';
import { entornoDelEmulador } from '../../core/entorno-del-hijo.ts';
import { ANA, PRODUCCION as PROD, PRUEBA as PRU, REC, avisosARecepcion, crear, dice, hablar, mTexto, valorMeta } from './mundo';

const AQUI = dirname(fileURLToPath(import.meta.url));
const REPO = join(AQUI, '../../../..');
const CARPETA = join(REPO, 'Flujos/experimental/rroca-evy');
const DATOS = join(REPO, 'admin/scripts/datos/rroca-evy');
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
  hostDeUrl: (u: unknown) => string | null;
  TOPE_DE_NODOS: number;
  NODOS_DE_CRM: string[];
  CREDENCIALES_DEL_DEMO_A: Record<string, string[]>;
};
const ENSAYO = JSON.parse(readFileSync(join(CARPETA, 'rroca-evy.ensayo-demo-a.json'), 'utf8')) as J;
const PRODUCCION = PROD as unknown as J;
const PRUEBA = PRU as unknown as J;
const clon = (f: J): J => JSON.parse(JSON.stringify(f)) as J;
const nodo = (f: J, n: string): J => (f['nodes'] as J[]).find((x) => x['name'] === n) as J;
const nombres = (f: J): string[] => (f['nodes'] as J[]).map((n) => n['name'] as string);
const asig = (f: J): J[] => nodo(f, 'Config base')['parameters']['assignments']['assignments'] as J[];
const valorBase = (f: J, k: string): unknown => asig(f).find((a) => a['name'] === k)?.['value'];
const hallazgos = (f: J): string => mod.guardias('ensayo-demo-a', f).join(' | ');
const CLAVE = 'avisarAlPropioNumero';
const RECEPTOR = ['Entrega del receptor', 'Verificar firma con el receptor', '¿Firma válida?', 'Aceptar (200)', 'Rechazar (401)', 'Descartar repetidos'];
const LECTURA = "(base.avisarAlPropioNumero === true || base.avisarAlPropioNumero === 'true')";

const temporales: string[] = [];
afterAll(() => { for (const d of temporales) rmSync(d, { recursive: true, force: true }); });
/** Una copia de la carpeta de datos de Evy, en un temporal, para romperla sin tocar el repositorio. */
function copiaDeDatos(): string {
  const d = mkdtempSync(join(tmpdir(), 'ev-datos-'));
  temporales.push(d);
  cpSync(DATOS, d, { recursive: true });
  return d;
}
const editarEnsayo = (d: string, cambio: (e: J) => void): void => {
  const e = JSON.parse(readFileSync(join(d, 'ensayo-demo-a.json'), 'utf8')) as J;
  cambio(e);
  writeFileSync(join(d, 'ensayo-demo-a.json'), JSON.stringify(e));
};
const cargar = (d: string): unknown => mod.cargarDatosEnsayo(join(d, 'ensayo-demo-a.json'), join(d, 'rroca-evy.json'));

describe('el armado: lo versionado es lo que arma la plantilla', () => {
  it('`--verificar`: el JSON de ensayo está al día y sin guardias violadas; tiene 40 nodos (53 - 8 del miniCRM - 6 del receptor + 1 Trigger)', () => {
    const r = mod.construirEnsayo({ verificar: true });
    expect(r).toMatchObject({ archivo: 'rroca-evy.ensayo-demo-a.json', existia: true, alDia: true, versionado: [] });
    expect(r.nodos).toBe(40);
    expect((ENSAYO['nodes'] as J[]).length).toBe(40);
    expect(40).toBeLessThanOrEqual(mod.TOPE_DE_NODOS);
  });

  it('la producción y la prueba NO cambian: `construir --verificar` las deja al día, con 53 y 48 nodos, y ninguna trae el interruptor', () => {
    const r = mod.construir({ verificar: true }) as Array<{ archivo: string; alDia: boolean; versionado: string[]; nodos: number }>;
    expect(r.map((x) => [x.archivo, x.nodos, x.alDia])).toEqual([['rroca-evy.json', 53, true], ['rroca-evy.prueba.json', 48, true]]);
    for (const x of r) expect(x.versionado).toEqual([]);
    for (const f of [PRODUCCION, PRUEBA]) {
      // (La librería común nombra la clave en un comentario de `avDestinatarios`: lo que no puede haber es la asignación ni la LECTURA.)
      expect(JSON.stringify(f)).not.toContain(`"name":"${CLAVE}"`);
      expect(JSON.stringify(f)).not.toMatch(/base\.avisarAlPropioNumero/);
      expect(JSON.stringify(f)).not.toContain('REEMPLAZAR_NUMERO_AVISO_ENSAYO');
    }
  });

  it('`--verificar` por la línea de comandos cubre las TRES variantes y sale 0', () => {
    const r = spawnSync(process.execPath, [join(CARPETA, 'construir.mjs'), '--verificar'], { encoding: 'utf8', env: entornoDelEmulador(undefined) });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain('rroca-evy.json al día (53 nodos)');
    expect(r.stdout).toContain('rroca-evy.prueba.json al día (48 nodos)');
    expect(r.stdout).toContain('rroca-evy.ensayo-demo-a.json al día (40 nodos)');
  });

  it('nodos: el ensayo es la producción sin los 8 del miniCRM y los 6 del receptor, y con UN WhatsApp Trigger; nada más', () => {
    const prod = new Set(nombres(PRODUCCION)); const ens = new Set(nombres(ENSAYO));
    const seVan = [...prod].filter((n) => !ens.has(n)).sort();
    expect(seVan).toEqual([...mod.NODOS_DE_CRM, ...RECEPTOR].sort());
    expect([...ens].filter((n) => !prod.has(n))).toEqual(['WhatsApp Trigger']);
    // UN solo disparador, y ningún Webhook (ni el del receptor ni «Entrada de prueba»).
    const disparadores = (ENSAYO['nodes'] as J[]).filter((n) => n['type'] === 'n8n-nodes-base.whatsAppTrigger');
    expect(disparadores).toHaveLength(1);
    expect(disparadores[0]!['name']).toBe('WhatsApp Trigger');
    expect(disparadores[0]!['credentials']['whatsAppTriggerApi']['name']).toBe('WhatsApp OAuth account');
    expect((ENSAYO['nodes'] as J[]).filter((n) => n['type'] === 'n8n-nodes-base.webhook')).toEqual([]);
    expect(ENSAYO['connections']['WhatsApp Trigger']).toEqual({ main: [[{ node: 'Config base', type: 'main', index: 0 }]] });
    for (const n of [...mod.NODOS_DE_CRM, ...RECEPTOR, 'Entrada de prueba']) expect(nombres(ENSAYO)).not.toContain(n);
  });

  it('CERO mensajes agregados: los nodos y las conexiones de envío son los de producción (solo cambian credenciales); el código cambia SOLO en «Armar previos» y «Armar mensajes»', () => {
    const comunes = nombres(ENSAYO).filter((n) => n !== 'WhatsApp Trigger');
    for (const n of comunes) {
      const a = clon(nodo(PRODUCCION, n)); const b = clon(nodo(ENSAYO, n));
      delete a['credentials']; delete b['credentials'];
      if (n === 'Config base') continue;
      if (n === 'Armar previos' || n === 'Armar mensajes') { expect(b['parameters']['jsCode'], n).not.toBe(a['parameters']['jsCode']); a['parameters']['jsCode'] = b['parameters']['jsCode']; }
      expect(b, n).toEqual(a);
    }
    // Las conexiones entre nodos comunes son las mismas (el miniCRM y el receptor eran ramas aparte).
    const vivos = new Set(comunes);
    const conexiones = (f: J): J => Object.fromEntries(Object.entries(f['connections'] as J).filter(([de]) => vivos.has(de)).map(([de, s]) => [de, (s['main'] as J[][]).map((salida) => salida.filter((c) => vivos.has(c['node'])))]));
    expect(conexiones(ENSAYO)).toEqual(conexiones(PRODUCCION));
    // Y el código cambia SOLO en los puntos del interruptor: lo demás es idéntico, byte a byte.
    const previos = (f: J): string => nodo(f, 'Armar previos')['parameters']['jsCode'] as string;
    const armar = (f: J): string => nodo(f, 'Armar mensajes')['parameters']['jsCode'] as string;
    expect(previos(ENSAYO).replaceAll(LECTURA, 'false')).toBe(previos(PRODUCCION));
    expect(armar(ENSAYO).replaceAll(LECTURA, 'false').replace("const from = String(t.from || '');\nconst base = cnPrimero('Config base') || {};\n", "const from = String(t.from || '');\n").replace("desde: false ? '' : from", 'desde: from')).toBe(armar(PRODUCCION));
  });

  it('el JSON no trae ningún identificador ni teléfono ni token: solo los dos marcadores del ensayo, y solo en «Config base»', () => {
    const texto = JSON.stringify(ENSAYO);
    expect(texto).not.toMatch(/\d{10,}/);
    expect(texto).not.toMatch(/EAA[A-Za-z0-9]{20,}|Bearer [A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{20,}/);
    expect([...new Set(texto.match(/REEMPLAZAR_[A-Z0-9_]+/g))].sort()).toEqual(['REEMPLAZAR_NUMERO_AVISO_ENSAYO', 'REEMPLAZAR_PHONE_NUMBER_ID']);
    for (const n of ENSAYO['nodes'] as J[]) if (n['name'] !== 'Config base') expect(JSON.stringify(n), n['name']).not.toMatch(/REEMPLAZAR_[A-Z0-9]{3}/);
    expect(valorBase(ENSAYO, 'phoneNumberIdEsperado')).toBe('REEMPLAZAR_PHONE_NUMBER_ID');
    expect(valorBase(ENSAYO, 'numeroRecepcion')).toBe('REEMPLAZAR_NUMERO_AVISO_ENSAYO');
    // Los datos del ensayo tampoco traen un teléfono ni un id.
    expect(readFileSync(join(DATOS, 'ensayo-demo-a.json'), 'utf8')).not.toMatch(/\d{7,}/);
  });
});

describe('el interruptor `avisarAlPropioNumero`: solo true, solo en «Config base», solo en el archivo de datos del ensayo', () => {
  it('el JSON de ensayo lo trae como el booleano true; la producción y la prueba NO lo traen (ni en «Config base» ni leído por su código)', () => {
    expect(asig(ENSAYO).find((x) => x['name'] === CLAVE)).toMatchObject({ value: true, type: 'boolean' });
    for (const f of [PRODUCCION, PRUEBA]) {
      expect(asig(f).some((x) => x['name'] === CLAVE)).toBe(false);
      for (const n of f['nodes'] as J[]) expect(String(n['parameters']?.['jsCode'] ?? ''), n['name']).not.toMatch(/base\.avisarAlPropioNumero/);
    }
  });

  it('cualquier valor distinto del booleano true en los datos del ensayo se RECHAZA (false, "true", "false", 0, 1, vacío, objeto, lista); sin la clave, también', () => {
    for (const malo of [false, 'true', 'false', 0, 1, '', {}, [], null]) {
      const d = copiaDeDatos();
      editarEnsayo(d, (e) => { e['configBase'][CLAVE] = malo; });
      expect(() => cargar(d), JSON.stringify(malo)).toThrow(/solo vale el booleano true|solo texto, número o booleano/);
    }
    const d = copiaDeDatos();
    editarEnsayo(d, (e) => { delete e['configBase'][CLAVE]; });
    expect(() => cargar(d)).toThrow(/falta/);
  });

  it('la clave FUERA de «configBase» del archivo del ensayo (en la raíz, en credenciales) se rechaza', () => {
    for (const donde of ['raiz', 'credenciales']) {
      const d = copiaDeDatos();
      editarEnsayo(d, (e) => { if (donde === 'raiz') e[CLAVE] = true; else e['credenciales'][CLAVE] = 'x'; });
      expect(() => cargar(d), donde).toThrow(/solo vale en configBase/);
    }
  });

  it('`construir` FALLA si la clave aparece en cualquier OTRO archivo de datos (rroca-evy.json, negocio…), aunque sea heredada', () => {
    for (const archivo of ['rroca-evy.json', 'negocio-rroca-evy.json']) {
      const d = copiaDeDatos();
      const ruta = join(d, archivo);
      writeFileSync(ruta, readFileSync(ruta, 'utf8').replace(/^\{/, `{"${CLAVE}": true,`));
      expect(() => mod.vigilarInterruptor(d), archivo).toThrow(new RegExp(`${archivo}: «${CLAVE}» es un interruptor solo de ensayo`));
      expect(() => mod.construir({ datos: join(d, 'rroca-evy.json'), verificar: true }), archivo).toThrow();
      expect(() => mod.construirEnsayo({ datos: join(d, 'ensayo-demo-a.json'), base: join(d, 'rroca-evy.json'), verificar: true }), archivo).toThrow(/interruptor solo de ensayo/);
    }
    expect(() => mod.vigilarInterruptor()).not.toThrow();
  });

  it('`cargarDatos` (los datos de producción) rechaza la clave en «configBase»', () => {
    const d = copiaDeDatos();
    const p = JSON.parse(readFileSync(join(d, 'rroca-evy.json'), 'utf8')) as J;
    p['configBase'][CLAVE] = true;
    writeFileSync(join(d, 'rroca-evy.json'), JSON.stringify(p));
    expect(() => mod.cargarDatos(join(d, 'rroca-evy.json'))).toThrow(/interruptor solo de ensayo/);
  });

  it('`--verificar` falla si un JSON de PRODUCCIÓN o de PRUEBA trae la clave en «Config base» o la lee su código; el interruptor NO se acepta fuera del ensayo', () => {
    for (const [variante, base] of [['produccion', PRODUCCION], ['prueba', PRUEBA]] as const) {
      const conClave = clon(base); asig(conClave).push({ id: `cb_${CLAVE}`, name: CLAVE, type: 'boolean', value: true });
      expect(mod.guardias(variante, conClave).join(' | '), variante).toContain(`«Config base» trae «${CLAVE}» (interruptor solo de ensayo)`);
      for (const n of ['Armar previos', 'Armar mensajes']) {
        const conLectura = clon(base); const p = nodo(conLectura, n)['parameters']; p['jsCode'] = `${p['jsCode'] as string}\nconst x = base.${CLAVE} === true;`;
        expect(mod.guardias(variante, conLectura).join(' | '), `${variante} ${n}`).toContain(`lee «${CLAVE}»`);
      }
      expect(mod.guardias(variante, base), variante).toEqual([]);
    }
  });

  it('el ensayo exige la clave en true y SOLO la leen «Armar previos» y «Armar mensajes»', () => {
    const f1 = clon(ENSAYO); asig(f1).splice(asig(f1).findIndex((a) => a['name'] === CLAVE), 1);
    expect(hallazgos(f1)).toContain('tiene que traer «avisarAlPropioNumero» como el booleano true');
    for (const malo of [false, 'true', 1]) { const f = clon(ENSAYO); asig(f).find((a) => a['name'] === CLAVE)!['value'] = malo; expect(hallazgos(f), String(malo)).toContain('como el booleano true'); }
    const f2 = clon(ENSAYO); nodo(f2, 'Decidir turno')['parameters']['jsCode'] += `\nconst x = base.${CLAVE} === true;`;
    expect(hallazgos(f2)).toContain('solo «Armar previos» y «Armar mensajes» leen');
    for (const n of ['Armar previos', 'Armar mensajes']) {
      const f = clon(ENSAYO); nodo(f, n)['parameters']['jsCode'] = nodo(f, n)['parameters']['jsCode'].replaceAll(`base.${CLAVE}`, 'base.otra');
      expect(hallazgos(f), n).toContain(`«${n}» no lee el interruptor`);
    }
    expect(mod.guardias('ensayo-demo-a', ENSAYO)).toEqual([]);
  });

  it('si el código de «Armar previos» o «Armar mensajes» cambia y el reemplazo ya no encuentra su sitio, el armado FALLA (nunca silencioso)', () => {
    const anclas: Array<[string, string, string]> = [
      ['Armar previos', 'cfg.numeroRecepcion', 'cfg.otraCosa'],
      ['Armar mensajes', "const from = String(t.from || '');", "const desde = String(t.from || '');"],
      ['Armar mensajes', 'desde: from, cuerpo: c', 'desde: de, cuerpo: c'],
    ];
    for (const [n, antes, despues] of anclas) {
      const f = clon(PRODUCCION);
      nodo(f, n)['parameters']['jsCode'] = (nodo(f, n)['parameters']['jsCode'] as string).replace(antes, despues);
      expect(() => mod.interruptorDeEnsayo(f), `${n}: ${antes}`).toThrow(new RegExp(`«${n}» cambió`));
    }
    // Duplicado: el reemplazo exige UNA sola aparición.
    const f = clon(PRODUCCION); const p = nodo(f, 'Armar previos')['parameters'];
    p['jsCode'] = `${p['jsCode'] as string}\n${(p['jsCode'] as string).match(/avDestinatarios\('completo:'[^\n]*false\)/)![0]}`;
    expect(() => mod.interruptorDeEnsayo(f)).toThrow(/«Armar previos» cambió/);
    // Negativo: sobre la producción de verdad, funciona.
    const bien = clon(PRODUCCION); expect(() => mod.interruptorDeEnsayo(bien)).not.toThrow();
  });
});

describe('credenciales: solo las del Demo A, por nombre', () => {
  it('cada credencial del ensayo es del Demo A; ninguna de Google, de Evy ni de otro cliente; la herramienta la resuelve por id', () => {
    const permitidas = mod.CREDENCIALES_DEL_DEMO_A;
    for (const n of ENSAYO['nodes'] as J[]) {
      for (const [tipo, c] of Object.entries((n['credentials'] ?? {}) as J)) {
        expect(permitidas[tipo], `${n['name']} ${tipo}`).toContain(c['name']);
        expect(c['name'], String(n['name'])).not.toMatch(/bellido|platinum|q'?taco|segurolo|otp|aab1|receptor|evy|emma|ruben|rubén|miniCRM/i);
        expect(c['id'], 'el id va vacío: lo pone la herramienta').toBe('');
      }
    }
    // Gemini: la de producción del Demo A, en los nodos que llaman al modelo.
    for (const n of ['Transcribir audio', 'Ver imagen', 'Conversar con el modelo']) expect(nodo(ENSAYO, n)['credentials']['googlePalmApi']['name'], n).toBe('Google Gemini(PaLM) Api account');
    // Todo nodo que habla con Graph lleva la credencial «Graph WhatsApp Demo A (Bearer)», nunca la de la ingesta.
    const graph = (ENSAYO['nodes'] as J[]).filter((n) => n['type'] === 'n8n-nodes-base.httpRequest' && mod.hostDeUrl(n['parameters']['url']) === 'graph.facebook.com');
    expect(graph.map((n) => n['name']).sort()).toEqual(['Avisar falla del guardado', 'Enviar a WhatsApp', 'Enviar aviso', 'Enviar respaldo', 'Obtener URL del medio (general)', 'Pedir el medio a Meta (guardado)'].sort());
    for (const n of graph) expect(n['credentials']['httpHeaderAuth']['name'], String(n['name'])).toBe('Graph WhatsApp Demo A (Bearer)');
    expect(JSON.stringify(ENSAYO)).not.toMatch(/googleApi|Google Sheets|AAB1 envío/);
  });

  it('DESTINO DE CADA httpRequest: el host de cada nodo es fijo (o una de las dos descargas con su expresión exacta) y está en la lista de permitidos', () => {
    const permitidos = ['graph.facebook.com', 'generativelanguage.googleapis.com', 'us-east1-novuchat-demo.cloudfunctions.net'];
    const http = (ENSAYO['nodes'] as J[]).filter((n) => n['type'] === 'n8n-nodes-base.httpRequest');
    expect(http.length).toBeGreaterThan(10);
    for (const n of http) {
      const host = mod.hostDeUrl(n['parameters']['url']);
      if (host === null) expect(['Descargar medio', 'Descargar medio (guardado)'], String(n['name'])).toContain(n['name']);
      else expect(permitidos, `${n['name']} → ${host}`).toContain(host);
    }
    expect(hallazgos(ENSAYO)).not.toMatch(/destino|lista permitida|fuera de su host|llama a graph/);
  });

  it('GUARDIA POR DESTINO (lista de permitidos): el host se lee de la parte fija de la URL; todo lo que no se pueda leer con certeza, o no sea de la lista, es hallazgo', () => {
    const con = (n: string, url: string): string => { const f = clon(ENSAYO); nodo(f, n)['parameters']['url'] = url; return hallazgos(f); };
    expect(con('Enviar aviso', '=https://graph.facebook.com/{{ $json.v }}/messages?x=1')).not.toMatch(/destino|lista permitida|llama a graph/);
    for (const malo of ['={{ "https://graph.facebook.com/"+$json.x }}', 'http://graph.facebook.com/v20.0/x', '=HTTPS://GRAPH.FACEBOOK.COM.EVIL.COM/x', '= https://graph.facebook.com/x', ' https://graph.facebook.com/x',
      '=//graph.facebook.com/x', '=https://x' + String.fromCharCode(64) + 'graph.facebook.com/x', '=https://graph.facebook.com.evil.com/x', '={{ $json.url }}', '=https://{{ $json.host }}/x', '=https://graph.{{ $json.d }}/x', '=https://graph.facebook.com{{ ".evil.com" }}/', '=https://graph.facebook.com{{""}}.evil.com/']) {
      expect(con('Enviar aviso', malo), malo).toMatch(/destino no es fijo|lista permitida|sin la credencial de Graph/);
    }
    // La credencial de Graph (el token de Meta) nunca sale de graph.facebook.com; la de la ingesta nunca sale de su host:
    for (const destino of ['https://us-east1-novuchat-demo.cloudfunctions.net/x', 'https://generativelanguage.googleapis.com/x']) {
      expect(con('Enviar aviso', destino), destino).toMatch(/credencial de Graph fuera de graph\.facebook\.com/);
    }
    const f = clon(ENSAYO); nodo(f, 'Traer configuración')['parameters']['url'] = 'https://graph.facebook.com/x';
    expect(hallazgos(f)).toMatch(/fuera de su host|sin la credencial de Graph/);
    // Solo los dos nodos de descarga de medios pueden llevar la URL que devuelve Meta, con SU expresión exacta y la credencial de Graph:
    expect(con('Descargar medio', '={{ $json.url }}')).not.toMatch(/destino no es fijo/);
    expect(con('Conversar con el modelo', '={{ $json.url }}')).toMatch(/destino no es fijo/);
    expect(con('Descargar medio', '={{ "https://evil.example/" }}')).toMatch(/destino no es fijo/);
    expect(con('Descargar medio (guardado)', '={{ $json.url }}')).toMatch(/destino no es fijo/);
    const g = clon(ENSAYO); nodo(g, 'Descargar medio')['credentials']['httpHeaderAuth']['name'] = 'Cierres NovuChat A (auto)';
    expect(hallazgos(g)).toMatch(/destino no es fijo/);
  });

  it('se rechaza una credencial de producción de Evy, la del miniCRM, una de otro cliente o la de la ingesta en un nodo de Graph', () => {
    const cambiar = (n: string, tipo: string, nombre: string): J => { const f = clon(ENSAYO); nodo(f, n)['credentials'][tipo]['name'] = nombre; return f; };
    expect(hallazgos(cambiar('Traer configuración', 'httpHeaderAuth', 'NovuChat ingesta (Evy)'))).toContain('que no es una credencial del Demo A');
    expect(hallazgos(cambiar('Enviar a WhatsApp', 'httpHeaderAuth', 'Graph WhatsApp Dra. Evy (Bearer)'))).toContain('que no es una credencial del Demo A');
    expect(hallazgos(cambiar('Conversar con el modelo', 'googlePalmApi', 'Gemini — pruebas (no producción)'))).toContain('que no es una credencial del Demo A');
    expect(hallazgos(cambiar('WhatsApp Trigger', 'whatsAppTriggerApi', 'AAB1-WA-Prod receptor'))).toContain('«WhatsApp Trigger» tiene que llevar la credencial «WhatsApp OAuth account»');
    expect(hallazgos(cambiar('Traer configuración', 'httpHeaderAuth', 'NovuChat ingesta (Bellido)'))).toMatch(/que no es una credencial del Demo A/);
    expect(hallazgos(cambiar('Enviar aviso', 'httpHeaderAuth', 'Cierres NovuChat A (auto)'))).toContain('«Enviar aviso» llama a graph.facebook.com sin la credencial de Graph del Demo A');
    const conPlanilla = clon(ENSAYO); nodo(conPlanilla, 'Traer configuración')['credentials']['googleApi'] = { id: '', name: 'Google Sheets miniCRM (crm-rroca-evy)' };
    expect(hallazgos(conPlanilla)).toMatch(/credencial de Google/);
  });

  it('los datos del ensayo rechazan una credencial que no es del Demo A, o un Graph con otro nombre', () => {
    for (const [campo, malo] of [['ingesta', 'NovuChat ingesta (Evy)'], ['gemini', 'Gemini — pruebas (no producción)'], ['trigger', 'Trigger de Evy'], ['graph', 'Graph WhatsApp Dra. Evy (Bearer)'], ['graph', 'WhatsApp account']] as const) {
      const d = copiaDeDatos();
      editarEnsayo(d, (e) => { e['credenciales'][campo] = malo; });
      expect(() => cargar(d), `${campo}: ${malo}`).toThrow(/credenciales\.(ingesta|gemini|trigger|graph)/);
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
  });

  it('un WhatsApp Trigger sigue prohibido en producción y en prueba (prohibición 7); el del ensayo no pasa por esas variantes', () => {
    for (const [v, base] of [['produccion', PRODUCCION], ['prueba', PRUEBA]] as const) {
      const f = clon(base); (f['nodes'] as J[]).push(clon(nodo(ENSAYO, 'WhatsApp Trigger')));
      expect(mod.guardias(v, f).join(' | ')).toContain('contiene un WhatsApp Trigger (prohibición 7');
    }
    expect(hallazgos(PRODUCCION)).toMatch(/tiene que llevar exactamente un «WhatsApp Trigger»/);
    expect(mod.guardias('produccion', ENSAYO).join(' | ')).toContain('falta el nodo «Entrega del receptor»');
    expect(mod.guardias('produccion', ENSAYO).join(' | ')).toContain('miniCRM: falta el nodo');
  });

  it('«Config base»: sin planilla, sin modo ni etapa de prueba, sin plantilla APPROVED de la WABA de Evy, sin ids de imagen de esa WABA y solo los dos marcadores del ensayo', () => {
    expect(valorBase(ENSAYO, 'planillaProspectosId')).toBe('');
    expect(valorBase(ENSAYO, 'telefonosDePrueba')).toBeUndefined();
    expect(valorBase(ENSAYO, 'etapaPrueba')).toBe('');
    expect(valorBase(ENSAYO, 'avisoSolicitudEstado')).toBe('PENDING');
    for (const k of ['arteComparativoMediaId', 'arteAntesDespuesMediaId', 'arteAutoridadMediaId']) expect(valorBase(ENSAYO, k), k).toBe('');
    const planilla = clon(ENSAYO); asig(planilla).find((a) => a['name'] === 'planillaProspectosId')!['value'] = 'abcdefghijklmnopqrstuvwxy';
    expect(hallazgos(planilla)).toContain('«planillaProspectosId» tiene que ir vacío');
    const aprobada = clon(ENSAYO); asig(aprobada).find((a) => a['name'] === 'avisoSolicitudEstado')!['value'] = 'APPROVED';
    expect(hallazgos(aprobada)).toContain('no puede ser APPROVED');
    const prueba = clon(ENSAYO); asig(prueba).push({ id: 'x', name: 'telefonosDePrueba', type: 'string', value: 'x' });
    expect(hallazgos(prueba)).toContain('no lleva «telefonosDePrueba»');
    const etapa = clon(ENSAYO); asig(etapa).find((a) => a['name'] === 'etapaPrueba')!['value'] = 'si';
    expect(hallazgos(etapa)).toContain('«etapaPrueba» tiene que ir vacía');
    const arte = clon(ENSAYO); asig(arte).find((a) => a['name'] === 'arteAutoridadMediaId')!['value'] = 'REEMPLAZAR_MEDIA_ID_ARTE_AUTORIDAD';
    expect(hallazgos(arte)).toContain('«arteAutoridadMediaId» tiene que ir vacío');
    const marcador = clon(ENSAYO); asig(marcador).push({ id: 'x', name: 'otro', type: 'string', value: 'REEMPLAZAR_TELEFONOS_DE_PRUEBA' });
    expect(hallazgos(marcador)).toContain('el marcador REEMPLAZAR_TELEFONOS_DE_PRUEBA');
    const fuera = clon(ENSAYO); nodo(fuera, 'Traer configuración')['parameters']['url'] = 'REEMPLAZAR_RUTA_X';
    expect(hallazgos(fuera)).toContain('trae un marcador REEMPLAZAR_');
  });

  it('el tope de nodos y la retención valen también para el ensayo', () => {
    const f = clon(ENSAYO); for (let i = 0; i < 20; i++) (f['nodes'] as J[]).push({ id: `x${i}`, name: `Extra ${i}`, type: 'n8n-nodes-base.noOp', typeVersion: 1, position: [0, 0], parameters: {} });
    expect(hallazgos(f)).toContain(`el tope es ${mod.TOPE_DE_NODOS}`);
    const g = clon(ENSAYO); g['settings']['saveDataSuccessExecution'] = 'all';
    expect(hallazgos(g)).toContain('ajustes de retención');
  });
});

describe('la variante NO puede publicarse sobre el número de Evy', () => {
  const negocio = JSON.parse(readFileSync(join(DATOS, 'negocio-rroca-evy.json'), 'utf8')) as J;
  const datos = mod.cargarDatos();
  const todo = (f: J, d: J = datos): string => mod.guardiaDePublicacion({ flujo: f, datos: d, negocio }).join(' | ');
  const AVISO = 'nunca se publica sobre el número de Evy';

  it('`guardiaDePublicacion` rechaza el JSON de ensayo, un JSON con el interruptor o con un Trigger, un nombre «ensayo» y datos con la clave', () => {
    expect(todo(ENSAYO)).toContain(AVISO);
    const conClave = clon(PRODUCCION); asig(conClave).push({ id: 'x', name: CLAVE, type: 'boolean', value: true });
    expect(todo(conClave)).toContain(AVISO);
    const conTrigger = clon(PRODUCCION); (conTrigger['nodes'] as J[]).push(clon(nodo(ENSAYO, 'WhatsApp Trigger')));
    expect(todo(conTrigger)).toContain(AVISO);
    const conNombre = clon(PRODUCCION); conNombre['name'] = 'Dra. Evy (ENSAYO)';
    expect(todo(conNombre)).toContain(AVISO);
    const datosConClave = { ...datos, configBase: { ...(datos['configBase'] as J), [CLAVE]: true } };
    expect(todo(PRODUCCION, datosConClave)).toContain(AVISO);
    // Negativo: la producción y la prueba no son del ensayo.
    expect(todo(PRODUCCION)).not.toContain(AVISO);
    expect(mod.esDelEnsayo(PRODUCCION, datos)).toBe(false);
    expect(mod.esDelEnsayo(PRUEBA, datos)).toBe(false);
    expect(mod.esDelEnsayo(ENSAYO, datos)).toBe(true);
  });

  it('`construir.mjs --publicable --flujo <ensayo>` sale 1, aun con los marcadores sustituidos y la plantilla aprobada', () => {
    const d = mkdtempSync(join(tmpdir(), 'ev-publicable-'));
    temporales.push(d);
    const listo = JSON.parse(JSON.stringify(ENSAYO).replace(/REEMPLAZAR_[A-Z0-9_]+/g, 'valorsustituido')) as J;
    asig(listo).find((a) => a['name'] === 'avisoSolicitudEstado')!['value'] = 'APPROVED';
    writeFileSync(join(d, 'ensayo.json'), JSON.stringify(listo));
    const r = spawnSync(process.execPath, [join(CARPETA, 'construir.mjs'), '--publicable', '--flujo', join(d, 'ensayo.json')], { encoding: 'utf8', env: entornoDelEmulador(undefined) });
    expect(r.status, r.stdout + r.stderr).toBe(1);
    expect(r.stderr).toContain(AVISO);
    // Los datos del ensayo como `--datos` tampoco sirven.
    const r2 = spawnSync(process.execPath, [join(CARPETA, 'construir.mjs'), '--publicable', '--datos', join(DATOS, 'ensayo-demo-a.json')], { encoding: 'utf8', env: entornoDelEmulador(undefined) });
    expect(r2.status).toBe(1);
  });
});

describe('con el interruptor, el aviso y el botón a la recepción llegan a quien escribe; sin él, no', () => {
  const ENSAYO_VIVO = ENSAYO as unknown as Flujo;
  const PROD_VIVO = PRODUCCION as unknown as Flujo;
  // Quien prueba es a la vez el cliente y la recepción: escribe desde el número de recepción. El aviso a «recepción» de Evy sale por texto libre (la plantilla está PENDING).
  const PRUEBA_DE_ENSAYO = { base: { avisoSolicitudEstado: 'PENDING' }, modeloDice: dice('[DERIVAR_RECEPCION: Ana] ¡Qué bien! Te paso con recepción.') } as const;
  const PEDIDO = 'quiero agendar el martes en la tarde, soy Ana';
  // El Trigger entrega la carga de WhatsApp en la raíz (no la del receptor).
  const hablarPorTrigger = (m: ReturnType<typeof crear>, from: string, texto: string): ReturnType<typeof m.turno> => m.turno(valorMeta(mTexto(texto), from), {});

  it('ensayo: escribiendo desde el número de recepción, el aviso SALE a ese mismo número y la respuesta trae el botón a la recepción', () => {
    const m = crear({ flujo: ENSAYO_VIVO, ...PRUEBA_DE_ENSAYO });
    // Un primer mensaje abre la ficha (la ventana de la recepción es su último mensaje al bot: con un solo teléfono es el mismo).
    hablarPorTrigger(m, REC, 'hola');
    const t = hablarPorTrigger(m, REC, PEDIDO);
    expect(avisosARecepcion(t), JSON.stringify(t.avisos)).toHaveLength(1);
    expect(avisosARecepcion(t)[0]!.a).toBe(REC);
    expect(t.mensajes[0]?.payload['interactive']?.type).toBe('cta_url');
  });

  it('producción (sin el interruptor): el mismo teléfono NO recibe aviso ni botón (un empleado no se avisa a sí mismo)', () => {
    const m = crear({ flujo: PROD_VIVO, ...PRUEBA_DE_ENSAYO });
    hablar(m, REC, mTexto('hola'));
    const t = hablar(m, REC, mTexto(PEDIDO));
    expect(avisosARecepcion(t)).toHaveLength(0);
    expect(t.mensajes[0]?.payload['interactive']?.type).not.toBe('cta_url');
  });

  it('ensayo, límite conocido: en el PRIMER turno de una conversación nueva el aviso no sale (la ventana de la recepción es la ficha de quien prueba y aún no existe); el segundo turno sí lo manda', () => {
    const m = crear({ flujo: ENSAYO_VIVO, ...PRUEBA_DE_ENSAYO });
    const primero = hablarPorTrigger(m, REC, PEDIDO);
    expect(avisosARecepcion(primero)).toHaveLength(0);
  });

  it('ensayo con OTRO teléfono: el aviso va a la recepción y el botón al cliente, como siempre (el interruptor no cambia el caso normal)', () => {
    const m = crear({ flujo: ENSAYO_VIVO, ...PRUEBA_DE_ENSAYO });
    hablarPorTrigger(m, REC, 'hola'); // abre la ventana de la recepción
    const t = hablarPorTrigger(m, ANA, PEDIDO);
    expect(avisosARecepcion(t)).toHaveLength(1);
    expect(avisosARecepcion(t)[0]!.a).toBe(REC);
    expect(t.mensajes[0]?.payload['interactive']?.type).toBe('cta_url');
  });
});
