/**
 * `scripts/cargar-timbre-n8n.sh`: carga en n8n, por la API, la credencial del timbre y el
 * flujo «Salida de persona» de UN alias, seco por omisión.
 *
 * Se prueba NEGANDO, con un `curl` FALSO adelante en el PATH que hace de n8n: guarda el
 * estado (credenciales y flujos) en archivos, anota cada llamada SIN cuerpo ni clave, y
 * se parece a la API pública en lo que importa (401 si la clave no es la esperada, 400 si
 * el cuerpo del flujo trae claves de más, como `active`). Sin red ni n8n real.
 *
 * Lo que cada grupo cierra:
 *  - mal uso y mal entorno: ni una llamada;
 *  - el seco SOLO lee (GET) y no toca la entrega;
 *  - nada de lo secreto (clave del timbre, path, phoneNumberId, URL del relé, clave de la API)
 *    sale por pantalla;
 *  - marcadores sin reponer, credenciales faltantes o repetidas, o de otro tipo: se aborta
 *    SIN escribir; las de envío nunca llevan la de ingesta (aunque el JSON lo pidiera);
 *  - la entrega se borra solo si todo salió bien;
 *  - --activar es un paso aparte, y --quitar revierte solo lo del timbre del alias.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, closeSync, fstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { entornoDelEmulador } from './entorno-del-hijo.ts';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..', '..', '..');
const SCRIPT = join(RAIZ, 'scripts', 'cargar-timbre-n8n.sh');
const FLUJO_REAL = join(RAIZ, 'Flujos', 'salida-de-persona.json');

const BASE = 'https://n8n.ejemplo.test';
const API_KEY = 'apikey-de-prueba-abc';
// Valores de prueba con la forma de los reales (no existen). Menos de 10 dígitos seguidos.
const PATH = 'Zk3vQ8mT1xW9aB4cD7eF2gH5';
const CLAVE = 'Kq7Lm2Nb5Vc8Xz1Aw4Er6Ty9Ui3Op0';
const PHONE = '987654321';
const RELE = 'http://rele-interno.ejemplo.test:8080';
const ALIAS = 'demoa';
const SECRETOS = [PATH, CLAVE, PHONE, 'rele-interno', API_KEY];

const CURL_FALSO = `#!/usr/bin/env python3
import json, os, sys
E = os.environ["FAKE_DIR"]
a = sys.argv[1:]
con_valor = {"-o", "-w", "-X", "-H", "--data-binary", "--max-time", "--proto"}
metodo, salida, cabeza, cuerpo_f, url = "GET", None, None, None, None
i = 0
while i < len(a):
    x = a[i]
    if x in con_valor:
        v = a[i + 1]
        if x == "-o": salida = v
        elif x == "-X": metodo = v
        elif x == "-H" and v == "@-": cabeza = sys.stdin.read().strip()
        elif x == "--data-binary": cuerpo_f = v[1:]
        i += 2
    else:
        if x.startswith("https://"): url = x
        i += 1
def leer(n, por_omision):
    try: return json.load(open(os.path.join(E, n)))
    except Exception: return por_omision
def guardar(n, d): json.dump(d, open(os.path.join(E, n), "w"))
ruta = url.split("/api/v1", 1)[1]
limpia = ruta.split("?")[0]
open(os.path.join(E, "llamadas"), "a").write(metodo + " " + limpia + "\\n")
def sin_versiones(x):
    if isinstance(x, dict): return {k: sin_versiones(v) for k, v in x.items() if k not in ("versionId", "activeVersionId")}
    if isinstance(x, list): return [sin_versiones(i) for i in x]
    return x
def responder(codigo, cuerpo=None):
    if cuerpo is not None and os.path.exists(os.path.join(E, "sin-versiones")): cuerpo = sin_versiones(cuerpo)
    if salida: open(salida, "w").write(json.dumps(cuerpo if cuerpo is not None else {}))
    print(codigo); sys.exit(0)
if cabeza != "X-N8N-API-KEY: " + os.environ["FAKE_API_KEY"]: responder(401, {"message": "unauthorized"})
partes = [p for p in limpia.split("/") if p]
if os.path.exists(os.path.join(E, "falla-" + metodo + "-" + partes[0])): responder(500, {"message": "falla"})
cuerpo = json.load(open(cuerpo_f)) if cuerpo_f else None
cred, wf = leer("creds.json", []), leer("wfs.json", [])
def n(): return len(cred) + len(wf) + 1 + int(leer("contador.json", 0))
if partes[0] == "credentials":
    if metodo == "GET": responder(200, {"data": [{k: v for k, v in c.items() if k != "_data"} for c in cred]})
    if metodo == "POST":
        nuevo = {"id": "c%d" % n(), "name": cuerpo["name"], "type": cuerpo["type"], "_data": cuerpo["data"]}
        cred.append(nuevo); guardar("creds.json", cred); guardar("contador.json", n())
        responder(200, {"id": nuevo["id"], "name": nuevo["name"], "type": nuevo["type"]})
    c = next((x for x in cred if x["id"] == partes[1]), None)
    if c is None: responder(404)
    if metodo == "PATCH": c["_data"] = cuerpo["data"]; guardar("creds.json", cred); responder(200, {"id": c["id"]})
    if metodo == "DELETE": cred.remove(c); guardar("creds.json", cred); responder(200, {"id": c["id"]})
if partes[0] == "workflows":
    if len(partes) == 1 and metodo == "GET": responder(200, {"data": wf})
    if len(partes) == 1 and metodo == "POST":
        if set(cuerpo) - {"name", "nodes", "connections", "settings"}: responder(400, {"message": "additional properties"})
        nuevo = dict(cuerpo, id="w%d" % n(), active=False, versionId="ver%d" % n(), activeVersionId=None); wf.append(nuevo); guardar("wfs.json", wf); guardar("contador.json", n())
        responder(200, nuevo)
    w = next((x for x in wf if x["id"] == partes[1]), None)
    if w is None: responder(404)
    if len(partes) == 2 and metodo == "GET": responder(200, w)
    if len(partes) == 2 and metodo == "PUT":
        if set(cuerpo) - {"name", "nodes", "connections", "settings"}: responder(400, {"message": "additional properties"})
        # n8n 2.x: borrador y publicada se separan; el PUT de un flujo activo NO publica la nueva versión
        w.update(cuerpo)
        if os.path.exists(os.path.join(E, "corrompe-borrador")):
            for x in w["nodes"]:
                if x["name"] == "Enviar por Graph": x.pop("credentials", None)
        w["versionId"] = "ver%d" % (n() + 100); guardar("contador.json", n())
        if w.get("active") and os.path.exists(os.path.join(E, "publica-al-guardar")): w["activeVersionId"] = w["versionId"]
        guardar("wfs.json", wf); responder(200, w)
    if len(partes) == 2 and metodo == "DELETE": wf.remove(w); guardar("wfs.json", wf); responder(200, w)
    if len(partes) == 3 and metodo == "POST":
        w["active"] = partes[2] == "activate"
        if w["active"] and not os.path.exists(os.path.join(E, "activar-no-arregla")): w["activeVersionId"] = w["versionId"]
        if not w["active"]: w["activeVersionId"] = None
        guardar("wfs.json", wf); responder(200, w)
responder(404)
`;

let dir: string;
let bin: string;
let runtime: string;
let envFile: string;
let tablaMd: string;

/** Sin comprobar-y-luego-usar (js/file-system-race): una sola operación con try/catch. */
const leerTxt = (ruta: string): string => {
  try { return readFileSync(ruta, 'utf8'); } catch { return ''; }
};
const existe = (ruta: string): boolean => {
  try { closeSync(openSync(ruta, 'r')); return true; } catch { return false; }
};
const modoDe = (ruta: string): number => {
  const fd = openSync(ruta, 'r');
  try { return fstatSync(fd).mode & 0o777; } finally { closeSync(fd); }
};
const estado = <T,>(n: string, def: T): T => {
  try { return JSON.parse(leerTxt(join(dir, n))) as T; } catch { return def; }
};
type Cred = { id: string; name: string; type: string; _data?: { name: string; value: string } };
type Nodo = { name: string; type: string; parameters: Record<string, unknown>; credentials?: Record<string, { id: string; name: string }> };
type Flujo = { id: string; name: string; active: boolean; versionId?: string; activeVersionId?: string | null; nodes: Nodo[]; connections: unknown; settings: unknown };
const creds = () => estado<Cred[]>('creds.json', []);
const flujos = () => estado<Flujo[]>('wfs.json', []);
const llamadas = () => leerTxt(join(dir, 'llamadas')).split('\n').filter(Boolean);
const escrituras = () => llamadas().filter((l) => !l.startsWith('GET '));
const entregaRuta = () => join(runtime, `novuchat-salida-persona-${ALIAS}.json`);

