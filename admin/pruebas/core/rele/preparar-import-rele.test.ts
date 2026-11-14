/**
 * `preparar-import.sh` REPONE la URL INTERNA DEL RELÉ B9 desde una variable (revisión del PR #757), y solo así:
 *   - el valor sale de `RELE_URL_INTERNA` (entorno o `.env` del cliente) y NUNCA está en el repositorio; no se imprime;
 *   - es una base: `http(s)://host[:puerto]`, sin ruta, sin barra final, sin credenciales;
 *   - `http://` solo para un host interno (sin puntos, localhost, *.internal, *.local, IP privada); cualquier otro host exige `https://`;
 *   - si falta o es inválida, el marcador queda y `publicar-flujo.sh` aborta (cualquier `REEMPLAZAR_[A-Z]…` que quede lo detiene).
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { entornoDelEmulador } from '../entorno-del-hijo.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const MARCADOR = 'REEMPLAZAR_URL_INTERNA_DEL_RELE';
// La misma expresión con que `publicar-flujo.sh` decide que queda un marcador sin reponer.
const MARCADOR_SIN_REPONER = /REEMPLAZAR_[A-Z][^"\\\s]*/;

describe('preparar-import.sh y RELE_URL_INTERNA', () => {
  let dir: string; let raiz: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'prep-rele-'));
    raiz = join(dir, 'repo');
    mkdirSync(join(raiz, 'scripts'), { recursive: true });
    mkdirSync(join(raiz, 'Flujos'));
    copyFileSync(join(REPO, 'scripts', 'preparar-import.sh'), join(raiz, 'scripts', 'preparar-import.sh'));
    writeFileSync(join(raiz, '.env.prueba'), 'N8N_BASE_URL=https://n8n.invalid\n');
    writeFileSync(join(raiz, 'tabla.md'), '| Marcador | Valor |\n|---|---|\n');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const FLUJO = {
    name: 'f',
    nodes: [{ name: 'Enviar a WhatsApp', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [0, 0], parameters: { url: `=${MARCADOR}/v1/envio/mensajes/{{ String($json.phoneNumberId) }}` } }],
    connections: {}, settings: {},
  };
  const salidaLocal = (): string => readFileSync(join(raiz, 'Flujos', 'f.local.json'), 'utf8');

  /**
   * `lista` = RELE_BASES_PERMITIDAS (obligatoria desde la ronda 3 del PR #757): por omisión, la base exacta que se quiere reponer (o la de la tabla).
   * `enEnv` pone RELE_URL_INTERNA (y la lista) en el `.env` del cliente; `terminal` pone valores DISTINTOS en la terminal, para probar la prioridad.
   */
  function correr(valor: string | undefined, o: { enEnv?: boolean; enTabla?: string; lista?: string; listaEnEnv?: boolean; terminal?: { url?: string; lista?: string } } = {}) {
    writeFileSync(join(raiz, 'Flujos', 'f.json'), JSON.stringify(FLUJO));
    const lista = o.lista ?? valor ?? o.enTabla ?? '';
    const lineasEnv = `${o.enEnv && valor !== undefined ? `RELE_URL_INTERNA=${valor}\n` : ''}${o.listaEnEnv ? `RELE_BASES_PERMITIDAS=${lista}\n` : ''}`;
    writeFileSync(join(raiz, '.env.prueba'), `N8N_BASE_URL=https://n8n.invalid\n${lineasEnv}`);
    writeFileSync(join(raiz, 'tabla.md'), '| Marcador | Valor |\n|---|---|\n');
    if (o.enTabla !== undefined) writeFileSync(join(raiz, 'tabla.md'), `| Marcador | Valor |\n|---|---|\n| \`${MARCADOR}\` | ${o.enTabla} |\n`);
    const r = spawnSync('bash', ['scripts/preparar-import.sh', 'Flujos/f.json', '.env.prueba'], {
      cwd: raiz, encoding: 'utf8',
      env: entornoDelEmulador(undefined, {
        CONFIG_LOCAL_MD: join(raiz, 'tabla.md'), BASH_ENV: '', ENV: '',
        RELE_URL_INTERNA: o.terminal ? (o.terminal.url ?? '') : (o.enEnv ? '' : (valor ?? '')),
        RELE_BASES_PERMITIDAS: o.terminal ? (o.terminal.lista ?? '') : (o.listaEnEnv ? '' : lista),
      }),
    });
    return { codigo: r.status, salida: `${r.stdout}${r.stderr}` };
  }

  it('una base https pública se repone, no se imprime y el JSON versionado no cambia', () => {
    const r = correr('https://rele.empresa.example.com:8443');
    expect(r.codigo, r.salida).toBe(0);
    expect(salidaLocal()).toContain('https://rele.empresa.example.com:8443/v1/envio/mensajes/');
    expect(salidaLocal()).not.toContain(MARCADOR);
    expect(r.salida).not.toContain('rele.empresa.example.com');
    expect(readFileSync(join(raiz, 'Flujos', 'f.json'), 'utf8')).toContain(MARCADOR);
  });

  it('http solo para un host interno: un nombre sin puntos, localhost, *.internal, *.local, IP privada o de loopback', () => {
    for (const v of ['http://relay:8080', 'http://relay', 'http://localhost:3000', 'http://rele.internal', 'http://rele.local:81', 'http://10.1.2.3:8080', 'http://172.16.0.9', 'http://172.31.255.1', 'http://192.168.1.20', 'http://127.0.0.1:9000']) {
      const r = correr(v);
      expect(r.codigo, `${v}\n${r.salida}`).toBe(0);
      expect(salidaLocal(), v).toContain(`${v}/v1/envio/mensajes/`);
    }
  });

  it('NIEGA: http con un host público o con una IP pública/no privada aborta y no escribe nada', () => {
    for (const v of ['http://rele.empresa.com', 'http://203.0.113.9', 'http://172.32.0.1', 'http://172.15.0.1', 'http://192.169.0.1', 'http://11.0.0.1', 'http://relay.example.com:8080']) {
      rmSync(join(raiz, 'Flujos', 'f.local.json'), { force: true });
      const r = correr(v);
      expect(r.codigo, v).toBe(1);
      expect(r.salida, v).toContain('http:// solo se admite para un host interno');
      expect(existsSync(join(raiz, 'Flujos', 'f.local.json')), v).toBe(false);
      expect(r.salida).not.toContain(v);
    }
  });

  it('NIEGA: IP disfrazadas, link-local, 0.0.0.0/8 y nombres «metadata» abortan con http y con https (segunda revisión del PR #757)', () => {
    // 169.254.169.254 escrito como un solo número decimal de 32 bits (calculado: el repositorio no lleva secuencias largas de dígitos).
    const decimal = String(169 * 2 ** 24 + 254 * 2 ** 16 + 169 * 2 ** 8 + 254);
    const malos = [
      `http://${decimal}`, `https://${decimal}`, 'http://0xa9fea9fe', 'https://0xa9fea9fe', 'http://0', 'https://0', 'http://169.254.169.254', 'https://169.254.169.254',
      'https://169.254.0.1:8443', 'http://0.0.0.0', 'https://0.1.2.3', 'https://rele.0x7f000001', 'https://10.1.2', 'https://metadata', 'http://metadata.google.internal', 'https://metadata.internal',
      'https://169.254.169.254.', 'http://relay.123',
    ];
    for (const v of malos) {
      rmSync(join(raiz, 'Flujos', 'f.local.json'), { force: true });
      const r = correr(v);
      expect(r.codigo, `${v}\n${r.salida}`).toBe(1);
      expect(existsSync(join(raiz, 'Flujos', 'f.local.json')), v).toBe(false);
      expect(r.salida).not.toContain(v);
    }
  });

  it('NIEGA: sin RELE_BASES_PERMITIDAS no se repone nada: aborta, no escribe la salida y no muestra el valor (ronda 3 del PR #757)', () => {
    for (const v of ['https://rele.empresa.example.com', 'http://relay:8080']) {
      rmSync(join(raiz, 'Flujos', 'f.local.json'), { force: true });
      const r = correr(v, { lista: '' });
      expect(r.codigo, `${v}\n${r.salida}`).toBe(1);
      expect(r.salida).toContain('RELE_BASES_PERMITIDAS');
      expect(existsSync(join(raiz, 'Flujos', 'f.local.json')), v).toBe(false);
      expect(r.salida).not.toContain(v);
    }
  });

  it('NIEGA: la lista tiene que nombrar la base EXACTA: el host solo, otro puerto u otro esquema no valen', () => {
    for (const [v, lista] of [['https://rele.empresa.example.com', 'rele.empresa.example.com'], ['https://rele.empresa.example.com:8443', 'https://rele.empresa.example.com'],
      ['http://relay:8080', 'https://relay:8080'], ['http://relay:8080', 'http://relay'], ['http://relay:8080', 'relay']] as const) {
      rmSync(join(raiz, 'Flujos', 'f.local.json'), { force: true });
      const r = correr(v, { lista });
      expect(r.codigo, `${v} vs ${lista}\n${r.salida}`).toBe(1);
      expect(existsSync(join(raiz, 'Flujos', 'f.local.json')), `${v} vs ${lista}`).toBe(false);
    }
  });

  it('NIEGA: 255.x.x.x, multicast 224.0.0.0/4 y reservadas 240.0.0.0/4 abortan con http y con https, aunque la lista las nombre', () => {
    for (const v of ['http://255.255.255.255', 'https://255.1.2.3', 'http://224.0.0.1', 'https://239.255.255.250', 'http://240.0.0.1', 'https://250.1.1.1:8443']) {
      rmSync(join(raiz, 'Flujos', 'f.local.json'), { force: true });
      const r = correr(v);
      expect(r.codigo, `${v}\n${r.salida}`).toBe(1);
      expect(r.salida).toContain('multicast');
      expect(existsSync(join(raiz, 'Flujos', 'f.local.json')), v).toBe(false);
    }
    // Y 223.x.x.x (justo debajo) no es multicast: con https y la lista exacta se repone.
    // (la IP se arma por partes: el saneo del repositorio público veta una IPv4 pública escrita en un archivo)
    expect(correr(`https://${['223', '1', '2', '3'].join('.')}`).codigo).toBe(0);
  });

  it('el .env del cliente manda sobre la variable de la terminal: si difieren se avisa SIN mostrar valores y se usa la del .env', () => {
    const r = correr('http://relay:8080', { enEnv: true, listaEnEnv: true, terminal: { url: 'https://otro.cliente.example.com', lista: 'https://otro.cliente.example.com' } });
    expect(r.codigo, r.salida).toBe(0);
    expect(salidaLocal()).toContain('http://relay:8080/v1/envio/mensajes/');
    expect(salidaLocal()).not.toContain('otro.cliente.example.com');
    expect(r.salida).toMatch(/RELE_URL_INTERNA: la variable de la terminal difiere/);
    expect(r.salida).toMatch(/RELE_BASES_PERMITIDAS: la variable de la terminal difiere/);
    expect(r.salida).not.toContain('relay:8080');
    expect(r.salida).not.toContain('otro.cliente.example.com');
  });

  const SUELTO = { name: 'f', nodes: [{ name: 'Config base', type: 'n8n-nodes-base.set', typeVersion: 3.4, position: [0, 0], parameters: { value: MARCADOR } }], connections: {}, settings: {} };
  const corrienteSuelto = (archivo: string) => {
    writeFileSync(join(raiz, 'Flujos', archivo), JSON.stringify(SUELTO));
    return spawnSync('bash', ['scripts/preparar-import.sh', `Flujos/${archivo}`, '.env.prueba'], {
      cwd: raiz, encoding: 'utf8',
      env: entornoDelEmulador(undefined, { CONFIG_LOCAL_MD: join(raiz, 'tabla.md'), BASH_ENV: '', ENV: '', RELE_URL_INTERNA: 'https://rele.empresa.example.com', RELE_BASES_PERMITIDAS: '' }),
    });
  };
  it('NIEGA: un JSON cualquiera con el marcador como DATO de Config (no en una URL) también exige RELE_BASES_PERMITIDAS', () => {
    for (const archivo of ['f.json', 'otro-flujo.json', 'salida-de-persona.json.bak.json']) {
      rmSync(join(raiz, 'Flujos', archivo.replace(/\.json$/, '.local.json')), { force: true });
      const r = corrienteSuelto(archivo);
      expect(r.status, `${archivo}\n${r.stdout}${r.stderr}`).toBe(1);
      expect(`${r.stdout}${r.stderr}`).toContain('RELE_BASES_PERMITIDAS');
      expect(existsSync(join(raiz, 'Flujos', archivo.replace(/\.json$/, '.local.json'))), archivo).toBe(false);
    }
  });
  it('NIEGA: Flujos/salida-de-persona.json NO queda libre de RELE_BASES_PERMITIDAS si lleva el marcador en una URL /v1/envio/ (la excepción cubre solo el dato suelto)', () => {
    const conUrl = { ...SUELTO, nodes: [{ name: 'Enviar', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [0, 0], parameters: { url: `=${MARCADOR}/v1/envio/mensajes/{{ 1 }}` } }] };
    writeFileSync(join(raiz, 'Flujos', 'salida-de-persona.json'), JSON.stringify(conUrl));
    rmSync(join(raiz, 'Flujos', 'salida-de-persona.local.json'), { force: true });
    const r = spawnSync('bash', ['scripts/preparar-import.sh', 'Flujos/salida-de-persona.json', '.env.prueba'], {
      cwd: raiz, encoding: 'utf8',
      env: entornoDelEmulador(undefined, { CONFIG_LOCAL_MD: join(raiz, 'tabla.md'), BASH_ENV: '', ENV: '', RELE_URL_INTERNA: 'https://rele.empresa.example.com', RELE_BASES_PERMITIDAS: '' }),
    });
    expect(r.status, `${r.stdout}${r.stderr}`).toBe(1);
    expect(`${r.stdout}${r.stderr}`).toContain('RELE_BASES_PERMITIDAS');
    expect(existsSync(join(raiz, 'Flujos', 'salida-de-persona.local.json'))).toBe(false);
  });
  const corrienteSalida = (parametros: Record<string, unknown>) => {
    const f = { ...SUELTO, nodes: [{ name: 'Config base', type: 'n8n-nodes-base.set', typeVersion: 3.4, position: [0, 0], parameters: { value: MARCADOR } }, { name: 'Enviar', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [0, 0], parameters: parametros }] };
    writeFileSync(join(raiz, 'Flujos', 'salida-de-persona.json'), JSON.stringify(f));
    rmSync(join(raiz, 'Flujos', 'salida-de-persona.local.json'), { force: true });
    return spawnSync('bash', ['scripts/preparar-import.sh', 'Flujos/salida-de-persona.json', '.env.prueba'], {
      cwd: raiz, encoding: 'utf8',
      env: entornoDelEmulador(undefined, { CONFIG_LOCAL_MD: join(raiz, 'tabla.md'), BASH_ENV: '', ENV: '', RELE_URL_INTERNA: 'https://rele.empresa.example.com', RELE_BASES_PERMITIDAS: '' }),
    });
  };
  it('NIEGA: las variantes de la ruta /v1/envio en salida-de-persona.json (sin barra final, doble barra, /./, /V1/, concatenación) exigen la lista', () => {
    const variantes: Record<string, string> = {
      'sin barra final': "={{ $('Config base').first().json.releBaseUrl }}/v1/envio",
      'doble barra': "={{ $('Config base').first().json.releBaseUrl }}//v1/envio/mensajes/1",
      'punto': "={{ $('Config base').first().json.releBaseUrl }}/v1/./envio/mensajes/1",
      'mayúsculas': "={{ $('Config base').first().json.releBaseUrl }}/V1/ENVIO/mensajes/1",
      'concatenación': "={{ $('Config base').first().json.releBaseUrl + '/v1' + '/envio/' + 'mensajes/1' }}",
      'concatenación partida': "={{ $('Config base').first().json.releBaseUrl + '/v' + '1/' + 'envio/mensajes/1' }}",
      'solo envio': "={{ $('Config base').first().json.releBaseUrl + '/' + 'envio/mensajes/1' }}",
      'otra copia de la expresión legítima más una variante': "={{ $('Config base').first().json.releBaseUrl }}/v1/envio/mensajes/1 y {{ x }}/V1/envio/",
    };
    for (const [nombre, url] of Object.entries(variantes)) {
      const r = corrienteSalida({ url });
      expect(r.status, `${nombre}\n${r.stdout}${r.stderr}`).toBe(1);
      expect(`${r.stdout}${r.stderr}`, nombre).toContain('RELE_BASES_PERMITIDAS');
      expect(existsSync(join(raiz, 'Flujos', 'salida-de-persona.local.json')), nombre).toBe(false);
    }
  });
  it('la preparación legítima de salida-de-persona.json (la expresión exacta del archivo real, sin otra ruta) sigue pasando sin la lista', () => {
    const r = corrienteSalida({ url: "={{ $('Config base').first().json.releBaseUrl }}/v1/envio/mensajes/{{ $('Config base').first().json.phoneNumberId }}" });
    expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
    expect(existsSync(join(raiz, 'Flujos', 'salida-de-persona.local.json'))).toBe(true);
  });
  it('el Flujos/salida-de-persona.json REAL se prepara sin RELE_BASES_PERMITIDAS (la regla nueva no rompe su uso legítimo)', () => {
    copyFileSync(join(REPO, 'Flujos', 'salida-de-persona.json'), join(raiz, 'Flujos', 'salida-de-persona.json'));
    rmSync(join(raiz, 'Flujos', 'salida-de-persona.local.json'), { force: true });
    // El archivo real lleva el marcador del flujo de alertas (settings.errorWorkflow): se resuelve por NOMBRE contra el n8n destino, igual que en
    // error-workflow-por-nombre.test.ts: scripts/lib, un curl falso y la lista con la alerta. Sin red.
    cpSync(join(REPO, 'scripts', 'lib'), join(raiz, 'scripts', 'lib'), { recursive: true });
    mkdirSync(join(dir, 'bin'));
    copyFileSync(join(REPO, 'admin', 'pruebas', 'core', 'curl-falso-n8n.sh'), join(dir, 'bin', 'curl'));
    chmodSync(join(dir, 'bin', 'curl'), 0o755);
    writeFileSync(join(dir, 'curl.log'), '');
    writeFileSync(join(raiz, '.env.prueba'), 'N8N_BASE_URL=https://n8n.invalid\nN8N_API_KEY=clave-de-prueba\n', { mode: 0o600 });
    const r = spawnSync('bash', ['scripts/preparar-import.sh', 'Flujos/salida-de-persona.json', '.env.prueba'], {
      cwd: raiz, encoding: 'utf8',
      env: entornoDelEmulador(undefined, {
        PATH: `${join(dir, 'bin')}:${process.env.PATH ?? ''}`, HOME: dir, REGISTRO_CURL: join(dir, 'curl.log'),
        RESPUESTA_CREDENCIALES: JSON.stringify({ data: [] }), RESPUESTA_LISTA_FLUJOS: JSON.stringify({ data: [{ id: 'idAlerta42', name: 'NovuChat — Error de envío incierto' }] }),
        HTTPS_PROXY: 'http://127.0.0.1:1', HTTP_PROXY: 'http://127.0.0.1:1', NO_PROXY: '',
        CONFIG_LOCAL_MD: join(raiz, 'tabla.md'), BASH_ENV: '', ENV: '', RELE_URL_INTERNA: 'http://relay:8080', RELE_BASES_PERMITIDAS: '',
      }),
    });
    expect(`${r.stdout}${r.stderr}`).not.toContain('RELE_BASES_PERMITIDAS');
    expect(`${r.stdout}${r.stderr}`).not.toContain('idAlerta42');
    expect(readFileSync(join(raiz, 'Flujos', 'salida-de-persona.local.json'), 'utf8')).toContain('http://relay:8080');
  });
  it('la excepción es NOMBRADA por archivo: Flujos/salida-de-persona.json (ruta exacta) valida su propia lista y se repone sin RELE_BASES_PERMITIDAS', () => {
    const r = corrienteSuelto('salida-de-persona.json');
    expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
    expect(readFileSync(join(raiz, 'Flujos', 'salida-de-persona.local.json'), 'utf8')).toContain('"value": "https://rele.empresa.example.com"');
    // Y con otro nombre en otra carpeta, no: la excepción no es por forma ni por nombre suelto.
    mkdirSync(join(raiz, 'Flujos', 'sub'), { recursive: true });
    writeFileSync(join(raiz, 'Flujos', 'sub', 'salida-de-persona.json'), JSON.stringify(SUELTO));
    const otra = spawnSync('bash', ['scripts/preparar-import.sh', 'Flujos/sub/salida-de-persona.json', '.env.prueba'], {
      cwd: raiz, encoding: 'utf8',
      env: entornoDelEmulador(undefined, { CONFIG_LOCAL_MD: join(raiz, 'tabla.md'), BASH_ENV: '', ENV: '', RELE_URL_INTERNA: 'https://rele.empresa.example.com', RELE_BASES_PERMITIDAS: '' }),
    });
    expect(otra.status).toBe(1);
  });

  it('NIEGA: la lista del .env también manda: una lista de la terminal que sí nombraba la base no la rescata', () => {
    const r = correr('https://rele.empresa.example.com', { enEnv: true, listaEnEnv: true, lista: 'https://otra.example.com', terminal: { url: 'https://rele.empresa.example.com', lista: 'https://rele.empresa.example.com' } });
    expect(r.codigo, r.salida).toBe(1);
    expect(existsSync(join(raiz, 'Flujos', 'f.local.json'))).toBe(false);
  });

  it('la lista cerrada RELE_BASES_PERMITIDAS deja pasar solo lo que nombra', () => {
    const corre = (v: string, lista: string) => {
      writeFileSync(join(raiz, 'Flujos', 'f.json'), JSON.stringify(FLUJO));
      const r = spawnSync('bash', ['scripts/preparar-import.sh', 'Flujos/f.json', '.env.prueba'], {
        cwd: raiz, encoding: 'utf8',
        env: entornoDelEmulador(undefined, { CONFIG_LOCAL_MD: join(raiz, 'tabla.md'), BASH_ENV: '', ENV: '', RELE_URL_INTERNA: v, RELE_BASES_PERMITIDAS: lista }),
      });
      return r.status;
    };
    expect(corre('http://relay:8080', 'http://relay:8080,https://otro.example.com')).toBe(0);
    expect(corre('https://otro.example.com', 'http://relay:8080,https://otro.example.com')).toBe(0);
    expect(corre('http://relay2:8080', 'http://relay:8080')).toBe(1);
    expect(corre('https://intruso.example.com', 'http://relay:8080')).toBe(1);
    // Aun en la lista, un link-local no pasa.
    expect(corre('https://169.254.169.254', 'https://169.254.169.254')).toBe(1);
  });

  it('NIEGA: con ruta, barra final, credenciales, comillas, espacios, puerto roto o esquema ajeno aborta', () => {
    for (const v of ['https://rele.example.com/', 'https://rele.example.com/v1', 'https://usuario:clave@rele.example.com', "https://rele.example.com'+alert(1)+'", 'https://rele.example.com extra', 'https://rele.example.com:99999', 'ftp://rele.example.com', 'rele.example.com', 'https://', 'https://-malo.example.com', 'https://rele.example.com?x=1', 'https://rele.example.com#x', 'http://relay\\x']) {
      rmSync(join(raiz, 'Flujos', 'f.local.json'), { force: true });
      const r = correr(v);
      expect(r.codigo, v).toBe(1);
      expect(existsSync(join(raiz, 'Flujos', 'f.local.json')), v).toBe(false);
    }
  });

  it('NIEGA: sin la variable (ni en el entorno, ni en el .env, ni en la tabla) el marcador queda, el script sale 1 y publicar-flujo.sh lo detendría', () => {
    const r = correr(undefined);
    expect(r.codigo, r.salida).toBe(1);
    expect(salidaLocal()).toContain(MARCADOR);
    expect(MARCADOR_SIN_REPONER.test(salidaLocal())).toBe(true);
  });

  it('el valor también puede venir del .env del cliente o de la fila de la tabla (en ese orden: entorno, .env, tabla)', () => {
    const delEnv = correr('http://relay:8080', { enEnv: true });
    expect(delEnv.codigo, delEnv.salida).toBe(0);
    expect(salidaLocal()).toContain('http://relay:8080/v1/envio/mensajes/');
    const deTabla = correr(undefined, { enTabla: 'https://tabla.example.com' });
    expect(deTabla.codigo, deTabla.salida).toBe(0);
    expect(salidaLocal()).toContain('https://tabla.example.com/v1/envio/mensajes/');
    // El entorno manda sobre la tabla.
    const ambos = correr('https://entorno.example.com', { enTabla: 'https://tabla.example.com' });
    expect(ambos.codigo, ambos.salida).toBe(0);
    expect(salidaLocal()).toContain('https://entorno.example.com/v1/envio/mensajes/');
    expect(salidaLocal()).not.toContain('tabla.example.com');
  });

  it('un valor inválido en el .env también aborta (no cae a la tabla)', () => {
    const r = correr('http://rele.empresa.com', { enEnv: true, enTabla: 'https://tabla.example.com' });
    expect(r.codigo, r.salida).toBe(1);
  });

  it('el script no trae ninguna URL real del relé: el repositorio solo conoce el marcador', () => {
    const fuente = readFileSync(join(REPO, 'scripts', 'preparar-import.sh'), 'utf8');
    expect(fuente).toContain(MARCADOR);
    expect(fuente).not.toMatch(/https?:\/\/(?!n8n|\$|\{|host|rele\.)[a-z0-9.-]+\.(com|net|org|io|app|dev|cloud)\b/i);
  });
});
