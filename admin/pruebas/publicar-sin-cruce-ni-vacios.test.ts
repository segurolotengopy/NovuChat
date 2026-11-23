/**
 * Publicar nunca cruza comercios ni vacia lo que el vivo tiene lleno (22/11/2026). Fixtures sinteticos, curl de mentira.
 *
 *  1. Credenciales: para un nodo cuya credencial nombrada es de OTRO comercio (Casa Bermejo <-> Walisuma, cliente10 <-> cliente09, en
 *     los nodos de la rama de guardado de medios), el cuerpo que se ENVIA conserva la del propio comercio; sin candidata unica del
 *     propio comercio, aborta. Se prueba negando: ninguna credencial del cuerpo enviado es de otro comercio.
 *  2. Config: ningun valor vivo no vacio de un campo Set queda vacio en lo enviado (salvo telefonosDePrueba y etapaPrueba, donde manda
 *     el origen). Y `--valores-del-vivo` alinea los campos de la Config por NOMBRE y no por posicion.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { entornoDelEmulador } from './core/entorno-del-hijo.ts';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '../..');
const PUBLICAR = join(RAIZ, 'scripts/publicar-flujo.sh');
const PREPARAR = join(RAIZ, 'scripts/preparar-import.sh');
const carpeta = mkdtempSync(join(tmpdir(), 'sin-cruce-'));
afterAll(() => rmSync(carpeta, { recursive: true, force: true }));

type Cred = { id: string; name: string };
type Nodo = { name: string; type: string; typeVersion?: number; position?: number[]; parameters: Record<string, unknown>; credentials?: Record<string, Cred> };
const nodo = (name: string, parameters: Record<string, unknown> = {}, credentials?: Record<string, Cred>): Nodo =>
  ({ name, type: 'n8n-nodes-base.httpRequest', typeVersion: 4, position: [0, 0], parameters, ...(credentials ? { credentials } : {}) });
const flujo = (nodes: Nodo[]) => ({ id: 'abc', name: 'Flujo de mentira', active: true, nodes, connections: {}, settings: { executionOrder: 'v1' } });
const set = (name: string, campos: Record<string, string>): Nodo => ({
  name, type: 'n8n-nodes-base.set', typeVersion: 3.4, position: [0, 0],
  parameters: { assignments: { assignments: Object.entries(campos).map(([k, v], i) => ({ id: `c${i}`, name: k, value: v, type: 'string' })) } },
});

let n = 0;
/** Corre publicar-flujo.sh en una copia de scripts/ en un directorio temporal; devuelve la salida y el cuerpo que habria enviado el PUT. */
function publicar(vivo: unknown, creds: Cred[], origen: unknown, args: string[]) {
  const dir = join(carpeta, `p${n++}`);
  const raiz = join(dir, 'repo');
  const bin = join(dir, 'bin');
  mkdirSync(join(raiz, 'scripts'), { recursive: true });
  mkdirSync(join(raiz, 'Flujos'));
  mkdirSync(bin);
  copyFileSync(PUBLICAR, join(raiz, 'scripts/publicar-flujo.sh'));
  if (existsSync(join(RAIZ, 'scripts/lib'))) cpSync(join(RAIZ, 'scripts/lib'), join(raiz, 'scripts/lib'), { recursive: true });
  writeFileSync(join(dir, 'vivo.json'), JSON.stringify(vivo));
  writeFileSync(join(dir, 'creds.json'), JSON.stringify({ data: creds.map((c) => ({ ...c, type: 'httpHeaderAuth' })) }));
  // un nodo nuevo sin credenciales asegura que haya algo que enviar (si no, el script dice «coincide» y no hace PUT)
  const conExtra = { ...(origen as ReturnType<typeof flujo>), nodes: [...(origen as ReturnType<typeof flujo>).nodes, { name: 'Extra nuevo', type: 'n8n-nodes-base.noOp', typeVersion: 1, position: [0, 0], parameters: {} }] };
  writeFileSync(join(dir, 'f.json'), JSON.stringify(conExtra));
  writeFileSync(join(raiz, '.env.prueba'), 'N8N_API_KEY=clave-de-mentira\nN8N_BASE_URL=http://n8n.invalid\nN8N_WORKFLOW_ID=abc\n', { mode: 0o600 });
  // curl de mentira: GET devuelve el vivo o las credenciales; un PUT guarda el cuerpo enviado.
  writeFileSync(join(bin, 'curl'), [
    '#!/usr/bin/env bash',
    "url=''; out=''; datos=''; metodo=GET",
    'while [ $# -gt 0 ]; do case "$1" in -o) out="$2";; -X) metodo="$2";; --data-binary) datos="${2#@}";; http*) url="$1";; esac; shift; done',
    'cat >/dev/null',
    `if [ "$metodo" = PUT ] && [ -n "$datos" ]; then cp "$datos" '${join(dir, 'enviado.json')}'; fi`,
    `case "$url" in *credentials*) f='${join(dir, 'creds.json')}';; *) f='${join(dir, 'vivo.json')}';; esac`,
    '[ -n "$out" ] && cp "$f" "$out"',
    'printf 200',
  ].join('\n') + '\n');
  chmodSync(join(bin, 'curl'), 0o755);
  const r = spawnSync('bash', ['scripts/publicar-flujo.sh', '--env', '.env.prueba', '--flujo', join(dir, 'f.json'), ...args], {
    cwd: raiz, encoding: 'utf8', input: '', env: entornoDelEmulador(undefined, { PATH: `${bin}:${process.env['PATH']}` }),
  });
  const ruta = join(dir, 'enviado.json');
  const enviado = existsSync(ruta) ? (JSON.parse(readFileSync(ruta, 'utf8')) as ReturnType<typeof flujo>) : null;
  return { r, out: `${r.stdout}${r.stderr}`, enviado };
}

