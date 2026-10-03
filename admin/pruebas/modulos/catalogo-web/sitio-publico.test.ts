/**
 * T-37 (`admin/SEGURIDAD.md`): LA PÁGINA PÚBLICA DEL CATÁLOGO EN OTRO ORIGEN.
 *
 * El riesgo: la página pública y la consola salían del mismo sitio de Hosting,
 * o sea del mismo origen del navegador, y en ese origen el SDK de Firebase
 * guarda las sesiones de administrador. La condición de la amenaza era comprobable
 * («antes de que el primer comercio que no sea de prueba encienda
 * `catalogoWebActivo`»), y esta suite es lo que la mantiene cumplida: si alguien
 * vuelve a juntar los sitios, o hace que la página pública importe algo de la
 * consola, falla acá y no en producción con un cliente real.
 *
 * PURA: lee archivos del repositorio (`firebase.json`, `.firebaserc.ejemplo`,
 * el código de `web/`, el workflow). No usa emulador, red ni credenciales, y no
 * compila nada (la comprobación sobre el paquete compilado es
 * `scripts/modulos/catalogo-web/verificar-sitio-publico.mjs`, que corre en el job `construir`).
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { closeSync, fstatSync, openSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { entornoDelEmulador } from '../../core/entorno-del-hijo.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const ADMIN = resolve(aqui, '../../..');
const leer = (...ruta: string[]) => readFileSync(join(ADMIN, ...ruta), 'utf8');

interface Cabecera { key: string; value: string }
interface Bloque { source: string; headers: Cabecera[] }
interface Reescritura { source: string; function?: string; destination?: string }
interface Sitio {
  target?: string;
  public: string;
  rewrites: Reescritura[];
  headers: Bloque[];
  cleanUrls?: boolean;
}

const firebase = JSON.parse(leer('firebase.json')) as { hosting: Sitio | Sitio[] };
const sitios = [firebase.hosting].flat();
const consola = sitios.find((s) => s.target === 'consola');
const catalogo = sitios.find((s) => s.target === 'catalogo');

const valorDe = (s: Sitio, fuente: string, clave: string): string =>
  s.headers.find((b) => b.source === fuente)?.headers.find((h) => h.key === clave)?.value ?? '';

describe('firebase.json: dos sitios de Hosting con orígenes distintos', () => {
  it('hay exactamente dos sitios, con target y carpetas distintas', () => {
    expect(Array.isArray(firebase.hosting)).toBe(true);
    expect(sitios).toHaveLength(2);
    expect(consola, 'falta el target «consola»').toBeDefined();
    expect(catalogo, 'falta el target «catalogo»').toBeDefined();
    expect(consola?.public).toBe('web/dist');
    expect(catalogo?.public).toBe('web/dist-catalogo');
    expect(consola?.public).not.toBe(catalogo?.public);
  });

  it('ningún sitio nombra un sitio real: solo targets (el repositorio es público)', () => {
    for (const s of sitios) {
      expect(s, 'un `site` fijo metería un identificador en el repositorio').not.toHaveProperty('site');
    }
    // Un nombre concreto (`algo.web.app`), no el comodín `*.firebaseapp.com`
    // que la CSP de la consola necesita para el inicio de sesión.
    expect(JSON.stringify(firebase)).not.toMatch(/[a-z0-9-]+\.(web\.app|firebaseapp\.com)|novuchat\.site/);
  });

  it('.firebaserc.ejemplo resuelve los dos targets, con marcadores y sin ids reales', () => {
    const rc = JSON.parse(leer('.firebaserc.ejemplo')) as {
      targets: Record<string, { hosting: Record<string, string[]> }>;
    };
    const proyectos = Object.values(rc.targets);
    expect(proyectos.length).toBeGreaterThanOrEqual(2);
    for (const p of proyectos) {
      expect(Object.keys(p.hosting).sort()).toEqual(['catalogo', 'consola']);
      expect(p.hosting['catalogo']).toHaveLength(1);
      expect(p.hosting['consola']).toHaveLength(1);
      // Distintos entre sí: el mismo sitio para los dos haría que el segundo
      // despliegue pisara al primero.
      expect(p.hosting['catalogo']?.[0]).not.toBe(p.hosting['consola']?.[0]);
    }
    expect(JSON.stringify(rc)).toMatch(/\$\{HOSTING_SITIO_CATALOGO/);
    // El sitio de la consola se nombra como lo hace el workflow (`FIREBASE_SITE_ID`,
    // o el id del proyecto): una variable que el CI no conoce sería un marcador muerto.
    expect(JSON.stringify(rc)).toContain('${FIREBASE_SITE_ID}');
    expect(JSON.stringify(rc)).not.toContain('HOSTING_SITIO_CONSOLA');
    // Claves y valores son marcadores `${...}`, nunca un identificador.
    for (const [proyecto, t] of Object.entries(rc.targets)) {
      expect(proyecto).toMatch(/^\$\{[A-Z_]+\}$/);
      for (const sitio of Object.values(t.hosting).flat()) expect(sitio).toMatch(/^\$\{[A-Z_]+\}$/);
    }
  });
});

describe('el sitio de la consola ya no sirve la página pública', () => {
  it('no reescribe a las Functions públicas del catálogo ni a catalogo.html', () => {
    const funciones = (consola?.rewrites ?? []).map((r) => r.function).filter(Boolean);
    for (const f of ['checkoutCatalogo', 'fotoDeCatalogo', 'catalogoPublico']) {
      expect(funciones, f).not.toContain(f);
    }
    for (const r of consola?.rewrites ?? []) {
      expect(r.destination ?? '').not.toContain('catalogo');
      expect(r.source).not.toMatch(/^\/c\//);
    }
  });

  it('conserva las rutas de servidor a servidor, incluida `enlace` (la firmada)', () => {
    const fuentes = (consola?.rewrites ?? []).map((r) => r.source);
    for (const f of ['/api/ingesta/**', '/api/configuracion/**', '/api/qr/**', '/api/catalogo/enlace']) {
      expect(fuentes, f).toContain(f);
    }
    expect(consola?.rewrites.at(-1)).toEqual({ source: '**', destination: '/index.html' });
  });

  it('no lleva la CSP del catálogo para /c/**', () => {
    expect(consola?.headers.some((b) => b.source === '/c/**')).toBe(false);
  });

  it('y su CSP sigue permitiendo el inicio de sesión (frame-src con firebaseapp.com)', () => {
    expect(valorDe(consola as Sitio, '**', 'Content-Security-Policy')).toContain('frame-src');
    expect(valorDe(consola as Sitio, '**', 'Content-Security-Policy')).toContain('https://*.firebaseapp.com');
  });
});

describe('el sitio público: lo mínimo, y cerrado', () => {
  const csp = valorDe(catalogo as Sitio, '**', 'Content-Security-Policy');
  const directivas = new Map(csp.split(';').map((d) => d.trim()).filter(Boolean)
    .map((d) => [d.split(' ')[0] as string, d.split(' ').slice(1).join(' ')]));

  it('solo reescribe a las tres Functions públicas y a la página en /c/**', () => {
    expect(catalogo?.rewrites).toEqual([
      { source: '/api/catalogo/*/checkout', function: 'checkoutCatalogo' },
      { source: '/api/catalogo/*/foto/*', function: 'fotoDeCatalogo' },
      { source: '/api/catalogo/**', function: 'catalogoPublico' },
      { source: '/c/**', destination: '/catalogo.html' },
    ]);
  });

  it('NO expone la API firmada de los flujos ni la de la consola', () => {
    const texto = JSON.stringify(catalogo?.rewrites);
    for (const f of ['ingesta', 'configuracionFlujo', 'imagenDeCobro', 'enlaceCatalogo']) {
      expect(texto, f).not.toContain(`"${f}"`);
    }
    expect(texto).not.toContain('/api/catalogo/enlace');
    expect(texto).not.toContain('/api/ingesta');
    expect(texto).not.toContain('"**"');
  });

  it('el orden importa: checkout y foto antes del comodín `/api/catalogo/**`', () => {
    const fuentes = (catalogo?.rewrites ?? []).map((r) => r.source);
    expect(fuentes.indexOf('/api/catalogo/*/checkout')).toBeLessThan(fuentes.indexOf('/api/catalogo/**'));
    expect(fuentes.indexOf('/api/catalogo/*/foto/*')).toBeLessThan(fuentes.indexOf('/api/catalogo/**'));
  });

  it('las tres Functions existen y son HTTP públicas sin CORS (la página las llama por su propio origen)', () => {
    const fuente = leer('functions/src/modulos/catalogo-web/catalogoWeb.ts');
    for (const f of ['checkoutCatalogo', 'fotoDeCatalogo', 'catalogoPublico']) {
      expect(fuente, f).toContain(`export const ${f} = onRequest(`);
    }
    // Sin CORS porque no hace falta: la página las pide por rutas relativas
    // que ESTE sitio reescribe, o sea del mismo origen. Abrir CORS sería
    // permitir que otro origen las llame, y no hay ninguno que deba.
    expect(fuente.match(/cors: false/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(fuente).not.toMatch(/cors: true|cors: \[/);
  });

  it('la CSP: nada fuera de su origen, ni marcos, ni Google, ni Firebase', () => {
    expect(directivas.get('default-src')).toBe("'none'");
    expect(directivas.get('script-src')).toBe("'self'");
    expect(directivas.get('connect-src')).toBe("'self'");
    expect(directivas.get('frame-ancestors')).toBe("'none'");
    expect(directivas.get('form-action')).toBe("'none'");
    expect(directivas.get('base-uri')).toBe("'none'");
    expect(directivas.get('object-src')).toBe("'none'");
    expect(directivas.has('frame-src')).toBe(false);
    expect(csp).not.toMatch(/google|gstatic|firebase|cloudfunctions|run\.app|unsafe-eval|unsafe-inline.*script/);
    // Las fotos las aloja cada comercio donde quiere: la única directiva abierta.
    expect(directivas.get('img-src')).toBe("'self' data: https:");
  });

  it('las demás cabeceras: sin marcos, sin indexar, sin referrer, HSTS', () => {
    const h = (k: string) => valorDe(catalogo as Sitio, '**', k);
    expect(h('X-Frame-Options')).toBe('DENY');
    expect(h('X-Content-Type-Options')).toBe('nosniff');
    expect(h('Referrer-Policy')).toBe('no-referrer'); // la ficha viaja en la ruta
    expect(h('X-Robots-Tag')).toContain('noindex');
    expect(h('Strict-Transport-Security')).toContain('max-age=31536000');
    expect(h('Cross-Origin-Opener-Policy')).toBe('same-origin');
    expect(h('Cache-Control')).toBe('no-cache');
    expect(valorDe(catalogo as Sitio, '/assets/**', 'Cache-Control')).toContain('immutable');
  });
});

/** Los `import` de un archivo: los de ruta relativa (a seguir) y los de paquete. */
function importsDe(texto: string): { relativos: string[]; paquetes: string[] } {
  const relativos: string[] = [];
  const paquetes: string[] = [];
  const re = /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const m of texto.matchAll(re)) {
    const esp = (m[1] ?? m[2]) as string;
    (esp.startsWith('.') ? relativos : paquetes).push(esp);
  }
  return { relativos, paquetes };
}

