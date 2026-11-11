/**
 * errorWorkflow de la decisión I4 (03/11/2026): el flujo de errores registra SOLO
 * el nombre del flujo y la hora. Pruebas negando: una entrada con teléfono, texto,
 * clave y cuerpo del relé en cada campo posible no deja nada de eso en la salida.
 */
import { describe, expect, it } from 'vitest';
import { codigoDe, destinos, ejecutar, leerFlujo, nodo, GLOBALES_FUERA_DEL_SANDBOX } from '../lib/flujo';

const f = leerFlujo('error-envio-incierto.json');
const codigo = codigoDe(f, 'Registrar flujo y hora');

const TEL = '59170000001';
const TEXTO = 'quiero mi cita del martes';
const CLAVE = 'clave-secreta-del-rele-abc123';
const CUERPO = '{"messaging_product":"whatsapp","to":"59170000001","text":{"body":"hola"}}';
const MARCAS = [TEL, TEXTO, CLAVE, 'abc123', 'whatsapp', 'messaging_product'];

const sucia = {
  execution: {
    id: '987654', url: `https://n8n.invalido/execution/987654?t=${TEL}`, mode: 'webhook',
    retryOf: '123456', lastNodeExecuted: `Enviar a WhatsApp ${TEL}`,
    error: { message: `${TEXTO} ${CLAVE} ${CUERPO}`, stack: `${CUERPO} ${CLAVE}`, name: 'NodeApiError', description: TEL, node: { parameters: { jsonBody: CUERPO, headers: CLAVE } } },
  },
  workflow: { id: 'wf42', name: 'Demo A · Agendamiento', extra: { telefono: TEL, texto: TEXTO, clave: CLAVE, cuerpo: CUERPO } },
  telefono: TEL, texto: TEXTO, clave: CLAVE, cuerpo: CUERPO,
};

