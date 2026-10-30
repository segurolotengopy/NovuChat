/**
 * EL GUARDADO DE MEDIOS ES OBLIGATORIO (contrato M1↔M2 del 29/10/2026, §4; contrato v2 «guardar y descargar TODO» del 30/10, §4, §7.6 y §8.1): TODO flujo versionado que maneja medios lleva la rama común
 * `Flujos/experimental/comun-sin-agente/src/guardado.mjs`, en su lugar y con las credenciales correctas.
 *
 * Se recorre `Flujos/` ENTERO (no una lista escrita a mano): un flujo nuevo con medios que no traiga la rama hace fallar esta prueba sin que
 * nadie se acuerde de agregarlo. Las únicas excepciones son las de `EXCEPCIONES`, cada una con su porqué, y se comprueba que sigan existiendo
 * y que sigan manejando medios (una excepción que ya no hace falta, o un archivo que se borró, también falla: la lista no se pudre).
 *
 * Lo que exige `hallazgosDelGuardado` (el mismo que corren los constructores, así que la prueba y el armado no pueden discrepar):
 *   - los NUEVE nodos y sus aristas (contrato v2: «¿Anotar medio?» y «Anotar medio» ya no existen y su presencia falla); «Preparar guardado» cuelga de «Reportar mensaje (entrante)», junto a la rama que responde y DEBAJO de ella
 *     en el lienzo (con `executionOrder: v1` corre después de que el cliente recibió su respuesta);
 *   - el código de los dos nodos Code, el del módulo común tal cual;
 *   - credenciales por nombre: hacia `guardarMedio`, la misma de ingesta de «Reportar mensaje (entrante)»; hacia Meta, una de WhatsApp que no
 *     es esa ni se llama «ingesta» (la trampa del 15/09);
 *   - todo nodo de red con `continueRegularOutput` y `alwaysOutputData`; las llamadas a `guardarMedio` con la respuesta completa sin error;
 *   - ningún nodo Code de la rama lee el contenido del binario, y el Content-Type va saneado;
 *   - `saveDataSuccessExecution` y `saveDataErrorExecution` «none» y `saveExecutionProgress` false (el binario quedaría en la ejecución guardada).
 * Y se prueba NEGANDO: cada regla tiene su mutación que la rompe.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { codigoLeeBinario, hallazgosDelGuardado, manejaMedios, NODOS_DEL_GUARDADO } from '../../Flujos/experimental/comun-sin-agente/src/guardado.mjs';
import type { Flujo, J } from './lib/flujo';

const aqui = dirname(fileURLToPath(import.meta.url));
const FLUJOS = join(aqui, '../../Flujos');

/** Los JSON de flujo versionados: todo `*.json` bajo `Flujos/` que tenga `nodes` y `connections` (no plantillas, ni copias locales, ni datos). */
function flujosVersionados(): string[] {
  const salida: string[] = [];
  const recorrer = (dir: string): void => {
    // El tipo sale de la misma lectura del directorio (sin comprobar y después leer: CodeQL js/file-system-race); el JSON se lee una vez, con try/catch.
    for (const entrada of readdirSync(dir, { withFileTypes: true })) {
      const nombre = entrada.name;
      if (nombre === 'node_modules' || nombre.startsWith('.')) continue;
      const ruta = join(dir, nombre);
      if (entrada.isDirectory()) { recorrer(ruta); continue; }
      if (!entrada.isFile()) continue;
      if (!nombre.endsWith('.json') || nombre.endsWith('.plantilla.json') || nombre.endsWith('.local.json')) continue;
      let j: J;
      try { j = JSON.parse(readFileSync(ruta, 'utf8')) as J; } catch { continue; }
      if (Array.isArray(j['nodes']) && j['connections'] && typeof j['connections'] === 'object') salida.push(relative(FLUJOS, ruta));
    }
  };
  recorrer(FLUJOS);
  return salida.sort();
}
const leer = (archivo: string): Flujo => JSON.parse(readFileSync(join(FLUJOS, archivo), 'utf8')) as Flujo;

/**
 * LAS EXCEPCIONES, cerradas. Cada una con su porqué y con lo que la cierra. Son los JSON históricos de la raíz de `Flujos/`, los que arma el
 * ensamblador desde `Flujos/manifiestos/` (otro mecanismo, sin `injertar`), y el flujo de Bellido hasta su commit aparte.
 */
