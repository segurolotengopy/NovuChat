/**
 * LA PRUEBA DE IDENTIDAD DEL ENSAMBLADOR DE FLUJOS.
 *
 * Es la regla de integración del frente de modularización: nada se fusiona
 * mientras ensamblar los módulos de `Flujos/src/` y `Flujos/prompts/` no
 * reproduzca cada JSON de `Flujos/` BYTE A BYTE. Un solo byte distinto
 * significa que el ensamblador perdió algo que hoy corre en producción, y por
 * eso acá se compara con `Buffer.equals`, no con un diff tolerante.
 *
 * Qué se prueba:
 *   1. Para cada JSON con manifiesto, ensamblar reproduce el archivo tal cual.
 *   2. Para los 8 JSON, `verificar` pasa: los que no tienen manifiesto se
 *      declaran «sin manifiesto, idéntico por definición», y se dice cuáles.
 *   3. `extraer` seguido de `ensamblar` es la identidad, y `extraer` deja el
 *      manifiesto exactamente como está versionado (no deriva solo).
 *   4. Un módulo o un prompt modificado hace fallar `verificar`, y la falla
 *      nombra el punto de inyección.
 *   5. Un nodo renombrado hace fallar con un mensaje que nombra el nodo y el
 *      manifiesto; un manifiesto que apunta a un nodo del tipo equivocado,
 *      también.
 *   6. Ningún archivo de `Flujos/src/`, `Flujos/prompts/` ni
 *      `Flujos/manifiestos/` contiene un valor real: los mismos patrones de
 *      `scripts/verificar-saneo.sh` y las formas que bloquean el repositorio
 *      público (dígitos sin seis ceros, UUID, rutas con usuario del sistema).
 *   7. El Demo A y Platinum comparten TODOS los módulos salvo el prompt de
 *      Sofía: es la afirmación del bloque B-1, y si deja de ser cierta, la
 *      suite lo dice.
 *   8. La línea de comandos sale con 0 sobre el repositorio.
 *
 * No necesita emulador: lee archivos y compara bytes.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import {
  RAIZ_FLUJOS, carpetas, ensamblarEnMemoria, extraerFlujo, leerManifiesto, listarFlujos,
  rutaDeManifiesto, slug, verificarFlujo,
} from '../scripts/ensamblar-flujo.mjs';

const aqui = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(aqui, '../scripts/ensamblar-flujo.mjs');

const FLUJOS = listarFlujos();
const CON_MANIFIESTO = FLUJOS.filter((f) => leerManifiesto(f) !== null);
const SIN_MANIFIESTO = FLUJOS.filter((f) => leerManifiesto(f) === null);

/** Una copia de `Flujos/` en un directorio temporal, para romperla sin miedo. */
const temporales: string[] = [];
function copiaDeFlujos(): string {
  const dir = mkdtempSync(join(tmpdir(), 'novuchat-ensamblador-'));
  cpSync(RAIZ_FLUJOS, dir, { recursive: true, filter: (src) => !src.endsWith('.local.json') });
  temporales.push(dir);
  return dir;
}
afterAll(() => { for (const d of temporales) rmSync(d, { recursive: true, force: true }); });

const bytes = (ruta: string) => readFileSync(ruta);

describe('Inventario: qué flujos tienen manifiesto', () => {
  it('hay 8 JSON de flujo, y el vertical de reservas (Demo A y Platinum) tiene manifiesto', () => {
    expect(FLUJOS).toHaveLength(8);
    expect(CON_MANIFIESTO).toEqual(expect.arrayContaining(['demo-a-agendamiento.json', 'platinum-agendamiento.json']));
    // Los que todavía no se ensamblan, dichos con nombre: son el bloque B-2.
    expect(SIN_MANIFIESTO).toEqual([
      'agendamiento-seguimientos.json', 'agendamiento-senas-vencidas.json', 'bellido-agendamiento.json',
      'demo-a-recordatorios.json', 'demo-b-venta-cobro.json', 'novuchat-onboarding.json',
    ]);
  });

  it('cada manifiesto declara el flujo del que es y conserva `Config base` con sus REEMPLAZAR_*', () => {
    for (const f of CON_MANIFIESTO) {
      const m = leerManifiesto(f) as { flujo: string; conservanMarcadores: Record<string, string> };
      expect(m.flujo).toBe(f);
      expect(m.conservanMarcadores).toEqual({ 'Config base': 'REEMPLAZAR_' });
      // `scripts/verificar-saneo.sh` exige que todo `Flujos/**.json` tenga un
      // REEMPLAZAR_ (su patrón `Flujos/*.json` alcanza también a los
      // manifiestos). El manifiesto lo cumple porque declara el prefijo que
      // `Config base` conserva; si alguien quita esa declaración, el saneo
      // tomaría el manifiesto por un export sin sanear.
      expect(readFileSync(rutaDeManifiesto(f), 'utf8')).toContain('REEMPLAZAR_');
    }
  });
});

