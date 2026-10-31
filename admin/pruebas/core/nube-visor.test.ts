/**
 * `scripts/nube-visor.sh`: el invocador público de una callable de una LISTA
 * CERRADA (`vercomprobante` → `verComprobante`, `buscarconversaciones` →
 * `buscarConversaciones`), seco por omisión.
 *
 * Se prueba NEGANDO, con `gcloud`, `curl` y `gh` FALSOS adelante en el PATH: el
 * `gcloud` falso guarda la política en un archivo, anota cada llamada y, al
 * fallar, menciona el id del proyecto y la cuota (como el de verdad); el `curl`
 * falso contesta el JSON de Firebase si la política tiene `allUsers` y el 403 de
 * Google si no. Sin red, sin nube, sin credenciales reales: el entorno es
 * `entornoDelEmulador`, y `CLOUDSDK_CONFIG` apunta a una carpeta temporal con un
 * `application_default_credentials.json` falso (solo `quota_project_id`), puesta
 * con `env` delante del script.
 *
 * Lo que cada grupo cierra:
 *  - sin `--servicio` de la lista ni `--confirmo <entorno>` no hay ni una
 *    llamada a gcloud;
 *  - la única escritura es `run services add|remove-iam-policy-binding
 *    <servicio> --member=allUsers --role=roles/run.invoker` en la región de
 *    `region.ts` y el proyecto del entorno pedido;
 *  - ningún id de proyecto ni la cuota en la salida, en ningún modo;
 *  - idempotente, vuelta atrás, «despliega primero», reversión automática si
 *    el código atiende a un anónimo, y la sonda distingue nuestro JSON del 403
 *    de Google.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { entornoDelEmulador } from './entorno-del-hijo.ts';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..', '..', '..');
const SCRIPT = join(RAIZ, 'scripts', 'nube-visor.sh');
const REGION = /export const REGION = '([a-z0-9-]+)';/.exec(
  readFileSync(join(RAIZ, 'admin', 'functions', 'src', 'core', 'region.ts'), 'utf8'),
)![1]!;

// Ids de prueba con la forma de un id real (no existen).
const STAGING = 'prueba-visor-stg1';
const PROD = 'prueba-visor-prd1';
const OTRO_ID = 'prueba-visor-otro';
// Menos de 10 dígitos a propósito (el saneo del repositorio público los
// bloquea); `sanear` tapa desde 6, así que la prueba sigue mordiendo.
const NUMERO_FALSO = '987654321';

const VISOR = 'vercomprobante';
const BUSCADOR = 'buscarconversaciones';
const ENVIAR = 'enviarcomopersona';
const TOMAR = 'tomarconversacion';
const DEVOLVER = 'devolverconversacion';
const RECLAMAR = 'reclamarsalidapersona';
const CONFIRMAR = 'confirmarsalidapersona';
const MEDIO = 'vermedio';
const HTTP = [RECLAMAR, CONFIRMAR] as const;
const SERVICIOS = [
  [VISOR, 'verComprobante'], [BUSCADOR, 'buscarConversaciones'], [ENVIAR, 'enviarComoPersona'],
  [TOMAR, 'tomarConversacion'], [DEVOLVER, 'devolverConversacion'],
  [RECLAMAR, 'reclamarSalidaPersona'], [CONFIRMAR, 'confirmarSalidaPersona'], [MEDIO, 'verMedio'],
] as const;
const urlDe = (s: string) => `https://${s}-${NUMERO_FALSO}.us-east1.run.app`;

const GCLOUD_FALSO = `#!/usr/bin/env bash
E="$FAKE_DIR"
printf '%s\\n' "$*" >> "$E/llamadas"
env | grep -E '^(CLOUDSDK_|GH_REPO=)' | grep -v '^CLOUDSDK_CONFIG=' >> "$E/entorno-visto" || true
P=""; MEM=""; ROLE=""; SVC=""
a=("$@")
for ((i = 0; i < \${#a[@]}; i++)); do
  case "\${a[i]}" in
    --project) P="\${a[i+1]}" ;;
    --member=*) MEM="\${a[i]#*=}" ;;
    --role=*) ROLE="\${a[i]#*=}" ;;
    describe|get-iam-policy|add-iam-policy-binding|remove-iam-policy-binding) SVC="\${a[i+1]}" ;;
  esac
done
CUOTA="$(grep -o '"quota_project_id": *"[^"]*"' "$CLOUDSDK_CONFIG/application_default_credentials.json" 2>/dev/null | sed 's/.*"\\([^"]*\\)"$/\\1/')"
c="$*"
case "$c" in
  *"run services describe "*)
    [[ -f "$E/existe" ]] || { echo "ERROR: (gcloud.run.services.describe) NOT_FOUND: Resource '$SVC' of kind 'SERVICE' in region 'r' in project '$P' does not exist." >&2; exit 1; }
    [[ -f "$E/niega" ]] && { echo "ERROR: PERMISSION_DENIED: cuenta@ejemplo.com sin permiso en $P (proyecto ${NUMERO_FALSO}, cuota $CUOTA)" >&2; exit 1; }
    # 1990 bytes de relleno y el id justo encima del corte de 2000.
    [[ -f "$E/niega-largo" ]] && { printf 'x%.0s' {1..1990} >&2; echo "$P sin permiso" >&2; exit 1; }
    [[ -f "$E/describe-roto" ]] && { echo "esto no es JSON"; exit 0; }
    etiquetas='{"goog-managed-by":"cloudfunctions"}'; [[ -f "$E/sin-etiqueta" ]] && etiquetas='{}'
    url="https://$SVC-${NUMERO_FALSO}.us-east1.run.app"; [[ -f "$E/url" ]] && url="$(cat "$E/url")"
    printf '{"metadata":{"name":"%s","labels":%s},"status":{"url":"%s"}}\\n' "$SVC" "$etiquetas" "$url" ;;
  *"run services get-iam-policy "*) cat "$E/politica.json" ;;
  *"run services add-iam-policy-binding"*|*"run services remove-iam-policy-binding"*)
    op=add; [[ "$c" == *remove-iam-policy-binding* ]] && op=remove
    # LOW-3: un remove que «sale bien» pero no quita nada.
    if [[ "$op" == remove && -f "$E/remove-no-quita" ]]; then echo '{}'; exit 0; fi
    python3 - "$E/politica.json" "$op" "$ROLE" "$MEM" <<'PY'
import json, sys
ruta, op, rol, mem = sys.argv[1:5]
p = json.load(open(ruta))
bs = p.setdefault("bindings", [])
b = next((x for x in bs if x.get("role") == rol and not x.get("condition")), None)
if op == "add":
    if b is None:
        b = {"role": rol, "members": []}; bs.append(b)
    if mem not in b["members"]:
        b["members"].append(mem)
elif b is not None and mem in b["members"]:
    b["members"].remove(mem)
p["bindings"] = [x for x in bs if x.get("members")]
json.dump(p, open(ruta, "w"))
PY
    [[ -f "$E/romper-tras-escribir" ]] && echo "esto no es JSON" > "$E/politica.json"
    # Como el de verdad: imprime la política entera, con cuentas del proyecto.
    printf '{"bindings":[{"role":"roles/run.admin","members":["serviceAccount:sa-deploy@%s.iam.gserviceaccount.com"]}]}\\n' "$P" ;;
  *) echo "gcloud falso: llamada no prevista" >&2; exit 97 ;;
esac
`;

const CURL_FALSO = `#!/usr/bin/env bash
E="$FAKE_DIR"
printf '%s\\n' "$*" >> "$E/curl"
out=""; a=("$@")
for ((i = 0; i < \${#a[@]}; i++)); do [[ "\${a[i]}" == -o ]] && out="\${a[i+1]}"; done
# Las dos Functions HTTP (ingesta) contestan TEXTO, no el JSON de Firebase.
http=0; [[ "\${a[\${#a[@]}-1]}" == *reclamarsalidapersona* || "\${a[\${#a[@]}-1]}" == *confirmarsalidapersona* ]] && http=1
modo="auto"; [[ -f "$E/curl-modo" ]] && modo="$(cat "$E/curl-modo")"
if [[ "$modo" == auto ]]; then
  if python3 -c 'import json,sys; p=json.load(open(sys.argv[1])); sys.exit(0 if any(b.get("role")=="roles/run.invoker" and "allUsers" in b.get("members",[]) for b in p.get("bindings",[])) else 1)' "$E/politica.json"; then modo=propio; else modo=403; fi
fi
err() { printf '{"error":{"message":"x","status":"%s"}}' "$1" > "$out"; printf '%s' "$2"; }
if (( http )) && [[ "$modo" == propio ]]; then printf 'no autorizado' > "$out"; printf '401'; exit 0; fi
if (( http )) && [[ "$modo" == http404 ]]; then printf 'numero no asignado' > "$out"; printf '404'; exit 0; fi
if (( http )) && [[ "$modo" == http400 ]]; then printf 'solicitud invalida' > "$out"; printf '400'; exit 0; fi
if (( http )) && [[ "$modo" == http401json ]]; then err UNAUTHENTICATED 401; exit 0; fi
case "$modo" in
  http401otro) printf 'otro texto' > "$out"; printf '401' ;;
  http409) printf 'transicion no permitida' > "$out"; printf '409' ;;
  http503) printf 'no disponible' > "$out"; printf '503' ;;
  http200html) printf '<html>hola</html>' > "$out"; printf '200' ;;
  propio) err UNAUTHENTICATED 401 ;;
  precondicion) err FAILED_PRECONDITION 400 ;;
  403) printf '<html><title>403 Forbidden</title></html>' > "$out"; printf '403' ;;
  500) printf 'error' > "$out"; printf '500' ;;
  000) printf '000' ;;
  200) printf '{"result":{"mime":"image/png","base64":""}}' > "$out"; printf '200' ;;
  invalido) err INVALID_ARGUMENT 400 ;;
  permiso403) err PERMISSION_DENIED 403 ;;
  noencontrado) err NOT_FOUND 404 ;;
  tope) err RESOURCE_EXHAUSTED 429 ;;
  json403otro) err UNAVAILABLE 403 ;;
  json403sinstatus) printf '{"error":{"message":"x"}}' > "$out"; printf '403' ;;
  json403statusvacio) printf '{"error":{"message":"x","status":""}}' > "$out"; printf '403' ;;
  json403texto) printf '{"error":"x"}' > "$out"; printf '403' ;;
  json403statusnumero) printf '{"error":{"status":7}}' > "$out"; printf '403' ;;
esac
`;

const GH_FALSO = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$FAKE_DIR/gh"
env | grep -E '^GH_REPO=' >> "$FAKE_DIR/entorno-visto" || true
exit 1
`;

const CON_PUBLICO = { bindings: [{ role: 'roles/run.invoker', members: ['allUsers'] }] };
const SIN_NADA = { bindings: [] };

let dir: string;
let bin: string;
let gcloudCfg: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nube-visor-'));
  bin = join(dir, 'bin');
  gcloudCfg = join(dir, 'gcloud');
  mkdirSync(bin);
  mkdirSync(gcloudCfg);
  for (const [n, t] of [['gcloud', GCLOUD_FALSO], ['curl', CURL_FALSO], ['gh', GH_FALSO]] as const) {
    writeFileSync(join(bin, n), t);
    chmodSync(join(bin, n), 0o755);
  }
  writeFileSync(join(dir, 'existe'), '');
  adc(PROD);
  politica(SIN_NADA);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function politica(p: unknown) { writeFileSync(join(dir, 'politica.json'), JSON.stringify(p)); }
/** Las credenciales de gcloud falsas, en el CLOUDSDK_CONFIG temporal: solo el quota_project_id (vacío = sin el campo). */
function adc(cuota: string) {
  writeFileSync(join(gcloudCfg, 'application_default_credentials.json'),
    cuota ? JSON.stringify({ type: 'authorized_user', quota_project_id: cuota }) : '{"type":"authorized_user"}');
}
const marcar = (n: string, v = '') => writeFileSync(join(dir, n), v);
const leer = (n: string) => (existsSync(join(dir, n)) ? readFileSync(join(dir, n), 'utf8') : '');
const llamadas = () => leer('llamadas').split('\n').filter(Boolean);
const escrituras = () => llamadas().filter((l) => /(add|remove|set)-iam-policy|projects |functions /.test(l));
const llamadasCurl = () => leer('curl').split('\n').filter(Boolean);
const publico = () => JSON.parse(leer('politica.json')).bindings
  .some((b: { role: string; members: string[] }) => b.role === 'roles/run.invoker' && b.members.includes('allUsers'));