export const EXCEPCIONES: Record<string, string> = {
  'demo-a-agendamiento.json': 'Demo A: número de ensayo sin pacientes, armado por el ensamblador; lo cierra pasarlo a la base común',
  'demo-b-venta-cobro.json': 'Demo B: demo sin clientes, armado por el ensamblador; lo cierra pasarlo a la base común',
  'novuchat-onboarding.json': 'histórico: el chat de NovuChat corre chat-novuchat (que sí lo trae); queda sin fila en versiones-por-cliente',
  'platinum-agendamiento.json': 'histórico del ensamblador, sin cliente; lo cierra retirarlo',
  'bellido-agendamiento.json': 'flujo A de Bellido, descartado desde el 01/10 (corre agenda-minima); Andres ordenó no tocarlo',
};

/**
 * Se EXIGE la rama a todo flujo que baja medios (por nombre, por nodo de medios o por URL: `manejaMedios`) Y a todo flujo conversacional que reporta
 * el entrante («Reportar mensaje (entrante)»), salvo la lista cerrada: así un flujo nuevo que baja medios con un nodo de otro nombre no se escapa.
 */
export const exigeGuardado = (f: Flujo): boolean => manejaMedios(f) || f.nodes.some((n) => n.name === 'Reportar mensaje (entrante)');

/** Revisa una lista de flujos y devuelve, por archivo, lo que falla. La usa la prueba sobre el repositorio y la prueba negada. */
export function revisar(lista: { archivo: string; flujo: Flujo }[], excepciones: Record<string, string>): Record<string, string[]> {
  const fallas: Record<string, string[]> = {};
  for (const { archivo, flujo } of lista) {
    if (!exigeGuardado(flujo) || excepciones[archivo] !== undefined) continue;
    const h = hallazgosDelGuardado(flujo, { exigir: true }) as string[];
    if (h.length) fallas[archivo] = h;
  }
  return fallas;
}

const TODOS = flujosVersionados();
const CON_MEDIOS = TODOS.filter((a) => exigeGuardado(leer(a)));
const CUBIERTOS = CON_MEDIOS.filter((a) => EXCEPCIONES[a] === undefined);

