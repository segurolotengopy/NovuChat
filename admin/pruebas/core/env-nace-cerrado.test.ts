/**
 * UN ARCHIVO CON SECRETOS NACE CERRADO (revisión de seguridad del PR #276).
 *
 * `configurar-cliente.sh` y `configurar-demo-b.sh` escribían el .env con
 * `{ … } > "$DESTINO"; chmod 600 "$DESTINO"`: el archivo nace con la umask por
 * defecto (022 o 002) y, entre la redirección y el chmod, WA_TOKEN,
 * WA_APP_SECRET y N8N_API_KEY quedan legibles por cualquier usuario de la
 * máquina. La forma correcta es `( umask 077; { … } > "$DESTINO" )`, con el
 * chmod 600 después para cuando el archivo ya existía (la redirección no le
 * cambia el modo).
 *
 * Prueba EN LA FUENTE, sobre todo `.sh` versionado: toda escritura a un archivo
 * cuyo contenido nombre uno de esos secretos —un grupo `{ … } > archivo`, una
 * línea con `>`/`>>`/`tee` o un heredoc redirigido— va dentro de un
 * `( umask 077 … )`, o después de un `umask 077` al nivel superior del script.
 * Y todo respaldo `cp -p` de un .env se hace con el original ya en 600: cp -p
 * copia el modo, y una copia legible con los secretos viejos quedaba al lado.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SECRETO = /\b(N8N_API_KEY|WA_TOKEN|WA_APP_SECRET)\b/;
// Copiar un .env entero (publicar-flujo --env-nuevo) también escribe sus secretos.
const COPIA_ENV = /\b(cat|grep\s+-v)\b[^\n]*(\$\{?ENV_FILE\b|\s\.env\b)/;
const escribeSecreto = (contenido: string) => SECRETO.test(contenido) || COPIA_ENV.test(contenido);

function scriptsVersionados(): string[] {
  const r = spawnSync('git', ['ls-files', '*.sh'], { cwd: REPO, encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(`git ls-files falló: ${r.stderr}`);
  return r.stdout.split('\n').filter(Boolean);
}

/** Quita lo que no es sintaxis de bash: `${…}`, cadenas entre comillas y comentarios. */
function sinTexto(linea: string): string {
  return linea
    .replace(/\$\{[^}]*\}/g, '')
    .replace(/'[^']*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/(^|\s)#.*$/, '$1');
}

