/**
 * HORARIO PROPIO DE UN FUNCIONARIO CON TEXTO ILEGIBLE — el servidor falla cerrado.
 *
 * EL HALLAZGO (seguridad, MEDIUM preexistente). La regla de Firestore solo exige
 * que `funcionarios/{id}.horarioTrabajo` sea un mapa. Un día con texto ilegible
 * («x») pasaba sin cambios por `horariosSaneados`; en el flujo `tramosDelDia`
 * devuelve null y `fueraDeHorario` devuelve '' («no se puede juzgar»), así que se
 * podía agendar fuera de horario (no genera doble reserva: es un hueco del horario).
 *
 * LA REMEDIACIÓN. `resolverFuncionarios` convierte en `cerrado` todo día no vacío
 * que no sea legible, SOLO para lo que va a los flujos. `horarioAtencion` (el texto
 * para el cliente) no cambia. Cada prueba arma un dato malo y exige que NO pase.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ejecutar } from '../lib/flujo.ts';
import { horarioAtencion, resolverFuncionarios } from '../../functions/src/core/prompt/prompt.ts';
import { horariosSaneados } from '../../functions/src/core/prompt/horario-tramos.ts';

const NEGOCIO = { nombreNegocio: 'N', calendarioId: 'cal@x', horarios: { lun: '09:00-19:00' } };
const horarioDe = (horarioTrabajo: unknown): Record<string, unknown> => {
  const [f] = resolverFuncionarios([{ id: 'f1', datos: { activo: true, nombre: 'Ana', horarioTrabajo } }], NEGOCIO, new Set());
  return (f as { horarioTrabajo: Record<string, unknown> }).horarioTrabajo;
};

describe('resolverFuncionarios: el horario que llega a los flujos falla cerrado', () => {
  it.each([
    ['x'], ['9 a 5'], ['cerrado '], ['09:00-'], ['25:00-26:00'], ['18:00-09:00'], ['09:00-09:00'],
    ['solo con cita previa'], ['09:00-12:00 y 14:00-18:00'],
  ])('el día %j llega como cerrado', (texto) => {
    expect(horarioDe({ lun: texto }).lun).toBe('cerrado');
  });

  it.each([[7], [true], [{ a: 1 }], [['09:00-18:00']]])('un valor que no es texto (%j) llega como cerrado', (v) => {
    expect(horarioDe({ lun: v }).lun).toBe('cerrado');
  });

  it('un día vacío o ausente NO se inventa: sigue sin dato', () => {
    const h = horarioDe({ lun: '', mar: null });
    expect(h.lun).toBe('');
    expect('mar' in h).toBe(false);
    expect('mie' in h).toBe(false);
  });

  it('__proto__ y claves que no son días no llegan a los flujos', () => {
    const h = horarioDe(JSON.parse('{"__proto__": "x", "lun": "x", "feriado": "09:00-10:00"}'));
    expect(Object.getPrototypeOf(h)).toBe(Object.prototype);
    expect(Object.keys(h)).toEqual(['lun']);
    expect(Object.keys(horariosSaneados(JSON.parse('{"__proto__": "x", "mar": "x"}')))).toEqual(['mar']);
  });

  it('lo legible se conserva: rango, turno partido, y las formas flexibles que el flujo ya entendía', () => {
    expect(horarioDe({ lun: '09:00-18:00', mar: '09:00-12:00,14:00-18:00', mie: 'cerrado' })).toEqual({
      lun: '09:00-18:00', mar: '09:00-12:00,14:00-18:00', mie: 'cerrado' });
    expect(horarioDe({ lun: '9:00 - 17:00', mar: '09:00 a 12:00; 14:00-18:00' })).toEqual({
      lun: '09:00-17:00', mar: '09:00-12:00,14:00-18:00' });
  });

  it('un día con un tramo bueno y otro ilegible conserva el bueno (como lo lee el candado)', () => {
    expect(horarioDe({ lun: '09:00-12:00,xx' }).lun).toBe('09:00-12:00');
  });

  it('el funcionario por defecto (el comercio) también falla cerrado', () => {
    const [u] = resolverFuncionarios([], { ...NEGOCIO, horarios: { lun: 'x', mar: '10:00-11:00' } }, new Set());
    expect(u?.horarioTrabajo).toEqual({ lun: 'cerrado', mar: '10:00-11:00' });
  });

  it('horarioAtencion NO cambia: «solo con cita previa» sigue siendo texto legítimo', () => {
    expect(horarioAtencion({ lun: 'solo con cita previa' })).toContain('solo con cita previa');
    expect(horarioAtencion({ lun: 'x', mar: '09:00-18:00' })).toContain('x');
  });
});

describe('el nodo real «Comprobar reserva» con ese dato: ya NO agenda fuera de horario', () => {
  const flujo = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)),
    '../../../Flujos/demo-a-agendamiento.json'), 'utf8')) as { nodes: { name: string; parameters: { jsCode?: string } }[] };
  const codigo = String(flujo.nodes.find((n) => n.name === 'Comprobar reserva')?.parameters.jsCode);
  const CAL = 'aaaa000000aaaa@group.calendar.google.com';
  const AHORA = new Date('2026-09-06T20:16:05.000Z');
  class Reloj extends Date {
    constructor(...a: unknown[]) {
      // @ts-expect-error se reenvían los argumentos tal cual
      if (a.length) { super(...a); } else { super(AHORA.getTime()); }
    }
    static override now() { return AHORA.getTime(); }
  }
  const previa = { respuesta: 'Cita confirmada.', from: '591700', transferir: false, pasosDelAgente: true,
    agendarPasosSinId: 0, eventosCreados: [{ id: 'nueva' }], agendarEjecutado: true };
  // Una cita un lunes a las 22:00 (fuera de cualquier horario razonable), sola en la agenda.
  const cita = { id: 'nueva', summary: 'Cita Silvana — consulta', organizer: { email: CAL },
    start: { dateTime: '2026-09-21T22:00:00-04:00' }, end: { dateTime: '2026-09-21T23:00:00-04:00' },
    created: '2026-09-06T20:16:00.000Z' };
  const nodo = (funcionarios: string) => ejecutar(codigo, [cita], {
    'Config del negocio': { mensajeReservaNoConfirmada: '', funcionarios },
    'Procesar respuesta': previa,
  }, { Date: Reloj })[0] ?? {};
  const correrCon = (horarioTrabajo: unknown) => {
    const [f] = resolverFuncionarios([{ id: 'f1', datos: { activo: true, nombre: 'Dr. Sandoval', calendarioId: CAL, horarioTrabajo } }],
      NEGOCIO, new Set());
    return nodo(JSON.stringify([{ nombre: 'Dr. Sandoval', servicios: [], calendario: CAL, horario: f?.horarioTrabajo }]));
  };

  it('CONTROL: con el dato ilegible tal cual (sin la remediación) la cita pasaba', () => {
    const r = nodo(JSON.stringify([{ nombre: 'Dr. Sandoval', servicios: [], calendario: CAL, horario: { lun: 'x' } }]));
    expect(r['citaSolapada']).toBeUndefined();
  });

  it.each([['x'], ['9 a 5'], ['09:00-'], ['25:00-26:00']])('con el día %j la cita se deshace por horario', (texto) => {
    const r = correrCon({ lun: texto });
    expect(r['citaSolapada']).toBe(true);
    expect(r['eventoABorrar']).toBe('nueva');
    expect(r['causaDeLaCaida']).toBe('horario');
  });

  it('un horario bueno que contiene la cita NO se toca', () => {
    const r = correrCon({ lun: '09:00-23:30' });
    expect(r['citaSolapada']).toBeUndefined();
  });
});
