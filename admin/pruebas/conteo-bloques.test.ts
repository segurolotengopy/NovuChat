/**
 * Pruebas de la unidad de cobro: la conversación como BLOQUE de 25 respuestas
 * dentro de la ventana de 24 horas (`Analisis/27`, 13/09/2026).
 *
 * NO NECESITAN EMULADOR: `contadoresDelMensaje` es pura. Se recorre una
 * conversación mensaje por mensaje, como la haría la ingesta, y se mira qué
 * suma cada uno. Sobre esto se factura, así que los casos son exactamente los
 * que Andres enunció al decidirlo:
 *
 *   - 26 respuestas en el mismo día  → dos conversaciones (dos bloques).
 *   - 20 respuestas hoy y 2 mañana   → dos conversaciones (dos ventanas).
 *   - 25 justas                      → una sola.
 */
import { describe, expect, it } from 'vitest';
import {
  contadoresDelMensaje, HORAS_VENTANA_ATENCION, RESPUESTAS_POR_CONVERSACION,
  type MarcasDeConteo,
} from '../functions/src/ingesta.ts';

const PERIODO = '2026-10';
const HORA = 3_600_000;
const T0 = Date.UTC(2026, 9, 5, 14, 0, 0);
const ts = (ms: number) => ({ toMillis: () => ms });

interface Resultado {
  conversaciones: number;
  bloquesAdicionales: number;
  marcas: MarcasDeConteo;
}

/**
 * Aplica un mensaje sobre las marcas guardadas, como lo hace la transacción de
 * la ingesta: calcula, y deja escrito lo que la ingesta escribiría.
 */
function aplicar(
  r: Resultado, direccion: 'entrante' | 'saliente', enMs: number, texto = 'hola, quiero reservar',
): Resultado {
  const c = contadoresDelMensaje(r.marcas, PERIODO, direccion, enMs, texto);
  return {
    conversaciones: r.conversaciones + (c.conversacion ? 1 : 0),
    bloquesAdicionales: r.bloquesAdicionales + (c.bloqueNuevo ? 1 : 0),
    marcas: {
      ...r.marcas,
      periodoContado: PERIODO,
      respuestasDelPeriodo: c.respuestasDelPeriodo,
      mensajesVentana: c.mensajesVentana,
      ...(c.atencion ? { atencionDesde: ts(enMs) } : {}),
    },
  };
}

const vacio = (): Resultado => ({ conversaciones: 0, bloquesAdicionales: 0, marcas: {} });

/** Una consulta del cliente seguida de `n` respuestas del asistente. */
function consultaConRespuestas(r: Resultado, desdeMs: number, n: number): Resultado {
  let actual = aplicar(r, 'entrante', desdeMs);
  for (let i = 1; i <= n; i++) {
    // Cada ida y vuelta: el cliente insiste y el asistente responde.
    if (i > 1) actual = aplicar(actual, 'entrante', desdeMs + i * 60_000, 'y otra cosa más');
    actual = aplicar(actual, 'saliente', desdeMs + i * 60_000 + 30_000);
  }
  return actual;
}

describe('El bloque de 25 respuestas', () => {
  it('el valor comercial es 25', () => {
    expect(RESPUESTAS_POR_CONVERSACION).toBe(25);
  });

  it('una consulta con 25 respuestas es UNA conversación', () => {
    const r = consultaConRespuestas(vacio(), T0, 25);
    expect(r.conversaciones).toBe(1);
    expect(r.bloquesAdicionales).toBe(0);
    expect(r.marcas.mensajesVentana).toBe(25);
  });

  it('26 respuestas en el mismo día son DOS conversaciones', () => {
    const r = consultaConRespuestas(vacio(), T0, 26);
    expect(r.conversaciones).toBe(2);
    expect(r.bloquesAdicionales).toBe(1);
  });

  it('es exactamente la respuesta 26 la que abre el bloque, no la 25 ni la 27', () => {
    const hasta25 = consultaConRespuestas(vacio(), T0, 25);
    const r26 = contadoresDelMensaje(hasta25.marcas, PERIODO, 'saliente', T0 + 26 * 60_000);
    expect(r26.bloqueNuevo).toBe(true);
    expect(r26.conversacion).toBe(true);
    expect(r26.atencion).toBe(false);

    const hasta26 = aplicar(hasta25, 'saliente', T0 + 26 * 60_000);
    const r27 = contadoresDelMensaje(hasta26.marcas, PERIODO, 'saliente', T0 + 27 * 60_000);
    expect(r27.bloqueNuevo).toBe(false);
    expect(r27.conversacion).toBe(false);
  });

  it('50 respuestas son dos conversaciones y 51 son tres', () => {
    expect(consultaConRespuestas(vacio(), T0, 50).conversaciones).toBe(2);
    expect(consultaConRespuestas(vacio(), T0, 51).conversaciones).toBe(3);
    expect(consultaConRespuestas(vacio(), T0, 75).conversaciones).toBe(3);
    expect(consultaConRespuestas(vacio(), T0, 76).conversaciones).toBe(4);
  });

  it('los mensajes del cliente no cuentan para el bloque: solo las respuestas', () => {
    let r = aplicar(vacio(), 'entrante', T0);
    for (let i = 1; i <= 60; i++) r = aplicar(r, 'entrante', T0 + i * 1000, `mensaje ${i}`);
    expect(r.conversaciones).toBe(1);
    expect(r.marcas.mensajesVentana).toBe(0);
  });
});