// Una redirección de salida a un archivo (no a un descriptor ni a /dev/…), o un tee.
const REDIRECCION = /(^|[^0-9&<>])>>?\s*(?!&|\/dev\/)\S|\btee\s+(-a\s+)?(?!-|\/dev\/)\S/;
const CIERRA_GRUPO_CON_SALIDA = /(^|[\s;])\}\s*>>?\s*(?!&|\/dev\/)\S/;
const HEREDOC = /(?<!<)<<(?!<)-?\s*['"]?(\w+)['"]?/;

interface Escritura {
  archivo: string;
  linea: number; // 1-based, la de la redirección
  desde: number; // índice 0-based donde empieza el contenido escrito
  hasta: number; // índice 0-based donde termina
}

/** Las escrituras de un script: grupos redirigidos, líneas sueltas y heredocs. */
function escrituras(archivo: string, lineas: string[]): Escritura[] {
  const salida: Escritura[] = [];
  let i = 0;
  while (i < lineas.length) {
    const sintaxis = sinTexto(lineas[i]);
    const heredoc = sintaxis.match(HEREDOC) ?? lineas[i].match(HEREDOC);
    let fin = i;
    if (heredoc && /<</.test(sintaxis)) {
      const delim = heredoc[1];
      fin = i + 1;
      while (fin < lineas.length && lineas[fin].trim() !== delim) fin++;
    }
    if (CIERRA_GRUPO_CON_SALIDA.test(sintaxis)) {
      // Se busca hacia atrás la llave que abre este grupo.
      let prof = 0;
      let j = i;
      for (; j >= 0; j--) {
        const s = sinTexto(lineas[j]);
        const cierres = (s.match(/(^|[\s;])\}(?=[\s>;)]|$)/g) ?? []).length;
        const aperturas = (s.match(/(^|[\s;&|(])\{(?=\s|$)/g) ?? []).length;
        prof += cierres - aperturas;
        if (prof <= 0) break;
      }
      salida.push({ archivo, linea: i + 1, desde: Math.max(j, 0), hasta: fin });
    } else if (REDIRECCION.test(sintaxis)) {
      salida.push({ archivo, linea: i + 1, desde: i, hasta: fin });
    }
    i = fin + 1;
  }
  return salida;
}

/** ¿La escritura corre con umask 077? */
function conUmask077(lineas: string[], e: Escritura): boolean {
  // (a) Dentro de una subshell `( umask 077 … )` que envuelve la escritura:
  //     la subshell abre en la línea del contenido o en la anterior, y cierra
  //     en la línea de la redirección.
  const apertura = [lineas[e.desde], lineas[e.desde - 1] ?? ''].some((l) =>
    /(^|[\s;&|])\(\s*umask\s+077\b/.test(l),
  );
  const cierre = /\)\s*(;.*|&&.*|\|\|.*)?$/.test(sinTexto(lineas[e.linea - 1]).trimEnd());
  if (apertura && cierre) return true;
  // (b) Después de un `umask 077` al nivel superior (columna 0), sin otro
  //     `umask` de por medio.
  for (let k = e.desde - 1; k >= 0; k--) {
    const m = lineas[k].match(/^umask\s+(\d+)/);
    if (m) return m[1] === '077';
  }
  return false;
}

const SCRIPTS = scriptsVersionados();

describe('archivos con secretos: nacen cerrados', () => {
  it('hay scripts para revisar (git ls-files responde)', () => {
    expect(SCRIPTS.length).toBeGreaterThan(20);
    expect(SCRIPTS).toContain('scripts/configurar-cliente.sh');
  });

  it('toda escritura de N8N_API_KEY, WA_TOKEN o WA_APP_SECRET va dentro de un umask 077', () => {
    const abiertas: string[] = [];
    let revisadas = 0;
    for (const archivo of SCRIPTS) {
      const lineas = readFileSync(join(REPO, archivo), 'utf-8').split('\n');
      for (const e of escrituras(archivo, lineas)) {
        const contenido = lineas.slice(e.desde, e.hasta + 1).join('\n');
        if (!escribeSecreto(contenido)) continue;
        revisadas++;
        if (!conUmask077(lineas, e)) abiertas.push(`${archivo}:${e.linea}`);
      }
    }
    expect(abiertas, 'escriben un secreto con la umask por defecto: usar ( umask 077; … > archivo )').toEqual([]);
    // Si el detector dejara de ver las escrituras conocidas, la prueba pasaría
    // en vacío: configurar-cliente, configurar-demo-b, publicar-flujo --env-nuevo
    // y la cabecera de nombre-visible.
    expect(revisadas).toBeGreaterThanOrEqual(4);
  });

  it('las escrituras conocidas usan la subshell ( umask 077 … ) y conservan el chmod 600', () => {
    for (const archivo of ['scripts/configurar-cliente.sh', 'scripts/configurar-demo-b.sh']) {
      const fuente = readFileSync(join(REPO, archivo), 'utf-8');
      expect(fuente, archivo).toMatch(/\(\s*umask 077\s*\n\s*\{[\s\S]*?\} > "\$DESTINO" \)\nchmod 600 "\$DESTINO"\n/);
    }
    const publicar = readFileSync(join(REPO, 'scripts/publicar-flujo.sh'), 'utf-8');
    expect(publicar).toMatch(/\(\s*umask 077\s*\n[\s\S]{0,300}?> "\$ENV_NUEVO" \)\n\s*chmod 600 "\$ENV_NUEVO"/);
  });

  it('el detector ve una escritura abierta (prueba negativa)', () => {
    const casos: Record<string, string> = {
      grupo: '{\n  echo "WA_TOKEN=$T"\n} > "$DESTINO"\nchmod 600 "$DESTINO"',
      grupoUmaskAparte: 'if true; then\n  umask 077\n  { echo "N8N_API_KEY=$K"; } > "$D"\nfi',
      linea: 'printf "%s" "$WA_APP_SECRET" > "$TMP/x"',
      heredoc: 'cat > .env <<EOF\nWA_TOKEN=$T\nEOF',
      copiaDeEnv: '{ grep -v -E "^X=" "$ENV_FILE"; echo "X=1"; } > "$NUEVO"',
      tee: 'echo "WA_TOKEN=$T" | tee -a "$D" >/dev/null',
      umaskQueSeDeshace: 'umask 077\numask 022\necho "WA_TOKEN=$T" > "$D"',
    };
    for (const [nombre, fuente] of Object.entries(casos)) {
      const lineas = fuente.split('\n');
      const con = escrituras(nombre, lineas).filter((e) =>
        escribeSecreto(lineas.slice(e.desde, e.hasta + 1).join('\n')),
      );
      expect(con.length, nombre).toBe(1);
      expect(conUmask077(lineas, con[0]), nombre).toBe(false);
    }
    const bien: Record<string, string> = {
      subshell: '( umask 077\n{\n  echo "WA_TOKEN=$T"\n} > "$DESTINO" )\nchmod 600 "$DESTINO"',
      unaLinea: '( umask 077; printf "%s" "$WA_TOKEN" > "$D" )',
      nivelSuperior: 'umask 077\nprintf "%s" "$WA_TOKEN" > "$TMP/cabeceras"',
    };
    for (const [nombre, fuente] of Object.entries(bien)) {
      const lineas = fuente.split('\n');
      const con = escrituras(nombre, lineas).filter((e) =>
        escribeSecreto(lineas.slice(e.desde, e.hasta + 1).join('\n')),
      );
      expect(con.length, nombre).toBe(1);
      expect(conUmask077(lineas, con[0]), nombre).toBe(true);
    }
  });

  it('el respaldo cp -p de un .env se hace con el original ya en 600', () => {
    const abiertos: string[] = [];
    for (const archivo of SCRIPTS) {
      const lineas = readFileSync(join(REPO, archivo), 'utf-8').split('\n');
      lineas.forEach((l, i) => {
        const m = l.match(/\bcp\s+-p\s+"(\$\{?(\w+)\}?)"\s+"[^"]*respaldo/);
        // CONFIGURACION.local.md ($LOCAL) solo guarda identificadores, no secretos.
        if (!m || m[2] === 'LOCAL') return;
        const chmod = new RegExp(`chmod 600 "\\$\\{?${m[2]}\\}?"`);
        if (!chmod.test(l) && !chmod.test(lineas[i - 1] ?? '')) abiertos.push(`${archivo}:${i + 1}`);
      });
    }
    expect(abiertos, 'cp -p copia el modo: chmod 600 al original antes de respaldarlo').toEqual([]);
  });
});