describe('1. Ensamblar reproduce cada JSON byte a byte', () => {
  it.each(CON_MANIFIESTO)('%s', (archivo) => {
    const r = ensamblarEnMemoria(archivo);
    expect(r.conManifiesto).toBe(true);
    expect(Buffer.from(r.texto, 'utf8').equals(bytes(join(RAIZ_FLUJOS, archivo)))).toBe(true);
  });

  it('el vertical de reservas inyecta 22 puntos: 18 nodos Code y 2 campos en cada uno de los 2 agentes', () => {
    for (const f of ['demo-a-agendamiento.json', 'platinum-agendamiento.json']) {
      const r = ensamblarEnMemoria(f);
      expect(r.inyectados, f).toHaveLength(22);
      expect(r.inyectados!.filter((c) => c.startsWith('codigo/'))).toHaveLength(18);
      expect(r.inyectados!.filter((c) => c.startsWith('prompts/'))).toHaveLength(4);
    }
  });
});

describe('2. `verificar` pasa para los 8 JSON', () => {
  it.each(FLUJOS)('%s', (archivo) => {
    const r = verificarFlujo(archivo);
    expect(r.estado, archivo).not.toBe('difiere');
    expect(r.estado).toBe(CON_MANIFIESTO.includes(archivo) ? 'identico' : 'sin-manifiesto');
    expect(r.diferencias).toEqual([]);
  });

  it('sin manifiesto, lo ensamblado es el archivo mismo (idéntico por definición)', () => {
    for (const f of SIN_MANIFIESTO) {
      const r = ensamblarEnMemoria(f);
      expect(r.conManifiesto).toBe(false);
      expect(r.texto).toBe(readFileSync(join(RAIZ_FLUJOS, f), 'utf8'));
    }
  });
});

describe('3. `extraer` seguido de `ensamblar` es la identidad', () => {
  it.each(CON_MANIFIESTO)('%s: desde una copia sin módulos, extraer y volver a ensamblar da el mismo archivo', (archivo) => {
    const dir = copiaDeFlujos();
    rmSync(carpetas(dir).src, { recursive: true, force: true });
    rmSync(carpetas(dir).prompts, { recursive: true, force: true });
    const r = extraerFlujo(archivo, { raiz: dir });
    expect(r.avisos).toEqual([]);
    expect(r.escritos.length).toBe(22 + 1); // los módulos y el manifiesto
    const e = ensamblarEnMemoria(archivo, dir);
    expect(Buffer.from(e.texto, 'utf8').equals(bytes(join(RAIZ_FLUJOS, archivo)))).toBe(true);
    // Y cada módulo escrito es byte a byte el versionado: `extraer` no inventa.
    for (const ruta of r.escritos) {
      const rel = relative(dir, ruta);
      expect(bytes(ruta).equals(bytes(join(RAIZ_FLUJOS, rel))), rel).toBe(true);
    }
  });

  it('`extraer` sobre el repositorio deja el manifiesto exactamente como está versionado', () => {
    const dir = copiaDeFlujos();
    for (const f of CON_MANIFIESTO) {
      extraerFlujo(f, { raiz: dir });
      expect(readFileSync(rutaDeManifiesto(f, dir), 'utf8')).toBe(readFileSync(rutaDeManifiesto(f), 'utf8'));
    }
  });

  it('un contenido que termina en dos saltos de línea no se puede representar y `extraer` lo dice', () => {
    const dir = copiaDeFlujos();
    const ruta = join(dir, 'demo-a-agendamiento.json');
    const j = JSON.parse(readFileSync(ruta, 'utf8')) as { nodes: { name: string; parameters: { jsCode?: string } }[] };
    j.nodes.find((n) => n.name === 'QR no enviado')!.parameters.jsCode += '\n\n';
    writeFileSync(ruta, JSON.stringify(j, null, 2) + '\n');
    expect(() => extraerFlujo('demo-a-agendamiento.json', { raiz: dir })).toThrow(/dos saltos de línea/);
  });
});