function instancia(extra: Cred[] = []) {
  writeFileSync(join(dir, 'creds.json'), JSON.stringify([
    { id: 'i1', name: `NovuChat ingesta (${ALIAS})`, type: 'httpHeaderAuth' },
    { id: 'r1', name: `AAB1 envío · ${ALIAS}`, type: 'httpHeaderAuth' },
    { id: 'g1', name: `WhatsApp ${ALIAS} (envío)`, type: 'whatsAppApi' },
    { id: 'o1', name: 'NovuChat ingesta (otro)', type: 'httpHeaderAuth' },
    ...extra,
  ]));
  writeFileSync(join(dir, 'wfs.json'), '[]');
}
function entrega(extra: Record<string, unknown> = {}, modo = 0o600) {
  writeFileSync(entregaRuta(), JSON.stringify({
    alias: ALIAS, ruta: `${BASE}/webhook/${PATH}`, path: PATH, clave: CLAVE, como_usar: 'x', ...extra,
  }), { mode: modo });
  chmodSync(entregaRuta(), modo);
}
function tabla(filas: Record<string, string> = {
  [`REEMPLAZAR_PHONE_NUMBER_ID_${ALIAS.toUpperCase()}`]: PHONE,
  [`REEMPLAZAR_URL_INTERNA_DEL_RELE_${ALIAS.toUpperCase()}`]: RELE,
}) {
  writeFileSync(tablaMd, '| Marcador | Valor |\n|---|---|\n' + Object.entries(filas).map(([k, v]) => `| \`${k}\` | ${v} |`).join('\n') + '\n');
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cargar-timbre-'));
  bin = join(dir, 'bin');
  runtime = join(dir, 'run');
  envFile = join(dir, 'env');
  tablaMd = join(dir, 'tabla.md');
  mkdirSync(bin); mkdirSync(join(dir, 'tmp')); mkdirSync(runtime, { mode: 0o700 });
  chmodSync(runtime, 0o700);
  writeFileSync(join(bin, 'curl'), CURL_FALSO);
  chmodSync(join(bin, 'curl'), 0o755);
  writeFileSync(envFile, `N8N_BASE_URL=${BASE}\nN8N_API_KEY=${API_KEY}\n`, { mode: 0o600 });
  chmodSync(envFile, 0o600);
  instancia();
  entrega();
  tabla();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function correr(args: string[], vars: Record<string, string> = {}) {
  const r = spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: entornoDelEmulador(undefined, {
      PATH: `${bin}:/usr/bin:/bin`,
      FAKE_DIR: dir,
      FAKE_API_KEY: API_KEY,
      XDG_RUNTIME_DIR: runtime,
      TMPDIR: join(dir, 'tmp'),
      CONFIG_LOCAL_MD: tablaMd,
      ...vars,
    }),
  });
  const salida = `${r.stdout}${r.stderr}`;
  for (const s of SECRETOS) expect(salida).not.toContain(s);
  for (const c of creds()) expect(salida).not.toContain(c.id + ' ');
  return { codigo: r.status, salida };
}
const base = ['--alias', ALIAS, '--env'];
const A = () => [...base, envFile];
const APLICAR = ['--aplicar', '--confirmo', 'produccion'];