const escritura = (op: 'add' | 'remove', proyecto: string, servicio = VISOR) =>
  `--project ${proyecto} --quiet run services ${op}-iam-policy-binding ${servicio} --region ${REGION} --member=allUsers --role=roles/run.invoker`;

/**
 * Corre el script. `servicio`: el `--servicio` que se antepone (null = ninguno).
 * CLOUDSDK_CONFIG va por `env` delante: entornoDelEmulador la fija a una ruta
 * inexistente y la suite necesita sus credenciales FALSAS (solo la cuota).
 */
function correr(
  args: string[], vars: Record<string, string> = {}, servicio: string | null = VISOR,
  prefijo: string[] = [`CLOUDSDK_CONFIG=${gcloudCfg}`],
) {
  const r = spawnSync('env', [...prefijo, 'bash', SCRIPT, ...(servicio === null ? [] : ['--servicio', servicio]), ...args], {
    encoding: 'utf8',
    env: entornoDelEmulador(undefined, {
      PATH: `${bin}:/usr/bin:/bin`,
      FAKE_DIR: dir,
      GCP_PROJECT_ID_STAGING: STAGING,
      GCP_PROJECT_ID_PROD: PROD,
      NUBE_VISOR_INTENTOS: '2',
      NUBE_VISOR_ESPERA: '0',
      ...vars,
    }),
  });
  const salida = `${r.stdout}${r.stderr}`;
  // Ningún id de proyecto ni la cuota en la salida, nunca (vale para TODAS las pruebas).
  for (const prohibido of [STAGING, PROD, NUMERO_FALSO, OTRO_ID]) expect(salida).not.toContain(prohibido);
  return { codigo: r.status, salida };
}

