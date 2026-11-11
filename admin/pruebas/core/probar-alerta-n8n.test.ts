/**
 * `scripts/probar-alerta-n8n.sh`: prueba de error forzado de la alerta «envío incierto», seco por omisión.
 *
 * Se prueba NEGANDO, con un `curl` FALSO adelante en el PATH que hace de n8n CON ESTADO (flujos creados, activados y
 * borrados quedan en un archivo), anota cada llamada y se parece a la API pública en lo que importa. Sin red ni n8n real.
 * (El `curl-falso-n8n.sh` común devuelve siempre el mismo flujo y no guarda estado: no sirve para comprobar que el temporal
 * se crea y se borra, por eso esta suite trae el suyo, como la de `cargar-timbre-n8n`.)
 *
 * Lo que cada grupo cierra:
 *  - mal uso: ni una llamada; sin `--confirmo produccion` no se escribe;
 *  - alerta ausente, duplicada o con nombre equivalente: aborta sin escribir; un temporal previo también;
 *  - el seco solo lee (GET);
 *  - la prueba crea, activa, dispara UNA vez, y SIEMPRE deja n8n sin el temporal (también ante fallos a mitad);
 *  - el temporal sale con el nodo exacto que exige «Armar alerta», errorWorkflow y sin guardar ejecuciones;
 *  - ningún id, ruta de webhook ni clave sale por pantalla ni por argumentos.
 */
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { codigoDe, leerFlujo } from '../lib/flujo';
import { entornoDelEmulador } from './entorno-del-hijo.ts';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..', '..', '..');
const SCRIPT = join(RAIZ, 'scripts', 'probar-alerta-n8n.sh');
const ALERTA = 'NovuChat — Error de envío incierto';
const TEMPORAL = 'NovuChat — PRUEBA alerta (temporal)';
const API_KEY = 'apikey-de-prueba-abc';
const ID_ALERTA = 'idAlertaQ7x';

