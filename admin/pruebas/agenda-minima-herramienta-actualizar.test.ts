/**
 * `flujo-de-prueba.mjs --actualizar-codigo`: actualizar el CÓDIGO de un flujo B que YA está vivo.
 *
 * Se corre la herramienta de verdad, como un proceso, contra un n8n de MENTIRA (un servidor HTTP local que
 * imita GET, PUT y activate del flujo). Lo que se prueba es lo que NUNCA debe pasar al escribir en producción:
 *   - tocar otra cosa que `jsCode` (credenciales, configuración, conexiones, ajustes);
 *   - escribir en un flujo ajeno (otro cliente, un sistema de otro proyecto), o en uno que todavía no es B;
 *   - publicar un candidato con un Webhook de prueba;
 *   - dar por hecho algo que no se leyó de vuelta (versión activa, código, que el flujo siga activo).
 * Cada «NIEGA» comprueba además que NO hubo ningún PUT.
 */
import { execFile } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { entornoDelEmulador } from './core/entorno-del-hijo.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const CARPETA = join(aqui, '../../Flujos/experimental/agenda-minima');
const HERRAMIENTA = join(CARPETA, 'herramientas/flujo-de-prueba.mjs');
const CLAVE = 'clave-falsa-de-prueba-no-es-secreta';
const ejecutar = promisify(execFile);
const BELLIDO = 'NovuChat Bellido — Agendamiento (Pediatría)';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type J = Record<string, any>;
const candidato = (archivo = 'agenda-minima.v0.json'): J => JSON.parse(readFileSync(join(CARPETA, archivo), 'utf8')) as J;

/** El flujo «vivo» de un cliente: el candidato, con otro nombre, credenciales con id, y «Config base» llena. */
function vivoDe(nombre: string, cambios: (w: J) => void = () => undefined): J {
  const w = candidato();
  w.id = 'wf1'; w.name = nombre; w.active = true; w.versionId = 'v1'; w.activeVersionId = 'v1'; w.settings = { executionOrder: 'v1' };
  for (const n of w.nodes as J[]) if (n.credentials) for (const c of Object.values(n.credentials as J)) (c as J).id = 'cred-' + String(n.name).length;
  const base = (w.nodes as J[]).find((n) => n.name === 'Config base')!;
  for (const a of base.parameters.assignments.assignments as J[]) if (/^REEMPLAZAR_/.test(String(a.value))) a.value = 'lleno-' + a.name;
  // Dos nodos con el código VIEJO: eso es lo que la herramienta tiene que actualizar.
  for (const n of ['Candado', 'Armar mensajes']) ((w.nodes as J[]).find((x) => x.name === n)!).parameters.jsCode = '// codigo viejo de ' + n;
  cambios(w);
  return w;
}

// ---------------------------------------------------------------------------------- n8n de mentira
interface Mundo { flujo: J; puts: J[]; activaciones: number; cabeceras: string[]; activarAlGuardar: boolean; activarNoArregla: boolean; putFalla: boolean; guardaOtroCodigo: boolean; cambiaCredenciales: boolean }
let mundo: Mundo;
let servidor: Server;
let carpeta = '';

const leerCuerpo = (r: IncomingMessage): Promise<string> => new Promise((ok) => { let t = ''; r.on('data', (c) => { t += String(c); }); r.on('end', () => ok(t)); });