describe('nube-visor.sh: uso y salvaguardas (nada se llama a gcloud)', () => {
  it('--help explica los modos y la lista cerrada, y sale 0', () => {
    const r = correr(['--help'], {}, null);
    expect(r.codigo).toBe(0);
    for (const t of ['--servicio', '--entorno', '--aplicar', '--confirmo', '--revertir', VISOR, BUSCADOR, ENVIAR, TOMAR, DEVOLVER, RECLAMAR, CONFIRMAR, MEDIO]) expect(r.salida).toContain(t);
    expect(llamadas()).toEqual([]);
  });

  it.each([
    ['sin --entorno', []],
    ['un entorno desconocido', ['--entorno', 'prod']],
    ['una opción desconocida', ['--entorno', 'staging', '--todo']],
    ['--aplicar sin --confirmo', ['--entorno', 'staging', '--aplicar']],
    ['--aplicar con --confirmo de OTRO entorno', ['--entorno', 'produccion', '--aplicar', '--confirmo', 'staging']],
    ['--aplicar en producción con --confirmo vacío', ['--entorno', 'produccion', '--aplicar', '--confirmo', '']],
    ['--revertir --aplicar sin --confirmo', ['--entorno', 'produccion', '--revertir', '--aplicar']],
  ])('%s: sale 2 sin tocar gcloud', (_n, args) => {
    const r = correr(args);
    expect(r.codigo).toBe(2);
    expect(llamadas()).toEqual([]);
    expect(publico()).toBe(false);
  });

  it('staging y producción con el mismo id: sale 2', () => {
    const r = correr(['--entorno', 'staging'], { GCP_PROJECT_ID_PROD: STAGING });
    expect(r.codigo).toBe(2);
    expect(llamadas()).toEqual([]);
  });

  it('sin la variable del entorno pedido (y gh sin respuesta): sale 2; gh solo se usa para leer, con --repo', () => {
    const r = correr(['--entorno', 'staging'], { GCP_PROJECT_ID_STAGING: '' });
    expect(r.codigo).toBe(2);
    expect(r.salida).toContain('GCP_PROJECT_ID_STAGING');
    expect(llamadas()).toEqual([]);
    expect(leer('gh').split('\n').filter(Boolean)).toEqual(['variable get GCP_PROJECT_ID_STAGING --repo segurolotengopy/NovuChat']);
  });

  it('un id con forma inválida: sale 2', () => {
    expect(correr(['--entorno', 'produccion'], { GCP_PROJECT_ID_PROD: 'X;rm -rf' }).codigo).toBe(2);
    expect(llamadas()).toEqual([]);
  });
});

