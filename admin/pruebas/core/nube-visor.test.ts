/**
 * `scripts/nube-visor.sh`: el invocador público de la callable `verComprobante`
 * (servicio de Cloud Run `vercomprobante`), seco por omisión.
 *
 * Se prueba NEGANDO, con `gcloud`, `curl` y `gh` FALSOS adelante en el PATH: el
 * `gcloud` falso guarda la política en un archivo, anota cada llamada y, al
 * fallar, menciona el id del proyecto (como el de verdad); el `curl` falso
 * contesta el JSON de Firebase si la política tiene `allUsers` y el 403 de
 * Google si no. Sin red, sin nube, sin credenciales (`entornoDelEmulador`).
 *
 * Lo que cada grupo cierra:
 *  - sin `--confirmo <entorno>` no hay escritura (ni una llamada a gcloud);
 *  - la única escritura es `run services add|remove-iam-policy-binding
 *    vercomprobante --member=allUsers --role=roles/run.invoker` en la región
 *    de `region.ts` y el proyecto del entorno pedido;
 *  - ningún id de proyecto en la salida, en ningún modo;
 *  - idempotente, vuelta atrás, «despliega primero», y la comprobación sin
 *    sesión distingue nuestro JSON del 403 de Google.
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
// Menos de 10 dígitos a propósito (el saneo del repositorio público los
// bloquea); `sanear` tapa desde 6, así que la prueba sigue mordiendo.
const NUMERO_FALSO = '987654321';
const OTRO_ID = 'prueba-visor-otro';
const URL_SERVICIO = `https://vercomprobante-${NUMERO_FALSO}.us-east1.run.app`;

const GCLOUD_FALSO = `#!/usr/bin/env bash
E="$FAKE_DIR"
printf '%s\\n' "$*" >> "$E/llamadas"
env | grep -E '^(CLOUDSDK_(AUTH_|CORE_ACCOUNT|CORE_PROJECT|API_ENDPOINT_)|GH_REPO)' >> "$E/entorno-visto" || true
P=""; MEM=""; ROLE=""
a=("$@")
for ((i = 0; i < \${#a[@]}; i++)); do
  case "\${a[i]}" in
    --project) P="\${a[i+1]}" ;;
    --member=*) MEM="\${a[i]#*=}" ;;
    --role=*) ROLE="\${a[i]#*=}" ;;
  esac
done
c="$*"
case "$c" in
  *"run services describe vercomprobante"*)
    [[ -f "$E/existe" ]] || { echo "ERROR: (gcloud.run.services.describe) NOT_FOUND: Resource 'vercomprobante' of kind 'SERVICE' in region 'r' in project '$P' does not exist." >&2; exit 1; }
    [[ -f "$E/niega" ]] && { echo "ERROR: PERMISSION_DENIED: cuenta@ejemplo.com sin permiso en $P (proyecto ${NUMERO_FALSO})" >&2; exit 1; }
    # 1990 bytes de relleno y el id justo encima del corte de 2000.
    [[ -f "$E/niega-largo" ]] && { printf 'x%.0s' {1..1990} >&2; echo "$P sin permiso" >&2; exit 1; }
    [[ -f "$E/describe-roto" ]] && { echo "esto no es JSON"; exit 0; }
    etiquetas='{"goog-managed-by":"cloudfunctions"}'; [[ -f "$E/sin-etiqueta" ]] && etiquetas='{}'
    printf '{"metadata":{"name":"vercomprobante","labels":%s},"status":{"url":"%s"}}\\n' "$etiquetas" "$(cat "$E/url")" ;;
  *"run services get-iam-policy vercomprobante"*) cat "$E/politica.json" ;;
  *"run services add-iam-policy-binding"*|*"run services remove-iam-policy-binding"*)
    op=add; [[ "$c" == *remove-iam-policy-binding* ]] && op=remove
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
modo="auto"; [[ -f "$E/curl-modo" ]] && modo="$(cat "$E/curl-modo")"
if [[ "$modo" == auto ]]; then
  if python3 -c 'import json,sys; p=json.load(open(sys.argv[1])); sys.exit(0 if any(b.get("role")=="roles/run.invoker" and "allUsers" in b.get("members",[]) for b in p.get("bindings",[])) else 1)' "$E/politica.json"; then modo=propio; else modo=403; fi
fi
case "$modo" in
  propio) printf '{"error":{"message":"Unauthenticated","status":"UNAUTHENTICATED"}}' > "$out"; printf '401' ;;
  403) printf '<html><title>403 Forbidden</title></html>' > "$out"; printf '403' ;;
  500) printf 'error' > "$out"; printf '500' ;;
  200) printf '{"result":{"mime":"image/png","base64":""}}' > "$out"; printf '200' ;;
  invalido) printf '{"error":{"message":"Solicitud inválida.","status":"INVALID_ARGUMENT"}}' > "$out"; printf '400' ;;
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

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nube-visor-'));
  bin = join(dir, 'bin');
  mkdirSync(bin);
  for (const [n, t] of [['gcloud', GCLOUD_FALSO], ['curl', CURL_FALSO], ['gh', GH_FALSO]] as const) {
    writeFileSync(join(bin, n), t);
    chmodSync(join(bin, n), 0o755);
  }
  writeFileSync(join(dir, 'existe'), '');
  writeFileSync(join(dir, 'url'), URL_SERVICIO);
  adc(PROD);
  politica(SIN_NADA);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function politica(p: unknown) { writeFileSync(join(dir, 'politica.json'), JSON.stringify(p)); }
/** Las credenciales de gcloud falsas: solo el quota_project_id (vacío = sin el campo). */
function adc(cuota: string) {
  writeFileSync(join(dir, 'adc.json'), cuota ? JSON.stringify({ type: 'authorized_user', quota_project_id: cuota }) : '{"type":"authorized_user"}');
}
const leer = (n: string) => (existsSync(join(dir, n)) ? readFileSync(join(dir, n), 'utf8') : '');
const llamadas = () => leer('llamadas').split('\n').filter(Boolean);
const escrituras = () => llamadas().filter((l) => /(add|remove|set)-iam-policy|projects |functions /.test(l));
const llamadasCurl = () => leer('curl').split('\n').filter(Boolean);
const publico = () => JSON.parse(leer('politica.json')).bindings
  .some((b: { role: string; members: string[] }) => b.role === 'roles/run.invoker' && b.members.includes('allUsers'));