describe('La ventana de 24 horas manda sobre el bloque', () => {
  it('20 respuestas hoy y 2 mañana son DOS conversaciones, por dos ventanas', () => {
    const hoy = consultaConRespuestas(vacio(), T0, 20);
    expect(hoy.conversaciones).toBe(1);
    const manana = consultaConRespuestas(hoy, T0 + (HORAS_VENTANA_ATENCION + 1) * HORA, 2);
    expect(manana.conversaciones).toBe(2);
    // Y ninguna vino de exceder el bloque.
    expect(manana.bloquesAdicionales).toBe(0);
  });

  it('al abrir una ventana nueva el conteo del bloque vuelve a cero', () => {
    const hoy = consultaConRespuestas(vacio(), T0, 24);
    const manana = aplicar(hoy, 'entrante', T0 + 25 * HORA);
    expect(manana.marcas.mensajesVentana).toBe(0);
    // Las 24 de ayer no se suman a las de hoy: hacen falta 26 nuevas.
    const r = consultaConRespuestas(hoy, T0 + 25 * HORA, 25);
    expect(r.conversaciones).toBe(2);
    expect(r.bloquesAdicionales).toBe(0);
  });

  it('dentro de las 24 horas, con pausas largas, el bloque sigue contando', () => {
    // 15 respuestas a la mañana, 11 más a la noche del mismo día: 26 en la
    // misma ventana, dos conversaciones. La ventana es FIJA desde la primera
    // consulta, no deslizante.
    const manana = consultaConRespuestas(vacio(), T0, 15);
    const noche = consultaConRespuestas(manana, T0 + 9 * HORA, 11);
    expect(noche.conversaciones).toBe(2);
    expect(noche.bloquesAdicionales).toBe(1);
  });

  it('una respuesta sobre una ventana vencida no abre bloque ni conversación', () => {
    // 25 respuestas ayer; hoy sale un recordatorio sin que el cliente escriba.
    const ayer = consultaConRespuestas(vacio(), T0, 25);
    const recordatorio = contadoresDelMensaje(
      ayer.marcas, PERIODO, 'saliente', T0 + 30 * HORA, 'Le recordamos su cita',
    );
    expect(recordatorio.atencion).toBe(false);
    expect(recordatorio.bloqueNuevo).toBe(false);
    expect(recordatorio.conversacion).toBe(false);
    // El contador viejo se descarta: esta respuesta es la primera de nada.
    expect(recordatorio.mensajesVentana).toBe(1);
  });

  it('una cortesía tardía y su respuesta tampoco cobran nada', () => {
    const ayer = consultaConRespuestas(vacio(), T0, 25);
    const gracias = aplicar(ayer, 'entrante', T0 + 30 * HORA, 'gracias!');
    expect(gracias.conversaciones).toBe(1);
    const denada = aplicar(gracias, 'saliente', T0 + 30 * HORA + 1000);
    expect(denada.conversaciones).toBe(1);
    expect(denada.bloquesAdicionales).toBe(0);
  });
});

describe('Robustez de las marcas', () => {
  it('sin marcas, un saliente suelto no factura', () => {
    const c = contadoresDelMensaje({}, PERIODO, 'saliente', T0);
    expect(c.conversacion).toBe(false);
    expect(c.mensajesVentana).toBe(1);
  });

  it('un contador guardado corrupto se trata como cero', () => {
    const marcas: MarcasDeConteo = { atencionDesde: ts(T0), mensajesVentana: 'veinticinco' };
    const c = contadoresDelMensaje(marcas, PERIODO, 'saliente', T0 + HORA);
    expect(c.bloqueNuevo).toBe(false);
    expect(c.mensajesVentana).toBe(1);
  });

  it('un contador adelantado a mano sigue cerrando bloques en múltiplos de 25', () => {
    const marcas: MarcasDeConteo = { atencionDesde: ts(T0), mensajesVentana: 50 };
    const c = contadoresDelMensaje(marcas, PERIODO, 'saliente', T0 + HORA);
    expect(c.bloqueNuevo).toBe(true);
    expect(c.mensajesVentana).toBe(51);
  });

  it('el cambio de mes no reinicia el bloque: lo reinicia la ventana', () => {
    // La ventana es la misma aunque el período cambie a mitad de ella.
    const r = consultaConRespuestas(vacio(), T0, 25);
    const c = contadoresDelMensaje(r.marcas, '2026-11', 'saliente', T0 + 2 * HORA);
    expect(c.bloqueNuevo).toBe(true);
  });
});