describe('cargar-timbre-n8n.sh: uso y salvaguardas (ni una llamada a n8n)', () => {
  it('--help explica los modos y sale 0', () => {
    const r = correr(['--help']);
    expect(r.codigo).toBe(0);
    for (const t of ['--alias', '--aplicar', '--confirmo', '--activar', '--quitar', 'A VERIFICAR EN EL ENSAYO']) expect(r.salida).toContain(t);
    expect(llamadas()).toEqual([]);
  });

  it.each([
    ['sin alias', ['--env', 'x']],
    ['alias con caracteres raros', ['--alias', 'a1;rm', '--env', 'x']],
    ['alias demasiado corto', ['--alias', 'a', '--env', 'x']],
    ['una opción desconocida', ['--alias', ALIAS, '--todo']],
    ['dos modos a la vez', ['--alias', ALIAS, '--activar', '--quitar']],
    ['--aplicar sin --confirmo', ['--alias', ALIAS, '--aplicar']],
    ['--confirmo de otro entorno', ['--alias', ALIAS, '--aplicar', '--confirmo', 'staging']],
    ['--quitar --aplicar sin --confirmo', ['--alias', ALIAS, '--quitar', '--aplicar']],
    ['--activar --aplicar sin --confirmo', ['--alias', ALIAS, '--activar', '--aplicar']],
    ['--env inexistente', ['--alias', ALIAS, '--env', '/no/existe']],
  ])('%s: sale 2 sin llamar a n8n', (_n, args) => {
    const r = correr(args);
    expect(r.codigo).toBe(2);
    expect(llamadas()).toEqual([]);
  });

  it.each([
    ['con http', 'http://n8n.ejemplo.test'],
    ['con ruta', 'https://n8n.ejemplo.test/webhook'],
    ['con barra final', 'https://n8n.ejemplo.test/'],
    ['con usuario', ['https://u:p', 'n8n.ejemplo.test'].join('@')],
    ['vacía', ''],
  ])('N8N_BASE_URL %s: sale 2', (_n, url) => {
    writeFileSync(envFile, `N8N_BASE_URL=${url}\nN8N_API_KEY=${API_KEY}\n`, { mode: 0o600 });
    expect(correr(A()).codigo).toBe(2);
    expect(llamadas()).toEqual([]);
  });

  it('sin N8N_API_KEY: sale 2', () => {
    writeFileSync(envFile, `N8N_BASE_URL=${BASE}\n`, { mode: 0o600 });
    expect(correr(A()).codigo).toBe(2);
    expect(llamadas()).toEqual([]);
  });

  it('--aplicar con el --env legible por otros (modo 644): se niega (2)', () => {
    chmodSync(envFile, 0o644);
    expect(correr([...A(), ...APLICAR]).codigo).toBe(2);
    expect(llamadas()).toEqual([]);
  });

  it('la clave de la API equivocada: 401, sale 3 y no escribe', () => {
    const r = correr(A(), { FAKE_API_KEY: 'otra-clave' });
    expect(r.codigo).toBe(3);
    expect(r.salida).toContain('401');
    expect(escrituras()).toEqual([]);
  });
});

describe('cargar-timbre-n8n.sh: el seco solo lee', () => {
  it('con todo en orden sale 1 (pendiente), solo hace GET, no toca la entrega y no imprime valores', () => {
    const r = correr(A());
    expect(r.codigo).toBe(1);
    expect(r.salida).toContain('seco');
    expect(r.salida).toContain('(haría)');
    expect(escrituras()).toEqual([]);
    expect(llamadas().length).toBeGreaterThan(0);
    expect(existe(entregaRuta())).toBe(true);
    expect(creds()).toHaveLength(4);
    expect(flujos()).toEqual([]);
    // el seco no deja nada en el directorio de ejecución más que la entrega
    expect(readdirSync(runtime)).toEqual([`novuchat-salida-persona-${ALIAS}.json`]);
  });

  it('sin archivo de entrega: sale 3, sin escribir', () => {
    rmSync(entregaRuta());
    const r = correr(A());
    expect(r.codigo).toBe(2);
    expect(escrituras()).toEqual([]);
  });

  it('entrega con permisos de más (644): se niega y no escribe', () => {
    entrega({}, 0o644);
    expect(correr([...A(), ...APLICAR]).codigo).toBe(2);
    expect(escrituras()).toEqual([]);
    expect(existe(entregaRuta())).toBe(true);
  });

  it('entrega de otro alias o de otra instancia de n8n: se niega', () => {
    entrega({ alias: 'otro' });
    expect(correr([...A(), ...APLICAR]).codigo).toBe(2);
    entrega({ ruta: `https://otra.ejemplo.test/webhook/${PATH}` });
    expect(correr([...A(), ...APLICAR]).codigo).toBe(2);
    expect(escrituras()).toEqual([]);
  });

  it('sin XDG_RUNTIME_DIR válido: sale 2 sin escribir', () => {
    const r = correr(A(), { XDG_RUNTIME_DIR: join(dir, 'no-existe') });
    expect(r.codigo).toBe(2);
    expect(escrituras()).toEqual([]);
  });
});