beforeAll(async () => {
  carpeta = mkdtempSync(join(tmpdir(), 'herramienta-actualizar-'));
  servidor = createServer((req, res) => {
    void (async () => {
      mundo.cabeceras.push(String(req.headers['x-n8n-api-key'] ?? ''));
      const cuerpo = await leerCuerpo(req);
      const enviar = (cod: number, datos: unknown): void => { res.writeHead(cod, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(datos)); };
      if (req.method === 'GET' && req.url === '/api/v1/workflows/wf1') return enviar(200, mundo.flujo);
      if (req.method === 'PUT' && req.url === '/api/v1/workflows/wf1') {
        if (mundo.putFalla) return enviar(500, { message: 'falló a propósito' });
        const b = JSON.parse(cuerpo) as J;
        mundo.puts.push(b);
        mundo.flujo = { ...mundo.flujo, name: b.name, nodes: b.nodes, connections: b.connections, settings: b.settings, versionId: 'v' + String(mundo.puts.length + 1) };
        // Un n8n que dice «200» pero guarda otra cosa: la herramienta tiene que LEER de vuelta y notarlo.
        if (mundo.cambiaCredenciales) ((mundo.flujo.nodes as J[]).find((n) => n.name === 'Leer agenda')!).credentials = { googleCalendarOAuth2Api: { id: 'otra', name: 'Otra credencial' } };
        if (mundo.guardaOtroCodigo) ((mundo.flujo.nodes as J[]).find((n) => n.name === 'Candado')!).parameters.jsCode = '// otro codigo';
        if (mundo.activarAlGuardar) mundo.flujo.activeVersionId = mundo.flujo.versionId;
        return enviar(200, mundo.flujo);
      }
      if (req.method === 'POST' && req.url === '/api/v1/workflows/wf1/activate') {
        mundo.activaciones++;
        mundo.flujo.active = true;
        if (!mundo.activarNoArregla) mundo.flujo.activeVersionId = mundo.flujo.versionId;
        return enviar(200, mundo.flujo);
      }
      return enviar(404, { message: 'no existe' });
    })();
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  const puerto = (servidor.address() as { port: number }).port;
  writeFileSync(join(carpeta, '.env.falso'), `N8N_BASE_URL=http://127.0.0.1:${puerto}\nN8N_API_KEY=${CLAVE}\nN8N_WORKFLOW_ID=wf1\n`);
  chmodSync(join(carpeta, '.env.falso'), 0o600);
});
afterAll(async () => { await new Promise<void>((ok) => servidor.close(() => ok())); rmSync(carpeta, { recursive: true, force: true }); });

const nuevo = (flujo: J, extra: Partial<Mundo> = {}): void => {
  mundo = { flujo, puts: [], activaciones: 0, cabeceras: [], activarAlGuardar: true, activarNoArregla: false, putFalla: false, guardaOtroCodigo: false, cambiaCredenciales: false, ...extra };
};
async function correr(...args: string[]): Promise<{ codigo: number; salida: string }> {
  try {
    const r = await ejecutar(process.execPath, [HERRAMIENTA, '--env', join(carpeta, '.env.falso'), '--actualizar-codigo', ...(args.includes('--exigir-commit') ? [] : ['--permitir-sin-commit']), ...args.filter((x) => x !== '--exigir-commit')], { env: entornoDelEmulador(undefined), encoding: 'utf8' });
    return { codigo: 0, salida: r.stdout + r.stderr };
  } catch (e) {
    const x = e as { code: number; stdout: string; stderr: string };
    return { codigo: x.code, salida: x.stdout + x.stderr };
  }
}
const nodo = (w: J, n: string): J => (w.nodes as J[]).find((x) => x.name === n)!;

describe('en seco', () => {
  it('lista los nodos Code con código distinto y NO escribe nada', async () => {
    nuevo(vivoDe(BELLIDO));
    const r = await correr();
    expect(r.codigo).toBe(0);
    expect(r.salida).toMatch(/Nodos Code con código distinto \(2\): (Armar mensajes, Candado|Candado, Armar mensajes)/);
    expect(r.salida).toMatch(/En seco: no se escribió nada/);
    expect(mundo.puts).toHaveLength(0);
  });
});

describe('con --aplicar', () => {
  it('escribe SOLO el código de esos dos nodos: lo demás del flujo vivo queda idéntico', async () => {
    const vivo = vivoDe(BELLIDO);
    const antes = JSON.parse(JSON.stringify(vivo)) as J;
    nuevo(vivo);
    const r = await correr('--aplicar');
    expect(r.codigo, r.salida).toBe(0);
    expect(mundo.puts).toHaveLength(1);
    const b = mundo.puts[0]!;
    const cand = candidato();
    for (const n of ['Candado', 'Armar mensajes']) expect(nodo(b, n).parameters.jsCode).toBe(nodo(cand, n).parameters.jsCode);
    // Todo lo demás es lo VIVO, sin tocar: credenciales con su id, Config base llena, conexiones y ajustes.
    for (const n of antes.nodes as J[]) {
      if (['Candado', 'Armar mensajes'].includes(n.name)) {
        expect({ ...nodo(b, n.name), parameters: { ...nodo(b, n.name).parameters, jsCode: 0 } }).toEqual({ ...n, parameters: { ...n.parameters, jsCode: 0 } });
        continue;
      }
      expect(nodo(b, n.name), n.name).toEqual(n);
    }
    expect(b.connections).toEqual(antes.connections);
    expect(b.settings).toEqual(antes.settings);
    expect(b.name).toBe(antes.name);
    expect(r.salida).toMatch(/activo=true, publicada=true; 2 nodos con el código nuevo/);
  });
  it('la clave de n8n va en la cabecera de cada llamada y NUNCA en la salida', async () => {
    nuevo(vivoDe(BELLIDO));
    const r = await correr('--aplicar');
    expect(mundo.cabeceras.length).toBeGreaterThanOrEqual(3);
    expect(mundo.cabeceras.every((c) => c === CLAVE)).toBe(true);
    expect(r.salida).not.toContain(CLAVE);
    expect(r.salida).not.toMatch(/cred-\d+|lleno-/);
  });
  it('funciona también en el Demo A', async () => {
    nuevo(vivoDe('NovuChat Demo A — Agendamiento (Belleza y Salud)'));
    expect((await correr('--aplicar')).codigo).toBe(0);
    expect(mundo.puts).toHaveLength(1);
  });
  it('si la versión ACTIVA no es la última después del PUT, la activa y lo comprueba', async () => {
    nuevo(vivoDe(BELLIDO), { activarAlGuardar: false });
    const r = await correr('--aplicar');
    expect(r.codigo, r.salida).toBe(0);
    expect(mundo.activaciones).toBe(1);
  });
  it('NIEGA: si activar no arregla la versión, falla y lo dice (no se da por publicado)', async () => {
    nuevo(vivoDe(BELLIDO), { activarAlGuardar: false, activarNoArregla: true });
    const r = await correr('--aplicar');
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/versión ACTIVA no es la que se acaba de escribir/);
  });
  it('NIEGA: si n8n responde 200 pero guarda otro código, la lectura de vuelta lo delata y NO se da por publicado', async () => {
    nuevo(vivoDe(BELLIDO), { guardaOtroCodigo: true });
    const r = await correr('--aplicar');
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/el código leído después del PUT no es el del candidato/);
    expect(r.salida).not.toMatch(/✓/);
  });
  it('NIEGA: un PUT que falla se informa y el mensaje no inventa éxito', async () => {
    nuevo(vivoDe(BELLIDO), { putFalla: true });
    const r = await correr('--aplicar');
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/PUT → 500/);
    expect(r.salida).not.toMatch(/✓/);
  });
});