describe('4. Un módulo modificado hace fallar `verificar`, y la falla nombra el punto', () => {
  it('un byte más en un nodo Code', () => {
    const dir = copiaDeFlujos();
    const ruta = join(carpetas(dir).src, 'reservas/comprobar-reserva.js');
    writeFileSync(ruta, readFileSync(ruta, 'utf8').replace(/\n$/, ' \n'));
    for (const f of ['demo-a-agendamiento.json', 'platinum-agendamiento.json']) {
      const r = verificarFlujo(f, dir);
      expect(r.estado, f).toBe('difiere');
      expect(r.diferencias).toEqual(['codigo/Comprobar reserva']);
    }
  });

  it('un prompt modificado, y solo cae el flujo que lo usa', () => {
    const dir = copiaDeFlujos();
    const ruta = join(carpetas(dir).prompts, 'reservas/platinum.md');
    writeFileSync(ruta, readFileSync(ruta, 'utf8') + 'Y una línea más.\n');
    expect(verificarFlujo('platinum-agendamiento.json', dir)).toMatchObject({
      estado: 'difiere', diferencias: ['prompts/AI Agent (Sofía).systemMessage'],
    });
    expect(verificarFlujo('demo-a-agendamiento.json', dir).estado).toBe('identico');
  });

  it('un módulo que falta es un error con la ruta, no un JSON vacío', () => {
    const dir = copiaDeFlujos();
    rmSync(join(carpetas(dir).src, 'comun/uso-extendido.js'));
    expect(() => verificarFlujo('demo-a-agendamiento.json', dir)).toThrow(/falta el módulo .*uso-extendido\.js/);
  });

  it('un módulo sin salto de línea final se rechaza: es la convención que sostiene la identidad', () => {
    const dir = copiaDeFlujos();
    const ruta = join(carpetas(dir).src, 'reservas/qr-no-enviado.js');
    writeFileSync(ruta, readFileSync(ruta, 'utf8').replace(/\n$/, ''));
    expect(() => verificarFlujo('demo-a-agendamiento.json', dir)).toThrow(/termina en un salto de línea/);
  });
});

describe('5. Un nodo renombrado hace fallar con un mensaje claro', () => {
  const conManifiestoCambiado = (cambio: (m: Record<string, any>) => void) => {
    const dir = copiaDeFlujos();
    const ruta = rutaDeManifiesto('demo-a-agendamiento.json', dir);
    const m = JSON.parse(readFileSync(ruta, 'utf8'));
    cambio(m);
    writeFileSync(ruta, JSON.stringify(m, null, 2) + '\n');
    return dir;
  };

  it('el manifiesto nombra un nodo que el JSON ya no tiene', () => {
    const dir = conManifiestoCambiado((m) => {
      m.codigo['Comprobar reservas'] = m.codigo['Comprobar reserva'];
      delete m.codigo['Comprobar reserva'];
    });
    expect(() => verificarFlujo('demo-a-agendamiento.json', dir))
      .toThrow(/«Comprobar reservas» y el JSON no lo tiene.*renómbrelo también en .*demo-a-agendamiento\.json/s);
  });

  it('el manifiesto apunta a un nodo que no es del tipo esperado', () => {
    const dir = conManifiestoCambiado((m) => { m.codigo['Config base'] = 'comun/config-base.js'; });
    expect(() => verificarFlujo('demo-a-agendamiento.json', dir)).toThrow(/«Config base» no es un nodo Code/);
    const dir2 = conManifiestoCambiado((m) => { m.prompts['Normalizar entrada'] = { text: 'x.md' }; });
    expect(() => verificarFlujo('demo-a-agendamiento.json', dir2)).toThrow(/«Normalizar entrada» no es un agente/);
  });

  it('el nodo que debía conservar los REEMPLAZAR_* ya no los tiene', () => {
    const dir = copiaDeFlujos();
    const ruta = join(dir, 'demo-a-agendamiento.json');
    writeFileSync(ruta, readFileSync(ruta, 'utf8').replaceAll('REEMPLAZAR_', 'VALOR_'));
    expect(() => verificarFlujo('demo-a-agendamiento.json', dir)).toThrow(/«Config base» tenía que conservar valores REEMPLAZAR_\*/);
  });

  it('un manifiesto que declara otro flujo se rechaza', () => {
    const dir = conManifiestoCambiado((m) => { m.flujo = 'platinum-agendamiento.json'; });
    expect(() => verificarFlujo('demo-a-agendamiento.json', dir)).toThrow(/declara "flujo"/);
  });
});

