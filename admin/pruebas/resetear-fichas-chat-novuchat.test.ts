/**
 * EL RESETEO DE LAS FICHAS DE PRUEBA DEL CHAT DE CAPTACIÓN (`scripts/resetear-fichas-chat-novuchat.py`).
 *
 * El script escribe en el estado de un flujo VIVO (`staticData` por PUT): su riesgo es borrar la ficha de un prospecto. Por eso la suite lo corre de verdad contra un n8n
 * SIMULADO (un servidor HTTP local, sin red ni credenciales) y prueba sobre todo lo que NO debe hacer: no escribe en seco, no toca una ficha que no termine en uno de los
 * sufijos, rechaza más de 3 sufijos o repetidos, y se niega a borrar cuando un sufijo es ambiguo.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const aqui = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(aqui, '../../scripts/resetear-fichas-chat-novuchat.py');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type J = Record<string, any>;
const PRUEBA = ['12345678', '23456789', '34567890'];
const PROSPECTO = '45678901';
const ficha = (s: string) => `t-${s}`;

let servidor: Server;
let url = '';
let vivo: J = {};
let puts: J[] = [];
// Simula una conversación que escribe su ficha entre la lectura y la escritura: en el GET número `n` el estado ya cambió.
let cambiaEnElGet = 0;
let gets = 0;
const carpetas: string[] = [];

function leer(req: IncomingMessage): Promise<string> {
  return new Promise((ok) => {
    let c = '';
    req.on('data', (d) => (c += d));
    req.on('end', () => ok(c));
  });
}

beforeAll(async () => {
  servidor = createServer(async (req, res) => {
    if (req.method === 'PUT') {
      const cuerpo = JSON.parse(await leer(req)) as J;
      puts.push(cuerpo);
      vivo = { ...vivo, staticData: cuerpo.staticData };
    }
    if (req.method === 'GET') {
      gets += 1;
      if (cambiaEnElGet && gets === cambiaEnElGet) vivo = { ...vivo, staticData: { global: { chatNovuchat: { ...vivo.staticData.global.chatNovuchat, 'nueva-ficha': { a: 9 } } } } };
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(vivo));
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});
afterAll(() => {
  servidor.close();
  for (const c of carpetas) rmSync(c, { recursive: true, force: true });
});
afterEach(() => {
  puts = [];
  cambiaEnElGet = 0;
  gets = 0;
});

function flujo(mapa: J | null): J {
  return {
    name: 'Chat NovuChat v2',
    active: true,
    nodes: [{ name: 'Nodo' }],
    connections: {},
    settings: {},
    staticData: mapa === null ? {} : { global: { chatNovuchat: mapa, otraCosa: 1 } },
  };
}
const mapaCompleto = (): J => ({ [ficha(PRUEBA[0]!)]: { a: 1 }, [ficha(PRUEBA[1]!)]: { a: 2 }, [ficha(PRUEBA[2]!)]: { a: 3 }, [ficha(PROSPECTO)]: { prospecto: true } });

function correr(args: string[], conRespaldo = true): Promise<{ codigo: number; salida: string }> {
  const carpeta = mkdtempSync(join(tmpdir(), 'reset-fichas-'));
  carpetas.push(carpeta);
  return new Promise((ok) => {
    const p = spawn('python3', ['-I', SCRIPT, ...args, ...(conRespaldo ? ['--respaldo', carpeta] : [])], {
      env: { PATH: process.env.PATH ?? '', N8N_BASE_URL: url, N8N_API_KEY: 'clave-de-prueba', N8N_WORKFLOW_ID: 'W1' },
    });
    let salida = '';
    p.stdout.on('data', (d) => (salida += d));
    p.stderr.on('data', (d) => (salida += d));
    p.on('close', (c) => ok({ codigo: c ?? -1, salida: `${salida}\n#${carpeta}` }));
  });
}
const carpetaDe = (salida: string) => salida.split('\n#').pop()!;

describe('resetear-fichas-chat-novuchat.py', () => {
  it('en seco (sin --aplicar) no escribe nada y avisa', async () => {
    vivo = flujo(mapaCompleto());
    const r = await correr(['--sufijos', PRUEBA.join(',')]);
    expect(r.codigo).toBe(0);
    expect(puts).toHaveLength(0);
    expect(r.salida).toContain('Seco: no se escribio nada');
    expect(readdirSync(carpetaDe(r.salida))).toHaveLength(0);
  });

  it('con --aplicar borra SOLO las 3 de prueba, conserva al prospecto y el resto del estado, y respalda con modo 600', async () => {
    vivo = flujo(mapaCompleto());
    const r = await correr(['--sufijos', PRUEBA.join(','), '--aplicar']);
    expect(r.codigo).toBe(0);
    expect(puts).toHaveLength(1);
    const enviado = puts[0]!.staticData.global;
    expect(Object.keys(enviado.chatNovuchat)).toEqual([ficha(PROSPECTO)]);
    expect(enviado.otraCosa).toBe(1);
    expect(puts[0]!.nodes).toEqual([{ name: 'Nodo' }]);
    const archivos = readdirSync(carpetaDe(r.salida));
    expect(archivos).toHaveLength(1);
    expect(statSync(join(carpetaDe(r.salida), archivos[0]!)).mode & 0o777).toBe(0o600);
  });

  it('no imprime el teléfono completo de ninguna ficha ni la clave de la API', async () => {
    vivo = flujo(mapaCompleto());
    const r = await correr(['--sufijos', PRUEBA.join(','), '--aplicar']);
    for (const s of [...PRUEBA, PROSPECTO]) expect(r.salida).not.toContain(s);
    expect(r.salida).not.toContain('clave-de-prueba');
  });

  it('NEGACIÓN: una ficha que no termina en los sufijos dados no se toca (solo se resetea una)', async () => {
    vivo = flujo(mapaCompleto());
    await correr(['--sufijos', PRUEBA[0]!, '--aplicar']);
    expect(Object.keys(puts[0]!.staticData.global.chatNovuchat).sort()).toEqual([ficha(PRUEBA[1]!), ficha(PRUEBA[2]!), ficha(PROSPECTO)].sort());
  });

  it('NEGACIÓN: rechaza un cuarto sufijo (casi seguro un prospecto) sin llamar a n8n', async () => {
    vivo = flujo(mapaCompleto());
    const r = await correr(['--sufijos', [...PRUEBA, PROSPECTO].join(','), '--aplicar']);
    expect(r.codigo).not.toBe(0);
    expect(r.salida).toContain('como maximo 3');
    expect(puts).toHaveLength(0);
  });

  it('NEGACIÓN: rechaza sufijos repetidos, sin sufijos y sufijos que no son 8 dígitos', async () => {
    vivo = flujo(mapaCompleto());
    const casos: [string[], string][] = [
      [['--sufijos', `${PRUEBA[0]},${PRUEBA[0]}`], 'como maximo 3'],
      [[], 'Falta --sufijos'],
      [['--sufijos', '1234'], 'Falta --sufijos'],
      [['--sufijos', 'abcdefgh'], 'Falta --sufijos'],
    ];
    for (const [args, mensaje] of casos) {
      const r = await correr([...args, '--aplicar']);
      expect(r.codigo).not.toBe(0);
      expect(r.salida).toContain(mensaje);
    }
    expect(puts).toHaveLength(0);
  });

  it('NEGACIÓN: un sufijo que coincide con dos fichas es ambiguo y no se borra nada', async () => {
    vivo = flujo({ ...mapaCompleto(), [`otro-${PRUEBA[0]}`]: { prospecto: true } });
    const r = await correr(['--sufijos', PRUEBA[0]!, '--aplicar']);
    expect(r.codigo).not.toBe(0);
    expect(r.salida).toContain('ambiguo');
    expect(puts).toHaveLength(0);
  });

  it('NEGACIÓN: sin staticData.global.chatNovuchat no toca nada', async () => {
    vivo = flujo(null);
    const r = await correr(['--sufijos', PRUEBA.join(','), '--aplicar']);
    expect(r.codigo).not.toBe(0);
    expect(r.salida).toContain('No hay staticData');
    expect(puts).toHaveLength(0);
  });

  it('NEGACIÓN: --aplicar sin --respaldo se rechaza (no escribe el respaldo en el directorio actual)', async () => {
    vivo = flujo(mapaCompleto());
    const r = await correr(['--sufijos', PRUEBA.join(','), '--aplicar'], false);
    expect(r.codigo).not.toBe(0);
    expect(r.salida).toContain('exige --respaldo');
    expect(puts).toHaveLength(0);
  });

  it('NEGACIÓN: si el flujo cambia entre la lectura y la escritura no escribe nada', async () => {
    vivo = flujo(mapaCompleto());
    cambiaEnElGet = 2; // el 1.º GET es la lectura; el 2.º, justo antes del PUT, ya trae una ficha nueva
    const r = await correr(['--sufijos', PRUEBA.join(','), '--aplicar']);
    expect(r.codigo).not.toBe(0);
    expect(r.salida).toContain('cambio entre la lectura y la escritura');
    expect(puts).toHaveLength(0);
    expect(readdirSync(carpetaDe(r.salida))).toHaveLength(0);
  });

  it('el respaldo es exactamente el estado leído antes de escribir', async () => {
    vivo = flujo(mapaCompleto());
    const antes = structuredClone(vivo.staticData);
    const r = await correr(['--sufijos', PRUEBA.join(','), '--aplicar']);
    const archivo = readdirSync(carpetaDe(r.salida))[0]!;
    expect(JSON.parse(readFileSync(join(carpetaDe(r.salida), archivo), 'utf8'))).toEqual(antes);
  });
});