describe('errorWorkflow «Error de envío incierto»', () => {
  it('la salida tiene solo flujo y hora', () => {
    const [s] = ejecutar(codigo, [sucia]);
    expect(Object.keys(s).sort()).toEqual(['flujo', 'hora']);
    expect(s.flujo).toBe('Demo A · Agendamiento');
    expect(s.hora).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d \(America\/La_Paz, UTC-4\)$/);
  });

  it('ningún dato sensible de ningún campo llega a la salida', () => {
    const salida = JSON.stringify(ejecutar(codigo, [sucia]));
    for (const m of MARCAS) expect(salida, m).not.toContain(m);
    expect(salida).not.toContain('987654');
    expect(salida).not.toContain('wf42');
    expect(salida).not.toContain('https://');
  });

  it('un nombre de flujo con datos pegados se sanea y se acota', () => {
    const [s] = ejecutar(codigo, [{ workflow: { name: `X ${TEL} {"to":"${TEL}"} ` + 'a'.repeat(200) } }]);
    expect(s.flujo.length).toBeLessThanOrEqual(80);
    expect(s.flujo).not.toMatch(/[{}"]/);
  });

  it('el nombre del flujo no deja secuencias de 6 o más dígitos', () => {
    const [s] = ejecutar(codigo, [{ workflow: { name: `Flujo ${TEL} y 1234567` } }]);
    expect(s.flujo).not.toMatch(/\d{6,}/);
  });

  it('tampoco deja dígitos separados que sumen 6 o más', () => {
    for (const n of ['71-23-45-67', '7123 4567', ['71', '23', '45', '67'].join('.'), '7 1 2 3 4 5']) {
      const [s] = ejecutar(codigo, [{ workflow: { name: `Flujo ${n}` } }]);
      expect(s.flujo.replace(/\D/g, '').length, n).toBeLessThan(6);
    }
  });

  it('el único marcador REEMPLAZAR_ es la URL de la alerta, dentro del código de «Armar alerta» (verificar-saneo.sh lo admite ahí); lo repone scripts/cargar-alerta-n8n.sh', () => {
    expect(JSON.stringify(f).match(/REEMPLAZAR_[A-Z_]+/g)).toEqual(['REEMPLAZAR_URL_ALERTA_OPERATIVA']);
    expect(codigoDe(f, 'Armar alerta')).toContain("const url = 'REEMPLAZAR_URL_ALERTA_OPERATIVA';");
    for (const n of f.nodes) expect(JSON.stringify({ ...n.parameters, jsCode: undefined }), n.name).not.toContain('REEMPLAZAR_');
  });

  it('sin workflow o con tipos raros no falla ni filtra', () => {
    for (const e of [{}, { workflow: null, execution: sucia.execution }, { workflow: { name: { texto: TEXTO } } }]) {
      const [s] = ejecutar(codigo, [e]);
      expect(Object.keys(s).sort()).toEqual(['flujo', 'hora']);
      expect(JSON.stringify(s)).not.toContain(TEXTO);
    }
  });

  it('la hora es La Paz (UTC-4) con reloj congelado', () => {
    const Reloj = class extends Date { constructor(...a: unknown[]) { super(...(a.length ? (a as [number]) : [Date.UTC(2026, 10, 3, 2, 30, 5)])); } static now() { return Date.UTC(2026, 10, 3, 2, 30, 5); } };
    const [s] = ejecutar(codigo, [sucia], {}, { Date: Reloj });
    expect(s.hora).toBe('2026-11-02 22:30:05 (America/La_Paz, UTC-4)');
  });

  it('el código no usa globales que el Code de n8n no tiene', () => {
    for (const g of GLOBALES_FUERA_DEL_SANDBOX) {
      expect(codigo, g).not.toMatch(new RegExp(`\\b${g}\\b`));
      expect(codigoDe(f, 'Armar alerta'), g).not.toMatch(new RegExp(`\\b${g}\\b`));
    }
  });

  it('el JSON no envía WhatsApp, no trae triggers de WhatsApp y su única llamada es la alerta firmada', () => {
    const texto = JSON.stringify(f);
    expect(texto).not.toMatch(/whatsApp|graph\.facebook|run\.app|cloudfunctions/i);
    expect(f.nodes.map((n) => n.type)).toEqual([
      'n8n-nodes-base.errorTrigger', 'n8n-nodes-base.code', 'n8n-nodes-base.code', 'n8n-nodes-base.crypto', 'n8n-nodes-base.httpRequest',
    ]);
    for (const n of f.nodes) expect(String((n as { id: string }).id)).toMatch(/^[a-z-]{1,20}$/);
    expect(destinos(f, 'Registrar flujo y hora')).toEqual(['Armar alerta']);
    expect(destinos(f, 'Armar alerta')).toEqual(['Firmar alerta (HMAC)']);
    expect(destinos(f, 'Firmar alerta (HMAC)')).toEqual(['Enviar alerta operativa']);
  });

  it('las credenciales: solo la de tipo crypto, por nombre y con id vacío', () => {
    const con = f.nodes.filter((n) => n.credentials);
    expect(con.map((n) => n.name)).toEqual(['Firmar alerta (HMAC)']);
    expect(con[0]!.credentials).toEqual({ crypto: { id: '', name: 'NovuChat alertas (HMAC)' } });
  });

  it('el nodo Crypto firma HMAC SHA256 en hexadecimal y el HTTP manda el cuerpo crudo con las dos cabeceras', () => {
    expect(nodo(f, 'Firmar alerta (HMAC)').parameters).toMatchObject({ action: 'hmac', type: 'SHA256', encoding: 'hex', binaryData: false });
    const h = nodo(f, 'Enviar alerta operativa');
    expect(h.parameters).toMatchObject({ method: 'POST', sendBody: true, contentType: 'raw', rawContentType: 'application/json', body: '={{ $json.cuerpo }}', url: '={{ $json.url }}' });
    expect(h.parameters['headerParameters'].parameters.map((x: { name: string }) => x.name)).toEqual(['X-NovuChat-Alerta-Timestamp', 'X-NovuChat-Alerta-Signature']);
    expect(h.parameters['options'].timeout).toBe(10000);
    expect(h).toMatchObject({ retryOnFail: true, maxTries: 2 });
    // Sin onError: si la Function responde 401/422/5xx o hay timeout tras los 2 intentos, la ejecución queda en ERROR.
    expect(h).not.toHaveProperty('onError');
  });

  it('guarda solo las ejecuciones con error (none en éxito, all en error): decisión de Andres', () => {
    expect(f.settings).toMatchObject({ saveDataSuccessExecution: 'none', saveDataErrorExecution: 'all' });
  });
});