describe('cargar-timbre-n8n.sh: cargar --aplicar', () => {
  it('crea la credencial y el flujo INACTIVO, por nombre, sin imprimir valores, y borra la entrega', () => {
    const r = correr([...A(), ...APLICAR]);
    expect(r.codigo).toBe(0);
    // la credencial del timbre: Header Auth, Authorization: Bearer <clave>
    const t = creds().find((c) => c.name === `Salida de persona (timbre ${ALIAS})`);
    expect(t?.type).toBe('httpHeaderAuth');
    expect(t?._data).toEqual({ name: 'Authorization', value: `Bearer ${CLAVE}` });
    // el flujo: uno, inactivo, con los valores repuestos
    const f = flujos();
    expect(f).toHaveLength(1);
    expect(f[0].name).toBe(`NovuChat — Salida de persona (${ALIAS})`);
    expect(f[0].active).toBe(false);
    const texto = JSON.stringify(f[0]);
    expect(texto).not.toContain('REEMPLAZAR_');
    const porNombre = (n: string) => f[0].nodes.find((x) => x.name === n)!;
    expect(porNombre('Timbre').parameters.path).toBe(PATH);
    expect(texto).toContain(PHONE);
    expect(texto).toContain(RELE);
    // las notas nunca llevan la ruta
    for (const nodo of f[0].nodes) expect(JSON.stringify((nodo as unknown as Record<string, unknown>).notes ?? '')).not.toContain(PATH);
    // credenciales por nombre y tipo, y ninguna de envío con la de ingesta
    const ing = creds().find((c) => c.name === `NovuChat ingesta (${ALIAS})`)!;
    expect(porNombre('Reclamar').credentials?.httpHeaderAuth).toEqual({ id: ing.id, name: ing.name });
    expect(porNombre('Confirmar').credentials?.httpHeaderAuth).toEqual({ id: ing.id, name: ing.name });
    expect(porNombre('Enviar por el relé').credentials?.httpHeaderAuth).toEqual({ id: 'r1', name: `AAB1 envío · ${ALIAS}` });
    expect(porNombre('Enviar por Graph').credentials?.whatsAppApi).toEqual({ id: 'g1', name: `WhatsApp ${ALIAS} (envío)` });
    expect(porNombre('Timbre').credentials?.httpHeaderAuth).toEqual({ id: t!.id, name: t!.name });
    for (const n of ['Enviar por el relé', 'Enviar por Graph']) {
      expect(JSON.stringify(porNombre(n).credentials)).not.toContain('ingesta');
      expect(JSON.stringify(porNombre(n).credentials)).not.toContain(ing.id + '"');
    }
    expect(f[0].nodes.some((x) => x.type.toLowerCase().includes('whatsapptrigger'))).toBe(false);
    // nada de otro alias se tocó, y la entrega se destruyó
    expect(creds().find((c) => c.id === 'o1')?.name).toBe('NovuChat ingesta (otro)');
    expect(existe(entregaRuta())).toBe(false);
    // el respaldo previo: directorio 700, archivo 600, solo el respaldo queda
    const m = /respaldo previo[^:]*: (\S+respaldo-vivo\.json)/.exec(r.salida);
    expect(m).not.toBeNull();
    expect(modoDe(m![1])).toBe(0o600);
    expect(modoDe(dirname(m![1]))).toBe(0o700);
    expect(readdirSync(dirname(m![1]))).toEqual(['respaldo-vivo.json']);
    expect(leerTxt(m![1])).not.toContain(CLAVE);
  });

  it('no usa nunca un método de escritura sobre credenciales ajenas', () => {
    correr([...A(), ...APLICAR]);
    for (const l of escrituras()) expect(l).not.toMatch(/credentials\/(i1|r1|g1|o1)/);
  });

  it('el cuerpo del flujo es solo name, nodes, connections y settings (sin active)', () => {
    expect(correr([...A(), ...APLICAR]).codigo).toBe(0);
    expect(flujos()).toHaveLength(1);
  });

  it('repetir (nueva entrega): ACTUALIZA, no duplica, y conserva el estado activo', () => {
    expect(correr([...A(), ...APLICAR]).codigo).toBe(0);
    const f = flujos(); f[0].active = true; f[0].activeVersionId = f[0].versionId; writeFileSync(join(dir, 'wfs.json'), JSON.stringify(f));
    entrega({ clave: 'Nu3va0Clave7Xy2Zw5Vu8Ts1Rq4', });
    const r = correr([...A(), ...APLICAR], {});
    expect(r.codigo).toBe(0);
    expect(creds().filter((c) => c.name.startsWith('Salida de persona (timbre'))).toHaveLength(1);
    expect(flujos()).toHaveLength(1);
    expect(flujos()[0].active).toBe(true);
    // el PUT dejó la publicada atrás: el script la publicó y lo comprobó
    expect(flujos()[0].activeVersionId).toBe(flujos()[0].versionId);
    expect(llamadas().some((l) => /^POST \/workflows\/\S+\/activate$/.test(l))).toBe(true);
    expect(llamadas().some((l) => l.startsWith('PATCH /credentials/'))).toBe(true);
    expect(llamadas().some((l) => l.startsWith('PUT /workflows/'))).toBe(true);
    expect(creds().find((c) => c.name.startsWith('Salida de persona (timbre'))?._data?.value).toBe('Bearer Nu3va0Clave7Xy2Zw5Vu8Ts1Rq4');
  });
});