const CURL_FALSO = `#!/usr/bin/env python3
import json, os, sys
E = os.environ["FAKE_DIR"]
a = sys.argv[1:]
con_valor = {"-o", "-w", "-X", "-H", "--data-binary", "--max-time", "--proto", "-K"}
metodo, salida, cuerpo_f, url, cab, conf = "GET", None, None, None, None, None
i = 0
while i < len(a):
    x = a[i]
    if x in con_valor:
        v = a[i + 1]
        if x == "-o": salida = v
        elif x == "-X": metodo = v
        elif x == "-H" and v == "@-": cab = sys.stdin.read().strip()
        elif x == "--data-binary" and v.startswith("@"): cuerpo_f = v[1:]
        elif x == "-K": conf = v
        i += 2
    else:
        if x.startswith("https://"): url = x
        i += 1
if conf:
    for l in open(conf).read().splitlines():
        if l.startswith("url"): url = l.split("=", 1)[1].strip().strip('"')
est_f = os.path.join(E, "estado.json")
est = json.load(open(est_f))
F = os.environ.get("FAKE_FALLA", "").split(",")
def reg(t): open(os.path.join(E, "registro"), "a").write(t + "\\n")
def guardar(): json.dump(est, open(est_f, "w"))
def salir(cod, cuerpo):
    if salida: open(salida, "w").write(json.dumps(cuerpo))
    sys.stdout.write(str(cod)); sys.exit(0)
reg("ARGV " + " ".join(a)); reg("STDIN " + str(cab))
if "/api/v1" in url:
    if cab != "X-N8N-API-KEY: " + os.environ["FAKE_CLAVE"]: salir(401, {})
    ruta = url.split("/api/v1", 1)[1]; ruta_s = ruta.split("?")[0]; reg(metodo + " " + ruta_s)
    wf = est["wf"]
    if metodo == "GET" and ruta_s == "/workflows":
        salir(200, {"data": [{"id": k, "name": v["name"], "active": v["active"], **({"isArchived": True} if v.get("archivado") else {})} for k, v in wf.items()], "nextCursor": None})
    if metodo == "POST" and ruta_s == "/workflows":
        if "create" in F: salir(500, {})
        cuerpo = json.load(open(cuerpo_f)); est["n"] += 1; k = "tmp%d" % est["n"]
        wf[k] = {"name": cuerpo["name"], "active": False, "nodes": cuerpo["nodes"], "settings": cuerpo["settings"], "connections": cuerpo["connections"]}
        json.dump(cuerpo, open(os.path.join(E, "cuerpo-creado.json"), "w")); guardar()
        if "post_deja" in F: salir(500, {})
        salir(200, {"id": k, "name": cuerpo["name"], "active": False})
    partes = ruta_s.split("/")
    if len(partes) >= 3 and partes[1] == "workflows":
        k = partes[2]
        if k not in wf: salir(404, {})
        if metodo == "GET" and len(partes) == 3: salir(200, {"id": k, **wf[k]})
        if metodo == "POST" and partes[3:] == ["activate"]:
            if "activate" in F: salir(500, {})
            wf[k]["active"] = True; guardar(); salir(200, {"id": k, "active": True})
        if metodo == "POST" and partes[3:] == ["deactivate"]:
            if "deact_no" in F: salir(200, {"id": k, "active": True})
            wf[k]["active"] = False; guardar(); salir(200, {"id": k, "active": False})
        if metodo == "POST" and partes[3:] == ["archive"]:
            wf[k]["archivado"] = True; guardar(); salir(200, {"id": k})
        if metodo == "DELETE":
            if "delete_nunca" in F: salir(500, {})
            if "delete_directo" in F and not wf[k].get("archivado"): salir(409, {})
            del wf[k]; guardar(); salir(200, {"id": k})
    if metodo == "GET" and ruta_s == "/executions":
        salir(200, {"data": est["ejec"], "nextCursor": None})
    salir(404, {})
else:
    reg("WEBHOOK")
    est["disparos"] = est.get("disparos", 0) + 1
    if "webhook404" in F:
        guardar(); salir(404, {})
    if "webhook404_una" in F and est["disparos"] == 1:
        guardar(); salir(404, {})
    if "webhook500" in F:
        guardar(); salir(500, {})
    if "webhook000" in F:
        guardar(); sys.exit(7)
    ok = [k for k, v in est["wf"].items() if v["name"].startswith("NovuChat \\u2014 PRUEBA") and v["active"] and url.endswith("/webhook/" + v["nodes"][0]["parameters"]["path"])]
    if not ok:
        guardar(); salir(404, {})
    if os.environ.get("FAKE_EJEC"):
        est["ejec"].append({"id": "e%d" % (100 + est["disparos"]), "status": os.environ["FAKE_EJEC"], "finished": True})
    guardar(); salir(200, {"message": "ok"})
`;