describe('lo que la herramienta se niega a hacer (y no hay ningún PUT)', () => {
  const niega = async (flujo: J, patron: RegExp, ...args: string[]): Promise<void> => {
    nuevo(flujo);
    const r = await correr('--aplicar', ...args);
    expect(r.codigo, r.salida).toBe(1);
    expect(r.salida).toMatch(patron);
    expect(mundo.puts).toHaveLength(0);
  };
  it("un flujo ajeno: Platinum, Q'Taco, captación (la lista de sistemas ajenos de la herramienta es más larga)", async () => {
    for (const nombre of ['NovuChat — Clínica Platinum (Reservas)', "Q'Taco — Pedidos", 'NovuChat — Captación']) {
      await niega(vivoDe(nombre), /no es el de Bellido ni el del Demo A/);
    }
  });
  it('NIEGA: un nombre que menciona a Bellido o al Demo A PERO también a un cliente ajeno (la lista de ajenos manda)', async () => {
    for (const nombre of ['Clínica Platinum — copia de Bellido', "Q'Taco sobre el Demo A", 'Captación del Demo A']) {
      await niega(vivoDe(nombre), /no es el de Bellido ni el del Demo A/);
    }
  });
  it('un flujo que no es de Bellido ni del Demo A', async () => { await niega(vivoDe('Otro negocio'), /no es el de Bellido ni el del Demo A/); });
  it('un flujo que todavía NO es B: se usa --sobre-bellido', async () => {
    await niega(vivoDe(BELLIDO, (w) => { w.nodes = (w.nodes as J[]).filter((n) => n.name !== 'Candado'); }), /todavía no es un B/);
  });
  it('un candidato con un Webhook de prueba', async () => {
    nuevo(vivoDe(BELLIDO));
    const r = await correr('--aplicar', '--flujo', join(CARPETA, 'agenda-minima.prueba.json'));
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/Webhook de prueba/);
    expect(mundo.puts).toHaveLength(0);
  });
  it('nodos que no coinciden (uno de más o de menos)', async () => {
    await niega(vivoDe(BELLIDO, (w) => { (w.nodes as J[]).push({ id: 'zz', name: 'Nodo ajeno', type: 'n8n-nodes-base.noOp', typeVersion: 1, position: [0, 0], parameters: {} }); }), /los nodos no coinciden.*Nodo ajeno/);
  });
  it('un nodo de otro tipo o versión', async () => {
    await niega(vivoDe(BELLIDO, (w) => { nodo(w, 'Candado').typeVersion = 99; }), /Candado: tipo o versión/);
  });
  it('una diferencia de parámetros en un nodo Code que NO es jsCode', async () => {
    await niega(vivoDe(BELLIDO, (w) => { nodo(w, 'Candado').parameters.mode = 'runOnceForEachItem'; }), /Candado: parámetros distintos de jsCode/);
  });
  it('una diferencia de parámetros en un nodo que no es Code (la URL de envío)', async () => {
    await niega(vivoDe(BELLIDO, (w) => { nodo(w, 'Enviar a WhatsApp').parameters.url = '=https://otro.example/x'; }), /Enviar a WhatsApp: url/);
  });
  it('una diferencia en «Config base» que NO es un marcador llenado', async () => {
    await niega(vivoDe(BELLIDO, (w) => {
      const a = (nodo(w, 'Config base').parameters.assignments.assignments as J[]).find((x) => !/^REEMPLAZAR_/.test(String(x.value)) && String(x.value).length > 3)!;
      a.value = 'otro valor';
    }), /Config base: /);
  });
  it('un marcador que el vivo TODAVÍA tiene sin llenar tampoco pasa', async () => {
    await niega(vivoDe(BELLIDO, (w) => {
      const a = (nodo(w, 'Config base').parameters.assignments.assignments as J[]).find((x) => String(x.value).startsWith('lleno-'))!;
      a.value = '';
    }), /Config base: /);
  });
  it('las conexiones distintas', async () => {
    await niega(vivoDe(BELLIDO, (w) => { delete w.connections['Candado']; }), /las conexiones/);
  });
  it('nada que actualizar: el código vivo ya es el del candidato', async () => {
    await niega(vivoDe(BELLIDO, (w) => {
      const c = candidato();
      for (const n of ['Candado', 'Armar mensajes']) nodo(w, n).parameters.jsCode = nodo(c, n).parameters.jsCode;
    }), /nada que actualizar/);
  });
  it('un candidato que trae marcas @@ sin armar', async () => {
    nuevo(vivoDe(BELLIDO));
    const roto = candidato();
    nodo(roto, 'Candado').parameters.jsCode = '@@nodos/candado.js';
    // Dentro del repositorio (si no, se niega antes por ser un archivo de afuera); se borra siempre.
    const ruta = join(CARPETA, `candidato-roto-${String(Date.now())}.json`);
    writeFileSync(ruta, JSON.stringify(roto));
    try {
      const r = await correr('--aplicar', '--flujo', ruta);
      expect(r.codigo).toBe(1);
      expect(r.salida).toMatch(/el candidato no trae el código armado/);
      expect(mundo.puts).toHaveLength(0);
    } finally { rmSync(ruta, { force: true }); }
  });
});