describe('guardado obligatorio: todo flujo versionado con medios lleva la rama común', () => {
  it('se encontraron los flujos versionados y los que manejan medios (la búsqueda no quedó vacía)', () => {
    expect(TODOS.length).toBeGreaterThan(20);
    expect(CON_MEDIOS.length).toBeGreaterThan(15);
    // Los de cada cliente que guarda medios, por nombre: si uno se renombra o deja de bajar medios, esto lo dice.
    for (const a of [
      'experimental/rroca-evy/rroca-evy.json', 'experimental/rroca-emma/rroca-emma.json', 'experimental/rroca-ruben/rroca-ruben.json',
      'experimental/rroca-antonio/rroca-antonio.json', 'experimental/venta-minima/venta-minima.qtaco.json', 'experimental/venta-minima/venta-minima.ensayo-demo-a.json',
      'experimental/venta-minima/venta-minima.prueba.json', 'experimental/doctoras/doctoras.rroca-evy.json', 'experimental/doctoras/doctoras.rroca-emma.json',
      'experimental/chat-novuchat/chat-novuchat.novuchat.json', 'experimental/captacion-minima/captacion-minima.novuchat.json',
      'experimental/agenda-minima/agenda-minima.v0.json', 'experimental/agenda-minima/agenda-minima.prueba.json',
    ]) expect(CUBIERTOS, a).toContain(a);
  });

  it.each(CUBIERTOS)('%s lleva el guardado completo, en su lugar y con las credenciales correctas', (archivo) => {
    expect(hallazgosDelGuardado(leer(archivo), { exigir: true })).toEqual([]);
  });

  // EL BINARIO DEL MEDIO queda en los datos de la ejecución de n8n si la ejecución se guarda. Tabla CERRADA de la retención de cada flujo cubierto:
  // [saveDataSuccessExecution, saveDataErrorExecution, saveExecutionProgress]. DECISIÓN DE ANDRES (30/10, contrato v2 §8.1): «none», «none» y false en
  // TODOS. Antes de esta decisión guardaban errores Rubén, Antonio, chat-novuchat y captacion-minima, y Q'Taco guardaba todo; Agenda mínima (Bellido) no lo
  // fijaba (valía el de la instancia). Cambiar una fila obliga a cambiar esta prueba y decirlo en el PR.
  const NADA: [string, string, boolean] = ['none', 'none', false];
  const RETENCION: Record<string, [string | undefined, string | undefined, boolean | undefined]> = Object.fromEntries([
    'experimental/rroca-evy/rroca-evy.json', 'experimental/rroca-evy/rroca-evy.prueba.json',
    'experimental/rroca-emma/rroca-emma.json', 'experimental/rroca-emma/rroca-emma.prueba.json',
    'experimental/doctoras/doctoras.rroca-evy.json', 'experimental/doctoras/doctoras.rroca-evy.prueba.json',
    'experimental/doctoras/doctoras.rroca-emma.json', 'experimental/doctoras/doctoras.rroca-emma.prueba.json',
    'experimental/rroca-ruben/rroca-ruben.json', 'experimental/rroca-ruben/rroca-ruben.prueba.json',
    'experimental/rroca-antonio/rroca-antonio.json', 'experimental/rroca-antonio/rroca-antonio.prueba.json',
    'experimental/venta-minima/venta-minima.qtaco.json', 'experimental/venta-minima/venta-minima.prueba.json',
    'experimental/venta-minima/venta-minima.ensayo-demo-a.json',
    'experimental/chat-novuchat/chat-novuchat.novuchat.json', 'experimental/chat-novuchat/chat-novuchat.prueba.json',
    'experimental/captacion-minima/captacion-minima.novuchat.json', 'experimental/captacion-minima/captacion-minima.prueba.json',
    'experimental/agenda-minima/agenda-minima.v0.json', 'experimental/agenda-minima/agenda-minima.prueba.json',
    // Walisuma (#713, 30/10): main la traía con «none»/«all»; pasa a «none» como todos.
    'experimental/walisuma/walisuma.json', 'experimental/walisuma/walisuma.prueba.json',
  ].map((a) => [a, NADA]));
  it('la retención de ejecuciones de cada flujo cubierto es la de la tabla cerrada: nada guardado (el binario del medio quedaría en la ejecución)', () => {
    expect(Object.keys(RETENCION).sort()).toEqual([...CUBIERTOS].sort());
    for (const a of CUBIERTOS) {
      const st = (leer(a).settings ?? {}) as J;
      expect([st['saveDataSuccessExecution'], st['saveDataErrorExecution'], st['saveExecutionProgress']], a).toEqual(RETENCION[a]);
    }
  });

  it('la rama tiene NUEVE nodos en cada flujo cubierto y ninguno de los que el contrato v2 quitó', () => {
    expect(NODOS_DEL_GUARDADO).toHaveLength(9);
    for (const a of CUBIERTOS) {
      const nombres = leer(a).nodes.map((n) => n.name);
      expect(nombres.filter((n) => NODOS_DEL_GUARDADO.includes(n)), a).toHaveLength(9);
      expect(nombres.filter((n) => /Anotar medio/.test(n)), a).toEqual([]);
    }
  });

  it('cada excepción existe, sigue manejando medios y NO trae la rama (si la trae, sobra la excepción)', () => {
    for (const [archivo, porque] of Object.entries(EXCEPCIONES)) {
      expect(porque.length, archivo).toBeGreaterThan(20);
      expect(TODOS, archivo).toContain(archivo);
      const f = leer(archivo);
      expect(exigeGuardado(f), archivo).toBe(true);
      expect(f.nodes.some((n) => n.name === 'Preparar guardado'), `${archivo}: ya trae el guardado; quítelo de EXCEPCIONES`).toBe(false);
    }
  });

  it('el repositorio entero pasa la revisión', () => {
    expect(revisar(TODOS.map((archivo) => ({ archivo, flujo: leer(archivo) })), EXCEPCIONES)).toEqual({});
  });
});

// ------------------------------------------------------------------------------------------------ NEGANDO
/** Escapa TODO lo que es especial en una expresión regular (barra invertida incluida). */
const escaparRegex = (t: string): string => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const copia = (f: Flujo): Flujo => JSON.parse(JSON.stringify(f)) as Flujo;
const BASE = 'experimental/rroca-evy/rroca-evy.json';
const conBase = (cambio: (f: Flujo) => void): string => { const f = copia(leer(BASE)); cambio(f); return (hallazgosDelGuardado(f) as string[]).join(' | '); };
const nodoDe = (f: Flujo, n: string) => f.nodes.find((x) => x.name === n)!;

