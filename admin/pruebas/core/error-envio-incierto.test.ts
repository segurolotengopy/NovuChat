/**
 * errorWorkflow de la decisión I4 (03/11/2026): el flujo de errores registra SOLO
 * el nombre del flujo y la hora. Pruebas negando: una entrada con teléfono, texto,
 * clave y cuerpo del relé en cada campo posible no deja nada de eso en la salida.
 */
import { describe, expect, it } from 'vitest';
import { codigoDe, ejecutar, leerFlujo, GLOBALES_FUERA_DEL_SANDBOX } from '../lib/flujo';

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
    for (const g of GLOBALES_FUERA_DEL_SANDBOX) expect(codigo, g).not.toMatch(new RegExp(`\\b${g}\\b`));
  });

  it('el JSON no envía nada, no tiene credenciales ni URL y los id son cortos', () => {
    const texto = JSON.stringify(f);
    expect(texto).not.toMatch(/credentials|httpRequest|whatsApp|https?:\/\//i);
    expect(f.nodes.map((n) => n.type).sort()).toEqual(['n8n-nodes-base.code', 'n8n-nodes-base.errorTrigger']);
    for (const n of f.nodes) expect(String((n as { id: string }).id)).toMatch(/^[a-z-]{1,20}$/);
  });
});
