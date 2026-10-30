/**
 * LA PAUSA POR TOMAR (`atencion.estado === 'bloqueado'`) y el comercio no operativo en el esqueleto de Walisuma. NEGANDO: con la pausa, cero envíos, cero modelo, cero descargas de medios.
 */
import { describe, expect, it } from 'vitest';
import { ANA, NODOS_DE_MEDIOS_Y_MODELO, SUSPENDIDO, crear, hablar, mAudio, mDocumento, mImagen, mSticker, mTexto, panelOk } from './mundo';

const BLOQUEADO = { atencion: { estado: 'bloqueado', avisarRecepcion: '' } };
const nodosQueCorrieron = (t: ReturnType<typeof hablar>): string[] => t.registro.map((r) => r.nodo);

describe('pausa por Tomar (la ingesta del entrante dice «bloqueado»)', () => {
  for (const [nombre, msg] of [['texto', mTexto('hola')], ['sticker', mSticker()], ['audio', mAudio()], ['imagen', mImagen()], ['documento', mDocumento()]] as const) {
    it(`${nombre}: cero envíos, cero modelo, cero descargas ni guardados de medios`, () => {
      const m = crear({ ingesta: BLOQUEADO });
      const t = hablar(m, ANA, msg);
      expect(t.mensajes).toHaveLength(0);
      expect(t.avisos).toHaveLength(0);
      for (const n of NODOS_DE_MEDIOS_Y_MODELO) expect(nodosQueCorrieron(t)).not.toContain(n);
      expect(nodosQueCorrieron(t)).not.toContain('Enviar a WhatsApp');
      expect(nodosQueCorrieron(t)).not.toContain('Enviar respaldo');
    });
  }
  it('la pausa que viene de `configuracionFlujo` (atencion del panel) también corta, sin llamar a nada', () => {
    const m = crear({ panel: panelOk({ atencion: { estado: 'bloqueado' } }) });
    const t = hablar(m, ANA, mAudio());
    expect(t.mensajes).toHaveLength(0);
    for (const n of NODOS_DE_MEDIOS_Y_MODELO) expect(nodosQueCorrieron(t)).not.toContain(n);
  });
  it('NEGADO: la pausa de un teléfono no se contagia al siguiente turno de otro comercio ni de otro estado: con «normal» el sticker sí contesta', () => {
    const m = crear({ ingesta: { atencion: { estado: 'normal' } } });
    expect(hablar(m, ANA, mSticker()).mensajes).toHaveLength(1);
  });
  it('control (la prueba tiene dientes): con la atención «normal» el mismo audio SÍ baja el medio y lo transcribe', () => {
    const m = crear({ ingesta: { atencion: { estado: 'normal' } } });
    const t = hablar(m, ANA, mAudio());
    expect(nodosQueCorrieron(t)).toContain('Obtener URL del medio (general)');
    expect(nodosQueCorrieron(t)).toContain('Transcribir audio');
  });
  it('control: el estado «operador» responde UN aviso fijo y tampoco baja medios ni llama al modelo', () => {
    const m = crear({ ingesta: { atencion: { estado: 'operador' } } });
    const t = hablar(m, ANA, mAudio());
    expect(t.mensajes).toHaveLength(1);
    for (const n of NODOS_DE_MEDIOS_Y_MODELO) expect(nodosQueCorrieron(t)).not.toContain(n);
  });
});

describe('atención en «operador» (uso extendido)', () => {
  // El texto fijo ofrece «una persona del equipo va a continuar»: tiene que haber un mecanismo detrás. Lo hay: el aviso al comercio MÁS el botón para escribirle directo.
  it('NEGADO: con la atención en «operador» el turno NO se cierra sin el aviso a recepción y sin el botón para escribirle directo', () => {
    const m = crear({ ingesta: { atencion: { estado: 'operador', avisarRecepcion: 'operador' } } });
    const t = hablar(m, ANA, mTexto('hola'));
    expect(t.mensajes).toHaveLength(1);
    expect(t.avisos).toHaveLength(1);
    expect(((t.mensajes[0]?.payload['interactive'] ?? {}) as { type?: string }).type).toBe('cta_url');
    expect(JSON.stringify(t.avisos[0]?.payload)).toMatch(/pedido_registrado/);
    expect(JSON.stringify(t.avisos[0]?.payload)).toMatch(/uso extendido/);
    expect(nodosQueCorrieron(t)).not.toContain('Conversar con el modelo');
  });
  it('NEGADO: dos turnos seguidos en «operador» mandan UN solo aviso (no uno por mensaje); el botón va en los dos', () => {
    const m = crear({ ingesta: { atencion: { estado: 'operador', avisarRecepcion: 'operador' } } });
    const t1 = hablar(m, ANA, mTexto('hola'));
    const t2 = hablar(m, ANA, mTexto('¿hay alguien?'));
    expect(t1.avisos).toHaveLength(1);
    expect(t2.avisos).toHaveLength(0);
    for (const t of [t1, t2]) expect(((t.mensajes[0]?.payload['interactive'] ?? {}) as { type?: string }).type).toBe('cta_url');
  });
  it('NEGADO: si el aviso no sale, el botón igual va (el cliente puede escribirle directo) y no hay modelo', () => {
    const m = crear({ ingesta: { atencion: { estado: 'operador' } }, aviso: 'error' });
    const t = hablar(m, ANA, mTexto('hola'));
    expect(((t.mensajes[0]?.payload['interactive'] ?? {}) as { type?: string }).type).toBe('cta_url');
    expect(nodosQueCorrieron(t)).not.toContain('Conversar con el modelo');
  });
  it('NEGADO: la pausa por Tomar («bloqueado») no avisa a nadie: cero avisos', () => {
    const t = hablar(crear({ ingesta: BLOQUEADO }), ANA, mTexto('hola'));
    expect(t.avisos).toHaveLength(0);
    expect(t.mensajes).toHaveLength(0);
  });
  it('con la pausa por Tomar un mensaje de TEXTO tampoco llama al modelo (cero llamadas)', () => {
    const t = hablar(crear({ ingesta: BLOQUEADO }), ANA, mTexto('quiero una billetera y quiero pagar'));
    expect(nodosQueCorrieron(t)).not.toContain('Conversar con el modelo');
    expect(nodosQueCorrieron(t)).not.toContain('Cotejar en el servidor');
  });
});

describe('comercio no operativo', () => {
  it('suspendido (409 de la consola): UN texto neutro, sin revelar el motivo, y sin medios ni modelo', () => {
    const m = crear({ panel: { statusCode: 409, body: { mensajeCortesia: SUSPENDIDO } } });
    const t = hablar(m, ANA, mImagen());
    expect(t.mensajes).toHaveLength(1);
    expect(t.mensajes[0]?.cuerpo).toBe(SUSPENDIDO);
    expect(t.mensajes[0]?.cuerpo).not.toMatch(/deuda|pago|plan|mora/i);
    for (const n of NODOS_DE_MEDIOS_Y_MODELO) expect(nodosQueCorrieron(t)).not.toContain(n);
  });
});
