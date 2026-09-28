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
import {
  closeSync, existsSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync,
  statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clienteDeTenant, comprobarDestino, destinoDelEnlace, escribirEnlace, guardarEnlaceDeContrasena, raizDelProyecto,
} from '../../scripts/plataforma/enlace-privado.mjs';
import { entornoDelEmulador } from '../core/entorno-del-hijo.ts';

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

/** El código sin literales de texto: lo que queda son identificadores y llamadas. */
const sinTextos = (c: string) => c.replace(/`(?:\\[\s\S]|[^`\\])*`|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g, '""');

describe('Los scripts no tienen el enlace en la mano: lo pide y lo escribe el módulo', () => {
  // Revisión de seguridad del PR #254: comprobar «no se imprime» mirando las
  // llamadas a console dejaba pasar `'…' + enlace`, `process.stdout.write`,
  // `{ enlace }`, `enlace.trim()`… La forma robusta es que el valor no llegue
  // nunca al script: sin variable, no hay qué imprimir.
  it.each(CON_ENLACE.map((r) => [r.slice(ADMIN.length + 1), r]))('%s', (_nombre, ruta) => {
    const c = codigo(ruta);
    expect(c).toMatch(/from '\.\/plataforma\/enlace-privado\.mjs'/);
    expect(c).toMatch(/await guardarEnlaceDeContrasena\(\{/);
    expect(c).not.toMatch(/generatePasswordResetLink|generateEmailVerificationLink|generateSignInWithEmailLink/);
    expect(c).not.toMatch(/\bescribirEnlace\b|\bwriteFileSync\b|\bappendFileSync\b|\bcreateWriteStream\b/);
    // Ningún identificador `enlace` (ni variable, ni argumento, ni propiedad).
    expect(sinTextos(c)).not.toMatch(/\benlace\b/);
    expect(c).not.toMatch(/\$\{\s*enlace\b/);
  });

  it('el módulo no escribe en la consola ni en la salida estándar', () => {
    const c = codigo(join(ADMIN, 'scripts', 'plataforma', 'enlace-privado.mjs'));
    expect(c).not.toMatch(/\bconsole\.|process\.(stdout|stderr)/);
  });
});

describe('guardarEnlaceDeContrasena(): el enlace no sale por ningún lado', () => {
  const MARCA = `MARCA-${process.pid}-oobCode`;
  const auth = { generatePasswordResetLink: vi.fn(async () => `https://ejemplo.invalid/accion?oobCode=${MARCA}`) };
  let raiz: string;
  beforeEach(() => {
    raiz = join(mkdtempSync(join(tmpdir(), 'enlace-guardar-')), 'proyecto');
    mkdirSync(join(raiz, 'CLIENTES', 'SALON_ROSA'), { recursive: true });
    auth.generatePasswordResetLink.mockClear();
  });

  it('lo escribe en el archivo y ni la salida ni lo devuelto lo contienen', async () => {
    const salida: string[] = [];
    const capturar = (s: unknown) => { salida.push(String(s)); return true; };
    const espias = [
      vi.spyOn(process.stdout, 'write').mockImplementation(capturar),
      vi.spyOn(process.stderr, 'write').mockImplementation(capturar),
      ...(['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m)
        .mockImplementation((...a: unknown[]) => { salida.push(a.map(String).join(' ')); })),
    ];
    let rel: string;
    try {
      rel = await guardarEnlaceDeContrasena({
        auth, correo: 'ana@ejemplo.com', raiz, cliente: 'SALON_ROSA', nombre: 'enlace-admin-salon-rosa',
        encabezado: 'Enlace para Ana.\nBorre este archivo.',
      });
    } finally {
      for (const e of espias) e.mockRestore();
    }
    expect(auth.generatePasswordResetLink).toHaveBeenCalledWith('ana@ejemplo.com');
    expect(JSON.stringify(rel)).not.toContain(MARCA);
    expect(salida.join('\n')).not.toContain(MARCA);
    const texto = readFileSync(join(raiz, rel), 'utf8');
    expect(texto).toContain(MARCA);
    expect(texto.startsWith('Enlace para Ana.')).toBe(true);
  });

  it('sin carpeta del cliente falla SIN pedirle el enlace a Auth', async () => {
    await expect(guardarEnlaceDeContrasena({
      auth, correo: 'ana@ejemplo.com', raiz, cliente: 'NO_ESTA', nombre: 'enlace-admin-x-y', encabezado: 'x',
    })).rejects.toThrow(/no existe CLIENTES\/NO_ESTA/);
    expect(auth.generatePasswordResetLink).not.toHaveBeenCalled();
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
    expect(statSync(dirname(archivo)).mode & 0o777).toBe(0o700);
    // Permisos y contenido del MISMO descriptor (CodeQL js/file-system-race).
    const fd = openSync(archivo, 'r');
    try {
      expect(fstatSync(fd).mode & 0o777).toBe(0o600);
      expect(readFileSync(fd, 'utf8')).toContain('oobCode');
    } finally {
      closeSync(fd);
    }
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

  // CWE-59 (revisión de seguridad del PR #254): un enlace simbólico dejado por
  // alguien con el mismo usuario no puede desviar la credencial.
  it('si CLIENTES/<X> es un enlace simbólico que sale de CLIENTES/, falla sin escribir', () => {
    const afuera = mkdtempSync(join(tmpdir(), 'enlace-afuera-'));
    symlinkSync(afuera, join(raiz, 'CLIENTES', 'DESVIADO'));
    expect(() => escribir('DESVIADO')).toThrow(/sale de CLIENTES/);
    expect(readdirSync(afuera)).toEqual([]);
  });

  it('si .enlaces es un enlace simbólico, falla sin escribir', () => {
    const afuera = mkdtempSync(join(tmpdir(), 'enlace-afuera-'));
    symlinkSync(afuera, join(raiz, 'CLIENTES', 'SALON_ROSA', '.enlaces'));
    expect(() => escribir()).toThrow(/no es una carpeta de verdad/);
    expect(readdirSync(afuera)).toEqual([]);
  });

  it('si el archivo destino es un enlace simbólico, se reemplaza el enlace y el apuntado queda intacto', () => {
    const publico = join(mkdtempSync(join(tmpdir(), 'enlace-afuera-')), 'publico.txt');
    writeFileSync(publico, 'nada\n', { mode: 0o644 });
    mkdirSync(join(raiz, 'CLIENTES', 'SALON_ROSA', '.enlaces'), { mode: 0o700 });
    const destino = join(raiz, 'CLIENTES', 'SALON_ROSA', '.enlaces', `${NOMBRE}.txt`);
    symlinkSync(publico, destino);
    escribir();
    expect(readFileSync(publico, 'utf8')).toBe('nada\n');
    expect(statSync(publico).mode & 0o777).toBe(0o644);
    expect(lstatSync(destino).isSymbolicLink()).toBe(false);
    expect(statSync(destino).mode & 0o777).toBe(0o600);
    expect(readdirSync(dirname(destino))).toEqual([`${NOMBRE}.txt`]); // sin temporales
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
      input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }), encoding: 'utf8', env: entornoDelEmulador(undefined),
    });
    return r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecision : 'nada';
  };

  // Cualquier comando que reciba una ruta a la carpeta o a un archivo de enlace,
  // con comodines incluidos, y la búsqueda recursiva que entraría sin nombrarla.
  // Los casos de H1 de la revisión de seguridad del PR #254 están todos.
  it.each([
    'cat CLIENTES/BELLIDO/.enlaces/enlace-admin-bellido.txt',
    'ls -la ../../CLIENTES/X/.enlaces',
    'head < ~/enlace-admin-bellido.txt',
    'cp CLIENTES/X/.enlaces/enlace-oper-x.txt /tmp/',
    'grep -h "" CLIENTES/X/.enlaces/enlace-admin-x.txt',
    'sort CLIENTES/X/.enlaces/*',
    'diff /dev/null CLIENTES/X/.enlaces/enlace-admin-x.txt',
    'jq -R . CLIENTES/X/.enlaces/enlace-admin-x.txt',
    'cut -c1- CLIENTES/X/.enlaces/enlace-admin-x.txt',
    'cat CLIENTES/X/.[e]nlaces/*',
    'cat CLIENTES/*/.*/enlace-*',
    'python3 -c "p = open( \'CLIENTES/X/.enlaces/a.txt\' ); print(p.read())"',
    'git diff --no-index /dev/null CLIENTES/X/.enlaces/enlace-admin-x.txt',
    'cd /tmp && cat ../srv/NovuChat/CLIENTES/X/.enlaces/a',
    'python3 - <<EOF\nprint(open("CLIENTES/X/.enlaces/a").read())\nEOF',
    'grep -rn oobCode CLIENTES/',
    'grep -rn "https" /srv/NovuChat/CLIENTES/BELLIDO',
    'rg --hidden -n https CLIENTES/X',
    'rg -uu https CLIENTES',
    'find CLIENTES -name "*.txt" -exec cat {} +',
    // Segunda revisión (N1): el nombre real del cliente con comodines.
    'cat CLIENTES/BELLIDO/.*/*',
    'cat CLIENTES/BELLIDO/.enl?ces/*',
    'head CLIENTES/RUBEN_ROCA/.e*/*',
    // N2: el recorrido desde la copia principal o desde una carpeta que la contiene.
    // (La copia principal, no este worktree: CLIENTES/ vive allá.)
    `cd ${raizDelProyecto()} && grep -rn TODO .`,
    `cd ${join(raizDelProyecto(), 'admin')} && rg --hidden TODO ..`,
    'rg --hidden oobCode ~',
    'cd CLIENTES/BELLIDO && ls -la .enlaces',
    // N3: recorrer sin -exec y sin nombrar la carpeta.
    'find CLIENTES/BELLIDO -type f | xargs cat',
    'find CLIENTES -type f -print0 | xargs -0 grep -h https',
    'cp -r CLIENTES/BELLIDO /tmp/b',
    'tar -cf - CLIENTES/BELLIDO',
    // N5: una palabra con espacios de git solo se salta si es un mensaje.
    'git diff --no-index /dev/null "$(echo CLIENTES/X/.enlaces/a.txt)"',
  ])('el gancho niega «%s»', (cmd) => {
    expect(gancho(cmd)).toBe('deny');
  });

  // Y lo que NO es tocar el enlace pasa: documentar la carpeta en un commit o
  // un PR, buscar el patrón escapado en la documentación, buscar en CLIENTES
  // excluyéndola, o comodines que la shell no haría entrar a una carpeta oculta.
  // Los casos de H3 de la misma revisión están todos.
  it.each([
    'grep -rn "enlaces" docs/',
    'grep -rn "\\.enlaces" docs | head -20',
    'grep -rn --exclude-dir=.enlaces https CLIENTES/BELLIDO',
    'rg -n https CLIENTES/BELLIDO',
    'ls CLIENTES/',
    'ls -d .*',
    'ls */*',
    'node scripts/alta-comercio.mjs --proyecto p --tenant x --nombre X --admin ana@ejemplo.com',
    'git commit -m "Seguridad: va a CLIENTES/<CLIENTE>/.enlaces/"',
    'git commit -F - <<\'EOF\'\nEl enlace va a CLIENTES/<CLIENTE>/.enlaces/\nEOF',
    'git diff -- .gitignore | tail -5',
    'gh pr create --body "$(cat docs/x.md)"',
    'GH_CONFIG_DIR=/x gh pr edit 1 --body "el enlace va a CLIENTES/<CLIENTE>/.enlaces/"',
    // Segunda revisión (N4): buscar o nombrar el texto no es abrir la carpeta.
    "grep -rn '.enlaces' docs",
    "rg -n '.enlaces/' docs .claude",
    'git grep -n .enlaces',
    'git log --oneline --grep=.enlaces',
    'echo "La carpeta .enlaces/ es privada"',
    'git check-ignore -v CLIENTES/X/.enlaces/a.txt',
    // Y recorrer CLIENTES excluyéndola, o recorrer otra carpeta, pasa.
    'grep -rn --exclude-dir .enlaces https CLIENTES/BELLIDO',
    "find CLIENTES -path '*/.enlaces' -prune -o -type f -print | xargs grep -l https",
    'grep -rn TODO admin/',
    'cp -r admin/scripts /tmp/x',
  ])('el gancho deja pasar «%s»', (cmd) => {
    expect(gancho(cmd)).toBe('nada');
  });
});
