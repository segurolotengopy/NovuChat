/**
 * ALERTA DEL ERRORWORKFLOW («Error de envío incierto» -> Function `alertaOperativa`): probada NEGANDO.
 *
 * Se ejecuta el código REAL de «Armar alerta» (el del JSON versionado), se simula el nodo Crypto de n8n con
 * `createHmac(clave).update(aFirmar)` (hex, como en `CryptoV2.node.js` de n8n-nodes-base 2.36.5) y el resultado entra a
 * `atenderAlerta()` con un almacén en memoria. Vive en `plataforma/` para no importar hacia arriba (la Function es de
 * Plataforma). Valores sintéticos ARMADOS EN EJECUCIÓN: ningún teléfono, correo ni identificador literal en el repositorio.
 */
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { atenderAlerta, type Enviar, type Envio } from '../../functions/src/plataforma/alertaOperativa.ts';
import { ErrorContrato, validarEntrada } from '../../functions/src/plataforma/alertaContenido.ts';
import { codigoDe, ejecutar, expresion, leerFlujo, nodo, type J } from '../lib/flujo';
import { almacenEnMemoria } from './alerta-almacen-memoria.ts';
import { AHORA } from './alerta-almacen-contrato.ts';

const f = leerFlujo('error-envio-incierto.json');
const REGISTRAR = codigoDe(f, 'Registrar flujo y hora');
const ARMAR = codigoDe(f, 'Armar alerta');
const CLAVE = ['clave', 'de', 'prueba', 'solo', 'para', 'esta', 'suite'].join('-');
const OTRA_CLAVE = ['otra', 'clave', 'de', 'prueba'].join('-');
const HOSTS = ['github.com'];
const DETENER = 'Detener por envío incierto';

const relojEn = (ms: number) => class extends Date {
  constructor(...a: unknown[]) { super(...(a.length ? (a as [number]) : [ms])); }
  static override now(): number { return ms; }
};

interface Salida { cuerpo: string; marca: string; aFirmar: string }
/** Registrar -> Armar, con el reloj en `ms`. `entrada` es lo que entrega el Error Trigger. */
function armar(entrada: J, ms = AHORA): Salida {
  const globales = { Date: relojEn(ms) };
  const [reg] = ejecutar(REGISTRAR, [entrada], {}, globales);
  const [s] = ejecutar(ARMAR, [reg!], { 'Error del flujo': entrada }, globales);
  return s as unknown as Salida;
}
/** Lo que haría el nodo Crypto: HMAC SHA256 hex de la expresión `value`, con la clave de la credencial. */
function firmar(s: Salida, clave = CLAVE): string {
  const valor = String(expresion(nodo(f, 'Firmar alerta (HMAC)').parameters['value'], s as unknown as J));
  return createHmac('sha256', clave).update(valor).digest('hex');
}
const entradaDe = (extra: J = {}, nombre = 'Demo A · Agendamiento', ultimo = DETENER): J => ({
  execution: { id: '1', lastNodeExecuted: ultimo, error: { message: 'x' } }, workflow: { name: nombre }, ...extra,
});

function llamar(cuerpo: string, marca: string, firma: string, ahora = AHORA) {
  const almacen = almacenEnMemoria();
  const enviados: Envio[] = [];
  const enviar: Enviar = async (e) => { enviados.push(e); };
  const cab: Record<string, string> = { 'x-novuchat-alerta-timestamp': marca, 'x-novuchat-alerta-signature': firma };
  const r = atenderAlerta(
    { metodo: 'POST', cabecera: (n) => cab[n.toLowerCase()], crudo: Buffer.from(cuerpo, 'utf8') },
    { secreto: CLAVE, ahoraMs: ahora, cargar: async () => ({ almacen, enviar, hosts: HOSTS, denegar: [] }) });
  return { r, almacen, enviados };
}