describe('cargar-timbre-n8n.sh: abortos sin escribir (la entrega se conserva)', () => {
  const sinEscribir = (codigo: number | null) => {
    expect(codigo).toBe(2);
    expect(escrituras()).toEqual([]);
    expect(existe(entregaRuta())).toBe(true);
  };

  it('la tabla no tiene la fila del relé', () => {
    tabla({ [`REEMPLAZAR_PHONE_NUMBER_ID_${ALIAS.toUpperCase()}`]: PHONE });
    const r = correr([...A(), ...APLICAR]);
    sinEscribir(r.codigo);
    expect(r.salida).toContain('REEMPLAZAR_URL_INTERNA_DEL_RELE_DEMOA');
  });

  it('la fila de la tabla dice «pendiente»', () => {
    tabla({ [`REEMPLAZAR_PHONE_NUMBER_ID_${ALIAS.toUpperCase()}`]: 'pendiente', [`REEMPLAZAR_URL_INTERNA_DEL_RELE_${ALIAS.toUpperCase()}`]: RELE });
    sinEscribir(correr([...A(), ...APLICAR]).codigo);
  });

  it('phoneNumberId con forma inválida o URL del relé con usuario', () => {
    tabla({ [`REEMPLAZAR_PHONE_NUMBER_ID_${ALIAS.toUpperCase()}`]: '12ab', [`REEMPLAZAR_URL_INTERNA_DEL_RELE_${ALIAS.toUpperCase()}`]: RELE });
    sinEscribir(correr([...A(), ...APLICAR]).codigo);
    tabla({ [`REEMPLAZAR_PHONE_NUMBER_ID_${ALIAS.toUpperCase()}`]: PHONE, [`REEMPLAZAR_URL_INTERNA_DEL_RELE_${ALIAS.toUpperCase()}`]: ['http://u:p', 'host.test'].join('@') });
    sinEscribir(correr([...A(), ...APLICAR]).codigo);
  });

  it('--tabla-demo-a usa las filas SIN sufijo', () => {
    tabla({ REEMPLAZAR_PHONE_NUMBER_ID: PHONE, REEMPLAZAR_URL_INTERNA_DEL_RELE: RELE });
    sinEscribir(correr([...A(), ...APLICAR]).codigo);
    expect(correr([...A(), '--tabla-demo-a', ...APLICAR]).codigo).toBe(0);
  });

  it('un marcador del JSON sin valor en el script aborta', () => {
    const f = JSON.parse(leerTxt(FLUJO_REAL));
    f.nodes[2].parameters.assignments.assignments[3].value = 'REEMPLAZAR_OTRA_COSA';
    const ruta = join(dir, 'flujo-con-resto.json');
    writeFileSync(ruta, JSON.stringify(f));
    const r = correr([...A(), '--flujo', ruta]);
    sinEscribir(r.codigo);
    expect(r.salida).toContain('REEMPLAZAR_OTRA_COSA');
  });

  it.each([
    ['falta la credencial de envío AAB1', (c: Cred[]) => c.filter((x) => x.id !== 'r1')],
    ['falta la credencial de ingesta del alias', (c: Cred[]) => c.filter((x) => x.id !== 'i1')],
    ['la de WhatsApp existe pero de OTRO tipo', (c: Cred[]) => c.map((x) => (x.id === 'g1' ? { ...x, type: 'httpHeaderAuth' } : x))],
    ['hay dos credenciales de envío con el mismo nombre', (c: Cred[]) => [...c, { id: 'r2', name: `AAB1 envío · ${ALIAS}`, type: 'httpHeaderAuth' }]],
  ])('%s: aborta sin completar por TIPO', (_n, cambio) => {
    writeFileSync(join(dir, 'creds.json'), JSON.stringify(cambio(creds())));
    const r = correr([...A(), ...APLICAR]);
    sinEscribir(r.codigo);
    expect(r.salida).toContain('credenciales');
  });

  it('un JSON donde el nodo de envío nombra la credencial de ingesta: aborta', () => {
    const f = JSON.parse(leerTxt(FLUJO_REAL)) as { nodes: Nodo[] };
    const rele = f.nodes.find((n) => n.name === 'Enviar por el relé')!;
    rele.credentials = { httpHeaderAuth: { id: '', name: 'NovuChat ingesta (REEMPLAZAR_ALIAS)' } };
    const ruta = join(dir, 'flujo-trampa.json');
    writeFileSync(ruta, JSON.stringify(f));
    const r = correr([...A(), '--flujo', ruta]);
    sinEscribir(r.codigo);
    expect(r.salida).toMatch(/ingesta/);
  });

  it('un JSON con un WhatsApp Trigger: aborta', () => {
    const f = JSON.parse(leerTxt(FLUJO_REAL)) as { nodes: Nodo[] };
    f.nodes.push({ name: 'Disparador', type: 'n8n-nodes-base.whatsAppTrigger', parameters: {} });
    const ruta = join(dir, 'flujo-trigger.json');
    writeFileSync(ruta, JSON.stringify(f));
    sinEscribir(correr([...A(), '--flujo', ruta]).codigo);
  });

  it('un JSON con una credencial de AAB1-WA-Prod: aborta', () => {
    writeFileSync(join(dir, 'creds.json'), JSON.stringify([...creds(), { id: 'p1', name: 'AAB1-WA-Prod', type: 'whatsAppApi' }]));
    const f = JSON.parse(leerTxt(FLUJO_REAL)) as { nodes: Nodo[] };
    f.nodes.find((n) => n.name === 'Enviar por Graph')!.credentials = { whatsAppApi: { id: '', name: 'AAB1-WA-Prod' } };
    const ruta = join(dir, 'flujo-prod.json');
    writeFileSync(ruta, JSON.stringify(f));
    sinEscribir(correr([...A(), '--flujo', ruta]).codigo);
  });
});

describe('cargar-timbre-n8n.sh: si algo falla al escribir, la entrega se conserva', () => {
  it('falla la creación del flujo (500): sale 3, conserva la entrega y el respaldo, dice cómo seguir', () => {
    writeFileSync(join(dir, 'falla-POST-workflows'), '');
    const r = correr([...A(), ...APLICAR]);
    expect(r.codigo).toBe(3);
    expect(existe(entregaRuta())).toBe(true);
    expect(r.salida).toContain('se CONSERVÓ');
    expect(r.salida).toContain('--quitar');
    const m = /respaldo previo[^:]*: (\S+respaldo-vivo\.json)/.exec(r.salida);
    expect(m).not.toBeNull();
    expect(readdirSync(dirname(m![1]))).toEqual(['respaldo-vivo.json']);
    // la clave NO quedó en el directorio de trabajo
    expect(leerTxt(m![1])).not.toContain(CLAVE);
  });

  it('con la credencial ya creada, reintentar sin la falla termina bien y borra la entrega', () => {
    writeFileSync(join(dir, 'falla-POST-workflows'), '');
    expect(correr([...A(), ...APLICAR]).codigo).toBe(3);
    rmSync(join(dir, 'falla-POST-workflows'));
    expect(correr([...A(), ...APLICAR]).codigo).toBe(0);
    expect(existe(entregaRuta())).toBe(false);
    expect(creds().filter((c) => c.name.startsWith('Salida de persona (timbre'))).toHaveLength(1);
    expect(flujos()).toHaveLength(1);
  });

  it('falla la credencial (500): no se crea el flujo y la entrega queda', () => {
    writeFileSync(join(dir, 'falla-POST-credentials'), '');
    expect(correr([...A(), ...APLICAR]).codigo).toBe(3);
    expect(flujos()).toEqual([]);
    expect(existe(entregaRuta())).toBe(true);
  });
});