describe('credenciales: ninguna termina en otro comercio', () => {
  const GRAPH = { id: 'g10', name: 'WhatsApp Graph (Casa Bermejo)' };
  const GRAPH_OTRO = { id: 'g09', name: 'Graph WhatsApp Walisuma 9448 (Bearer)' };
  const INGESTA = { id: 'i10', name: 'NovuChat ingesta (cliente10)' };
  const INGESTA_OTRA = { id: 'i09', name: 'NovuChat ingesta (cliente09)' };
  const TODAS = [GRAPH, GRAPH_OTRO, INGESTA, INGESTA_OTRA];
  const H = 'httpHeaderAuth';
  const vivo = flujo([
    nodo('Enviar a WhatsApp', {}, { [H]: GRAPH }),
    nodo('Guardar medio', {}, { [H]: INGESTA }),
    nodo('Descargar medio (guardado)', {}, { [H]: GRAPH }),
    nodo('Reintentar el guardado', {}, { [H]: INGESTA }),
  ]);
  // El versionado (con la tabla local contaminada) nombra las credenciales de Walisuma en TODOS los nodos.
  const origenOtro = (extra: Nodo[] = []) => flujo([
    nodo('Enviar a WhatsApp', {}, { [H]: GRAPH_OTRO }),
    nodo('Guardar medio', {}, { [H]: INGESTA_OTRA }),
    nodo('Descargar medio (guardado)', {}, { [H]: GRAPH_OTRO }),
    nodo('Reintentar el guardado', {}, { [H]: INGESTA_OTRA }),
    ...extra,
  ]);
  const nombresEnviados = (e: ReturnType<typeof flujo> | null) => (e?.nodes ?? []).flatMap((x) => Object.values(x.credentials ?? {}).map((c) => `${x.name}=${c.name}`));

  it('nodos del flujo vivo (guardado de medios): conservan su credencial propia; no se envia ninguna de Walisuma ni de cliente09', () => {
    const { r, out, enviado } = publicar(vivo, TODAS, origenOtro(), ['--aplicar']);
    expect(r.status, out).toBe(0);
    expect(out).not.toContain('CRUZA comercios');
    expect(out).toContain('credencial del PROPIO comercio');
    const enviadas = nombresEnviados(enviado);
    expect(enviadas.length).toBe(4);
    for (const e of enviadas) {
      expect(e).not.toMatch(/Walisuma|cliente09/);
    }
    expect(enviadas).toContain('Guardar medio=NovuChat ingesta (cliente10)');
    expect(enviadas).toContain('Descargar medio (guardado)=WhatsApp Graph (Casa Bermejo)');
  });
  it('un nodo NUEVO con la credencial de Walisuma recibe la unica candidata del propio comercio con el mismo proposito', () => {
    const nuevoNodo = nodo('Guardar imagen enviada', {}, { [H]: INGESTA_OTRA });
    const { r, out, enviado } = publicar(vivo, TODAS, origenOtro([nuevoNodo]), ['--aplicar']);
    expect(r.status, out).toBe(0);
    const enviadas = nombresEnviados(enviado);
    expect(enviadas).toContain('Guardar imagen enviada=NovuChat ingesta (cliente10)');
    for (const e of enviadas) expect(e).not.toMatch(/Walisuma|cliente09/);
  });
  it('un nodo NUEVO sin candidata unica del propio comercio: falla cerrado y no envia nada', () => {
    // el vivo tiene DOS credenciales de ingesta propias con el mismo proposito: no hay una unica
    const vivoDoble = flujo([nodo('Guardar medio', {}, { [H]: INGESTA }), nodo('Otro envio', {}, { [H]: { id: 'i11', name: 'NovuChat ingesta (cliente10) bis' } })]);
    const origen = flujo([nodo('Guardar medio', {}, { [H]: INGESTA }), nodo('Otro envio', {}, { [H]: { id: 'i11', name: 'NovuChat ingesta (cliente10) bis' } }),
      nodo('Nodo nuevo', {}, { [H]: INGESTA_OTRA })]);
    const { r, out, enviado } = publicar(vivoDoble, [...TODAS, { id: 'i11', name: 'NovuChat ingesta (cliente10) bis' }], origen, ['--aplicar']);
    expect(r.status).not.toBe(0);
    expect(out).toContain('CRUZA comercios');
    expect(enviado).toBeNull();
  });
});