describe('firma del errorWorkflow contra la Function', () => {
  it('«Armar alerta» + Crypto simulado: la Function responde 200 y manda el correo urgente', async () => {
    const s = armar(entradaDe());
    expect(s.aFirmar).toBe(`${s.marca}.${s.cuerpo}`);
    expect(s.marca).toBe(String(AHORA));
    const { r, enviados } = llamar(s.cuerpo, s.marca, firmar(s));
    expect(await r).toEqual({ status: 200, cuerpo: 'enviado' });
    expect(enviados).toHaveLength(1);
    expect(enviados[0]!.asunto).toContain('Envío incierto');
  });

  it('el HTTP Request manda marca, firma y cuerpo tal como los entrega el Crypto', () => {
    const s = armar(entradaDe());
    const firma = firmar(s);
    const j = { ...s, firma } as unknown as J;
    const h = nodo(f, 'Enviar alerta operativa').parameters;
    expect(expresion(h['body'], j)).toBe(s.cuerpo);
    expect(expresion(h['url'], j)).toBe('REEMPLAZAR_URL_ALERTA_OPERATIVA');
    const cab = Object.fromEntries(h['headerParameters'].parameters.map((x: { name: string; value: string }) => [x.name, expresion(x.value, j)]));
    expect(cab).toEqual({ 'X-NovuChat-Alerta-Timestamp': s.marca, 'X-NovuChat-Alerta-Signature': firma });
  });

  it('un flujo con «ñ» y «—» viaja escapado (ASCII puro) y la Function lo acepta', async () => {
    const s = armar(entradaDe({}, 'Año nuevo — Agenda'));
    expect(/^[\x20-\x7e]*$/.test(s.cuerpo)).toBe(true);
    expect(s.cuerpo).toContain('\\u00f1');
    expect(s.cuerpo).toContain('\\u2014');
    expect(JSON.parse(s.cuerpo).flujo).toBe('Año nuevo — Agenda');
    expect(Buffer.from(s.cuerpo, 'utf8').length).toBe(s.cuerpo.length);
    expect((await llamar(s.cuerpo, s.marca, firmar(s)).r).status).toBe(200);
  });

  it('NEGANDO: firma de otra clave -> 401, sin guardar ni enviar', async () => {
    const s = armar(entradaDe());
    const { r, almacen, enviados } = llamar(s.cuerpo, s.marca, firmar(s, OTRA_CLAVE));
    expect((await r).status).toBe(401);
    expect(enviados).toHaveLength(0);
    expect(almacen.eventos.size).toBe(0);
  });

  it('NEGANDO: marca de hace 121 s -> 401 (la ventana es de 120 s)', async () => {
    const s = armar(entradaDe(), AHORA - 121_000);
    expect((await llamar(s.cuerpo, s.marca, firmar(s)).r).status).toBe(401);
    const fresca = armar(entradaDe(), AHORA - 119_000);
    expect((await llamar(fresca.cuerpo, fresca.marca, firmar(fresca)).r).status).toBe(200);
  });

  it('NEGANDO: un solo byte alterado en el cuerpo -> 401', async () => {
    const s = armar(entradaDe());
    const alterado = s.cuerpo.replace('urgente', 'urgentf');
    expect(alterado).not.toBe(s.cuerpo);
    expect(alterado.length).toBe(s.cuerpo.length);
    expect((await llamar(alterado, s.marca, firmar(s)).r).status).toBe(401);
  });

  it('NEGANDO: firmar el texto SIN escapar (con «ñ/—») no vale: 401', async () => {
    const s = armar(entradaDe({}, 'Año nuevo — Agenda'));
    const sinEscapar = JSON.stringify(JSON.parse(s.cuerpo));
    expect(sinEscapar).not.toBe(s.cuerpo);
    const firmaMala = createHmac('sha256', CLAVE).update(`${s.marca}.${sinEscapar}`).digest('hex');
    expect((await llamar(s.cuerpo, s.marca, firmaMala).r).status).toBe(401);
    // El cuerpo sin escapar enviado como bytes UTF-8 tampoco coincide con lo firmado sobre el escapado.
    expect((await llamar(sinEscapar, s.marca, firmar(s)).r).status).toBe(401);
  });
});

describe('niveles: envio_incierto = urgente; cualquier otro error = aviso', () => {
  it('«Detener por envío incierto» -> urgente, envio_incierto, con el nodo', () => {
    const c = JSON.parse(armar(entradaDe()).cuerpo);
    expect(c).toMatchObject({ nivel: 'urgente', tipo_error: 'envio_incierto', nodo: DETENER, proyecto: 'novuchat' });
  });

  it('cualquier otro nodo, uno parecido o ninguno -> aviso, error_de_flujo y sin nodo', () => {
    for (const ultimo of ['Enviar por el relé', `${DETENER} `, DETENER.toLowerCase(), '', 'Detener']) {
      const c = JSON.parse(armar(entradaDe({}, 'Demo A', ultimo)).cuerpo);
      expect(c, ultimo).toMatchObject({ nivel: 'aviso', tipo_error: 'error_de_flujo' });
      expect(c.nodo, ultimo).toBeUndefined();
    }
    for (const e of [{}, { execution: null }, { execution: 'x' }, { execution: {} }]) {
      expect(JSON.parse(armar(e).cuerpo)).toMatchObject({ nivel: 'aviso', tipo_error: 'error_de_flujo' });
    }
  });

  it('el aviso (no urgente) también pasa la firma y el contrato: 200', async () => {
    const s = armar(entradaDe({}, 'Demo A', 'Otro nodo'));
    expect(await llamar(s.cuerpo, s.marca, firmar(s)).r).toEqual({ status: 200, cuerpo: 'enviado' });
  });
});