describe('nube-visor.sh: --servicio, lista cerrada', () => {
  it.each([
    ['sin --servicio', null, []],
    ['vacío', '', []],
    ['el nombre de la Function en camelCase (verComprobante)', 'verComprobante', []],
    ['el nombre de la Function en camelCase (buscarConversaciones)', 'buscarConversaciones', []],
    ['el nombre de la Function en camelCase (enviarComoPersona)', 'enviarComoPersona', []],
    ['el nombre de la Function en camelCase (reclamarSalidaPersona)', 'reclamarSalidaPersona', []],
    ['el nombre de la Function en camelCase (confirmarSalidaPersona)', 'confirmarSalidaPersona', []],
    ['ingesta (Function HTTP fuera de la lista)', 'ingesta', []],
    ['el nombre de la Function en camelCase (tomarConversacion)', 'tomarConversacion', []],
    ['el nombre de la Function en camelCase (devolverConversacion)', 'devolverConversacion', []],
    ['el nombre de la Function en camelCase (verMedio)', 'verMedio', []],
    ['vermedios (con una s de más)', 'vermedios', []],
    ['un prefijo (tomar)', 'tomarconversac', []],
    ['un prefijo (devolver)', 'devolver', []],
    ['buscarconversacion (sin la s final)', 'buscarconversacion', []],
    ['un prefijo de la lista', 'reclamarsalida', []],
    ['una lista con barra', 'enviarcomopersona|reclamarsalidapersona', []],
    ['en mayúsculas', 'VERCOMPROBANTE', []],
    ['con un espacio', 'vercomprobante ', []],
    ['otro servicio cualquiera', 'enlacecatalogo', []],
    ['un comodín', '*', []],
    ['los dos nombres pegados', 'vercomprobante,buscarconversaciones', []],
    ['--servicio dos veces', VISOR, ['--servicio', BUSCADOR]],
    ['--servicio dos veces, el mismo', VISOR, ['--servicio', VISOR]],
  ])('%s: sale 2 sin tocar gcloud', (_n, servicio, mas) => {
    const r = correr(['--entorno', 'staging', '--aplicar', '--confirmo', 'staging', ...mas], {}, servicio);
    expect(r.codigo).toBe(2);
    expect(llamadas()).toEqual([]);
  });

  it('acepta la forma --servicio=<s>', () => {
    const r = correr([`--servicio=${BUSCADOR}`, '--entorno', 'staging'], {}, null);
    expect(r.codigo).toBe(1);
    expect(r.salida).toContain(`servicio ${BUSCADOR} (buscarConversaciones)`);
  });

  it.each(SERVICIOS)('%s: seco solo lee ESE servicio y dice qué haría', (servicio, funcion) => {
    const r = correr(['--entorno', 'produccion'], {}, servicio);
    expect(r.codigo).toBe(1);
    expect(r.salida).toContain(`servicio ${servicio} (${funcion})`);
    expect(r.salida).toContain(`(haría) gcloud run services add-iam-policy-binding ${servicio}`);
    expect(r.salida).toContain(`--servicio ${servicio} --entorno produccion --aplicar --confirmo produccion`);
    expect(escrituras()).toEqual([]);
    expect(llamadas().every((l) => l.includes(` ${servicio} --region ${REGION}`))).toBe(true);
  });

  it.each(SERVICIOS)('%s: --aplicar concede SOLO sobre ese servicio y prueba su URL', (servicio, funcion) => {
    const r = correr(['--entorno', 'staging', '--aplicar', '--confirmo', 'staging'], {}, servicio);
    expect(r.codigo).toBe(0);
    expect(escrituras()).toEqual([escritura('add', STAGING, servicio)]);
    expect(r.salida).toContain(`${funcion} es invocable en staging`);
    const c = llamadasCurl();
    expect(c).toHaveLength(1);
    expect(c[0]!.endsWith(` ${urlDe(servicio)}`)).toBe(true);
  });

  it.each(SERVICIOS)('%s: --revertir quita SOLO de ese servicio', (servicio, funcion) => {
    politica(CON_PUBLICO);
    const r = correr(['--entorno', 'produccion', '--revertir', '--aplicar', '--confirmo', 'produccion'], {}, servicio);
    expect(r.codigo).toBe(0);
    expect(escrituras()).toEqual([escritura('remove', PROD, servicio)]);
    expect(r.salida).toContain(`ya no puede ${(HTTP as readonly string[]).includes(servicio) ? 'llamar a' : 'usar'} ${funcion} en produccion`);
  });

  it.each(SERVICIOS)('%s: la URL de OTRO servicio de la lista no se prueba', (servicio) => {
    const otro = servicio === VISOR ? BUSCADOR : VISOR;
    marcar('url', urlDe(otro));
    const r = correr(['--entorno', 'staging', '--aplicar', '--confirmo', 'staging'], {}, servicio);
    expect(r.codigo).toBe(3);
    expect(llamadasCurl()).toEqual([]);
  });
});

describe('nube-visor.sh: seco (no escribe)', () => {
  it('sin invocador: dice qué haría, sale 1 y solo LEE', () => {
    const r = correr(['--entorno', 'produccion']);
    expect(r.codigo).toBe(1);
    expect(r.salida).toContain('(haría) gcloud run services add-iam-policy-binding vercomprobante');
    expect(r.salida).toContain('(sin ningún binding)');
    expect(escrituras()).toEqual([]);
    expect(llamadas().every((l) => l.includes(`--project ${PROD}`))).toBe(true);
    expect(llamadasCurl()).toEqual([]);
    expect(publico()).toBe(false);
  });

  it('con el invocador: «ya concedido», sale 0', () => {
    politica(CON_PUBLICO);
    const r = correr(['--entorno', 'staging']);
    expect(r.codigo).toBe(0);
    expect(r.salida).toContain('ya concedido');
    expect(escrituras()).toEqual([]);
  });

  it('allUsers en OTRO rol, o con condición, no cuenta como concedido', () => {
    politica({ bindings: [
      { role: 'roles/run.viewer', members: ['allUsers'] },
      { role: 'roles/run.invoker', members: ['allUsers'], condition: { title: 'x', expression: 'false' } },
    ] });
    expect(correr(['--entorno', 'staging']).codigo).toBe(1);
  });

  it('el resumen de la política no imprime identidades', () => {
    politica({ bindings: [{ role: 'roles/run.invoker', members: ['allUsers', `serviceAccount:sa@${PROD}.iam.gserviceaccount.com`] }] });
    const r = correr(['--entorno', 'produccion']);
    expect(r.salida).toContain('roles/run.invoker: allUsers + 1 miembro(s) más');
  });

  it('servicio inexistente: «despliega primero», sale 3, sin escribir', () => {
    rmSync(join(dir, 'existe'));
    const r = correr(['--entorno', 'produccion', '--aplicar', '--confirmo', 'produccion']);
    expect(r.codigo).toBe(3);
    expect(r.salida).toContain('despliega primero');
    expect(escrituras()).toEqual([]);
  });

  it('otro error de gcloud: lo muestra sin el id, el número ni la cuenta', () => {
    marcar('niega');
    const r = correr(['--entorno', 'produccion']);
    expect(r.codigo).toBe(3);
    expect(r.salida).toContain('PERMISSION_DENIED');
    expect(r.salida).not.toContain('cuenta@ejemplo.com');
  });
});