function resolverRelativo(desde: string, esp: string): string {
  const base = resolve(dirname(desde), esp);
  for (const c of [base, `${base}.ts`, `${base}.tsx`, `${base}.css`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (!/\.(tsx?|css)$/.test(c)) continue;
    // Se lee directamente, sin comprobar antes que exista (carrera entre la
    // comprobación y el uso): si no se puede leer como archivo, no es el candidato.
    try { readFileSync(c); return c; } catch { /* siguiente candidato */ }
  }
  throw new Error(`no encontré ${esp} importado desde ${desde}`);
}

/** Cierre transitivo de lo que importa la entrada pública. */
function cierre(entrada: string): { archivos: string[]; paquetes: Set<string> } {
  const vistos = new Set<string>();
  const paquetes = new Set<string>();
  const pendientes = [entrada];
  while (pendientes.length > 0) {
    const a = pendientes.pop() as string;
    if (vistos.has(a)) continue;
    vistos.add(a);
    if (a.endsWith('.css')) continue;
    const { relativos, paquetes: ps } = importsDe(readFileSync(a, 'utf8'));
    ps.forEach((p) => paquetes.add(p));
    for (const r of relativos) pendientes.push(resolverRelativo(a, r));
  }
  return { archivos: [...vistos], paquetes };
}

describe('el paquete público no puede arrastrar la consola ni el SDK de Firebase', () => {
  const entrada = join(ADMIN, 'web/src/modulos/catalogo-web/publico/entrada.tsx');
  const { archivos, paquetes } = cierre(entrada);
  const relativos = archivos.map((a) => a.slice(ADMIN.length + 1));

  it('la entrada existe y tiene un cierre de imports razonable', () => {
    expect(relativos.length).toBeGreaterThanOrEqual(5);
    expect(relativos).toContain('web/src/modulos/catalogo-web/publico/SitioCatalogo.tsx');
  });

  it('solo importa React como paquete (nada de firebase ni react-router-dom)', () => {
    expect([...paquetes].sort()).toEqual(['react', 'react-dom/client']);
  });

  it('no alcanza ningún archivo de la consola, de sesión ni de otros módulos', () => {
    const permitidos = [
      /^web\/src\/modulos\/catalogo-web\/publico\//,
      // Tipografía y tokens de diseño, y las paletas (funciones puras): lo
      // único común que la página usa. Si hace falta algo más de `central/`,
      // que se decida mirándolo, no que se cuele.
      /^web\/src\/central\/estilos\/diseno\.css$/,
      /^web\/src\/central\/lib\/paletas\.ts$/,
    ];
    const fuera = relativos.filter((r) => !permitidos.some((p) => p.test(r)));
    expect(fuera, `la página pública importa algo ajeno: ${fuera.join(', ')}`).toEqual([]);
  });

  it('nada del cierre usa `import.meta.env` (la página no se configura por ambiente) ni inyecta HTML', () => {
    for (const a of archivos.filter((x) => !x.endsWith('.css'))) {
      const t = readFileSync(a, 'utf8');
      expect(t, a).not.toContain('import.meta.env');
      expect(t, a).not.toContain('dangerouslySetInnerHTML');
      expect(t, a).not.toMatch(/\.innerHTML\s*=|document\.write\(/);
    }
  });

  it('la ruta que acepta la entrada es la misma forma de ficha del servidor y de Hosting', () => {
    const e = leer('web/src/modulos/catalogo-web/publico/entrada.tsx');
    expect(e).toContain('/^\\/c\\/[0-9a-f]{32}$/');
    expect(leer('functions/src/modulos/catalogo-web/catalogoWeb.ts')).toContain('const FICHA = /^[0-9a-f]{32}$/;');
  });

  it('la consola (`main.tsx`) ya no monta ni importa el catálogo', () => {
    const { relativos, paquetes } = importsDe(leer('web/src/main.tsx'));
    expect(relativos).toEqual(['./consola']);
    expect(paquetes).toEqual([]);
  });

  it('el HTML público no lleva el título ni el script de la consola, y es la entrada de su propia compilación', () => {
    const html = leer('web/catalogo.html');
    expect(html).toContain('/src/modulos/catalogo-web/publico/entrada.tsx');
    expect(html).not.toContain('main.tsx');
    expect(html).not.toContain('Panel administrativo');
    const cfg = leer('web/vite.catalogo.config.ts');
    expect(cfg).toContain("outDir: 'dist-catalogo'");
    expect(cfg).toContain("'catalogo.html'");
  });
});

describe('la compilación: dos paquetes', () => {
  const paquete = JSON.parse(leer('web/package.json')) as { scripts: Record<string, string> };

  it('`build` compila el catálogo y la consola', () => {
    const orden = paquete.scripts['build'] ?? '';
    expect(orden).toContain('vite build --config vite.catalogo.config.ts');
    expect(orden.trim().endsWith('&& vite build')).toBe(true);
    // NO se afirma nada sobre `--mode`: el CI llama `web:build -- --mode <ambiente>`,
    // pnpm lo convierte en `vite build -- --mode <ambiente>` y lo que va después de
    // `--` Vite lo ignora (medido el 03/10/2026: el paquete no lleva el modo). Lo que
    // distingue a staging de producción son las variables `VITE_*`, que llegan por el
    // entorno de cada job, no por el modo.
  });

  it('dist-catalogo está ignorado por git', () => {
    expect(leer('.gitignore')).toMatch(/^dist-catalogo\/$/m);
  });
});

describe('SITIO_PUBLICO: sin valor derivado del proyecto', () => {
  const fuente = leer('functions/src/modulos/catalogo-web/catalogoWeb.ts');
  const i = fuente.indexOf('function baseDelSitio()');
  const cuerpo = fuente.slice(i, fuente.indexOf('\n}\n', i));

  it('baseDelSitio solo acepta una dirección https configurada', () => {
    expect(i).toBeGreaterThan(-1);
    expect(cuerpo).toContain("startsWith('https://')");
    // El antiguo respaldo `https://<proyecto>.web.app` apuntaría al sitio de la
    // consola, que ya no sirve `/c/**`: el cliente caería en la pantalla de ingreso.
    expect(cuerpo).not.toContain('web.app');
    expect(cuerpo).not.toContain('GCLOUD_PROJECT');
    expect(cuerpo).not.toContain('GCP_PROJECT');
  });
});

describe('el despliegue publica los dos sitios y se niega a juntarlos', () => {
  const ci = readFileSync(join(ADMIN, '..', '.github/workflows/ci-node-firebase.yml'), 'utf8');
  const job = (nombre: string): string => {
    const i = ci.indexOf(`\n  ${nombre}:\n`);
    expect(i, `no encontré el job ${nombre}`).toBeGreaterThan(-1);
    const resto = ci.slice(i + 1);
    const sig = resto.slice(1).search(/\n {2}[a-z][a-z-]*:\n/);
    return sig === -1 ? resto : resto.slice(0, sig + 1);
  };

  for (const [construir, amb] of [['construir', 'production'], ['construir-staging', 'staging']] as const) {
    it(`${construir} verifica el paquete público y lo guarda como artefacto aparte`, () => {
      const j = job(construir);
      expect(j).toContain('node scripts/modulos/catalogo-web/verificar-sitio-publico.mjs');
      expect(j).toContain(`name: dist-catalogo-${amb}`);
      expect(j).toContain('web/dist-catalogo/');
      expect(j.indexOf('verificar-sitio-publico.mjs'), 'se verifica antes de guardar')
        .toBeLessThan(j.indexOf(`name: dist-catalogo-${amb}`));
    });
  }

  for (const [desplegar, amb] of [['desplegar-produccion', 'production'], ['desplegar-staging', 'staging']] as const) {
    it(`${desplegar}: descarga el paquete público y resuelve los dos destinos`, () => {
      const j = job(desplegar);
      expect(j).toContain(`name: dist-catalogo-${amb}`);
      expect(j).toContain('/web/dist-catalogo');
      expect(j).toMatch(/target:apply hosting consola /);
      expect(j).toMatch(/target:apply hosting catalogo "\$SITIO_CATALOGO"/);
      expect(j).toContain('vars.HOSTING_SITIO_CATALOGO');
    });

    it(`${desplegar}: falla si falta el segundo sitio o si es el de la consola`, () => {
      const j = job(desplegar);
      expect(j).toMatch(/Falta (vars\.)?HOSTING_SITIO_CATALOGO/);
      expect(j).toMatch(/HOSTING_SITIO_CATALOGO es el sitio de la consola/);
    });

    it(`${desplegar}: la dirección del catálogo pasa por la compuerta de host (comprobar-origen-catalogo.sh)`, () => {
      const j = job(desplegar);
      expect(j).toContain('scripts/comprobar-origen-catalogo.sh');
      expect(j).toContain('vars.HOSTING_DOMINIO_CATALOGO');
      // Se compara contra el host de la consola Y contra los del proyecto, no solo contra PROD_URL/STAGING_URL.
      expect(j).toMatch(/URL_CONSOLA="\$URL_(PROD|STAGING)"/);
    });

    it(`${desplegar}: reverifica el paquete público descargado, antes de publicar (L-3)`, () => {
      const j = job(desplegar);
      const verif = j.indexOf('node scripts/modulos/catalogo-web/verificar-sitio-publico.mjs');
      expect(verif, 'sin reverificación tras la descarga').toBeGreaterThan(-1);
      expect(verif).toBeGreaterThan(j.indexOf(`name: dist-catalogo-${desplegar === 'desplegar-staging' ? 'staging' : 'production'}`));
      expect(verif).toBeLessThan(j.indexOf('target:apply hosting catalogo'));
    });

    it(`${desplegar}: comprueba en Firebase que el sitio exista en ESTE proyecto, antes de resolver los destinos`, () => {
      const j = job(desplegar);
      const get = j.indexOf('firebase hosting:sites:get "$SITIO_CATALOGO" --project "$PROYECTO"');
      expect(get).toBeGreaterThan(-1);
      expect(get).toBeLessThan(j.indexOf('target:apply hosting catalogo'));
      expect(j).toMatch(/no existe en el proyecto de (staging|producción)/);
    });

    it(`${desplegar}: resuelve los destinos ANTES de publicar`, () => {
      const j = job(desplegar);
      expect(j.indexOf('target:apply hosting catalogo')).toBeGreaterThan(-1);
      expect(j.indexOf('target:apply hosting catalogo')).toBeLessThan(j.lastIndexOf('firebase deploy --only "$SOLO"'));
    });
  }

  it('el SITIO_PUBLICO del .env de producción no cambia de forma (la compuerta de INSTANCIAS_MINIMAS sigue intacta)', () => {
    expect(job('desplegar-produccion')).toContain(
      "diff <(printf 'SITIO_PUBLICO=%s\\nINSTANCIAS_MINIMAS=1\\n' \"$SITIO_PUBLICO\") functions/.env");
  });

  it('dev y el canal de PR publican solo la consola (no tienen segundo sitio)', () => {
    expect(job('desplegar-dev')).toContain('hosting:consola');
    expect(job('previsualizar')).toContain('--only consola');
  });

  it('dev reemplaza SOLO el elemento exacto `hosting` de la lista (el código real del workflow, ejecutado)', () => {
    const j = job('desplegar-dev');
    const i = j.indexOf("IFS=',' read -r -a partes");
    const f = j.indexOf('SOLO="$(IFS=,; echo "${partes[*]}")"');
    expect(i).toBeGreaterThan(-1);
    expect(f).toBeGreaterThan(i);
    const trozo = j.slice(i, f) + 'SOLO="$(IFS=,; echo "${partes[*]}")"\nprintf "%s" "$SOLO"';
    const corre = (solo: string) => {
      const r = spawnSync('bash', ['-c', trozo], {
        encoding: 'utf8',
        env: entornoDelEmulador(undefined, { SOLO: solo }),
      });
      expect(r.status, r.stderr).toBe(0);
      return r.stdout;
    };
    expect(corre('hosting,firestore:rules,firestore:indexes')).toBe('hosting:consola,firestore:rules,firestore:indexes');
    expect(corre('hosting')).toBe('hosting:consola');
    // Un valor ya calificado, o un nombre que solo CONTIENE «hosting», no se toca.
    expect(corre('hosting:consola,functions')).toBe('hosting:consola,functions');
    expect(corre('hosting:catalogo')).toBe('hosting:catalogo');
    expect(corre('functions,webhosting')).toBe('functions,webhosting');
  });

  it('producción corre el humo del sitio público tras el health check, de solo lectura y haciendo fallar el job', () => {
    const j = job('desplegar-produccion');
    const humo = j.indexOf('./scripts/humo-sitio-publico.sh');
    expect(humo).toBeGreaterThan(-1);
    expect(humo).toBeGreaterThan(j.indexOf('id: salud'));
    const paso = j.slice(j.lastIndexOf('- name:', humo), humo + 40);
    expect(paso).toContain("if: steps.salud.outputs.ok == 'true'");
    expect(paso).toContain('SITIO_PUBLICO_URL: ${{ vars.SITIO_PUBLICO }}');
    expect(paso).toContain('CONSOLA_URL: ${{ vars.PROD_URL }}');
    expect(paso).not.toContain('continue-on-error');
    expect(paso).toContain('timeout-minutes');
  });

  it('preparar-staging.sh ya no carga la dirección de la consola como SITIO_PUBLICO y crea el segundo sitio', () => {
    const t = readFileSync(join(ADMIN, '..', 'scripts/preparar-staging.sh'), 'utf8');
    expect(t).not.toMatch(/SITIO_PUBLICO[^\n]*"\$URL_STAGING"/);
    expect(t).toMatch(/SITIO_PUBLICO[^\n]*"\$URL_CATALOGO"/);
    expect(t).toContain('HOSTING_SITIO_CATALOGO');
    expect(t).toContain('hosting:sites:create');
    expect(t).toContain('fase_sitio()');
  });

  it('la consola no deja huérfano el estilo del marco, y la vista previa explica la falta de dirección', () => {
    expect(leer('web/src/central/estilos/estilos.css')).not.toContain('.marco-catalogo');
    const c = leer('web/src/modulos/productos/Catalogo.tsx');
    expect(c).not.toMatch(/<iframe\s/); // el elemento, no la mención en el comentario
    expect(c).toContain('dirección del sitio');
    expect(c).toContain('Avise a NovuChat');
    expect(leer('web/src/modulos/catalogo-web/publico/montar.tsx')).not.toContain('validada por `main.tsx`');
  });

  it('el humo de staging recibe la dirección del sitio público y la mira', () => {
    expect(job('humo-staging')).toContain('SITIO_PUBLICO_URL: ${{ needs.desplegar-staging.outputs.sitio_publico }}');
    const humo = readFileSync(join(ADMIN, '..', 'scripts/humo-staging.sh'), 'utf8');
    expect(humo).toContain('5. Sitio público del catálogo');
    expect(humo).toContain('./scripts/humo-sitio-publico.sh');
    // La consola ya no sirve /c/**: el humo de la consola comprueba que no lo haga.
    expect(humo).toContain('ya no lleva la CSP del catálogo');
    expect(humo).not.toContain('GET  /api/catalogo/<enlace vencido>');
  });

  it('humo-sitio-publico.sh es ejecutable y comprueba la separación de orígenes', () => {
    const ruta = join(ADMIN, '..', 'scripts/humo-sitio-publico.sh');
    // Un solo descriptor para el modo y el contenido: no hay un archivo que pueda
    // cambiar entre mirar sus permisos y leerlo.
    let modo = 0;
    let humo = '';
    let fd: number | undefined;
    try {
      fd = openSync(ruta, 'r');
      modo = fstatSync(fd).mode;
      humo = readFileSync(fd, 'utf8');
    } catch (e) {
      throw new Error(`no se pudo leer scripts/humo-sitio-publico.sh: ${(e as Error).message}`);
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
    expect(modo & 0o111, 'sin permiso de ejecución el job humo-staging falla').not.toBe(0);
    expect(humo).toContain('GET  /index.html (entrada de la consola)');
    expect(humo).toContain('frame-ancestors');
    expect(humo).toContain('identitytoolkit');
    expect(humo).toContain('FICHA_DE_PRUEBA');
  });
});

/**
 * LA COMPUERTA DE LA DIRECCIÓN DEL CATÁLOGO, ejecutada (no solo leída).
 *
 * La consola responde en su dominio propio (PROD_URL) y TAMBIÉN en
 * `<sitio>.web.app` y `<sitio>.firebaseapp.com`, y en los del proyecto: comparar
 * `SITIO_PUBLICO` solo con `PROD_URL` dejaba pasar esos. Es un script de bash sin
 * red ni credenciales; se lanza con el entorno de las suites (hijos-hermeticos).
 */
describe('comprobar-origen-catalogo.sh: SITIO_PUBLICO no puede ser un origen de la consola', () => {
  const script = join(ADMIN, '..', 'scripts/comprobar-origen-catalogo.sh');
  const BASE: Record<string, string> = {
    SITIO_CATALOGO: 'cat-sitio',
    SITIO_CONSOLA: 'consola-sitio',
    PROYECTO: 'proyecto-id',
    URL_CONSOLA: 'https://consola.ejemplo.test',
    DOMINIOS_CATALOGO: '',
    SITIO_PUBLICO: '',
  };
  const corre = (publico: string, extra: Record<string, string> = {}) => {
    const r = spawnSync('bash', [script], {
      encoding: 'utf8',
      env: entornoDelEmulador(undefined, { ...BASE, ...extra, SITIO_PUBLICO: publico }),
    });
    return { codigo: r.status, salida: `${r.stdout}${r.stderr}` };
  };

  it('acepta el sitio público declarado, con mayúsculas, ruta, puerto o punto final', () => {
    for (const u of [
      'https://cat-sitio.web.app',
      'https://CAT-SITIO.WEB.APP/c/abc?x=1#y',
      'https://cat-sitio.firebaseapp.com:443/',
      'https://cat-sitio.web.app./',
    ]) expect(corre(u).codigo, u).toBe(0);
  });

  it('acepta un dominio propio SOLO si está declarado aparte', () => {
    expect(corre('https://catalogo.ejemplo.test').codigo).toBe(1);
    expect(corre('https://catalogo.ejemplo.test', { DOMINIOS_CATALOGO: 'catalogo.ejemplo.test' }).codigo).toBe(0);
    expect(corre('https://CATALOGO.ejemplo.test/c/x', { DOMINIOS_CATALOGO: 'otro.ejemplo.test, Catalogo.Ejemplo.Test' }).codigo).toBe(0);
  });

  it('NEGANDO: rechaza todos los hosts donde responde la consola', () => {
    for (const u of [
      'https://consola-sitio.web.app',                // el sitio de la consola
      'https://CONSOLA-SITIO.firebaseapp.com/c/x',
      'https://proyecto-id.web.app',                  // el sitio por defecto del proyecto
      'https://proyecto-id.firebaseapp.com./',
      'https://consola.ejemplo.test',                 // PROD_URL
      'https://Consola.Ejemplo.Test:8443/ruta?x#y',   // PROD_URL con otra forma
    ]) {
      const r = corre(u);
      expect(r.codigo, u).toBe(1);
      expect(r.salida, u).toContain('un host de la consola');
    }
  });

  it('NEGANDO: la forma completa se valida ANTES de normalizar (barra invertida, saltos de línea, usuario@)', () => {
    const arroba = '@'; // armado aparte: el saneo del repositorio toma «a@b.c» por un correo
    // (El `@` se rechaza en TODA la dirección, también en la ruta: un enlace de catálogo no lo necesita.)
    for (const [que, u] of [
      // Un navegador trata `\` como `/`: iría a la consola aunque el texto nombre el catálogo.
      ['barra invertida con @', `https://consola-sitio.web.app\\${arroba}cat-sitio.web.app`],
      ['barra invertida en la ruta', 'https://cat-sitio.web.app\\ruta'],
      // El paso de producción escribe el valor con printf en functions/.env: una línea extra sería otro parámetro.
      ['salto de línea', 'https://cat-sitio.web.app/ruta\nOTRO_PARAMETRO=1'],
      ['retorno de carro', 'https://cat-sitio.web.app/ruta\rx'],
      ['salto de línea al final', 'https://cat-sitio.web.app\n'],
      ['espacio', 'https://cat-sitio.web.app/a b'],
      ['tabulación', 'https://cat-sitio.web.app/a\tb'],
      ['usuario delante del host de la consola', `https://usuario${arroba}consola-sitio.web.app/`],
      ['usuario delante del sitio válido', `https://usuario${arroba}cat-sitio.web.app/`],
      ['puerto sin número', 'https://cat-sitio.web.app:/x'],
      ['puerto de más de cinco cifras', 'https://cat-sitio.web.app:123456/x'],
    ] as const) {
      const r = corre(u);
      expect(r.codigo, que).toBe(1);
      expect(r.salida, que).toContain('no tiene la forma');
    }
  });

  it('lo que se aceptaba sigue aceptándose (mayúsculas, puerto, punto final, esquema en mayúsculas)', () => {
    for (const u of [
      'https://CAT-SITIO.web.APP:8443/c/x?y=1#z',
      'https://cat-sitio.web.app./',
      'HTTPS://cat-sitio.web.app',
    ]) expect(corre(u).codigo, u).toBe(0);
  });

  it('NEGANDO: el host de la consola se rechaza aunque esté en la lista de dominios propios', () => {
    expect(corre('https://consola.ejemplo.test', { DOMINIOS_CATALOGO: 'consola.ejemplo.test' }).codigo).toBe(1);
    expect(corre('https://proyecto-id.web.app', { DOMINIOS_CATALOGO: 'proyecto-id.web.app' }).codigo).toBe(1);
  });

  it('NEGANDO: rechaza lo que no es https, está vacío, o es otro host (incluido uno que solo CONTIENE el nuestro)', () => {
    for (const u of [
      '', 'http://cat-sitio.web.app', 'cat-sitio.web.app', 'https://otro.web.app',
      'https://cat-sitio.web.app.malo.test', 'https://malo.test/cat-sitio.web.app',
    ]) expect(corre(u).codigo, u).toBe(1);
  });

  it('sin el id del sitio del catálogo no hay con qué comparar: sale 2', () => {
    expect(corre('https://cat-sitio.web.app', { SITIO_CATALOGO: '' }).codigo).toBe(2);
  });
});