describe('PII: nada de la entrada sale en la alerta', () => {
  const TEL = ['5917', '0000001'].join('');
  const TEXTO = 'quiero mi cita del martes';
  const SECRETO = ['clave', 'secreta', 'del', 'rele', 'abc123'].join('-');
  const CUERPO_RELE = JSON.stringify({ messaging_product: 'whatsapp', to: TEL, text: { body: 'hola' } });
  const MARCAS = [TEL, TEXTO, SECRETO, 'abc123', 'whatsapp', 'messaging_product', 'hola', 'NodeApiError', '987654'];
  const sucia = (ultimo: string): J => ({
    execution: {
      id: '987654', url: `https://n8n.invalido/execution/987654?t=${TEL}`, mode: 'webhook', retryOf: '123456', lastNodeExecuted: ultimo,
      error: {
        message: `${TEXTO} ${SECRETO} ${CUERPO_RELE}`, stack: `${CUERPO_RELE} ${SECRETO}`, name: 'NodeApiError', description: TEL,
        node: { parameters: { jsonBody: CUERPO_RELE, headers: SECRETO } },
      },
    },
    workflow: { id: 'wf42', name: 'Demo A · Agendamiento', extra: { telefono: TEL, texto: TEXTO, clave: SECRETO, cuerpo: CUERPO_RELE } },
    telefono: TEL, texto: TEXTO, clave: SECRETO, cuerpo: CUERPO_RELE,
  });
  const ID_PROHIBIDO = /\d{7,}|[0-9a-f]{16,}|^resumen-|^id-invalido-|:bloqueado$/;

  for (const [titulo, ultimo] of [['urgente', DETENER], ['aviso', `Enviar a ${TEL} ${SECRETO}`]] as const) {
    it(`entrada sucia (${titulo}): el cuerpo no trae ninguna marca, el contrato lo acepta y el id es limpio`, () => {
      const s = armar(sucia(ultimo));
      for (const m of MARCAS) expect(s.cuerpo, m).not.toContain(m);
      expect(s.cuerpo).not.toContain(TEL.slice(0, 7));
      expect(s.cuerpo).not.toContain('https://n8n');
      const c = JSON.parse(s.cuerpo);
      expect(Object.keys(c).sort()).toEqual(
        ['asunto', 'enlace', 'flujo', 'id_unico', 'nivel', 'ocurrido_en', 'proyecto', 'que_paso', 'que_se_espera_de_andres', 'tipo_error', ...(titulo === 'urgente' ? ['nodo'] : [])].sort());
      let ev;
      try { ev = validarEntrada(c, { hosts: HOSTS, denegar: [], ahoraMs: AHORA }); } catch (e) {
        if (e instanceof ErrorContrato) throw new Error(`ErrorContrato: ${e.cuerpo}`);
        throw e;
      }
      expect(ev.saneado).toBe(false);
      expect(c.id_unico).not.toMatch(ID_PROHIBIDO);
      expect(c.id_unico).toBe(`${c.tipo_error}-${c.ocurrido_en.slice(0, -1)}`);
    });
  }

  it('un nombre de flujo con datos pegados sale saneado y el contrato lo acepta', () => {
    const nombres = [
      `X ${TEL} {"to":"${TEL}"} ${'ab '.repeat(70)}`, 'Flujo 71-23-45-67', `Flujo ${['71', '23', '45', '67'].join('.')}`,
      'Cita (copia) · Año — v2', SECRETO.toUpperCase(),
    ];
    for (const n of nombres) {
      const s = armar(entradaDe({}, n));
      expect(s.cuerpo, n).not.toContain(TEL);
      const c = JSON.parse(s.cuerpo);
      expect([...c.flujo].length).toBeLessThanOrEqual(80);
      expect(() => validarEntrada(c, { hosts: HOSTS, denegar: [], ahoraMs: AHORA }), n).not.toThrow();
    }
  });

  it('el id es determinista (misma hora, mismo id) y cambia con el segundo', () => {
    expect(JSON.parse(armar(entradaDe()).cuerpo).id_unico).toBe(JSON.parse(armar(entradaDe()).cuerpo).id_unico);
    expect(JSON.parse(armar(entradaDe(), AHORA + 1000).cuerpo).id_unico).not.toBe(JSON.parse(armar(entradaDe()).cuerpo).id_unico);
  });
});

describe('el JSON versionado no lleva secretos', () => {
  const texto = JSON.stringify(f);
  it('ni claves, ni cabeceras con Bearer, ni hosts de la nube, ni palabras largas', () => {
    expect(texto).not.toMatch(/hmacSecret|Bearer|run\.app|cloudfunctions|\.internal|localhost/i);
    expect(texto).not.toMatch(/[A-Za-z0-9]{32,}/);
  });
  it('las credenciales son solo por nombre (id vacío) y el único REEMPLAZAR_ es la URL', () => {
    for (const n of f.nodes) {
      for (const c of Object.values(n.credentials ?? {})) {
        expect(Object.keys(c).sort()).toEqual(['id', 'name']);
        expect(c.id).toBe('');
      }
    }
    expect(texto.match(/REEMPLAZAR_[A-Z_]+/g)).toEqual(['REEMPLAZAR_URL_ALERTA_OPERATIVA']);
    expect(nodo(f, 'Enviar alerta operativa').parameters['url']).toBe('={{ $json.url }}');
    expect(codigoDe(f, 'Armar alerta')).toContain("const url = 'REEMPLAZAR_URL_ALERTA_OPERATIVA';");
  });
});
