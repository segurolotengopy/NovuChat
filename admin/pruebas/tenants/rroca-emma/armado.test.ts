/**
 * EL ARMADO del flujo de Emma: los JSON versionados son lo que arma `construir.mjs` (nunca a mano), las guardias del armado se NIEGAN con mutaciones, el prompt versionado no trae teléfonos ni enlaces, ninguna
 * referencia `$('…')` nombra un nodo que no es su antecesor, y las copias declaradas (carga de entrada, NIEGA_IA, párrafos, riesgo, transcripción) son iguales a su fuente.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Flujo } from '../../lib/flujo';
import { entornoDelEmulador } from '../../core/entorno-del-hijo.ts';
// @ts-expect-error el armador es un .mjs sin tipos
import { CONFIG, TOPE_DE_NODOS, guardias, hallazgosDelPrompt, leerPrompt, problemasDeReferencias } from '../../../../Flujos/experimental/rroca-emma/construir.mjs';
import { PRODUCCION, PRUEBA } from './mundo';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const CARPETA = join(REPO, 'Flujos/experimental/rroca-emma');
const leer = (r: string): string => readFileSync(join(REPO, r), 'utf8');
const copia = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const g = (v: 'produccion' | 'prueba', f: Flujo): string[] => guardias(v, f) as string[];

describe('lo versionado es lo que arma construir.mjs', () => {
  it('--verificar sale 0 (los dos JSON al día, 44 y 39 nodos: 36 y 31 más los 8 del guardado de medios)', () => {
    const r = spawnSync(process.execPath, [join(CARPETA, 'construir.mjs'), '--verificar'], { encoding: 'utf8', env: entornoDelEmulador({}) });
    expect(`${r.stdout}${r.stderr}`).toContain('rroca-emma.json al día (44 nodos)');
    expect(`${r.stdout}${r.stderr}`).toContain('rroca-emma.prueba.json al día (39 nodos)');
    expect(r.status).toBe(0);
  });
  it('un argumento desconocido se rechaza y no escribe', () => {
    const r = spawnSync(process.execPath, [join(CARPETA, 'construir.mjs'), '--ayuda'], { encoding: 'utf8', env: entornoDelEmulador({}) });
    expect(r.status).toBe(2);
  });
  it('lo armado no viola ninguna guardia y el tope es de 44 nodos (36 más los 8 del guardado de medios)', () => {
    expect(g('produccion', PRODUCCION)).toEqual([]);
    expect(g('prueba', PRUEBA)).toEqual([]);
    expect(TOPE_DE_NODOS).toBe(44);
    expect(CONFIG.variantes.length).toBe(2);
  });
});

describe('las guardias se niegan con mutaciones', () => {
  const quitar = (f: Flujo, n: string): Flujo => { const c = copia(f); c.nodes = c.nodes.filter((x) => x.name !== n); return c; };
  const nodo = (f: Flujo, n: string) => f.nodes.find((x) => x.name === n)!;
  it('un WhatsApp Trigger, «subscriptions» o un agente de n8n', () => {
    const a = copia(PRODUCCION); a.nodes.push({ ...nodo(a, 'Config base'), name: 'Disparador', type: 'n8n-nodes-base.whatsAppTrigger' });
    expect(g('produccion', a).join(' ')).toMatch(/WhatsApp Trigger/);
    const b = copia(PRODUCCION); nodo(b, 'Config base').notes = 'usa subscriptions';
    expect(g('produccion', b).join(' ')).toMatch(/subscriptions/);
    const c = copia(PRODUCCION); c.nodes.push({ ...nodo(c, 'Config base'), name: 'Agente', type: '@n8n/n8n-nodes-langchain.agent' });
    expect(g('produccion', c).join(' ')).toMatch(/agente/);
  });
  it('más de 44 nodos', () => {
    const f = copia(PRODUCCION); f.nodes.push({ ...nodo(f, 'Config base'), name: 'Nodo de más' });
    expect(g('produccion', f).join(' ')).toMatch(/tope es 44/);
  });
  it('la entrada del receptor: sin «Continue on Fail», con wabaIdEsperado fijo y repetidos entre ejecuciones', () => {
    const a = copia(PRODUCCION); (nodo(a, 'Verificar firma con el receptor') as Record<string, unknown>)['onError'] = 'continueRegularOutput';
    expect(g('produccion', a).join(' ')).toMatch(/Continue on Fail/);
    const b = copia(PRODUCCION); (nodo(b, 'Verificar firma con el receptor').parameters as Record<string, unknown>)['jsonBody'] = '={{ JSON.stringify({ wabaIdEsperado: $json.waba }) }}';
    expect(g('produccion', b).join(' ')).toMatch(/wabaIdEsperado/);
    const c = copia(PRODUCCION); (nodo(c, 'Descartar repetidos').parameters as Record<string, unknown>)['operation'] = 'removeDuplicateInputItems';
    expect(g('produccion', c).join(' ')).toMatch(/entre ejecuciones/);
    expect(g('produccion', quitar(PRODUCCION, 'Descartar repetidos')).join(' ')).toMatch(/falta el nodo «Descartar repetidos»/);
  });
  it('producción sin «Entrada de prueba» y prueba sin receptor', () => {
    const a = copia(PRODUCCION); a.nodes.push({ ...nodo(PRUEBA, 'Entrada de prueba') });
    expect(g('produccion', a).join(' ')).toMatch(/Entrada de prueba/);
    const b = copia(PRUEBA); b.nodes.push({ ...nodo(PRODUCCION, 'Entrega del receptor') });
    expect(g('prueba', b).join(' ')).toMatch(/entrada del receptor/);
  });
  it('«Enviar aviso» corre ANTES de «Armar mensajes», no reintenta y no corta el turno', () => {
    const a = copia(PRODUCCION); delete (a.connections['Enviar aviso'] as Record<string, unknown>)['main'];
    a.connections['Enviar aviso'] = { main: [[]] };
    expect(g('produccion', a).join(' ')).toMatch(/Enviar aviso/);
    const b = copia(PRODUCCION); delete (nodo(b, 'Enviar aviso') as Record<string, unknown>)['onError'];
    expect(g('produccion', b).join(' ')).toMatch(/onError/);
    const c = copia(PRODUCCION); a.connections['¿Hay previos?'] = { main: [[{ node: 'Enviar aviso', type: 'main', index: 0 }], []] }; c.connections['¿Hay previos?'] = a.connections['¿Hay previos?'];
    expect(g('produccion', c).join(' ')).toMatch(/sin previos/);
  });
  it('el modelo y los nodos de Gemini no cortan el turno si fallan', () => {
    const a = copia(PRODUCCION); delete (nodo(a, 'Conversar con el modelo') as Record<string, unknown>)['onError'];
    expect(g('produccion', a).join(' ')).toMatch(/Conversar con el modelo/);
    const b = copia(PRODUCCION); delete (nodo(b, 'Ver imagen') as Record<string, unknown>)['onError'];
    expect(g('produccion', b).join(' ')).toMatch(/Ver imagen/);
  });
  it('un anfitrión fuera de la lista, una credencial de producción en la prueba, la retención y el reporte de la baja', () => {
    const a = copia(PRODUCCION); (nodo(a, 'Traer configuración').parameters as Record<string, unknown>)['url'] = 'https://ejemplo.invalid/x';
    expect(g('produccion', a).join(' ')).toMatch(/anfitrión/);
    const b = copia(PRUEBA); ((nodo(b, 'Transcribir audio') as Record<string, unknown>)['credentials'] as Record<string, { name: string }>)['googlePalmApi']!.name = 'Google Gemini(PaLM) Api account';
    expect(g('prueba', b).join(' ')).toMatch(/credencial de producción/);
    const c = copia(PRODUCCION); c.settings = { ...(c.settings as object), saveDataErrorExecution: 'all' };
    expect(g('produccion', c).join(' ')).toMatch(/retención/);
    const d = copia(PRODUCCION); (nodo(d, 'Reportar mensaje (saliente)').parameters as Record<string, unknown>)['jsonBody'] = '={{ "{}" }}';
    expect(g('produccion', d).join(' ')).toMatch(/no_contactar/);
  });
  it('«Reportar mensaje (entrante)» va ARRIBA de la rama que responde', () => {
    const a = copia(PRODUCCION); nodo(a, 'Reportar mensaje (entrante)').position = [1400, 900];
    expect(g('produccion', a).join(' ')).toMatch(/tiene que ir arriba/);
  });
  it('un marcador REEMPLAZAR_ fuera de «Config base», del receptor y de la ruta de prueba', () => {
    const a = copia(PRODUCCION); nodo(a, 'Armar mensajes').notes = 'REEMPLAZAR_ALGO_MAS';
    expect(g('produccion', a).join(' ')).toMatch(/marcador REEMPLAZAR_/);
  });
  it('«Preparar transcripción» es el módulo común del core, byte a byte', () => {
    const a = copia(PRODUCCION); (nodo(a, 'Preparar transcripción').parameters as Record<string, unknown>)['jsCode'] = '// editado a mano\nreturn [];';
    expect(g('produccion', a).join(' ')).toMatch(/módulo común/);
    const fuente = readFileSync(join(REPO, 'Flujos/src/core/medios/preparar-transcripcion.js'), 'utf8').trimEnd();
    expect(String(nodo(PRODUCCION, 'Preparar transcripción').parameters['jsCode'])).toContain(fuente);
  });
});

describe('el prompt versionado', () => {
  const md = readFileSync(join(CARPETA, 'prompts/emma.md'), 'utf8');
  it('no trae teléfonos, enlaces wa.me con dígitos ni literales de 10 o más dígitos', () => {
    expect(hallazgosDelPrompt(md)).toEqual([]);
    expect(md).not.toMatch(/wa\.me\/\s*\+?\d/);
    expect(md).not.toMatch(/\d{7,}/);
    expect(md).not.toMatch(/\+?\d{2,3}[\s.-]?\d{2}[\s.-]?\d{5,}/);
    expect(() => leerPrompt()).not.toThrow();
  });
  it('un prompt con un teléfono, un enlace o sin sus marcadores se rechaza', () => {
    const tel = ['+591', ' 7', '00', '25', '677'].join('');
    expect((hallazgosDelPrompt(`${md}\nllama al ${tel}`) as string[]).join(' ')).toMatch(/7 o más dígitos/);
    expect((hallazgosDelPrompt(`${md}\nwa.me/${['591', '7', '0025677'].join('')}`) as string[]).join(' ')).toMatch(/wa\.me/);
    expect((hallazgosDelPrompt(md.replace('{{RECEPCION_LINK}}', 'x')) as string[]).join(' ')).toMatch(/RECEPCION_LINK/);
    expect((hallazgosDelPrompt(md.replace('{{/MARCAS}}', '')) as string[]).join(' ')).toMatch(/MARCAS/);
  });
  it('las correcciones obligatorias sobre el guion: sin «inmediato», sin las dos frases sin mecanismo, sin la frase de baja', () => {
    // la regla 11 del prompt de Emma es la que PROHÍBE «inmediato»: se excluye de la comprobación
    const plano = md.split('\n').filter((l) => !l.startsWith('11. ')).join('\n').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    expect(plano).not.toContain('inmediato');
    expect(plano).not.toContain('de inmediato');
    expect(plano).not.toContain('ubicacion exacta en google maps');
    expect(plano).not.toContain('te asignaran');
    expect(plano).not.toContain('no me escribas mas');
    expect(plano).not.toContain('elige lo que te interesa');
    expect(plano).not.toContain('esa consulta la responde mejor');
    expect(md).toContain('{{DIRECCION}}');
    expect(md).toContain('{{RECEPCION_LINK}}');
  });
  it('en el JSON armado el prompt no tiene teléfonos ni marcadores resueltos', () => {
    const flujo = JSON.stringify(PRODUCCION);
    expect(flujo).not.toMatch(/\d{10,}/);
    expect(flujo).not.toMatch(/wa\.me\/\d/);
  });
});

describe('ningún literal de 10 o más dígitos en lo que este flujo versiona', () => {
  const recorrer = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
    const r = join(dir, n);
    return statSync(r).isDirectory() ? recorrer(r) : [r];
  });
  const rutas = [
    ...recorrer(CARPETA).filter((r) => !/herramientas/.test(r)),
    ...recorrer(join(REPO, 'admin/scripts/datos/rroca-emma')),
    ...recorrer(join(REPO, 'admin/pruebas/tenants/rroca-emma')),
  ];
  it('ni en el código, ni en los datos, ni en las pruebas', () => {
    const malos = rutas.filter((r) => /\d{10,}/.test(readFileSync(r, 'utf8')) || /\b\d{3}0{6}/.test(readFileSync(r, 'utf8'))).map((r) => relative(REPO, r));
    expect(malos).toEqual([]);
  });
});

describe('cada $(\'…\') nombra un nodo que existe y es su antecesor', () => {
  it('producción y prueba', () => {
    expect(problemasDeReferencias(PRODUCCION)).toEqual([]);
    expect(problemasDeReferencias(PRUEBA)).toEqual([]);
  });
  it('una referencia a un nodo que no es antecesor se detecta', () => {
    const f = copia(PRODUCCION);
    const n = f.nodes.find((x) => x.name === 'Normalizar entrada')!;
    (n.parameters as Record<string, unknown>)['jsCode'] = `${String((n.parameters as Record<string, unknown>)['jsCode'])}\nconst x = $('Armar mensajes').first();`;
    expect((problemasDeReferencias(f) as string[]).join(' ')).toMatch(/NO es su antecesor/);
  });
});

describe('las copias declaradas son iguales a su fuente', () => {
  it('«Carga de entrada» es la misma de las doctoras, byte a byte', () => {
    expect(leer('Flujos/experimental/rroca-emma/src/nodos/carga-de-entrada.js')).toBe(leer('Flujos/experimental/doctoras/src/nodos/carga-de-entrada.js'));
  });
  it('«_comun.js» solo cambia la clave de la ficha y los comentarios', () => {
    const norm = (t: string): string => t.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n').replace(/sd\.doctoras/g, 'sd.emma');
    expect(norm(leer('Flujos/experimental/rroca-emma/src/nodos/_comun.js'))).toBe(norm(leer('Flujos/experimental/doctoras/src/nodos/_comun.js')));
  });
  const expr = (fuente: string, nombre: string): string => {
    const i = fuente.indexOf(`const ${nombre} = `);
    expect(i).toBeGreaterThanOrEqual(0);
    return fuente.slice(i + `const ${nombre} = `.length, fuente.indexOf('\n', i));
  };
  it('NIEGA_IA es la de Rubén (que es la de chat-novuchat)', () => {
    expect(expr(leer('Flujos/experimental/rroca-emma/src/lib/ev.js'), 'EV_NIEGA_IA')).toBe(expr(leer('Flujos/experimental/rroca-ruben/src/lib/rr.js'), 'RR_NIEGA_IA'));
  });
  it('la expresión de riesgo es la de las doctoras (que es la de Antonio)', () => {
    const cuerpo = (f: string, n: string): string => f.slice(f.indexOf(`const ${n} = new RegExp([`), f.indexOf('].join(\'|\'));', f.indexOf(`const ${n} = new RegExp([`)));
    expect(cuerpo(leer('Flujos/experimental/rroca-emma/src/lib/ev.js'), 'EV_RIESGO').replace('EV_RIESGO', 'X')).toBe(cuerpo(leer('Flujos/experimental/doctoras/src/lib/dr.js'), 'DR_RIESGO').replace('DR_RIESGO', 'X'));
  });
  it('los párrafos son los de Rubén (evOraciones/evParrafos = rrOraciones/rrParrafos)', () => {
    const f = (t: string, n: string): string => t.slice(t.indexOf(`function ${n}(`), t.indexOf('\n}\n', t.indexOf(`function ${n}(`)) + 3);
    const ev = leer('Flujos/experimental/rroca-emma/src/lib/ev.js');
    const rr = leer('Flujos/experimental/rroca-ruben/src/lib/rr.js');
    const igualar = (s: string): string => s.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n').replace(/\bev(Oraciones|EsPregunta|Parrafos)\b/g, 'x$1').replace(/\brr(Oraciones|EsPregunta|Parrafos)\b/g, 'x$1').replace(/EV_PARRAFO_MAX|RR_PARRAFO_MAX/g, 'MAX');
    for (const [a, b] of [['evOraciones', 'rrOraciones'], ['evParrafos', 'rrParrafos']] as const) expect(igualar(f(ev, a))).toBe(igualar(f(rr, b)));
  });
});