describe('Config: ningun valor vivo no vacio queda vacio', () => {
  const vivo = flujo([set('Config base', {
    costoDeEntrega: 'Bs 10 dentro de la ciudad', enlaceCatalogo: 'https://tienda.ejemplo.bo/catalogo', ubicacionTienda: 'Calle Falsa 123',
    hostsFoto: 'fotos.ejemplo.bo', avisoRespaldoPlantilla: 'plantilla_respaldo', telefonosDePrueba: '500000000001', etapaPrueba: 'si', nombreNegocio: 'Tienda Vieja',
  })]);
  const origen = flujo([set('Config base', {
    costoDeEntrega: '', enlaceCatalogo: '', ubicacionTienda: '', hostsFoto: '', avisoRespaldoPlantilla: '', telefonosDePrueba: '', etapaPrueba: '', nombreNegocio: 'Tienda Nueva',
  })]);
  const valores = (f: ReturnType<typeof flujo> | null) => {
    const a = (f?.nodes[0]?.parameters as { assignments: { assignments: Array<{ name: string; value: string }> } }).assignments.assignments;
    return Object.fromEntries(a.map((c) => [c.name, c.value]));
  };

  it('lo que el origen deja vacio y el vivo tiene lleno se conserva del vivo; nombra la clave y la longitud, no el valor', () => {
    const { r, out, enviado } = publicar(vivo, [], origen, ['--aplicar']);
    expect(r.status, out).toBe(0);
    const v = valores(enviado);
    for (const clave of ['costoDeEntrega', 'enlaceCatalogo', 'ubicacionTienda', 'hostsFoto', 'avisoRespaldoPlantilla']) {
      expect(v[clave], clave).not.toBe('');
      expect(out).toContain(`Config base · ${clave}: el origen lo trae vacio`);
    }
    expect(out).not.toContain('tienda.ejemplo.bo');
    expect(out).not.toContain('Calle Falsa');
    // un valor lleno del origen NO se pisa con el del vivo
    expect(v['nombreNegocio']).toBe('Tienda Nueva');
  });
  it('telefonosDePrueba y etapaPrueba son la excepcion: manda el origen aunque el vivo los tenga llenos', () => {
    const { enviado } = publicar(vivo, [], origen, ['--aplicar']);
    const v = valores(enviado);
    expect(v['telefonosDePrueba']).toBe('');
    expect(v['etapaPrueba']).toBe('');
  });
  it('propiedad: tras publicar, ningun campo vivo no vacio (fuera de las dos excepciones) queda vacio', () => {
    const { enviado } = publicar(vivo, [], origen, ['--aplicar']);
    const v = valores(enviado);
    const del = valores(vivo as ReturnType<typeof flujo>);
    for (const [k, valor] of Object.entries(del)) {
      if (['telefonosDePrueba', 'etapaPrueba'].includes(k)) continue;
      if (valor !== '') expect(v[k], k).not.toBe('');
    }
  });
});

