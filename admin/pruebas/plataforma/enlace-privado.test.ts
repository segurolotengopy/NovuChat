/**
 * EL ENLACE DE CONTRASEÑA NO VA AL DIRECTORIO PERSONAL NI A LA PANTALLA.
 *
 * `alta-comercio.mjs` y `asignar-rol.mjs` generan un enlace de Firebase Auth
 * que fija la contraseña de una cuenta de comercio: es la credencial misma por
 * unas horas. Hasta el 28/09/2026 lo escribían en `~/enlace-*.txt`, y ese día
 * había dos olvidados en el directorio personal (Bellido y Platinum). Desde
 * entonces va a `CLIENTES/<CLIENTE>/.enlaces/` de la copia principal, ignorada
 * por git, con permisos 600 (`scripts/plataforma/enlace-privado.mjs`).
 *
 * Esta suite falla si un script vuelve a usar el directorio personal, si el
 * enlace sale por la salida estándar (la leería el agente que corre el script)
 * o si las defensas contra que un agente lo abra (`.gitignore`,
 * `.claude/settings.json`, el gancho de acciones sensibles) se pierden.
 *
 * No abre Firebase: prueba la función que escribe contra una raíz falsa y lee
 * las fuentes de los scripts.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clienteDeTenant, comprobarDestino, destinoDelEnlace, escribirEnlace, raizDelProyecto,
} from '../../scripts/plataforma/enlace-privado.mjs';

const aqui = dirname(fileURLToPath(import.meta.url));
const ADMIN = join(aqui, '..', '..');
const REPO = join(ADMIN, '..');

/** La fuente SIN COMENTARIOS: los comentarios cuentan, con razón, que antes iba a `~/`. */
const codigo = (ruta: string) => readFileSync(ruta, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

const scriptsMjs = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const ruta = join(dir, e.name);
  if (e.isDirectory()) return e.name === 'node_modules' ? [] : scriptsMjs(ruta);
  return e.name.endsWith('.mjs') ? [ruta] : [];
});

const CON_ENLACE = ['alta-comercio.mjs', 'asignar-rol.mjs'].map((f) => join(ADMIN, 'scripts', f));

