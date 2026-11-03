/**
 * `preparar-import.sh` REPONE la URL INTERNA DEL RELÉ B9 desde una variable (revisión del PR #757), y solo así:
 *   - el valor sale de `RELE_URL_INTERNA` (entorno o `.env` del cliente) y NUNCA está en el repositorio; no se imprime;
 *   - es una base: `http(s)://host[:puerto]`, sin ruta, sin barra final, sin credenciales;
 *   - `http://` solo para un host interno (sin puntos, localhost, *.internal, *.local, IP privada); cualquier otro host exige `https://`;
 *   - si falta o es inválida, el marcador queda y `publicar-flujo.sh` aborta (cualquier `REEMPLAZAR_[A-Z]…` que quede lo detiene).
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

  function correr(valor: string | undefined, o: { enEnv?: boolean; enTabla?: string } = {}) {
    writeFileSync(join(raiz, 'Flujos', 'f.json'), JSON.stringify(FLUJO));
    writeFileSync(join(raiz, '.env.prueba'), `N8N_BASE_URL=https://n8n.invalid\n${o.enEnv && valor !== undefined ? `RELE_URL_INTERNA=${valor}\n` : ''}`);
    writeFileSync(join(raiz, 'tabla.md'), '| Marcador | Valor |\n|---|---|\n');
    if (o.enTabla !== undefined) writeFileSync(join(raiz, 'tabla.md'), `| Marcador | Valor |\n|---|---|\n| \`${MARCADOR}\` | ${o.enTabla} |\n`);
    const r = spawnSync('bash', ['scripts/preparar-import.sh', 'Flujos/f.json', '.env.prueba'], {
      cwd: raiz, encoding: 'utf8',
      env: entornoDelEmulador(undefined, { CONFIG_LOCAL_MD: join(raiz, 'tabla.md'), BASH_ENV: '', ENV: '', RELE_URL_INTERNA: o.enEnv ? '' : (valor ?? '') }),
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

  it('la lista cerrada opcional RELE_BASES_PERMITIDAS deja pasar solo lo que nombra', () => {
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