describe('--valores-del-vivo en la Config', () => {
  function preparar(versionado: unknown, vivo: unknown, filas: string[]) {
    const dir = join(carpeta, `q${n++}`);
    const bin = join(dir, 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(dir, 'vivo.json'), JSON.stringify(vivo));
    writeFileSync(join(bin, 'curl'), `#!/usr/bin/env bash\ncat >/dev/null\nout=''\nwhile [ $# -gt 0 ]; do [ "$1" = -o ] && out="$2"; shift; done\ncp '${join(dir, 'vivo.json')}' "$out"\nprintf 200\n`);
    chmodSync(join(bin, 'curl'), 0o755);
    writeFileSync(join(dir, 'tabla.md'), ['| Marcador | Valor |', '|---|---|', ...filas].join('\n') + '\n');
    writeFileSync(join(dir, 'env'), 'N8N_BASE_URL=http://n8n.invalid\nN8N_API_KEY=clave-de-mentira\nN8N_WORKFLOW_ID=abc\n');
    writeFileSync(join(dir, 'f.json'), JSON.stringify(versionado));
    const r = spawnSync('bash', [PREPARAR, join(dir, 'f.json'), join(dir, 'env'), '--valores-del-vivo'], {
      cwd: RAIZ, encoding: 'utf8', env: entornoDelEmulador(undefined, { CONFIG_LOCAL_MD: join(dir, 'tabla.md'), PATH: `${bin}:${process.env['PATH']}` }),
    });
    return { r, out: `${r.stdout}${r.stderr}`, texto: () => readFileSync(join(dir, 'f.local.json'), 'utf8') };
  }
  const ver = flujo([set('Config base', { a: 'x', tratamiento: 'REEMPLAZAR_TRATAMIENTO', nombreNegocio: 'REEMPLAZAR_NOMBRE_DEL_NEGOCIO' })]);
  // el vivo trae los campos en OTRO orden: el marcador se alinea por nombre, no por posicion
  const viv = flujo([set('Config base', { nombreNegocio: 'Tienda Del Vivo', z: 'otro', a: 'x', tratamiento: 'usted' })]);

  it('alinea el campo por NOMBRE aunque el orden difiera, y el vivo gana a la fila de la tabla en un campo de la Config', () => {
    const { r, out, texto } = preparar(ver, viv, ['| `REEMPLAZAR_NOMBRE_DEL_NEGOCIO` | Tienda De Otro |']);
    expect(r.status, out).toBe(0);
    const t = texto();
    expect(t).toContain('Tienda Del Vivo');
    expect(t).not.toContain('Tienda De Otro');
    expect(t).toContain('usted');
    expect(out).not.toContain('Tienda Del Vivo');
  });
  it('si el vivo no lo resuelve (vacio), se usa la tabla como siempre', () => {
    const vacio = flujo([set('Config base', { a: 'x', tratamiento: 'usted', nombreNegocio: '' })]);
    const { r, texto } = preparar(ver, vacio, ['| `REEMPLAZAR_NOMBRE_DEL_NEGOCIO` | Tienda De Otro |']);
    expect(r.status).toBe(0);
    expect(texto()).toContain('Tienda De Otro');
  });
});
