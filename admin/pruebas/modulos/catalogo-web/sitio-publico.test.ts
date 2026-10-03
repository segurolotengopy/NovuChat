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
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
    if (existsSync(c) && !/\/$/.test(c) && /\.(tsx?|css)$/.test(c)) return c;
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

describe('la compilación: dos paquetes, y el modo llega a la consola', () => {
  const paquete = JSON.parse(leer('web/package.json')) as { scripts: Record<string, string> };

  it('`build` compila el catálogo y LA CONSOLA AL FINAL', () => {
    const orden = paquete.scripts['build'] ?? '';
    expect(orden).toContain('vite build --config vite.catalogo.config.ts');
    // El CI llama `web:build -- --mode <ambiente>` y pnpm agrega esos argumentos
    // al FINAL del script: tienen que caer en la compilación de la consola, la
    // que lee las VITE_* del ambiente. Si alguien reordena, el modo se lo lleva
    // la del catálogo y la consola compila con el modo equivocado.
    expect(orden.trim().endsWith('&& vite build')).toBe(true);
    expect(orden.indexOf('vite.catalogo.config.ts')).toBeLessThan(orden.lastIndexOf('vite build'));
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

    it(`${desplegar}: falla si el enlace del catálogo sigue siendo el origen de la consola`, () => {
      const j = job(desplegar);
      expect(j).toMatch(/SITIO_PUBLICO es el origen de la consola/);
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
    expect(statSync(ruta).mode & 0o111, 'sin permiso de ejecución el job humo-staging falla').not.toBe(0);
    const humo = readFileSync(ruta, 'utf8');
    expect(humo).toContain('GET  /index.html (entrada de la consola)');
    expect(humo).toContain('frame-ancestors');
    expect(humo).toContain('identitytoolkit');
    expect(humo).toContain('FICHA_DE_PRUEBA');
  });
});