describe('cargar-timbre-n8n.sh: --activar es un paso aparte', () => {
  it('sin flujo cargado: sale 2', () => {
    const r = correr([...A(), '--activar', ...APLICAR]);
    expect(r.codigo).toBe(2);
    expect(escrituras()).toEqual([]);
  });

  it('cargar NO activa; el seco de --activar no escribe; --activar --aplicar activa y relee', () => {
    expect(correr([...A(), ...APLICAR]).codigo).toBe(0);
    expect(llamadas().some((l) => /activate/.test(l))).toBe(false);
    const antes = llamadas().length;
    const seco = correr([...A(), '--activar']);
    expect(seco.codigo).toBe(1);
    expect(llamadas().slice(antes).filter((l) => !l.startsWith('GET '))).toEqual([]);
    expect(flujos()[0].active).toBe(false);
    const r = correr([...A(), '--activar', ...APLICAR]);
    expect(r.codigo).toBe(0);
    expect(flujos()[0].active).toBe(true);
    // ya activo: nada que hacer
    expect(correr([...A(), '--activar', ...APLICAR]).codigo).toBe(0);
  });

  it('no activa un flujo vivo con marcadores sin reponer', () => {
    expect(correr([...A(), ...APLICAR]).codigo).toBe(0);
    const f = flujos(); f[0].nodes[2].parameters = { x: 'REEMPLAZAR_PHONE_NUMBER_ID' };
    writeFileSync(join(dir, 'wfs.json'), JSON.stringify(f));
    expect(correr([...A(), '--activar', ...APLICAR]).codigo).toBe(2);
    expect(flujos()[0].active).toBe(false);
  });
});

describe('cargar-timbre-n8n.sh: --quitar revierte solo lo del timbre del alias', () => {
  it('el seco no escribe; --aplicar desactiva, borra flujo y credencial del timbre; las demás quedan', () => {
    expect(correr([...A(), ...APLICAR]).codigo).toBe(0);
    expect(correr([...A(), '--activar', ...APLICAR]).codigo).toBe(0);
    const antes = llamadas().length;
    const seco = correr([...A(), '--quitar']);
    expect(seco.codigo).toBe(1);
    expect(llamadas().slice(antes).filter((l) => !l.startsWith('GET '))).toEqual([]);
    expect(flujos()).toHaveLength(1);

    const r = correr([...A(), '--quitar', ...APLICAR]);
    expect(r.codigo).toBe(0);
    expect(flujos()).toEqual([]);
    expect(creds().map((c) => c.id).sort()).toEqual(['g1', 'i1', 'o1', 'r1']);
    const l = llamadas();
    expect(l.some((x) => /^POST \/workflows\/\S+\/deactivate$/.test(x))).toBe(true);
    expect(l.filter((x) => x.startsWith('DELETE ')).every((x) => /^DELETE \/(workflows|credentials)\/\S+$/.test(x))).toBe(true);
    expect(l.some((x) => /DELETE \/credentials\/(i1|r1|g1|o1)$/.test(x))).toBe(false);
    expect(r.salida).toContain('quitar-alias');
    // repetir: no queda nada
    expect(correr([...A(), '--quitar', ...APLICAR]).codigo).toBe(0);
  });

  it('con dos flujos de otros alias, solo toca el de este', () => {
    expect(correr([...A(), ...APLICAR]).codigo).toBe(0);
    const f = flujos();
    f.push({ ...f[0], id: 'wotro', name: 'NovuChat — Salida de persona (otro)' });
    writeFileSync(join(dir, 'wfs.json'), JSON.stringify(f));
    expect(correr([...A(), '--quitar', ...APLICAR]).codigo).toBe(0);
    expect(flujos().map((x) => x.id)).toEqual(['wotro']);
  });
});