describe('segunda ronda de la revisión de seguridad (#364): nombre, disparador, candidato versionado y modos', () => {
  const niega = async (flujo: J, patron: RegExp, ...args: string[]): Promise<void> => {
    nuevo(flujo);
    const r = await correr('--aplicar', ...args);
    expect(r.codigo, r.salida).toBe(1);
    expect(r.salida).toMatch(patron);
    expect(mundo.puts).toHaveLength(0);
  };
  it('NIEGA: un nombre que esquiva la lista con espacios, apóstrofos tipográficos o mayúsculas (se compara compacto)', async () => {
    for (const nombre of ['Bellido — WhatsApp Modular', 'Demo A — Seguro Lo Tengo', 'Bellido — Q’Taco', 'Bellido Q Taco', 'BELLIDO — PLATINUM', 'Demo A — Captación']) {
      await niega(vivoDe(nombre), /no es el de Bellido ni el del Demo A/);
    }
  });
  it('NIEGA: si la credencial del WhatsApp Trigger vivo es de un sistema ajeno, aunque el nombre del flujo sea el de Bellido (prohibición 7)', async () => {
    await niega(vivoDe(BELLIDO, (w) => {
      const t = (w.nodes as J[]).find((n) => /whatsAppTrigger/i.test(n.type))!;
      t.credentials = { whatsAppTriggerApi: { id: 'x', name: 'Credencial de otp (sistema ajeno)' } };
    }), /credencial del disparador vivo es de un sistema ajeno/);
  });
  it('NIEGA: un flujo vivo con DOS WhatsApp Trigger, o con ninguno', async () => {
    await niega(vivoDe(BELLIDO, (w) => {
      const t = (w.nodes as J[]).find((n) => /whatsAppTrigger/i.test(n.type))!;
      (w.nodes as J[]).push({ ...JSON.parse(JSON.stringify(t)) as J, id: 'otro', name: 'Otro disparador' });
    }), /tiene 2 WhatsApp Trigger/);
    await niega(vivoDe(BELLIDO, (w) => { w.nodes = (w.nodes as J[]).filter((n) => !/whatsAppTrigger/i.test(n.type)); }), /tiene 0 WhatsApp Trigger/);
  });
  it('NIEGA: un candidato FUERA del repositorio (un archivo cualquiera con el código que se quiera)', async () => {
    nuevo(vivoDe(BELLIDO));
    const ruta = join(carpeta, 'cualquiera.json');
    writeFileSync(ruta, JSON.stringify(candidato()));
    const r = await correr('--aplicar', '--flujo', ruta);
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/versionado DENTRO del repositorio/);
    expect(mundo.puts).toHaveLength(0);
  });
  it('NIEGA: un candidato dentro del repositorio pero SIN rastrear por git', async () => {
    nuevo(vivoDe(BELLIDO));
    const ruta = join(CARPETA, `candidato-sin-rastrear-${String(Date.now())}.json`);
    writeFileSync(ruta, JSON.stringify(candidato()));
    try {
      const r = await correr('--aplicar', '--exigir-commit', '--flujo', ruta);
      expect(r.codigo).toBe(1);
      expect(r.salida).toMatch(/no está rastreado por git/);
      expect(mundo.puts).toHaveLength(0);
    } finally { rmSync(ruta, { force: true }); }
  });
  it('el candidato por omisión, versionado y sin cambios, pasa SIN la bandera y se imprime su commit', async () => {
    const sucio = await ejecutar('git', ['-C', CARPETA, 'status', '--porcelain', '--', 'agenda-minima.v0.json'], { encoding: 'utf8', env: entornoDelEmulador(undefined) });
    if (sucio.stdout.trim() !== '') return; // el archivo tiene cambios locales sin confirmar: esta comprobación no aplica aquí
    nuevo(vivoDe(BELLIDO));
    const r = await correr('--exigir-commit');
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/commit [0-9a-f]{7,}/);
  });
  it('NIEGA: --actualizar-codigo no se combina con otro modo (antes, con --borrar, corría --borrar)', async () => {
    nuevo(vivoDe(BELLIDO));
    for (const otro of ['--borrar', '--sobre-bellido', '--sobre-demo-a', '--restaurar-respaldo']) {
      const r = await correr('--aplicar', otro);
      expect(r.codigo, otro).toBe(1);
      expect(r.salida, otro).toMatch(/no se combina con otro modo/);
    }
    expect(mundo.puts).toHaveLength(0);
  });
  it('NIEGA: --previa sin archivo (al final, o seguido de otra opción) NO se omite en silencio', async () => {
    nuevo(vivoDe(BELLIDO));
    for (const args of [['--aplicar', '--previa'], ['--previa', '--aplicar']]) {
      const r = await correr(...args);
      expect(r.codigo, args.join(' ')).toBe(1);
      expect(r.salida).toMatch(/--previa necesita un archivo/);
    }
    expect(mundo.puts).toHaveLength(0);
  });
  it('NIEGA: --previa a través de un enlace simbólico hacia el repositorio', async () => {
    nuevo(vivoDe(BELLIDO));
    const enlace = join(carpeta, 'enlace-al-repo');
    symlinkSync(CARPETA, enlace);
    const r = await correr('--aplicar', '--previa', join(enlace, 'previa-por-enlace.json'));
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/FUERA del repositorio/);
    expect(mundo.puts).toHaveLength(0);
  });
  it('NIEGA: si después del PUT las credenciales cambiaron, el mensaje NO dice «intactas» y avisa que se revise n8n', async () => {
    nuevo(vivoDe(BELLIDO), { cambiaCredenciales: true });
    const r = await correr('--aplicar');
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/las credenciales o las conexiones no coinciden con las de antes/);
    expect(r.salida).not.toMatch(/✓/);
  });
  it('el éxito afirma solo lo que leyó: código, credenciales y conexiones', async () => {
    nuevo(vivoDe(BELLIDO));
    const r = await correr('--aplicar');
    expect(r.salida).toMatch(/leído de vuelta\); credenciales y conexiones iguales a las de antes \(leídas de vuelta\)/);
    expect(r.salida).not.toMatch(/configuración/);
  });
});

describe('--previa: la copia del vivo antes de escribir (opcional)', () => {
  it('guarda el flujo vivo con permisos 600 y NO pisa una copia que ya existe', async () => {
    nuevo(vivoDe(BELLIDO));
    const previa = join(carpeta, 'previa.json');
    expect((await correr('--aplicar', '--previa', previa)).codigo).toBe(0);
    expect((statSync(previa).mode & 0o777)).toBe(0o600);
    expect((JSON.parse(readFileSync(previa, 'utf8')) as J).name).toMatch(/Bellido/);
    nuevo(vivoDe(BELLIDO));
    const r = await correr('--aplicar', '--previa', previa);
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/ya existe: no se pisa/);
    expect(mundo.puts).toHaveLength(0);
  });
  it('NIEGA: una copia DENTRO del repositorio (lleva ids del cliente)', async () => {
    nuevo(vivoDe(BELLIDO));
    const r = await correr('--aplicar', '--previa', join(CARPETA, 'previa-prohibida.json'));
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/FUERA del repositorio/);
    expect(mundo.puts).toHaveLength(0);
  });
});