describe('6. Ningún módulo, prompt ni manifiesto contiene un valor real', () => {
  const archivos = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? archivos(p) : [p];
  }) : []);
  const TODOS = [carpetas().src, carpetas().prompts, carpetas().manifiestos].flatMap(archivos);

  // Los mismos ejemplos deliberadamente falsos que admite `verificar-saneo.sh`.
  const PERMITIDOS = /(00000000-0000-0000-0000-000000000000|1234567890123456|59170000000|59100000000|example\.(com|org)|ejemplo\.(tld|com)|@group\.calendar\.google\.com|noreply@anthropic\.com|[a-z0-9._-]+@novuchat\.site|REEMPLAZAR|[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com|[0-9]*0{6,}[0-9]*)/;
  const REGLAS: [string, RegExp][] = [
    ['UUID', /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/],
    ['secuencia de 10 o más dígitos sin seis ceros', /(^|[^0-9])[0-9]{10,}([^0-9]|$)/],
    ['correo electrónico', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
    ['ruta absoluta con usuario del sistema', /\/(home|Users)\/[a-z][a-z0-9._-]+\//],
    ['token de Meta', /EAA[A-Za-z0-9]{20,}/],
    ['clave de API de Google', /AIza[0-9A-Za-z_-]{30,}/],
    ['token de OpenAI / Anthropic', /sk-(ant-)?[A-Za-z0-9_-]{20,}/],
    ['token de GitHub', /(gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/],
    ['clave de AWS', /AKIA[0-9A-Z]{16}/],
    ['llave privada', /-----BEGIN ([A-Z ]+ )?PRIVATE KEY-----/],
    ['dominio de DNS dinámico o túnel', /\.(duckdns\.org|ngrok(-free)?\.(io|app|dev)|no-ip\.(org|com)|dyndns\.org|serveo\.net|trycloudflare\.com|loca\.lt)/],
  ];
  const IPV4 = /(^|[^0-9.])([0-9]{1,3}\.){3}[0-9]{1,3}([^0-9.]|$)/;
  const IPV4_PRIVADA = /(^|[^0-9])(0|10|127|169\.254|192\.168|172\.(1[6-9]|2[0-9]|3[01])|22[4-9]|23[0-9]|24[0-9]|25[0-5])\./;

  it('hay módulos que revisar, y están donde el ensamblador los busca', () => {
    expect(TODOS.length).toBeGreaterThanOrEqual(18 + 5 + 2);
    expect(TODOS.every((p) => /\.(js|md|json)$/.test(p))).toBe(true);
  });

  it.each(REGLAS)('%s', (_nombre, regla) => {
    const hallazgos: string[] = [];
    for (const ruta of TODOS) {
      for (const [i, linea] of readFileSync(ruta, 'utf8').split('\n').entries()) {
        if (regla.test(linea) && !PERMITIDOS.test(linea)) hallazgos.push(`${relative(RAIZ_FLUJOS, ruta)}:${i + 1}: ${linea.slice(0, 120)}`);
      }
    }
    expect(hallazgos).toEqual([]);
  });

  it('dirección IPv4 pública', () => {
    const hallazgos: string[] = [];
    for (const ruta of TODOS) {
      for (const [i, linea] of readFileSync(ruta, 'utf8').split('\n').entries()) {
        if (IPV4.test(linea) && !PERMITIDOS.test(linea) && !IPV4_PRIVADA.test(linea)) hallazgos.push(`${relative(RAIZ_FLUJOS, ruta)}:${i + 1}`);
      }
    }
    expect(hallazgos).toEqual([]);
  });

  it('los archivos de módulo y de prompt terminan en exactamente un salto de línea', () => {
    for (const ruta of TODOS) {
      const t = readFileSync(ruta, 'utf8');
      expect(t.endsWith('\n') && !t.endsWith('\n\n'), relative(RAIZ_FLUJOS, ruta)).toBe(true);
    }
  });
});

describe('7. El Demo A y Platinum comparten todos los módulos salvo el prompt de Sofía', () => {
  it('los dos manifiestos apuntan a los mismos archivos, con una sola excepción', () => {
    const a = leerManifiesto('demo-a-agendamiento.json') as Record<string, any>;
    const p = leerManifiesto('platinum-agendamiento.json') as Record<string, any>;
    expect(p.codigo).toEqual(a.codigo);
    expect(p.conservanMarcadores).toEqual(a.conservanMarcadores);
    expect(p.prompts['Reintento tras cruce']).toEqual(a.prompts['Reintento tras cruce']);
    expect(p.prompts['AI Agent (Sofía)'].text).toBe(a.prompts['AI Agent (Sofía)'].text);
    expect(a.prompts['AI Agent (Sofía)'].systemMessage).toBe('reservas/demo-a.md');
    expect(p.prompts['AI Agent (Sofía)'].systemMessage).toBe('reservas/platinum.md');
  });

  it('cinco módulos son comunes por nombre a los otros verticales y trece son del vertical de reservas', () => {
    const a = leerManifiesto('demo-a-agendamiento.json') as { codigo: Record<string, string | { archivo: string }> };
    const rutas = Object.values(a.codigo).map((v) => (typeof v === 'string' ? v : v.archivo));
    expect(rutas.filter((r) => r.startsWith('comun/'))).toHaveLength(5);
    expect(rutas.filter((r) => r.startsWith('reservas/'))).toHaveLength(13);
    // Los comunes existen con el mismo nombre en el Demo B y en la captación,
    // aunque su código todavía diverja: es lo que el bloque B-2 tiene que mirar.
    const otros = ['demo-b-venta-cobro.json', 'novuchat-onboarding.json']
      .map((f) => JSON.parse(readFileSync(join(RAIZ_FLUJOS, f), 'utf8')) as { nodes: { name: string }[] });
    for (const [nombre, v] of Object.entries(a.codigo)) {
      const ruta = typeof v === 'string' ? v : v.archivo;
      const enOtros = otros.every((o) => o.nodes.some((n) => n.name === nombre));
      expect(ruta.startsWith('comun/'), `${nombre} → ${ruta}`).toBe(enOtros);
    }
  });

  it('el nombre de archivo de cada módulo es el nombre del nodo normalizado', () => {
    const a = leerManifiesto('demo-a-agendamiento.json') as { codigo: Record<string, string | { archivo: string }> };
    for (const [nombre, v] of Object.entries(a.codigo)) {
      const ruta = typeof v === 'string' ? v : v.archivo;
      expect(ruta.replace(/^[a-z]+\//, '')).toBe(`${slug(nombre)}.js`);
    }
    expect(slug('AI Agent (Sofía)')).toBe('ai-agent-sofia');
    expect(slug('¿Es un mensaje?')).toBe('es-un-mensaje');
  });
});

describe('8. La línea de comandos', () => {
  it('`verificar` sale con 0 sobre el repositorio y dice qué flujos no tienen manifiesto', () => {
    const salida = execFileSync(process.execPath, [SCRIPT, 'verificar'], { encoding: 'utf8' });
    expect(salida).toContain('Todos los flujos coinciden con sus módulos.');
    expect(salida.match(/sin manifiesto, idéntico por definición/g)).toHaveLength(SIN_MANIFIESTO.length);
    expect(salida.match(/✓ .*: idéntico \(22 puntos de inyección\)/g)).toHaveLength(CON_MANIFIESTO.length);
  });

  it('`verificar` sale con 1 y nombra el punto cuando un módulo difiere', () => {
    // El script resuelve `Flujos/` desde su propia ruta (`../../Flujos`), así
    // que se arma un repositorio falso en un temporal: una copia de `Flujos/`
    // y una copia del script en `admin/scripts/`, y se rompe un módulo ahí.
    const raizFalsa = mkdtempSync(join(tmpdir(), 'novuchat-raiz-'));
    temporales.push(raizFalsa);
    cpSync(RAIZ_FLUJOS, join(raizFalsa, 'Flujos'), { recursive: true, filter: (src) => !src.endsWith('.local.json') });
    mkdirSync(join(raizFalsa, 'admin/scripts'), { recursive: true });
    cpSync(SCRIPT, join(raizFalsa, 'admin/scripts/ensamblar-flujo.mjs'));
    const ruta = join(raizFalsa, 'Flujos/src/comun/normalizar-entrada.js');
    writeFileSync(ruta, readFileSync(ruta, 'utf8') + '// cambio\n');
    let codigo = 0; let salida = '';
    try {
      salida = execFileSync(process.execPath, [join(raizFalsa, 'admin/scripts/ensamblar-flujo.mjs'), 'verificar'], { encoding: 'utf8' });
    } catch (e) {
      codigo = (e as { status: number }).status; salida = (e as { stdout: string }).stdout;
    }
    expect(codigo).toBe(1);
    expect(salida).toContain('✗ demo-a-agendamiento.json: difiere en codigo/Normalizar entrada');
    expect(salida).toContain('✗ platinum-agendamiento.json: difiere en codigo/Normalizar entrada');
    expect(salida).toContain('2 flujo(s) no coinciden con sus módulos.');
  });
});