describe('cargar-timbre-n8n.sh: borrador y publicada (n8n 2.x)', () => {
  const activoPublicado = () => {
    const f = flujos(); f[0].active = true; f[0].activeVersionId = f[0].versionId;
    writeFileSync(join(dir, 'wfs.json'), JSON.stringify(f));
  };

  it('recarga de un flujo activo cuyo PUT no publica: falla si el activate tampoco arregla (borrador sin publicar)', () => {
    expect(correr([...A(), ...APLICAR]).codigo).toBe(0);
    activoPublicado();
    entrega();
    writeFileSync(join(dir, 'activar-no-arregla'), '');
    const r = correr([...A(), ...APLICAR]);
    expect(r.codigo).toBe(3);
    expect(r.salida).toMatch(/PUBLICADA|publicad/);
    expect(existe(entregaRuta())).toBe(true);
  });

  it('recarga con un n8n que sí publica al guardar: no hace falta activate', () => {
    expect(correr([...A(), ...APLICAR]).codigo).toBe(0);
    activoPublicado();
    entrega();
    writeFileSync(join(dir, 'publica-al-guardar'), '');
    expect(correr([...A(), ...APLICAR]).codigo).toBe(0);
    expect(llamadas().filter((l) => /activate$/.test(l))).toEqual([]);
    expect(flujos()[0].activeVersionId).toBe(flujos()[0].versionId);
  });

  it('--activar sobre un flujo activo pero con borrador sin publicar: NO dice «ya está activo», publica', () => {
    expect(correr([...A(), ...APLICAR]).codigo).toBe(0);
    const f = flujos(); f[0].active = true; f[0].activeVersionId = 'vieja'; writeFileSync(join(dir, 'wfs.json'), JSON.stringify(f));
    const seco = correr([...A(), '--activar']);
    expect(seco.codigo).toBe(1);
    expect(seco.salida).not.toContain('nada que hacer');
    expect(correr([...A(), '--activar', ...APLICAR]).codigo).toBe(0);
    expect(flujos()[0].activeVersionId).toBe(flujos()[0].versionId);
  });

  it('--activar con un n8n que no publica: sale 3', () => {
    expect(correr([...A(), ...APLICAR]).codigo).toBe(0);
    writeFileSync(join(dir, 'activar-no-arregla'), '');
    expect(correr([...A(), '--activar', ...APLICAR]).codigo).toBe(3);
  });

  it('--activar sobre uno ya activo y publicado: nada que hacer, 0, sin escribir', () => {
    expect(correr([...A(), ...APLICAR]).codigo).toBe(0);
    expect(correr([...A(), '--activar', ...APLICAR]).codigo).toBe(0);
    const antes = escrituras().length;
    const r = correr([...A(), '--activar', ...APLICAR]);
    expect(r.codigo).toBe(0);
    expect(r.salida).toContain('nada que hacer');
    expect(escrituras().length).toBe(antes);
  });
});