describe('nube-visor.sh: --aplicar', () => {
  it('concede EXACTAMENTE roles/run.invoker a allUsers sobre vercomprobante, relee y prueba sin sesión', () => {
    const r = correr(['--entorno', 'staging', '--aplicar', '--confirmo', 'staging']);
    expect(r.codigo).toBe(0);
    expect(escrituras()).toEqual([escritura('add', STAGING)]);
    expect(publico()).toBe(true);
    expect(JSON.parse(leer('politica.json')).bindings).toEqual(CON_PUBLICO.bindings);
    expect(r.salida).toContain('NUESTRO código');
    const c = llamadasCurl();
    expect(c).toHaveLength(1);
    expect(c[0]!.endsWith(` ${urlDe(VISOR)}`)).toBe(true);
    expect(c[0]).toContain('-X POST');
  });

  it('FAILED_PRECONDITION sin sesión también es nuestro código', () => {
    marcar('curl-modo', 'precondicion');
    expect(correr(['--entorno', 'staging', '--aplicar', '--confirmo', 'staging']).codigo).toBe(0);
  });

  it('en producción va contra el proyecto de producción', () => {
    const r = correr(['--entorno', 'produccion', '--aplicar', '--confirmo', 'produccion']);
    expect(r.codigo).toBe(0);
    expect(llamadas().every((l) => l.startsWith(`--project ${PROD} `))).toBe(true);
  });

  it('idempotente: con el binding ya puesto no escribe y sale 0', () => {
    politica(CON_PUBLICO);
    const r = correr(['--entorno', 'staging', '--aplicar', '--confirmo', 'staging']);
    expect(r.codigo).toBe(0);
    expect(r.salida).toContain('ya concedido');
    expect(escrituras()).toEqual([]);
  });

  // LOW-4: si el código no contesta como se espera, el binding QUEDÓ puesto y se dice.
  it.each([
    ['el 403 de Google', '403', 2],
    ['un 500', '500', 2],
    ['sin respuesta (000)', '000', 2],
  ])('tras conceder, %s: sale 3 y dice que el binding QUEDÓ puesto', (_n, modo, intentos) => {
    marcar('curl-modo', modo);
    const r = correr(['--entorno', 'staging', '--aplicar', '--confirmo', 'staging']);
    expect(r.codigo).toBe(3);
    expect(r.salida).toContain('el binding QUEDÓ puesto; si persiste: --servicio vercomprobante --entorno staging --revertir --aplicar --confirmo staging');
    expect(llamadasCurl()).toHaveLength(intentos); // NUBE_VISOR_INTENTOS=2
    expect(publico()).toBe(true);
  });

  it('una dirección de servicio que no es *.run.app del servicio: no se llama a curl', () => {
    marcar('url', 'https://evil.example.com/vercomprobante-1.run.app');
    const r = correr(['--entorno', 'staging', '--aplicar', '--confirmo', 'staging']);
    expect(r.codigo).toBe(3);
    expect(llamadasCurl()).toEqual([]);
  });
});

describe('nube-visor.sh: --revertir', () => {
  it('seco: dice qué quitaría, sale 1, no escribe', () => {
    politica(CON_PUBLICO);
    const r = correr(['--entorno', 'produccion', '--revertir']);
    expect(r.codigo).toBe(1);
    expect(r.salida).toContain('(haría) gcloud run services remove-iam-policy-binding vercomprobante');
    expect(escrituras()).toEqual([]);
    expect(publico()).toBe(true);
  });

  it('--aplicar: quita SOLO ese binding y comprueba el 403 de Google', () => {
    politica({ bindings: [
      { role: 'roles/run.invoker', members: ['allUsers'] },
      { role: 'roles/run.admin', members: ['user:alguien@ejemplo.com'] },
    ] });
    const r = correr(['--entorno', 'produccion', '--revertir', '--aplicar', '--confirmo', 'produccion']);
    expect(r.codigo).toBe(0);
    expect(escrituras()).toEqual([escritura('remove', PROD)]);
    expect(JSON.parse(leer('politica.json')).bindings).toEqual([{ role: 'roles/run.admin', members: ['user:alguien@ejemplo.com'] }]);
    expect(r.salida).toContain('Vuelta atrás hecha');
  });

  // Obs 3 del #493: CUALQUIER JSON con `error`, con o sin `status` de texto.
  it.each([
    ['con otro status', 'json403otro'],
    ['sin status', 'json403sinstatus'],
    ['con status vacío', 'json403statusvacio'],
    ['con error de texto', 'json403texto'],
    ['con status no textual', 'json403statusnumero'],
  ])('un 403 con JSON de error %s NO es el de Google: la vuelta atrás no se da por comprobada', (_n, modo) => {
    politica(CON_PUBLICO);
    marcar('curl-modo', modo);
    const r = correr(['--entorno', 'staging', '--revertir', '--aplicar', '--confirmo', 'staging']);
    expect(r.codigo).toBe(3);
    expect(r.salida).toContain('respuesta inesperada (403)');
  });

  it('sin el binding: nada que quitar, sale 0, no escribe', () => {
    const r = correr(['--entorno', 'staging', '--revertir', '--aplicar', '--confirmo', 'staging']);
    expect(r.codigo).toBe(0);
    expect(r.salida).toContain('nada que quitar');
    expect(escrituras()).toEqual([]);
  });
});

describe('nube-visor.sh: el código atiende a un anónimo («abierto»)', () => {
  it.each([
    ['un 200', '200', 'abierto:200'],
    ['un 400 INVALID_ARGUMENT', 'invalido', 'abierto:400'],
    ['un 403 PERMISSION_DENIED en JSON (nuestro, no de Google)', 'permiso403', 'abierto:403'],
    ['un 404 NOT_FOUND en JSON', 'noencontrado', 'abierto:404'],
    ['un 429 RESOURCE_EXHAUSTED en JSON', 'tope', 'abierto:429'],
  ])('tras conceder, %s sin sesión: REVIERTE, relee y sale 3', (_n, modo, ultima) => {
    marcar('curl-modo', modo);
    const r = correr(['--entorno', 'staging', '--aplicar', '--confirmo', 'staging']);
    expect(r.codigo).toBe(3);
    expect(r.salida).toContain(`REVERTIDO: respondió sin sesión (${ultima})`);
    expect(escrituras()).toEqual([escritura('add', STAGING), escritura('remove', STAGING)]);
    expect(publico()).toBe(false);
    expect(llamadasCurl()).toHaveLength(1); // «abierto» no se reintenta
    // Relee después de quitar: describe, política, add, relectura, remove, relectura.
    expect(llamadas().filter((l) => l.includes('get-iam-policy'))).toHaveLength(3);
  });

  it('LOW-3: si el remove «sale bien» pero allUsers SIGUE: sale 3 con «SIGUE», no «REVERTIDO»', () => {
    marcar('curl-modo', '200');
    marcar('remove-no-quita');
    const r = correr(['--entorno', 'staging', '--aplicar', '--confirmo', 'staging']);
    expect(r.codigo).toBe(3);
    expect(r.salida).toContain('SIGUE');
    expect(r.salida).not.toContain('REVERTIDO');
    expect(publico()).toBe(true);
  });

  it('con el binding ya puesto (no lo puso esta corrida): sale 3 sin escribir y dice cómo quitarlo', () => {
    politica(CON_PUBLICO);
    marcar('curl-modo', '200');
    const r = correr(['--entorno', 'staging', '--aplicar', '--confirmo', 'staging']);
    expect(r.codigo).toBe(3);
    expect(r.salida).toContain('--servicio vercomprobante --entorno staging --revertir --aplicar --confirmo staging');
    expect(escrituras()).toEqual([]);
  });
});

