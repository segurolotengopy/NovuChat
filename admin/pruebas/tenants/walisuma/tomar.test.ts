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

describe('pendiente de PR-3: atención en «operador»', () => {
  // Hoy el esqueleto ofrece «una persona del equipo va a continuar» sin avisar a recepción (no existe «Armar avisos»): promesa sin respaldo. PR-3 debe avisar y poner el botón.
  it.todo('NEGADO (PR-3): con la atención en «operador» el turno no se cierra sin aviso a recepción con el botón para escribirle directo');
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