describe('cargar-timbre-n8n.sh: endurecimiento (ronda de revisión)', () => {
  it('el Timbre lleva un webhookId estable por alias (el mismo al recargar)', () => {
    expect(correr([...A(), ...APLICAR]).codigo).toBe(0);
    const id1 = (flujos()[0].nodes.find((n) => n.name === 'Timbre') as unknown as { webhookId: string }).webhookId;
    expect(id1).toMatch(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
    entrega();
    expect(correr([...A(), ...APLICAR]).codigo).toBe(0);
    expect((flujos()[0].nodes.find((n) => n.name === 'Timbre') as unknown as { webhookId: string }).webhookId).toBe(id1);
    expect(id1).not.toContain(PATH);
  });

  it('el respaldo nunca guarda el path del Timbre: ni al recargar, ni en --activar, ni en --quitar', () => {
    const respaldos: string[] = [];
    const tomar = (r: { salida: string }) => {
      const m = /respaldo previo[^:]*: (\S+respaldo-vivo\.json)/.exec(r.salida);
      expect(m).not.toBeNull();
      respaldos.push(m![1]);
    };
    tomar(correr([...A(), ...APLICAR]));
    entrega();
    const recarga = correr([...A(), ...APLICAR]); tomar(recarga);
    tomar(correr([...A(), '--activar', ...APLICAR]));
    tomar(correr([...A(), '--quitar', ...APLICAR]));
    for (const r of respaldos) {
      const t = leerTxt(r);
      expect(t).not.toContain(PATH);
      expect(t).not.toContain(CLAVE);
    }
    // el que traía el flujo completo lo lleva enmascarado, con su hash
    expect(leerTxt(respaldos[1])).toContain('<capacidad>');
    expect(leerTxt(respaldos[1])).toContain('path_sha256');
  });

  it.each([
    ['--activar --aplicar', ['--activar']],
    ['--quitar --aplicar', ['--quitar']],
    ['cargar --aplicar', []],
  ])('%s sin $XDG_RUNTIME_DIR válido: sale 2 y no cae a /tmp', (_n, modo) => {
    const r = correr([...A(), ...modo, ...APLICAR], { XDG_RUNTIME_DIR: '' });
    expect(r.codigo).toBe(2);
    expect(llamadas()).toEqual([]);
  });

  it('--flujo junto con --aplicar se niega (2)', () => {
    const r = correr([...A(), '--flujo', FLUJO_REAL, ...APLICAR]);
    expect(r.codigo).toBe(2);
    expect(llamadas()).toEqual([]);
  });

  const variante = (cambio: (f: { nodes: Nodo[] }) => void, nombre: string) => {
    const f = JSON.parse(leerTxt(FLUJO_REAL)) as { nodes: Nodo[] };
    cambio(f);
    const ruta = join(dir, nombre);
    writeFileSync(ruta, JSON.stringify(f));
    return correr([...A(), '--flujo', ruta]);
  };

  it('un Timbre sin authentication=headerAuth: aborta', () => {
    const r = variante((f) => { f.nodes.find((n) => n.name === 'Timbre')!.parameters.authentication = 'none'; }, 'a.json');
    expect(r.codigo).toBe(2);
    expect(r.salida).toContain('headerAuth');
  });

  it.each(['Reclamar', 'Confirmar', 'Enviar por el relé', 'Enviar por Graph', 'Timbre'])('el nodo %s sin credencial: aborta', (nodo) => {
    const r = variante((f) => { delete f.nodes.find((n) => n.name === nodo)!.credentials; }, 'b.json');
    expect(r.codigo).toBe(2);
  });

  it.each(['subscribed_apps', 'subscriptions', 'register', 'message_templates'])('un nodo HTTP que llama a %s: aborta', (ruta) => {
    const r = variante((f) => {
      f.nodes.find((n) => n.name === 'Enviar por Graph')!.parameters.url = `=https://graph.facebook.com/v26.0/123/${ruta}`;
    }, 'c.json');
    expect(r.codigo).toBe(2);
    expect(r.salida).toMatch(/subscriptions|otra sesión/);
  });

  it('un stickyNote con un marcador: no aborta y no recibe valores', () => {
    const f = JSON.parse(leerTxt(FLUJO_REAL)) as { nodes: Nodo[] };
    f.nodes.push({ name: 'Nota', type: 'n8n-nodes-base.stickyNote', parameters: { content: 'ruta REEMPLAZAR_RUTA_TIMBRE' } });
    const ruta = join(dir, 'd.json');
    writeFileSync(ruta, JSON.stringify(f));
    expect(correr([...A(), '--flujo', ruta]).codigo).toBe(1);
  });

  it('un id de flujo con forma rara en la lista de n8n: se niega (no se interpola en una URL)', () => {
    expect(correr([...A(), ...APLICAR]).codigo).toBe(0);
    const f = flujos(); f[0].id = 'w1/../../credentials'; writeFileSync(join(dir, 'wfs.json'), JSON.stringify(f));
    entrega();
    const r = correr([...A(), ...APLICAR]);
    expect(r.codigo).toBe(2);
    expect(llamadas().filter((l) => l.includes('..'))).toEqual([]);
  });

  it('--activar con una credencial del flujo vivo que ya no está en la lista de n8n: se niega (2)', () => {
    expect(correr([...A(), ...APLICAR]).codigo).toBe(0);
    writeFileSync(join(dir, 'creds.json'), JSON.stringify(creds().filter((c) => c.id !== 'g1')));
    const r = correr([...A(), '--activar', ...APLICAR]);
    expect(r.codigo).toBe(2);
    expect(flujos()[0].active).toBe(false);
  });
});

describe('cargar-timbre-n8n.sh: segunda mini-ronda', () => {
  const activoPublicado = () => {
    const f = flujos(); f[0].active = true; f[0].activeVersionId = f[0].versionId;
    writeFileSync(join(dir, 'wfs.json'), JSON.stringify(f));
  };

  it('el borrador se verifica ANTES de publicar: si el guardado no coincide, no hay ni un activate', () => {
    expect(correr([...A(), ...APLICAR]).codigo).toBe(0);
    activoPublicado();
    entrega();
    writeFileSync(join(dir, 'corrompe-borrador'), '');
    const antes = llamadas().length;
    const r = correr([...A(), ...APLICAR]);
    expect(r.codigo).toBe(3);
    expect(r.salida).toContain('borrador');
    expect(llamadas().slice(antes).some((l) => /activate/.test(l))).toBe(false);
    expect(existe(entregaRuta())).toBe(true);
  });

  it('un n8n que no manda versionId/activeVersionId de un flujo activo: falla en recarga y en --activar (no compara None con None)', () => {
    expect(correr([...A(), ...APLICAR]).codigo).toBe(0);
    activoPublicado();
    entrega();
    writeFileSync(join(dir, 'sin-versiones'), '');
    const r = correr([...A(), ...APLICAR]);
    expect(r.codigo).toBe(3);
    expect(existe(entregaRuta())).toBe(true);
    const a = correr([...A(), '--activar', ...APLICAR]);
    expect(a.codigo).toBe(3);
    expect(a.salida).not.toContain('nada que hacer');
  });

  it('el respaldo no guarda pinData ni staticData del flujo vivo', () => {
    expect(correr([...A(), ...APLICAR]).codigo).toBe(0);
    const f = flujos() as unknown as Array<Record<string, unknown>>;
    f[0].pinData = { Reclamar: [{ json: { cabecera: 'Bearer secreto-de-editor' } }] };
    f[0].staticData = { global: { auth: 'Bearer otro-secreto-de-editor' } };
    writeFileSync(join(dir, 'wfs.json'), JSON.stringify(f));
    const r = correr([...A(), '--quitar', ...APLICAR]);
    const m = /respaldo previo[^:]*: (\S+respaldo-vivo\.json)/.exec(r.salida);
    expect(m).not.toBeNull();
    const t = leerTxt(m![1]);
    expect(t).not.toContain('secreto-de-editor');
    expect(t).not.toContain('pinData');
    expect(t).not.toContain('staticData');
  });

  it('el cuerpo que arma `plan` deja el stickyNote con <marcador> y no recibe ningún valor', () => {
    const fuente = leerTxt(SCRIPT);
    const m = /<<'PY'\n([\s\S]*?)\nPY\n/.exec(fuente);
    expect(m).not.toBeNull();
    const lib = join(dir, 'lib.py');
    writeFileSync(lib, m![1]);
    const f = JSON.parse(leerTxt(FLUJO_REAL)) as { nodes: Nodo[] };
    f.nodes.push({ name: 'Nota', type: 'n8n-nodes-base.stickyNote', parameters: { content: 'ruta REEMPLAZAR_RUTA_TIMBRE y REEMPLAZAR_PHONE_NUMBER_ID' } });
    writeFileSync(join(dir, 'f.json'), JSON.stringify(f));
    writeFileSync(join(dir, 'l.json'), JSON.stringify({ data: [] }));
    writeFileSync(join(dir, 'c.json'), JSON.stringify({ data: creds() }));
    writeFileSync(join(dir, 't.json'), JSON.stringify({ phone: PHONE, rele: RELE }));
    writeFileSync(join(dir, 'p.txt'), PATH);
    const r = spawnSync('python3', ['-I', lib, 'plan', join(dir, 'f.json'), join(dir, 'l.json'), join(dir, 'c.json'), join(dir, 't.json'), join(dir, 'p.txt'), ALIAS, '', join(dir, 'cuerpo.json'), join(dir, 'plan.json')], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    const cuerpo = JSON.parse(leerTxt(join(dir, 'cuerpo.json'))) as { nodes: Array<{ name: string; parameters: Record<string, unknown> }> };
    expect(cuerpo.nodes.find((n) => n.name === 'Nota')!.parameters.content).toBe('ruta <marcador> y <marcador>');
    expect(JSON.stringify(cuerpo.nodes.find((n) => n.name === 'Nota'))).not.toContain(PATH);
    expect(cuerpo.nodes.find((n) => n.name === 'Timbre')!.parameters.path).toBe(PATH);
  });
});