describe('nube-visor.sh: proyectos y credenciales', () => {
  it.each([
    ['el id de producción como STAGING y sin PROD', { GCP_PROJECT_ID_STAGING: PROD, GCP_PROJECT_ID_PROD: '' }, 'staging', 'Falta GCP_PROJECT_ID_PROD'],
    ['sin STAGING, pidiendo producción', { GCP_PROJECT_ID_STAGING: '' }, 'produccion', 'Falta GCP_PROJECT_ID_STAGING'],
  ])('%s: sale 2 sin llamar a gcloud y dice cuál falta', (_n, vars, entorno, mensaje) => {
    const r = correr(['--entorno', entorno], vars);
    expect(r.codigo).toBe(2);
    expect(r.salida).toContain(mensaje);
    expect(llamadas()).toEqual([]);
  });

  it('producción con --aplicar y cuota que coincide: dice «cruzado: sí» sin el id', () => {
    const r = correr(['--entorno', 'produccion', '--aplicar', '--confirmo', 'produccion']);
    expect(r.codigo).toBe(0);
    expect(r.salida).toContain('proyecto cruzado con las credenciales: sí');
  });

  it.each([
    ['seco', ['--entorno', 'produccion']],
    ['--aplicar', ['--entorno', 'produccion', '--aplicar', '--confirmo', 'produccion']],
  ])('producción (%s) con una cuota de OTRO proyecto: sale 2 sin llamar a gcloud', (_n, args) => {
    adc(OTRO_ID);
    expect(correr(args).codigo).toBe(2);
    expect(llamadas()).toEqual([]);
  });

  it.each([
    ['sin quota_project_id', () => adc('')],
    ['sin archivo de credenciales', () => rmSync(join(gcloudCfg, 'application_default_credentials.json'))],
  ])('producción con --aplicar %s: sale 2 sin llamar a gcloud; el seco sigue y lo avisa', (_n, preparar) => {
    preparar();
    expect(correr(['--entorno', 'produccion', '--aplicar', '--confirmo', 'produccion']).codigo).toBe(2);
    expect(llamadas()).toEqual([]);
    const seco = correr(['--entorno', 'produccion']);
    expect(seco.codigo).toBe(1);
    expect(seco.salida).toContain('proyecto cruzado con las credenciales: no');
  });

  // LOW-A del #493: para escribir, el cruce es obligatorio en LOS DOS entornos.
  it.each([
    ['staging, sin archivo de credenciales', 'staging', [], () => rmSync(join(gcloudCfg, 'application_default_credentials.json'))],
    ['staging, sin quota_project_id', 'staging', [], () => adc('')],
    ['staging --revertir, sin archivo de credenciales', 'staging', ['--revertir'], () => rmSync(join(gcloudCfg, 'application_default_credentials.json'))],
    ['producción --revertir, sin quota_project_id', 'produccion', ['--revertir'], () => adc('')],
  ])('%s, con --aplicar: sale 2 sin ninguna llamada', (_n, entorno, mas, preparar) => {
    preparar();
    politica(CON_PUBLICO);
    const r = correr(['--entorno', entorno, ...mas, '--aplicar', '--confirmo', entorno]);
    expect(r.codigo).toBe(2);
    expect(r.salida).toContain('Sin quota_project_id en las credenciales no se puede cruzar el proyecto: no se escribe');
    expect(llamadas()).toEqual([]);
    expect(llamadasCurl()).toEqual([]);
    expect(publico()).toBe(true);
  });

  it('staging en seco sin credenciales sí lee (no escribe)', () => {
    rmSync(join(gcloudCfg, 'application_default_credentials.json'));
    expect(correr(['--entorno', 'staging']).codigo).toBe(1);
    expect(escrituras()).toEqual([]);
  });

  // Obs 1 del #493: sin CLOUDSDK_CONFIG ni HOME, salida 2 (no el 1 de `set -u`, que significa «pendiente»).
  it('sin CLOUDSDK_CONFIG ni HOME: sale 2 con mensaje claro y sin llamadas', () => {
    const r = correr(['--entorno', 'staging'], {}, VISOR, ['-u', 'HOME', '-u', 'CLOUDSDK_CONFIG']);
    expect(r.codigo).toBe(2);
    expect(r.salida).toContain('Sin CLOUDSDK_CONFIG ni HOME');
    expect(llamadas()).toEqual([]);
  });

  // LOW-1: la cuota es la de producción; un id de staging igual a ella está mal puesto.
  it.each([
    ['seco', ['--entorno', 'staging']],
    ['--aplicar', ['--entorno', 'staging', '--aplicar', '--confirmo', 'staging']],
  ])('staging (%s) cuyo id coincide con la cuota: sale 2 sin llamar a gcloud', (_n, args) => {
    adc(STAGING);
    const r = correr(args);
    expect(r.codigo).toBe(2);
    expect(r.salida).toContain('coincide con el proyecto de las credenciales');
    expect(llamadas()).toEqual([]);
  });

  it('una cuota de un TERCER proyecto en un error de gcloud también se tapa', () => {
    adc(OTRO_ID);
    marcar('niega');
    const r = correr(['--entorno', 'staging']); // correr() exige que OTRO_ID no aparezca
    expect(r.codigo).toBe(3);
    expect(r.salida).toContain('cuota <proyecto>');
  });

  it('gcloud y gh no ven ninguna CLOUDSDK_* salvo CLOUDSDK_CONFIG, ni GH_REPO', () => {
    const hostiles = {
      CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT: 'otra@ejemplo.iam.gserviceaccount.com',
      CLOUDSDK_AUTH_ACCESS_TOKEN_FILE: '/tmp/token-ajeno',
      CLOUDSDK_CORE_ACCOUNT: 'otra@ejemplo.com',
      CLOUDSDK_API_ENDPOINT_OVERRIDES_RUN: 'https://ajeno.example.com/',
      CLOUDSDK_CORE_PROJECT: 'proyecto-ajeno-1',
      CLOUDSDK_ACTIVE_CONFIG_NAME: 'ajena',
      CLOUDSDK_PROPIEDAD_INVENTADA: 'x',
      GH_REPO: 'ajeno/repo',
    };
    // Sin STAGING en el entorno, para que también se llame a gh.
    const r = correr(['--entorno', 'produccion', '--aplicar', '--confirmo', 'produccion'], { ...hostiles, GCP_PROJECT_ID_STAGING: '' });
    expect(r.codigo).toBe(2);
    expect(leer('gh')).toContain('--repo segurolotengopy/NovuChat');
    const conGcloud = correr(['--entorno', 'produccion', '--aplicar', '--confirmo', 'produccion'], hostiles);
    expect(conGcloud.codigo).toBe(0);
    expect(llamadas().length).toBeGreaterThan(0);
    expect(leer('entorno-visto')).toBe('');
  });
});