describe('Ningún script de admin/scripts escribe en el directorio personal', () => {
  // Para escribir en `~/` hay que nombrarlo: `homedir()`, `$HOME` o `~/`.
  // Ninguno de estos scripts lo necesita; las credenciales las toman de
  // variables de entorno que fija quien los corre.
  it.each(scriptsMjs(join(ADMIN, 'scripts')).map((r) => [r.slice(ADMIN.length + 1), r]))(
    '%s', (_nombre, ruta) => {
      const c = codigo(ruta);
      expect(c).not.toMatch(/\bhomedir\b/);
      expect(c).not.toMatch(/process\.env\.HOME\b|process\.env\[['"]HOME['"]\]/);
      expect(c).not.toMatch(/['"`]~\//);
    });
});

describe('Los scripts que generan el enlace lo dejan en la carpeta del cliente y no lo imprimen', () => {
  it.each(CON_ENLACE.map((r) => [r.slice(ADMIN.length + 1), r]))('%s', (_nombre, ruta) => {
    const c = codigo(ruta);
    expect(c).toMatch(/from '\.\/plataforma\/enlace-privado\.mjs'/);
    expect(c).not.toMatch(/\bwriteFileSync\b/);
    // El enlace se interpola UNA vez, dentro del texto que recibe escribirEnlace.
    expect(c.match(/\$\{enlace\}/g)).toHaveLength(1);
    expect(c).toMatch(/escribirEnlace\(\{[^}]*texto:[\s\S]*?\$\{enlace\}[\s\S]*?\}\)/);
    // Y nunca va a la consola, ni interpolado ni como argumento.
    expect(c).not.toMatch(/console\.\w+\([^;]*\$\{enlace\}/);
    expect(c).not.toMatch(/console\.\w+\([^;]*[(,]\s*enlace\s*[,)]/);
  });
});

describe('escribirEnlace()', () => {
  let raiz: string;
  // Un nombre que no puede existir de antes en el directorio personal. (En los
  // hilos de vitest, cambiar HOME no cambia lo que ve homedir(): se mira el real.)
  const NOMBRE = `enlace-admin-prueba-${process.pid}`;
  const enCasa = () => existsSync(join(homedir(), `${NOMBRE}.txt`));

  beforeEach(() => {
    raiz = join(mkdtempSync(join(tmpdir(), 'enlace-privado-')), 'proyecto');
    mkdirSync(join(raiz, 'CLIENTES', 'SALON_ROSA'), { recursive: true });
  });

  const escribir = (cliente = 'SALON_ROSA') => escribirEnlace({
    raiz, cliente, nombre: NOMBRE, texto: 'https://ejemplo.invalid/accion?oobCode=x\n',
  });

  it('queda en CLIENTES/<CLIENTE>/.enlaces/, con carpeta 700 y archivo 600', () => {
    const rel = escribir();
    expect(rel).toBe(join('CLIENTES', 'SALON_ROSA', '.enlaces', `${NOMBRE}.txt`));
    const archivo = join(raiz, rel);
    expect(statSync(archivo).mode & 0o777).toBe(0o600);
    expect(statSync(dirname(archivo)).mode & 0o777).toBe(0o700);
    expect(readFileSync(archivo, 'utf8')).toContain('oobCode');
  });

  it('nada queda en el directorio personal', () => {
    escribir();
    expect(enCasa()).toBe(false);
  });

  it('si el archivo ya existía con otros permisos, queda en 600', () => {
    escribir();
    const archivo = join(raiz, 'CLIENTES', 'SALON_ROSA', '.enlaces', `${NOMBRE}.txt`);
    spawnSync('chmod', ['644', archivo]);
    escribir();
    expect(statSync(archivo).mode & 0o777).toBe(0o600);
  });

  it('sin la carpeta del cliente falla y no crea nada (ni la carpeta, ni en ~/)', () => {
    expect(() => escribir('OTRO_CLIENTE')).toThrow(/no existe CLIENTES\/OTRO_CLIENTE/);
    expect(existsSync(join(raiz, 'CLIENTES', 'OTRO_CLIENTE'))).toBe(false);
    expect(enCasa()).toBe(false);
  });

  it.each(['../SALON_ROSA', 'SALON_ROSA/..', 'salon_rosa', 'X', '', '.enlaces'])(
    'la carpeta de cliente «%s» se rechaza', (cliente) => {
      expect(() => escribir(cliente)).toThrow(/cliente inválido/);
    });

  it.each(['../x', 'ENLACE', 'a/b', 'x'])('el nombre de enlace «%s» se rechaza', (nombre) => {
    expect(() => destinoDelEnlace({ raiz, cliente: 'SALON_ROSA', nombre })).toThrow(/nombre de enlace inválido/);
  });

  it('comprobarDestino no escribe: dice dónde iría y si la carpeta existe', () => {
    const d = comprobarDestino({ raiz, cliente: 'SALON_ROSA', nombre: 'enlace-oper-salon-rosa' });
    expect(d.existe).toBe(true);
    expect(existsSync(d.carpeta)).toBe(false);
  });
});

describe('La raíz y la carpeta por defecto', () => {
  it('la raíz es la copia del proyecto (la que tiene el .git común), nunca el directorio personal', () => {
    const r = raizDelProyecto();
    expect(r).not.toBe(homedir());
    expect(existsSync(join(r, '.git'))).toBe(true);
    expect(existsSync(join(r, 'admin', 'scripts'))).toBe(true);
  });

  it('el tenant da la carpeta de CLIENTES/ en mayúsculas', () => {
    expect(clienteDeTenant('bellido')).toBe('BELLIDO');
    expect(clienteDeTenant('ruben-roca')).toBe('RUBEN_ROCA');
  });
});

describe('Las defensas para que un agente no lo abra', () => {
  it('git ignora el enlace en la carpeta del cliente y fuera de ella', () => {
    for (const ruta of [
      'CLIENTES/SALON_ROSA/.enlaces/enlace-admin-salon-rosa.txt',
      'admin/.enlaces/enlace-oper-salon-rosa.txt',
      'enlace-admin-salon-rosa.txt',
    ]) {
      const r = spawnSync('git', ['-C', REPO, 'check-ignore', '-q', ruta]);
      expect(r.status, ruta).toBe(0);
    }
  });

  it('.claude/settings.json niega leer cualquier .enlaces/, también fuera del proyecto', () => {
    const deny: string[] = JSON.parse(readFileSync(join(REPO, '.claude', 'settings.json'), 'utf8')).permissions.deny;
    expect(deny).toContain('Read(./**/.enlaces/**)');
    expect(deny).toContain('Read(//**/.enlaces/**)');
  });

  const gancho = (command: string) => {
    const r = spawnSync('bash', [join(REPO, '.claude', 'hooks', 'acciones-sensibles.sh')], {
      input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }), encoding: 'utf8',
    });
    return r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecision : 'nada';
  };

  it.each([
    'cat CLIENTES/BELLIDO/.enlaces/enlace-admin-bellido.txt',
    'ls -la ../../CLIENTES/X/.enlaces',
    'head < ~/enlace-admin-bellido.txt',
    'cp CLIENTES/X/.enlaces/enlace-oper-x.txt /tmp/',
  ])('el gancho niega «%s»', (cmd) => {
    expect(gancho(cmd)).toBe('deny');
  });

  it.each([
    'grep -rn "enlaces" docs/',
    'node scripts/alta-comercio.mjs --proyecto p --tenant x --nombre X --admin a@b.co',
  ])('el gancho deja pasar «%s»', (cmd) => {
    expect(gancho(cmd)).toBe('nada');
  });
});