describe('guardado obligatorio, NEGANDO: cada regla tiene la mutación que la rompe', () => {
  it('UN FLUJO NUEVO CON MEDIOS SIN LA RAMA hace fallar la revisión del repositorio', () => {
    const nuevo = copia(leer(BASE));
    const fuera = new Set(NODOS_DEL_GUARDADO);
    nuevo.nodes = nuevo.nodes.filter((n) => !fuera.has(n.name));
    for (const k of Object.keys(nuevo.connections)) {
      if (fuera.has(k)) { delete nuevo.connections[k]; continue; }
      nuevo.connections[k]!['main'] = (nuevo.connections[k]!['main'] ?? []).map((s) => (s ?? []).filter((c) => !fuera.has(c.node)));
    }
    expect(manejaMedios(nuevo)).toBe(true);
    const lista = [...TODOS.map((archivo) => ({ archivo, flujo: leer(archivo) })), { archivo: 'experimental/cliente-nuevo/cliente-nuevo.json', flujo: nuevo }];
    const fallas = revisar(lista, EXCEPCIONES);
    expect(Object.keys(fallas)).toEqual(['experimental/cliente-nuevo/cliente-nuevo.json']);
    expect(fallas['experimental/cliente-nuevo/cliente-nuevo.json']!.join(' ')).toMatch(/falta el nodo «Preparar guardado»/);
    // …y un flujo SIN medios no la necesita.
    const sinMedios = copia(nuevo);
    // (ni medios ni reporte del entrante: un flujo que no conversa)
    sinMedios.nodes = sinMedios.nodes.filter((n) => !/^(Obtener URL del medio|Descargar medio)/.test(n.name) && n.name !== 'Reportar mensaje (entrante)');
    expect(manejaMedios(sinMedios)).toBe(false);
    expect(revisar([{ archivo: 'x.json', flujo: sinMedios }], {})).toEqual({});
  });
  it('UN FLUJO QUE BAJA MEDIOS CON NODOS DE OTRO NOMBRE no se escapa: se lo detecta por la URL', () => {
    const f = copia(leer(BASE));
    const fuera = new Set(NODOS_DEL_GUARDADO);
    f.nodes = f.nodes.filter((n) => !fuera.has(n.name) && n.name !== 'Reportar mensaje (entrante)');
    for (const k of Object.keys(f.connections)) {
      if (fuera.has(k) || k === 'Reportar mensaje (entrante)') { delete f.connections[k]; continue; }
      f.connections[k]!['main'] = (f.connections[k]!['main'] ?? []).map((sal) => (sal ?? []).filter((c) => !fuera.has(c.node) && c.node !== 'Reportar mensaje (entrante)'));
    }
    const renombrar = (de: string, a: string): void => {
      nodoDe(f, de).name = a;
      for (const [k, v] of Object.entries(f.connections)) for (const sal of (v['main'] ?? [])) for (const c of (sal ?? [])) if (c.node === de) c.node = a;
      if (f.connections[de]) { f.connections[a] = f.connections[de]!; delete f.connections[de]; }
    };
    renombrar('Obtener URL del medio (general)', 'Ubicar adjunto');
    renombrar('Descargar medio', 'Bajar imagen');
    expect(f.nodes.some((n) => /^(Obtener URL del medio|Descargar medio)/.test(n.name))).toBe(false);
    expect(manejaMedios(f)).toBe(true);
    const fallas = revisar([{ archivo: 'experimental/otro/otro.json', flujo: f }], {});
    expect(fallas['experimental/otro/otro.json']!.join(' ')).toMatch(/falta el nodo «Preparar guardado»/);
  });
  it('un flujo que reporta el entrante, aunque no baje medios, también la exige', () => {
    const f = copia(leer(BASE));
    f.nodes = f.nodes.filter((n) => !NODOS_DEL_GUARDADO.includes(n.name) && !/medio|Ver imagen|Transcribir|Tamaño|Es audio/.test(n.name));
    expect(manejaMedios(f)).toBe(false);
    expect(Object.keys(revisar([{ archivo: 'x.json', flujo: f }], {}))).toEqual(['x.json']);
  });
  it('el aviso con otra credencial que la de envío del flujo (p. ej. la de descarga, de producción, en una variante de prueba)', () => {
    expect(conBase((f) => { nodoDe(f, 'Avisar falla del guardado').credentials = { httpHeaderAuth: { id: '', name: 'Graph WhatsApp Otra (Bearer)' } }; })).toMatch(/MISMA credencial que «Enviar a WhatsApp»/);
  });
  it('la descarga del guardado con reintentos', () => {
    expect(conBase((f) => { (nodoDe(f, 'Descargar medio (guardado)') as J)['retryOnFail'] = true; })).toMatch(/no reintenta/);
  });
  it('sin un nodo de la rama', () => {
    for (const n of NODOS_DEL_GUARDADO) expect(conBase((f) => { f.nodes = f.nodes.filter((x) => x.name !== n); }), n).toMatch(new RegExp(`falta el nodo «${escaparRegex(n)}»`));
  });
  it('la rama ARRIBA de la que responde (correría antes y demoraría la respuesta)', () => {
    expect(conBase((f) => { nodoDe(f, 'Preparar guardado').position = [nodoDe(f, 'Preparar guardado').position![0], 100]; })).toMatch(/DEBAJO de «Puerta del turno»/);
  });
  it('colgada de otro nodo, o el reporte sin seguir a la rama que responde', () => {
    expect(conBase((f) => { f.connections['Reportar mensaje (entrante)']!['main']![0] = [{ node: 'Puerta del turno', type: 'main', index: 0 }]; })).toMatch(/no cuelga de «Reportar mensaje \(entrante\)»/);
    expect(conBase((f) => { f.connections['Reportar mensaje (entrante)']!['main']![0] = [{ node: 'Preparar guardado', type: 'main', index: 0 }]; })).toMatch(/no sigue hacia la rama que responde/);
  });
  it('una arista de la rama cortada', () => {
    expect(conBase((f) => { f.connections['Descargar medio (guardado)']!['main']![0] = []; })).toMatch(/«Descargar medio \(guardado\)» \(salida 0\) no está conectado a «Guardar medio»/);
  });
  it('el código de un nodo Code cambiado a mano (no es el del módulo común)', () => {
    expect(conBase((f) => { (nodoDe(f, 'Preparar guardado').parameters as J)['jsCode'] = String((nodoDe(f, 'Preparar guardado').parameters as J)['jsCode']).replace('16 * 1024 * 1024', '99 * 1024 * 1024'); })).toMatch(/guardado-preparar\.js tal cual/);
    expect(conBase((f) => { (nodoDe(f, 'Resultado del guardado').parameters as J)['jsCode'] = 'return [];'; })).toMatch(/guardado-resultado\.js tal cual/);
  });
  it('LA TRAMPA DEL 15/09: la credencial de ingesta en un nodo que llama a Meta', () => {
    for (const n of ['Pedir el medio a Meta (guardado)', 'Descargar medio (guardado)', 'Avisar falla del guardado']) {
      expect(conBase((f) => { nodoDe(f, n).credentials = { httpHeaderAuth: { id: '', name: 'NovuChat ingesta (Evy)' } }; }), n).toMatch(/credencial de ingesta \(la trampa del 15\/09\)/);
    }
  });
  it('hacia guardarMedio, otra credencial que la de ingesta del flujo (la de Graph, o una ingesta ajena)', () => {
    expect(conBase((f) => { nodoDe(f, 'Guardar medio').credentials = { httpHeaderAuth: { id: '', name: 'Graph WhatsApp Dra. Evy (Bearer)' } }; })).toMatch(/«Guardar medio» tiene que llevar SOLO la credencial de ingesta/);
    expect(conBase((f) => { nodoDe(f, 'Reintentar el guardado').credentials = { httpHeaderAuth: { id: '', name: 'NovuChat ingesta (Emma)' } }; })).toMatch(/«Reintentar el guardado» tiene que llevar SOLO la credencial de ingesta/);
  });
  it('guardarMedio con firma, o hacia otra Function', () => {
    expect(conBase((f) => { ((nodoDe(f, 'Guardar medio').parameters as J)['headerParameters'] as J)['parameters'].push({ name: 'X-NovuChat-Signature', value: 'x' }); })).toMatch(/manda una firma/);
    expect(conBase((f) => { (nodoDe(f, 'Guardar medio').parameters as J)['url'] = 'https://us-east1-novuchat-demo.cloudfunctions.net/ingesta'; })).toMatch(/no llama a guardarMedio/);
  });
  it('un nodo de red que corta el turno, o que no ve el código de la respuesta', () => {
    expect(conBase((f) => { delete nodoDe(f, 'Guardar medio').onError; })).toMatch(/«Guardar medio» tiene que llevar onError continueRegularOutput/);
    expect(conBase((f) => { ((((nodoDe(f, 'Reintentar el guardado').parameters as J)['options'] as J)['response'] as J)['response'] as J)['neverError'] = false; })).toMatch(/respuesta completa sin error/);
  });
  it('el aviso que traga su fallo (con onError), o que va a otro número que el de recepción', () => {
    expect(conBase((f) => { (nodoDe(f, 'Avisar falla del guardado') as J)['onError'] = 'continueRegularOutput'; })).toMatch(/no lleva onError/);
    expect(conBase((f) => { const p = nodoDe(f, 'Avisar falla del guardado').parameters as J; p['jsonBody'] = String(p['jsonBody']).replace('$json.numeroRecepcion', '$json.telefono'); })).toMatch(/SOLO al número de recepción/);
  });
  it('el reintento sin los bytes, o sin el Content-Type saneado; o que reintenta algo que no es un 5xx', () => {
    expect(conBase((f) => { (nodoDe(f, 'Reintentar el guardado').parameters as J)['sendBody'] = "={{ $json.modo === 'descargar' }}"; })).toMatch(/manda los mismos bytes/);
    expect(conBase((f) => { const p = nodoDe(f, 'Reintentar el guardado').parameters as J; p['jsonHeaders'] = String(p['jsonHeaders']).replace(", 'Content-Type': $json.contentType", ''); })).toMatch(/Reintentar el guardado» manda el Content-Type saneado/);
    expect(conBase((f) => { const c = (nodoDe(f, '¿Reintentar el guardado?').parameters as J)['conditions']['conditions'][0]; c['leftValue'] = '={{ Number($json.statusCode) >= 400 }}'; })).toMatch(/reintenta solo un 5xx/);
  });
  it('«Guardar medio» sin el Content-Type saneado (mandaría el mime que trajo el CDN de Meta), o sin los bytes', () => {
    expect(conBase((f) => { const h = ((nodoDe(f, 'Guardar medio').parameters as J)['headerParameters'] as J); h['parameters'] = (h['parameters'] as J[]).filter((x) => x['name'] !== 'Content-Type'); })).toMatch(/«Guardar medio» manda el Content-Type saneado/);
    expect(conBase((f) => { const h = ((nodoDe(f, 'Guardar medio').parameters as J)['headerParameters'] as J); (h['parameters'] as J[]).find((x) => x['name'] === 'Content-Type')!['value'] = "={{ $binary.data.mimeType }}"; })).toMatch(/«Guardar medio» manda el Content-Type saneado/);
    expect(conBase((f) => { (nodoDe(f, 'Guardar medio').parameters as J)['sendBody'] = false; })).toMatch(/«Guardar medio» manda los bytes/);
  });
  it('«Guardar medio» o su reintento sin X-NovuChat-Mime (revisión de #709)', () => {
    expect(conBase((f) => { const h = ((nodoDe(f, 'Guardar medio').parameters as J)['headerParameters'] as J); h['parameters'] = (h['parameters'] as J[]).filter((x) => x['name'] !== 'X-NovuChat-Mime'); })).toMatch(/«Guardar medio» manda X-NovuChat-Mime/);
    expect(conBase((f) => { const p = nodoDe(f, 'Reintentar el guardado').parameters as J; p['jsonHeaders'] = String(p['jsonHeaders']).replace(", 'X-NovuChat-Mime': $json.mime", ''); })).toMatch(/«Reintentar el guardado» manda X-NovuChat-Mime/);
  });
  it('VUELVEN «¿Anotar medio?» o «Anotar medio» (el contrato v2 los quitó)', () => {
    expect(conBase((f) => { f.nodes.push({ ...nodoDe(f, 'Guardar medio'), id: 'gm-anotar', name: 'Anotar medio' }); })).toMatch(/sobra «Anotar medio»/);
    expect(conBase((f) => { f.nodes.push({ ...nodoDe(f, '¿Reintentar el guardado?'), id: 'gm-si-anotar', name: '¿Anotar medio?' }); })).toMatch(/sobra «¿Anotar medio\?»/);
  });
  it('UN NODO CODE QUE LEE EL BINARIO (contrato v2 §7.6), o un nodo de la rama que se vuelve Code, o la rama que sale de sí misma', () => {
    for (const lee of ["const b = await this.helpers.getBinaryDataBuffer(0, 'data');", "const b = $input.first().binary.data.data;", "const t = Buffer.from(x, 'base64');", "const t = atob(x);"]) {
      expect(codigoLeeBinario(lee), lee).toBe(true);
      expect(conBase((f) => { const p = nodoDe(f, 'Preparar reintento').parameters as J; p['jsCode'] = `${String(p['jsCode'])}\n${lee}`; }), lee).toMatch(/«Preparar reintento» lee el contenido del binario/);
    }
    // El código común NO lee el binario: el reintento solo pasa la referencia.
    expect(codigoLeeBinario('if (rpBajado && rpBajado.binary && rpBajado.binary.data) rpItem.binary = { data: rpBajado.binary.data };')).toBe(false);
    expect(conBase((f) => { const n = nodoDe(f, 'Guardar medio') as J; n['type'] = 'n8n-nodes-base.code'; })).toMatch(/«Guardar medio» no puede ser un nodo Code/);
    expect(conBase((f) => { f.connections['Descargar medio (guardado)']!['main']![0]!.push({ node: 'Puerta del turno', type: 'main', index: 0 }); })).toMatch(/«Descargar medio \(guardado\)» sigue hacia «Puerta del turno», fuera de la rama/);
  });
  it('un flujo con la rama que GUARDA ejecuciones (el binario del medio quedaría en n8n)', () => {
    expect(conBase((f) => { (f.settings as J)['saveDataErrorExecution'] = 'all'; })).toMatch(/settings\.saveDataErrorExecution tiene que ser "none"/);
    expect(conBase((f) => { (f.settings as J)['saveDataSuccessExecution'] = 'all'; })).toMatch(/settings\.saveDataSuccessExecution tiene que ser "none"/);
    expect(conBase((f) => { delete (f.settings as J)['saveExecutionProgress']; })).toMatch(/settings\.saveExecutionProgress tiene que ser false/);
  });
  it('manejaMedios: un nodo que baja un VIDEO o un DOCUMENTO también obliga a llevar la rama', () => {
    const f = copia(leer(BASE));
    const fuera = new Set([...NODOS_DEL_GUARDADO, 'Reportar mensaje (entrante)']);
    f.nodes = f.nodes.filter((n) => !fuera.has(n.name) && !/^(Obtener URL del medio|Descargar medio)/.test(n.name));
    f.connections = { 'Carga de entrada': { main: [[{ node: 'Descargar video', type: 'main', index: 0 }, { node: 'Descargar documento', type: 'main', index: 0 }]] } };
    expect(manejaMedios(f)).toBe(false);
    f.nodes.push({ id: 'v', name: 'Descargar video', type: 'n8n-nodes-base.noOp', typeVersion: 1, position: [0, 0], parameters: {} } as never);
    expect(manejaMedios(f)).toBe(true);
    f.nodes = f.nodes.filter((n) => n.name !== 'Descargar video');
    f.nodes.push({ id: 'd', name: 'Descargar documento', type: 'n8n-nodes-base.noOp', typeVersion: 1, position: [0, 0], parameters: {} } as never);
    expect(manejaMedios(f)).toBe(true);
  });
  it('el aviso o el guardado con reintentos (un aviso repetido llegaría dos veces)', () => {
    expect(conBase((f) => { (nodoDe(f, 'Avisar falla del guardado') as J)['retryOnFail'] = true; })).toMatch(/no reintentan/);
  });
  it('la descarga hacia otro anfitrión que el CDN de Meta', () => {
    expect(conBase((f) => { (nodoDe(f, 'Descargar medio (guardado)').parameters as J)['url'] = '={{ $json.url }}'; })).toMatch(/llama a otro anfitrión/);
  });
});