describe('nube-visor.sh: revisión de seguridad del #490', () => {
  it('un error de 1990 bytes con el id justo en el corte: ni un pedazo del id', () => {
    marcar('niega-largo');
    const r = correr(['--entorno', 'produccion']);
    expect(r.codigo).toBe(3);
    expect(r.salida).not.toContain(PROD.slice(0, 6));
  });

  it('servicio sin goog-managed-by=cloudfunctions: --aplicar sale 2 sin escribir; el seco solo avisa', () => {
    marcar('sin-etiqueta');
    expect(correr(['--entorno', 'staging', '--aplicar', '--confirmo', 'staging']).codigo).toBe(2);
    expect(escrituras()).toEqual([]);
    const seco = correr(['--entorno', 'staging']);
    expect(seco.codigo).toBe(1);
    expect(seco.salida).toContain('goog-managed-by=cloudfunctions');
    politica(CON_PUBLICO);
    expect(correr(['--entorno', 'staging', '--revertir', '--aplicar', '--confirmo', 'staging']).codigo).toBe(2);
    expect(escrituras()).toEqual([]);
  });

  it('el 403 tras conceder sugiere --aplicar --confirmo, que con el binding puesto prueba y no escribe', () => {
    marcar('curl-modo', '403');
    const r = correr(['--entorno', 'staging', '--aplicar', '--confirmo', 'staging']);
    expect(r.salida).toContain('reintentar con --aplicar --confirmo staging: no escribe nada si ya está concedido; solo prueba');
    rmSync(join(dir, 'curl-modo'));
    rmSync(join(dir, 'llamadas'));
    rmSync(join(dir, 'curl'));
    const otra = correr(['--entorno', 'staging', '--aplicar', '--confirmo', 'staging']);
    expect(otra.codigo).toBe(0);
    expect(escrituras()).toEqual([]);
    expect(llamadasCurl()).toHaveLength(1);
  });

  it('describe que no devuelve JSON: sale 3 sin escribir', () => {
    marcar('describe-roto');
    expect(correr(['--entorno', 'staging', '--aplicar', '--confirmo', 'staging']).codigo).toBe(3);
    expect(escrituras()).toEqual([]);
  });

  it.each([
    ['conceder', ['--entorno', 'staging', '--aplicar', '--confirmo', 'staging'], SIN_NADA],
    ['--revertir', ['--entorno', 'staging', '--revertir', '--aplicar', '--confirmo', 'staging'], CON_PUBLICO],
  ])('%s: si la política RELEÍDA no es JSON, sale 3 (nunca se toma por «no hay binding»)', (_n, args, antes) => {
    politica(antes);
    marcar('romper-tras-escribir');
    const r = correr(args as string[]);
    expect(r.codigo).toBe(3);
    expect(r.salida).toContain('no es JSON legible');
  });

  it('una política que no es JSON: sale 3 sin escribir', () => {
    writeFileSync(join(dir, 'politica.json'), 'esto no es JSON');
    expect(correr(['--entorno', 'staging', '--revertir', '--aplicar', '--confirmo', 'staging']).codigo).toBe(3);
    expect(escrituras()).toEqual([]);
  });
});

describe('nube-visor.sh: las Functions HTTP de la ingesta (H2-3)', () => {
  it.each(HTTP)('%s: sin credencial contesta 401 «no autorizado» (nuestro código): concede y sale 0', (servicio) => {
    const r = correr(['--entorno', 'staging', '--aplicar', '--confirmo', 'staging'], {}, servicio);
    expect(r.codigo).toBe(0);
    expect(r.salida).toContain('NUESTRO código');
    expect(escrituras()).toEqual([escritura('add', STAGING, servicio)]);
  });

  it.each(HTTP)('%s: cualquier respuesta distinta del 401 propio y del 403 de Google es «abierto»: revierte y sale 3', (servicio) => {
    for (const [modo, codigo] of [['200', 200], ['http400', 400], ['http404', 404], ['http409', 409], ['http503', 503], ['500', 500], ['http200html', 200], ['http401otro', 401], ['http401json', 401]] as const) {
      politica(SIN_NADA);
      marcar('llamadas', ''); marcar('curl', ''); marcar('curl-modo', modo);
      const r = correr(['--entorno', 'staging', '--aplicar', '--confirmo', 'staging'], {}, servicio);
      expect(r.codigo).toBe(3);
      expect(r.salida).toContain(`REVERTIDO: respondió sin sesión (abierto:${codigo})`);
      expect(escrituras()).toEqual([escritura('add', STAGING, servicio), escritura('remove', STAGING, servicio)]);
      expect(publico()).toBe(false);
    }
  });

  it.each(HTTP)('%s: el 403 HTML de Google sigue siendo de Google (no revierte, el binding queda)', (servicio) => {
    marcar('curl-modo', '403');
    const r = correr(['--entorno', 'staging', '--aplicar', '--confirmo', 'staging'], {}, servicio);
    expect(r.codigo).toBe(3);
    expect(r.salida).toContain('403 de Google');
    expect(escrituras()).toEqual([escritura('add', STAGING, servicio)]);
  });

  it.each(HTTP)('%s: sin respuesta (000) no revierte a ciegas', (servicio) => {
    marcar('curl-modo', '000');
    const r = correr(['--entorno', 'staging', '--aplicar', '--confirmo', 'staging'], {}, servicio);
    expect(r.codigo).toBe(3);
    expect(r.salida).toContain('respuesta inesperada (000)');
    expect(escrituras()).toEqual([escritura('add', STAGING, servicio)]);
  });

  it('los mensajes de una HTTP hablan de la credencial y del flujo n8n; los de una callable, del token', () => {
    const h = correr(['--entorno', 'staging', '--aplicar', '--confirmo', 'staging'], {}, RECLAMAR);
    expect(h.salida).toContain('401 «no autorizado»');
    expect(h.salida).toContain('la barrera sigue siendo la credencial de ingesta del número');
    expect(h.salida).not.toContain('JSON de Firebase');
    const r = correr(['--entorno', 'staging', '--revertir', '--aplicar', '--confirmo', 'staging'], {}, RECLAMAR);
    expect(r.salida).toContain('El flujo n8n «Salida de persona» ya no puede llamar a reclamarSalidaPersona');
    politica(SIN_NADA);
    const c = correr(['--entorno', 'staging', '--aplicar', '--confirmo', 'staging'], {}, ENVIAR);
    expect(c.salida).toContain('JSON de Firebase');
    expect(c.salida).toContain('la barrera sigue siendo el token');
  });

  it('una callable (enviarcomopersona) sigue exigiendo el JSON de Firebase, no el texto', () => {
    marcar('curl-modo', 'propio');
    expect(correr(['--entorno', 'staging', '--aplicar', '--confirmo', 'staging'], {}, ENVIAR).codigo).toBe(0);
  });
});