describe('probar-alerta-n8n.sh', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'probar-alerta-'));
    mkdirSync(join(dir, 'bin'));
    writeFileSync(join(dir, 'bin', 'curl'), CURL_FALSO);
    chmodSync(join(dir, 'bin', 'curl'), 0o755);
    writeFileSync(join(dir, 'env'), `N8N_BASE_URL=https://n8n.ejemplo.test\nN8N_API_KEY=${API_KEY}\nOTRA=no-se-lee\n`, { mode: 0o600 });
    chmodSync(join(dir, 'env'), 0o600);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const alertaWf = (nombre = ALERTA) => ({ name: nombre, active: false, nodes: [{ name: 'Error del flujo', type: 'n8n-nodes-base.errorTrigger' }], settings: {} });
  const clienteWf = { name: 'Flujo de cliente', active: true, nodes: [], settings: {} };
  function estado(wf: Record<string, unknown>, ejec: unknown[] = [{ id: 'e1', status: 'error' }]) { writeFileSync(join(dir, 'estado.json'), JSON.stringify({ n: 0, wf, ejec })); }
  function correr(args: string[], falla = '', extra: Record<string, string> = {}) {
    if (!existsSync(join(dir, 'estado.json'))) estado({ [ID_ALERTA]: alertaWf(), otro: clienteWf });
    const r = spawnSync('bash', [SCRIPT, '--env', join(dir, 'env'), ...args], {
      cwd: RAIZ, encoding: 'utf8',
      env: entornoDelEmulador(undefined, { PATH: `${join(dir, 'bin')}:${process.env.PATH ?? ''}`, BASH_ENV: '', ENV: '', FAKE_DIR: dir, FAKE_CLAVE: API_KEY, FAKE_FALLA: falla,
        HTTPS_PROXY: 'http://127.0.0.1:1', HTTP_PROXY: 'http://127.0.0.1:1', TMPDIR: dir, ...extra }),
    });
    return { codigo: r.status, salida: `${r.stdout}${r.stderr}` };
  }
  const aplicar = ['--aplicar', '--confirmo', 'produccion', '--espera', '0'];
  const registro = () => (existsSync(join(dir, 'registro')) ? readFileSync(join(dir, 'registro'), 'utf8') : '');
  const llamadas = () => registro().split('\n').filter((l) => /^(GET|POST|PUT|PATCH|DELETE) /.test(l));
  const escrituras = () => llamadas().filter((l) => !l.startsWith('GET '));
  type Wf = { name: string; active: boolean };
  const flujos = () => JSON.parse(readFileSync(join(dir, 'estado.json'), 'utf8')).wf as Record<string, Wf>;
  const temporales = () => Object.values(flujos()).filter((w) => w.name === TEMPORAL);
  const restos = () => readdirSync(dir).filter((n) => n.startsWith('probar-alerta-n8n.')).length;

  describe('mal uso y salvaguardas: ni una llamada', () => {
    it('--aplicar sin --confirmo produccion', () => {
      const r = correr(['--aplicar']);
      expect(r.codigo).toBe(2);
      expect(registro()).toBe('');
    });
    it('--confirmo con otro valor, o sin --aplicar', () => {
      expect(correr(['--aplicar', '--confirmo', 'staging']).codigo).toBe(2);
      expect(correr(['--confirmo', 'produccion']).codigo).toBe(2);
      expect(registro()).toBe('');
    });
    it('opción desconocida, --espera inválida, --env inexistente, http:// y xtrace', () => {
      expect(correr(['--loquesea']).codigo).toBe(2);
      expect(correr(['--espera', '999']).codigo).toBe(2);
      expect(spawnSync('bash', [SCRIPT, '--env', join(dir, 'no-existe')], { cwd: RAIZ, encoding: 'utf8', env: entornoDelEmulador(undefined, {}) }).status).toBe(2);
      writeFileSync(join(dir, 'env-http'), `N8N_BASE_URL=http://n8n.ejemplo.test\nN8N_API_KEY=${API_KEY}\n`, { mode: 0o600 });
      expect(spawnSync('bash', [SCRIPT, '--env', join(dir, 'env-http')], { cwd: RAIZ, encoding: 'utf8', env: entornoDelEmulador(undefined, {}) }).status).toBe(2);
      expect(spawnSync('bash', ['-x', SCRIPT, '--env', join(dir, 'env')], { cwd: RAIZ, encoding: 'utf8', env: entornoDelEmulador(undefined, {}) }).status).toBe(2);
      expect(registro()).toBe('');
    });
    it('--aplicar con --env legible por otros (modo distinto de 600)', () => {
      chmodSync(join(dir, 'env'), 0o644);
      expect(correr(aplicar).codigo).toBe(2);
      expect(registro()).toBe('');
    });
  });

  describe('la alerta debe existir exactamente una vez (también en seco)', () => {
    it('ausente: aborta sin escribir', () => {
      estado({ otro: clienteWf });
      for (const args of [[], aplicar]) {
        const r = correr(args);
        expect(r.codigo).toBe(2);
        expect(r.salida).toContain('No existe el flujo');
      }
      expect(escrituras()).toEqual([]);
    });
    it('duplicada: aborta sin escribir', () => {
      estado({ a1: alertaWf(), a2: alertaWf() });
      for (const args of [[], aplicar]) expect(correr(args).codigo).toBe(2);
      expect(escrituras()).toEqual([]);
    });
    it('una archivada no cuenta: una activa y otra archivada es válido', () => {
      estado({ a1: alertaWf(), a2: { ...alertaWf(), archivado: true } });
      expect(correr([]).codigo).toBe(0);
    });
    it('nombre equivalente pero no exacto: aborta', () => {
      estado({ a1: alertaWf(), a2: alertaWf(ALERTA.toUpperCase()) });
      expect(correr(aplicar).codigo).toBe(2);
      expect(escrituras()).toEqual([]);
    });
    it('sin Error Trigger: aborta', () => {
      estado({ a1: { ...alertaWf(), nodes: [] } });
      expect(correr(aplicar).codigo).toBe(2);
      expect(escrituras()).toEqual([]);
    });
    it('un temporal previo: aborta sin escribir (no lo borra a ciegas)', () => {
      estado({ a1: alertaWf(), t: { name: TEMPORAL, active: false, nodes: [], settings: {} } });
      expect(correr(aplicar).codigo).toBe(2);
      expect(escrituras()).toEqual([]);
      expect(Object.keys(flujos())).toContain('t');
    });
  });

  describe('seco', () => {
    it('solo lee: ninguna escritura, dice qué haría y no deja residuos', () => {
      const r = correr([]);
      expect(r.codigo, r.salida).toBe(0);
      expect(escrituras()).toEqual([]);
      expect(llamadas().every((l) => l.startsWith('GET '))).toBe(true);
      expect(r.salida).toContain('Seco: no se escribió nada');
      expect(r.salida).toContain('1 aviso de prueba');
      expect(r.salida).toContain('aviso INMEDIATO por hora');
      expect(registro()).not.toContain('WEBHOOK');
      expect(restos()).toBe(0);
    });
  });

  describe('prueba aplicada', () => {
    it('crea, activa, dispara UNA vez, informa y deja n8n sin el temporal', () => {
      const r = correr(aplicar);
      expect(r.codigo, r.salida).toBe(0);
      const ops = escrituras();
      expect(ops[0]).toBe('POST /workflows');
      expect(ops.filter((l) => l.endsWith('/activate'))).toHaveLength(1);
      expect(registro().match(/^WEBHOOK$/gm)).toHaveLength(1);
      expect(ops.some((l) => l.startsWith('DELETE '))).toBe(true);
      expect(temporales()).toHaveLength(0);
      expect(Object.keys(flujos()).sort()).toEqual([ID_ALERTA, 'otro'].sort());
      expect(r.salida).toContain('no encuentra ningún flujo');
      expect(restos()).toBe(0);
    });
    it('no toca ningún flujo de cliente ni la alerta: solo se escribe sobre el temporal', () => {
      correr(aplicar);
      const ids = escrituras().filter((l) => l !== 'POST /workflows').map((l) => l.split(' ')[1]!.split('/')[2]!);
      expect(ids.length).toBeGreaterThan(0);
      expect(ids.every((id) => id.startsWith('tmp'))).toBe(true);
    });
    it('el temporal lleva el nodo exacto que exige «Armar alerta», errorWorkflow y no guarda ejecuciones', () => {
      correr(aplicar);
      const c = JSON.parse(readFileSync(join(dir, 'cuerpo-creado.json'), 'utf8'));
      expect(c.name).toBe(TEMPORAL);
      expect(c.settings).toMatchObject({ errorWorkflow: ID_ALERTA, saveDataErrorExecution: 'none', saveDataSuccessExecution: 'none' });
      expect(c).not.toHaveProperty('active');
      expect(c.nodes.map((n: { name: string }) => n.name)).toEqual(['Disparo de prueba', 'Detener por envío incierto']);
      expect(c.nodes[0].type).toBe('n8n-nodes-base.webhook');
      expect(c.nodes[0].parameters.path).toMatch(/^[0-9a-f]{32}$/);
      expect(c.nodes[1].type).toBe('n8n-nodes-base.stopAndError');
      // el nombre del nodo es el que el código REAL de «Armar alerta» compara para marcar el aviso urgente
      expect(codigoDe(leerFlujo('error-envio-incierto.json'), 'Armar alerta')).toContain(c.nodes[1].name);
    });
    it('ids, ruta del webhook y clave no salen por pantalla ni por argumentos; la clave solo por stdin y nunca al webhook', () => {
      const r = correr(aplicar);
      const c = JSON.parse(readFileSync(join(dir, 'cuerpo-creado.json'), 'utf8'));
      const ruta = c.nodes[0].parameters.path as string;
      for (const secreto of [ID_ALERTA, 'tmp1', ruta, c.nodes[0].webhookId, API_KEY]) expect(r.salida).not.toContain(secreto);
      const lineas = registro().split('\n');
      for (const l of lineas.filter((x) => x.startsWith('ARGV '))) {
        expect(l).not.toContain(API_KEY);
        expect(l).not.toContain(ruta);
      }
      expect(registro()).toContain(`STDIN X-N8N-API-KEY: ${API_KEY}`);
      expect(lineas.some((l) => l.startsWith('ARGV ') && l.includes(' -K '))).toBe(true);
      const w = lineas.indexOf('WEBHOOK');
      expect(lineas[w - 1]).toBe('STDIN None');
    });
    it('informa el estado de las ejecuciones nuevas de la alerta sin imprimir datos', () => {
      let r = correr(aplicar, '', { FAKE_EJEC: 'success' });
      expect(r.codigo, r.salida).toBe(0);
      expect(r.salida).toContain('corrió');
      rmSync(join(dir, 'estado.json'));
      r = correr(aplicar, '', { FAKE_EJEC: 'error' });
      expect(r.codigo, r.salida).toBe(4);
      expect(r.salida).toContain('ERROR');
      expect(temporales()).toHaveLength(0);
    });
    it('desactiva el temporal justo tras el 2xx del webhook y ANTES de leer las ejecuciones de la alerta', () => {
      const r = correr(aplicar);
      expect(r.codigo, r.salida).toBe(0);
      const l = registro().split('\n').filter((x) => x === 'WEBHOOK' || /^(GET|POST|DELETE) \//.test(x));
      const web = l.indexOf('WEBHOOK');
      const des = l.findIndex((x, i) => i > web && x.endsWith('/deactivate'));
      const ejec = l.map((x, i) => (x === 'GET /executions' ? i : -1)).filter((i) => i >= 0).pop()!;
      expect(web).toBeGreaterThan(-1);
      expect(des).toBe(web + 1);
      expect(des).toBeLessThan(ejec);
      expect(r.salida).toContain('active=false comprobado');
    });
    it('limpieza con el id conocido: no vuelve a listar para decidir qué borrar ni toca otro flujo', () => {
      correr(aplicar);
      const l = llamadas();
      const iDel = l.findIndex((x) => x.startsWith('DELETE '));
      expect(l.slice(0, iDel).filter((x) => x === 'GET /workflows').length).toBe(1); // solo la lectura inicial
      expect(l.filter((x) => x.startsWith('DELETE ')).every((x) => x.startsWith('DELETE /workflows/tmp'))).toBe(true);
    });
    it('el listado se guarda solo con id, nombre y archivado: lista.json no conserva nada más', () => {
      // Se observa en el script: el ayudante descarta el resto de cada flujo (incluidos los de cliente).
      const src = readFileSync(SCRIPT, 'utf8');
      expect(src).toContain('("id", "name", "isArchived", "archived")');
      expect(src).not.toContain('acum += rta["data"]');
    });
    it('NEGANDO: la alerta corrió en la última hora -> aborta (2) sin escribir; con --acepto-sin-aviso-inmediato sigue', () => {
      const hace = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
      estado({ [ID_ALERTA]: alertaWf(), otro: clienteWf }, [{ id: 'e1', status: 'error', startedAt: hace(10) }]);
      let r = correr(aplicar);
      expect(r.codigo, r.salida).toBe(2);
      expect(r.salida).toContain('--acepto-sin-aviso-inmediato');
      expect(escrituras()).toEqual([]);
      r = correr([...aplicar, '--acepto-sin-aviso-inmediato']);
      expect(r.codigo, r.salida).toBe(0);
      expect(registro().match(/^WEBHOOK$/gm)).toHaveLength(1);
    });
    it('una ejecución de hace más de una hora no bloquea', () => {
      estado({ [ID_ALERTA]: alertaWf(), otro: clienteWf }, [{ id: 'e1', status: 'error', startedAt: new Date(Date.now() - 2 * 3_600_000).toISOString() }]);
      expect(correr(aplicar).codigo).toBe(0);
    });
    it('--acepto-sin-aviso-inmediato sin --aplicar es un error de uso', () => {
      expect(correr(['--acepto-sin-aviso-inmediato']).codigo).toBe(2);
      expect(registro()).toBe('');
    });
    it('sin ejecuciones nuevas: lo dice con su salvedad (un éxito no se guarda) y sale 0', () => {
      const r = correr(aplicar);
      expect(r.codigo, r.salida).toBe(0);
      expect(r.salida).toContain('no guardó ejecuciones nuevas');
      expect(r.salida).toContain('Falta confirmar');
    });
  });

  describe('fallos a mitad: el temporal SIEMPRE se borra', () => {
    it('falla al activar', () => {
      const r = correr(aplicar, 'activate');
      expect(r.codigo).toBe(3);
      expect(registro()).not.toContain('WEBHOOK');
      expect(temporales()).toHaveLength(0);
    });
    it('el webhook no responde 2xx (404 siempre): un único reintento y se limpia', () => {
      const r = correr(aplicar, 'webhook404');
      expect(r.codigo).toBe(3);
      expect(registro().match(/^WEBHOOK$/gm)).toHaveLength(2);
      expect(temporales()).toHaveLength(0);
    });
    it('el POST crea el flujo pero responde 500 (id desconocido): se limpia por nombre', () => {
      const r = correr(aplicar, 'post_deja');
      expect(r.codigo).toBe(3);
      expect(temporales()).toHaveLength(0);
    });
    it('el POST falla del todo: nada que limpiar, sale 3', () => {
      const r = correr(aplicar, 'create');
      expect(r.codigo).toBe(3);
      expect(temporales()).toHaveLength(0);
    });
    it('el webhook responde 500 o no responde (000): UN solo disparo, sin reintento, y se limpia', () => {
      for (const falla of ['webhook500', 'webhook000']) {
        rmSync(join(dir, 'registro'), { force: true });
        rmSync(join(dir, 'estado.json'), { force: true });
        const r = correr(aplicar, falla);
        expect(r.codigo, falla).toBe(3);
        expect(registro().match(/^WEBHOOK$/gm), falla).toHaveLength(1);
        expect(temporales(), falla).toHaveLength(0);
      }
    });
    it('el webhook da 404 y luego 200: exactamente un reintento y la prueba sigue', () => {
      const r = correr(aplicar, 'webhook404_una');
      expect(r.codigo, r.salida).toBe(0);
      expect(registro().match(/^WEBHOOK$/gm)).toHaveLength(2);
      expect(temporales()).toHaveLength(0);
    });
    it('tras desactivar, si n8n sigue diciendo active=true: aborta (3), sin esperar ni leer ejecuciones, y limpia', () => {
      const r = correr(aplicar, 'deact_no');
      expect(r.codigo, r.salida).toBe(3);
      expect(r.salida).not.toContain('Espero');
      expect(llamadas().filter((l) => l === 'GET /executions')).toHaveLength(1); // solo la lectura previa
      expect(temporales()).toHaveLength(0);
    });
    it('n8n exige archivar antes de borrar: archiva y borra', () => {
      const r = correr(aplicar, 'delete_directo');
      expect(r.codigo, r.salida).toBe(0);
      expect(escrituras().some((l) => l.endsWith('/archive'))).toBe(true);
      expect(temporales()).toHaveLength(0);
    });
    it('no se puede borrar: sale 3 con aviso claro de limpieza incompleta y el temporal queda desactivado', () => {
      const r = correr(aplicar, 'delete_nunca');
      expect(r.codigo).toBe(3);
      expect(r.salida).toContain('LIMPIEZA INCOMPLETA');
      expect(temporales().every((w) => !w.active)).toBe(true);
    });
    for (const [senal, esperado] of [['SIGINT', 130], ['SIGTERM', 143]] as const) {
      it(`interrupción (${senal}) tras el disparo: sale ${esperado} (no 3) y el trap deja n8n sin el temporal`, async () => {
        estado({ [ID_ALERTA]: alertaWf() }, []);
        const hijo = spawn('bash', [SCRIPT, '--env', join(dir, 'env'), '--aplicar', '--confirmo', 'produccion', '--espera', '3'], {
          cwd: RAIZ, stdio: 'ignore',
          env: entornoDelEmulador(undefined, { PATH: `${join(dir, 'bin')}:${process.env.PATH ?? ''}`, BASH_ENV: '', FAKE_DIR: dir, FAKE_CLAVE: API_KEY, FAKE_FALLA: '', TMPDIR: dir }),
        });
        const fin = new Promise<number | null>((ok) => hijo.on('close', (c) => ok(c)));
        for (let i = 0; i < 200 && !registro().includes('/deactivate'); i++) await new Promise((r) => setTimeout(r, 50));
        expect(registro()).toContain('WEBHOOK');
        hijo.kill(senal);
        expect(await fin).toBe(esperado);
        expect(temporales()).toHaveLength(0);
        expect(restos()).toBe(0);
      }, 30_000);
    }
  });
});