function correr(args: string[], vars: Record<string, string> = {}) {
  const r = spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: entornoDelEmulador(undefined, {
      PATH: `${bin}:/usr/bin:/bin`,
      FAKE_DIR: dir,
      GCP_PROJECT_ID_STAGING: STAGING,
      GCP_PROJECT_ID_PROD: PROD,
      NUBE_VISOR_INTENTOS: '2',
      NUBE_VISOR_ESPERA: '0',
      NUBE_VISOR_ADC: join(dir, 'adc.json'),
      ...vars,
    }),
  });
  const salida = `${r.stdout}${r.stderr}`;
  // Ningún id de proyecto en la salida, nunca (vale para TODAS las pruebas).
  expect(salida).not.toContain(STAGING);
  expect(salida).not.toContain(PROD);
  expect(salida).not.toContain(NUMERO_FALSO);
  expect(salida).not.toContain(OTRO_ID);
  return { codigo: r.status, salida };
}

describe('nube-visor.sh: uso y salvaguardas (nada se llama a gcloud)', () => {
  it('--help explica los modos y sale 0', () => {
    const r = correr(['--help']);
    expect(r.codigo).toBe(0);
    for (const t of ['--entorno', '--aplicar', '--confirmo', '--revertir', 'vercomprobante']) expect(r.salida).toContain(t);
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

  it('sin la variable del entorno pedido (y gh sin respuesta): sale 2; gh solo se usa para leer', () => {
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
    writeFileSync(join(dir, 'niega'), '');
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
    expect(escrituras()).toEqual([
      `--project ${STAGING} --quiet run services add-iam-policy-binding vercomprobante --region ${REGION} --member=allUsers --role=roles/run.invoker`,
    ]);
    expect(publico()).toBe(true);
    expect(JSON.parse(leer('politica.json')).bindings).toEqual(CON_PUBLICO.bindings);
    expect(r.salida).toContain('NUESTRO código');
    const c = llamadasCurl();
    expect(c).toHaveLength(1);
    expect(c[0]!.endsWith(` ${URL_SERVICIO}`)).toBe(true);
    expect(c[0]).toContain('-X POST');
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

  it('si sigue el 403 de Google después de conceder: sale 3 y lo dice', () => {
    writeFileSync(join(dir, 'curl-modo'), '403');
    const r = correr(['--entorno', 'staging', '--aplicar', '--confirmo', 'staging']);
    expect(r.codigo).toBe(3);
    expect(r.salida).toContain('403 de Google');
    expect(llamadasCurl()).toHaveLength(2); // NUBE_VISOR_INTENTOS=2
  });

  it('una respuesta que no es ni nuestra ni de Google: sale 3', () => {
    writeFileSync(join(dir, 'curl-modo'), '500');
    expect(correr(['--entorno', 'staging', '--aplicar', '--confirmo', 'staging']).codigo).toBe(3);
  });

  it('una dirección de servicio que no es *.run.app de vercomprobante: no se llama a curl', () => {
    writeFileSync(join(dir, 'url'), 'https://evil.example.com/vercomprobante-1.run.app');
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
    expect(escrituras()).toEqual([
      `--project ${PROD} --quiet run services remove-iam-policy-binding vercomprobante --region ${REGION} --member=allUsers --role=roles/run.invoker`,
    ]);
    expect(JSON.parse(leer('politica.json')).bindings).toEqual([{ role: 'roles/run.admin', members: ['user:alguien@ejemplo.com'] }]);
    expect(r.salida).toContain('Vuelta atrás hecha');
  });

  it('sin el binding: nada que quitar, sale 0, no escribe', () => {
    const r = correr(['--entorno', 'staging', '--revertir', '--aplicar', '--confirmo', 'staging']);
    expect(r.codigo).toBe(0);
    expect(r.salida).toContain('nada que quitar');
    expect(escrituras()).toEqual([]);
  });
});

describe('nube-visor.sh: revisión de seguridad del #490', () => {
  // 1 (MEDIUM): si tras conceder el código atiende a un anónimo, se quita en el acto.
  it.each([
    ['un 200', '200', 'abierto:200'],
    ['un 400 INVALID_ARGUMENT (la sesión ya pasó)', 'invalido', 'abierto:400'],
  ])('tras conceder, %s sin sesión: REVIERTE con las mismas constantes y sale 3', (_n, modo, ultima) => {
    writeFileSync(join(dir, 'curl-modo'), modo);
    const r = correr(['--entorno', 'staging', '--aplicar', '--confirmo', 'staging']);
    expect(r.codigo).toBe(3);
    expect(r.salida).toContain(`REVERTIDO: respondió sin sesión (${ultima})`);
    const fijo = `--region ${REGION} --member=allUsers --role=roles/run.invoker`;
    expect(escrituras()).toEqual([
      `--project ${STAGING} --quiet run services add-iam-policy-binding vercomprobante ${fijo}`,
      `--project ${STAGING} --quiet run services remove-iam-policy-binding vercomprobante ${fijo}`,
    ]);
    expect(publico()).toBe(false);
    expect(llamadasCurl()).toHaveLength(1); // «abierto» no se reintenta
  });

  it('con el binding ya puesto (no lo puso esta corrida) y respuesta sin sesión: sale 3 sin escribir', () => {
    politica(CON_PUBLICO);
    writeFileSync(join(dir, 'curl-modo'), '200');
    const r = correr(['--entorno', 'staging', '--aplicar', '--confirmo', 'staging']);
    expect(r.codigo).toBe(3);
    expect(r.salida).toContain('--revertir --aplicar --confirmo staging');
    expect(escrituras()).toEqual([]);
  });

  // 2: las dos variables, antes de cualquier llamada a gcloud.
  it.each([
    ['el id de producción como STAGING y sin PROD', { GCP_PROJECT_ID_STAGING: PROD, GCP_PROJECT_ID_PROD: '' }, 'staging', 'Falta GCP_PROJECT_ID_PROD'],
    ['sin STAGING, pidiendo producción', { GCP_PROJECT_ID_STAGING: '' }, 'produccion', 'Falta GCP_PROJECT_ID_STAGING'],
  ])('%s: sale 2 sin llamar a gcloud y dice cuál falta', (_n, vars, entorno, mensaje) => {
    const r = correr(['--entorno', entorno], vars);
    expect(r.codigo).toBe(2);
    expect(r.salida).toContain(mensaje);
    expect(llamadas()).toEqual([]);
  });

  // 3: el cruce con el quota_project_id de las credenciales.
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
    ['sin archivo de credenciales', () => rmSync(join(dir, 'adc.json'))],
  ])('producción con --aplicar %s: sale 2 sin llamar a gcloud; el seco sigue y lo avisa', (_n, preparar) => {
    preparar();
    expect(correr(['--entorno', 'produccion', '--aplicar', '--confirmo', 'produccion']).codigo).toBe(2);
    expect(llamadas()).toEqual([]);
    const seco = correr(['--entorno', 'produccion']);
    expect(seco.codigo).toBe(1);
    expect(seco.salida).toContain('proyecto cruzado con las credenciales: no');
  });

  it('staging no exige el cruce (la cuota es la de producción)', () => {
    adc('');
    expect(correr(['--entorno', 'staging', '--aplicar', '--confirmo', 'staging']).codigo).toBe(0);
  });

  // 4: sanear tapa sobre el texto completo y corta después.
  it('un error de 1990 bytes con el id justo en el corte: ni un pedazo del id', () => {
    writeFileSync(join(dir, 'niega-largo'), '');
    const r = correr(['--entorno', 'produccion']);
    expect(r.codigo).toBe(3);
    expect(r.salida).not.toContain(PROD.slice(0, 6));
  });

  // 5: sin la etiqueta de Cloud Functions, --aplicar no escribe; el seco avisa.
  it('servicio sin goog-managed-by=cloudfunctions: --aplicar sale 2 sin escribir; el seco solo avisa', () => {
    writeFileSync(join(dir, 'sin-etiqueta'), '');
    expect(correr(['--entorno', 'staging', '--aplicar', '--confirmo', 'staging']).codigo).toBe(2);
    expect(escrituras()).toEqual([]);
    const seco = correr(['--entorno', 'staging']);
    expect(seco.codigo).toBe(1);
    expect(seco.salida).toContain('goog-managed-by=cloudfunctions');
    politica(CON_PUBLICO);
    expect(correr(['--entorno', 'staging', '--revertir', '--aplicar', '--confirmo', 'staging']).codigo).toBe(2);
    expect(escrituras()).toEqual([]);
  });

  // 6: el reintento correcto es --aplicar (con el binding puesto, prueba sin escribir).
  it('el 403 tras conceder sugiere --aplicar --confirmo, que con el binding puesto prueba y no escribe', () => {
    writeFileSync(join(dir, 'curl-modo'), '403');
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

  // 7: un JSON ilegible nunca se toma por «no hay binding».
  it('describe que no devuelve JSON: sale 3 sin escribir', () => {
    writeFileSync(join(dir, 'describe-roto'), '');
    expect(correr(['--entorno', 'staging', '--aplicar', '--confirmo', 'staging']).codigo).toBe(3);
    expect(escrituras()).toEqual([]);
  });

  it.each([
    ['conceder', ['--entorno', 'staging', '--aplicar', '--confirmo', 'staging'], SIN_NADA],
    ['--revertir', ['--entorno', 'staging', '--revertir', '--aplicar', '--confirmo', 'staging'], CON_PUBLICO],
  ])('%s: si la política RELEÍDA no es JSON, sale 3 (nunca se toma por «no hay binding»)', (_n, args, antes) => {
    politica(antes);
    writeFileSync(join(dir, 'romper-tras-escribir'), '');
    const r = correr(args as string[]);
    expect(r.codigo).toBe(3);
    expect(r.salida).toContain('no es JSON legible');
  });

  it('una política que no es JSON: sale 3 sin escribir', () => {
    writeFileSync(join(dir, 'politica.json'), 'esto no es JSON');
    expect(correr(['--entorno', 'staging', '--revertir', '--aplicar', '--confirmo', 'staging']).codigo).toBe(3);
    expect(escrituras()).toEqual([]);
  });

  // 8: nada del entorno cambia quién actúa ni adónde van las llamadas.
  it('gcloud y gh no ven las variables que cambian cuenta, token, extremo, proyecto o repositorio', () => {
    const hostiles = {
      CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT: 'otra@ejemplo.iam.gserviceaccount.com',
      CLOUDSDK_AUTH_ACCESS_TOKEN_FILE: '/tmp/token-ajeno',
      CLOUDSDK_CORE_ACCOUNT: 'otra@ejemplo.com',
      CLOUDSDK_API_ENDPOINT_OVERRIDES_RUN: 'https://ajeno.example.com/',
      CLOUDSDK_CORE_PROJECT: 'proyecto-ajeno-1',
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

describe('nube-visor.sh: la fuente', () => {
  const fuente = readFileSync(SCRIPT, 'utf8');
  const codigo = fuente.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

  it('estricta y sin eval', () => {
    expect(fuente).toContain('set -euo pipefail');
    expect(codigo).not.toMatch(/\beval\b/);
  });

  it('un solo rol, un solo miembro, un solo servicio; nunca a nivel de proyecto', () => {
    expect(codigo).not.toContain('allAuthenticatedUsers');
    expect(codigo).not.toMatch(/--project=/);
    expect(codigo).not.toMatch(/gcloud projects|projects (add|remove|set)-iam|set-iam-policy|functions add-iam/);
    expect([...new Set(codigo.match(/roles\/[a-zA-Z.]+/g))]).toEqual(['roles/run.invoker']);
    expect(codigo).toMatch(/readonly SERVICIO="vercomprobante"/);
    expect(codigo).toMatch(/readonly MIEMBRO="allUsers"/);
    // Toda escritura usa las constantes, no un texto suelto.
    for (const m of codigo.matchAll(/(add|remove)-iam-policy-binding "([^"]+)"[\s\\]+--region "([^"]+)"[\s\\]+--member="([^"]+)" --role="([^"]+)"/g)) {
      expect(m.slice(2)).toEqual(['$SERVICIO', '$REGION', '$MIEMBRO', '$ROL']);
    }
    // conceder, quitar (--revertir) y la reversión automática tras «abierto».
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