describe('nube-visor.sh: la fuente', () => {
  const fuente = readFileSync(SCRIPT, 'utf8');
  const codigo = fuente.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

  it('estricta, sin eval, python aislado', () => {
    expect(fuente).toContain('set -euo pipefail');
    expect(codigo).not.toMatch(/\beval\b/);
    expect(codigo).not.toMatch(/python3(?! -I )/);
  });

  it('la lista cerrada: nueve servicios con sus constantes, sin variable que agregue otro', () => {
    for (const [c, v] of [
      ['SERVICIO_ENVIAR', 'enviarcomopersona'], ['FUNCION_ENVIAR', 'enviarComoPersona'],
      ['SERVICIO_TOMAR', 'tomarconversacion'], ['FUNCION_TOMAR', 'tomarConversacion'],
      ['SERVICIO_DEVOLVER', 'devolverconversacion'], ['FUNCION_DEVOLVER', 'devolverConversacion'],
      ['SERVICIO_RECLAMAR', 'reclamarsalidapersona'], ['FUNCION_RECLAMAR', 'reclamarSalidaPersona'],
      ['SERVICIO_CONFIRMAR', 'confirmarsalidapersona'], ['FUNCION_CONFIRMAR', 'confirmarSalidaPersona'],
      ['SERVICIO_GUARDAR', 'guardarmedio'], ['FUNCION_GUARDAR', 'guardarMedio'],
      ['SERVICIO_MEDIO', 'vermedio'], ['FUNCION_MEDIO', 'verMedio'],
    ] as const) expect(codigo).toContain(`readonly ${c}="${v}"`);
    expect(codigo).toContain('readonly SERVICIO_VISOR="vercomprobante"');
    expect(codigo).toContain('readonly FUNCION_VISOR="verComprobante"');
    expect(codigo).toContain('readonly SERVICIO_BUSCADOR="buscarconversaciones"');
    expect(codigo).toContain('readonly FUNCION_BUSCADOR="buscarConversaciones"');
    expect(codigo).toContain('readonly SERVICIO FUNCION');
    // Solo nueve asignaciones de SERVICIO, y desde las constantes.
    expect([...codigo.matchAll(/\bSERVICIO="([^"]*)"/g)].map((m) => m[1])).toEqual([
      '$SERVICIO_VISOR', '$SERVICIO_BUSCADOR', '$SERVICIO_ENVIAR', '$SERVICIO_TOMAR', '$SERVICIO_DEVOLVER', '$SERVICIO_RECLAMAR', '$SERVICIO_CONFIRMAR', '$SERVICIO_GUARDAR', '$SERVICIO_MEDIO']);
    // Solo las tres HTTP son de tipo http.
    expect([...codigo.matchAll(/TIPO="http"/g)]).toHaveLength(3);
    expect(codigo).not.toMatch(/NUBE_VISOR_(SERVICIO|ADC)/);
  });

  it('un solo rol, un solo miembro; nunca a nivel de proyecto', () => {
    expect(codigo).not.toContain('allAuthenticatedUsers');
    expect(codigo).not.toMatch(/--project=/);
    expect(codigo).not.toMatch(/gcloud projects|projects (add|remove|set)-iam|set-iam-policy|functions add-iam/);
    expect([...new Set(codigo.match(/roles\/[a-zA-Z.]+/g))]).toEqual(['roles/run.invoker']);
    expect(codigo).toMatch(/readonly MIEMBRO="allUsers"/);
    // Toda escritura usa las constantes, no un texto suelto.
    const escrituras = [...codigo.matchAll(/(add|remove)-iam-policy-binding "([^"]+)"[\s\\]+--region "([^"]+)"[\s\\]+--member="([^"]+)" --role="([^"]+)"/g)];
    // conceder, quitar (--revertir) y la reversión automática tras «abierto».
    expect(escrituras).toHaveLength(3);
    for (const m of escrituras) expect(m.slice(2)).toEqual(['$SERVICIO', '$REGION', '$MIEMBRO', '$ROL']);
    expect([...codigo.matchAll(/-iam-policy-binding "/g)]).toHaveLength(3);
  });

  it('ningún id de proyecto escrito, y curl solo contra la URL validada del servicio', () => {
    // La carpeta de configuración de gcloud (gcloud-novuchat-prod) no es un id.
    expect(codigo.replaceAll('gcloud-novuchat-prod', '')).not.toMatch(/novu[a-z0-9-]*-[a-z0-9]{3,}/);
    const curls = codigo.split('\n').filter((l) => /\bcurl\b/.test(l) && !/^\s*#/.test(l));
    expect(curls).toHaveLength(1);
    expect(codigo).toMatch(/"\$URL"\s*2>\/dev\/null/);
    expect(codigo).toContain('URL_VALIDA="^https://${SERVICIO}-');
  });

  const hayShellcheck = spawnSync('bash', ['-c', 'command -v shellcheck'], { env: entornoDelEmulador(undefined) }).status === 0;
  it.skipIf(!hayShellcheck)('shellcheck sin observaciones', () => {
    const r = spawnSync('shellcheck', ['-x', SCRIPT], { encoding: 'utf8', env: entornoDelEmulador(undefined) });
    expect(`${r.stdout}${r.stderr}`).toBe('');
    expect(r.status).toBe(0);
  });
});
