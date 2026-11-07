/**
 * LA BATERÍA DEL CONTRATO DEL ALMACÉN DE ALERTAS: la corren las dos implementaciones (memoria y Firestore real).
 * Probada negando: el tope no se pasa ni en paralelo, un fallo devuelve el cupo, un duplicado no lanza.
 */
import { describe, expect, it } from 'vitest';
import { HORA_MS, inmediatosDe, type AlmacenAlertas, type EventoGuardado } from '../../functions/src/plataforma/alertaOperativa.ts';

export const AHORA = Date.parse('2026-11-07T15:00:00Z');
export const DIA = '2026-11-07';

export const eventoGuardado = (id: string, extra: Partial<EventoGuardado> = {}): EventoGuardado => ({
  contrato: 'avisos-correo/v1', nivel: 'urgente', proyecto: 'novuchat', asunto: 'Envío incierto', que_paso: 'Falló un envío.',
  que_se_espera_de_andres: 'Revisar el flujo.', enlace: null, ocurrido_en: '2026-11-07T14:59:00Z', id_unico: id,
  tipo_error: 'envio_incierto', flujo: 'demo-a', nodo: 'Enviar', ocurrido_ms: AHORA - 60_000, recibido_ms: AHORA, dia: DIA,
  estado: 'en_resumen', saneado: false, resumido_en: null, ...extra,
});

export interface Fabrica {
  almacen: AlmacenAlertas;
  /** Lee de vuelta, sin pasar por la interfaz, lo que quedó guardado. */
  contadores(tipo: string, dia: string): Promise<{ enviados: number; ultimoMs: number | null }>;
}

/** `nuevo` devuelve un almacén VACÍO. */
export function bateriaDelAlmacen(nombre: string, nuevo: () => Promise<Fabrica>): void {
  describe(`almacén de alertas (${nombre})`, () => {
    it('reservas en paralelo: con tope 5 solo 4 salen aunque lleguen 9 a la vez', async () => {
      const { almacen, contadores } = await nuevo();
      const r = await Promise.all(Array.from({ length: 9 }, (_, i) => almacen.reservar(`tipo_${i}`, DIA, AHORA, 5)));
      expect(r.filter((x) => x.ok)).toHaveLength(inmediatosDe(5));
      expect((await contadores('tipo_0', DIA)).enviados).toBe(4);
    });

    it('dos del MISMO tipo en paralelo: solo una sale (1 por hora)', async () => {
      const { almacen } = await nuevo();
      const r = await Promise.all([almacen.reservar('mismo', DIA, AHORA, 8), almacen.reservar('mismo', DIA, AHORA, 8)]);
      expect(r.filter((x) => x.ok)).toHaveLength(1);
      // Pasada la hora, vuelve a salir.
      expect((await almacen.reservar('mismo', DIA, AHORA + HORA_MS + 1, 8)).ok).toBe(true);
    });

    it('liberar devuelve el contador del día y restaura la hora del tipo', async () => {
      const { almacen, contadores } = await nuevo();
      const r = await almacen.reservar('t', DIA, AHORA, 8);
      expect(r).toEqual({ ok: true, previoUltimoMs: null });
      expect(await contadores('t', DIA)).toEqual({ enviados: 1, ultimoMs: AHORA });
      await almacen.liberar('t', DIA, r.previoUltimoMs);
      const c = await contadores('t', DIA);
      expect(c.enviados).toBe(0);
      expect(c.ultimoMs ?? 0).toBe(0);
      expect((await almacen.reservar('t', DIA, AHORA + 1, 8)).ok).toBe(true); // no quedó bloqueado
      // Liberar de más nunca deja el contador negativo.
      await almacen.liberar('t', DIA, null); await almacen.liberar('t', DIA, null);
      expect((await contadores('t', DIA)).enviados).toBe(0);
    });

    it('crear dos veces el mismo id_unico: la segunda devuelve false SIN lanzar y no pisa el original', async () => {
      const { almacen } = await nuevo();
      expect(await almacen.crear(eventoGuardado('evt-dup-0001', { asunto: 'Original' }))).toBe(true);
      await expect(almacen.crear(eventoGuardado('evt-dup-0001', { asunto: 'Otro' }))).resolves.toBe(false);
      const v = await almacen.pendientesDeResumen();
      expect(v.filter((e) => e.id_unico === 'evt-dup-0001')).toHaveLength(1);
      expect(v.find((e) => e.id_unico === 'evt-dup-0001')!.asunto).toBe('Original');
    });

    it('poner cambia el estado; pendientesDeResumen ve solo lo no resumido y marcarResumidos lo saca', async () => {
      const { almacen } = await nuevo();
      await almacen.crear(eventoGuardado('evt-srv-0001', { recibido_ms: AHORA }));
      await almacen.crear(eventoGuardado('evt-srv-0002', { recibido_ms: AHORA - 3 * 86_400_000 }));
      await almacen.crear(eventoGuardado('evt-srv-0003', { recibido_ms: AHORA - 1000 }));
      await almacen.poner('evt-srv-0001', 'enviado');
      let v = await almacen.pendientesDeResumen();
      expect(v.map((e) => e.id_unico)).toEqual(['evt-srv-0001', 'evt-srv-0003', 'evt-srv-0002']); // más nuevos primero
      expect(v[0]!.estado).toBe('enviado');
      await almacen.marcarResumidos(['evt-srv-0001', 'evt-srv-0002'], AHORA);
      v = await almacen.pendientesDeResumen();
      expect(v.map((e) => e.id_unico)).toEqual(['evt-srv-0003']);
    });

    it('la lista del resumen del día se guarda y se lee; eventosPorId devuelve solo los que existen', async () => {
      const { almacen } = await nuevo();
      expect(await almacen.resumenDelDia(DIA)).toBeNull();
      await almacen.crear(eventoGuardado('evt-lis-0001'));
      await almacen.fijarResumenDelDia(DIA, ['evt-lis-0001', 'evt-no-existe'], AHORA);
      expect(await almacen.resumenDelDia(DIA)).toEqual({ ids: ['evt-lis-0001', 'evt-no-existe'], ahoraMs: AHORA });
      expect((await almacen.eventosPorId(['evt-lis-0001', 'evt-no-existe'])).map((e) => e.id_unico)).toEqual(['evt-lis-0001']);
      expect(await almacen.resumenDelDia('2026-11-08')).toBeNull();
    });

    it('pendientesDeResumen entrega los MÁS NUEVOS primero', async () => {
      const { almacen } = await nuevo();
      await almacen.crear(eventoGuardado('evt-ord-0001', { recibido_ms: AHORA - 5000 }));
      await almacen.crear(eventoGuardado('evt-ord-0002', { recibido_ms: AHORA - 1000 }));
      await almacen.crear(eventoGuardado('evt-ord-0003', { recibido_ms: AHORA - 3000 }));
      expect((await almacen.pendientesDeResumen()).map((e) => e.id_unico)).toEqual(['evt-ord-0002', 'evt-ord-0003', 'evt-ord-0001']);
    });

    it('reservar con tope por tipo y día: a lo más N, aunque pase la hora; liberar devuelve ese cupo', async () => {
      const { almacen } = await nuevo();
      expect((await almacen.reservar('bloq', DIA, AHORA, 8, 1)).ok).toBe(true);
      expect((await almacen.reservar('bloq', DIA, AHORA + 2 * HORA_MS, 8, 1)).ok).toBe(false);   // misma UTC, pasó la hora: sigue negado
      expect((await almacen.reservar('bloq', '2026-11-08', AHORA + 24 * HORA_MS, 8, 1)).ok).toBe(true); // otro día
      await almacen.liberar('bloq', DIA, null);
      expect((await almacen.reservar('bloq', DIA, AHORA + 3 * HORA_MS, 8, 1)).ok).toBe(true);
      // Sin el parámetro, el tipo no tiene tope diario propio (solo 1 por hora).
      expect((await almacen.reservar('normal', DIA, AHORA, 8)).ok).toBe(true);
      expect((await almacen.reservar('normal', DIA, AHORA + 2 * HORA_MS, 8)).ok).toBe(true);
    });

    it('sumarRepetido cuenta en el documento existente', async () => {
      const { almacen } = await nuevo();
      await almacen.crear(eventoGuardado('id-invalido-2026-11-07T15'));
      await almacen.sumarRepetido('id-invalido-2026-11-07T15');
      await almacen.sumarRepetido('id-invalido-2026-11-07T15');
      expect((await almacen.pendientesDeResumen())[0]!.repetidos).toBe(2);
    });

    it('fijar la lista de un día nuevo borra las de días anteriores', async () => {
      const { almacen } = await nuevo();
      await almacen.fijarResumenDelDia('2026-11-05', ['a'], AHORA);
      await almacen.fijarResumenDelDia('2026-11-06', ['b'], AHORA);
      await almacen.fijarResumenDelDia('2026-11-07', ['c'], AHORA);
      expect(await almacen.resumenDelDia('2026-11-05')).toBeNull();
      expect(await almacen.resumenDelDia('2026-11-06')).toBeNull();
      expect(await almacen.resumenDelDia('2026-11-07')).toEqual({ ids: ['c'], ahoraMs: AHORA });
    });

    it('la cuota de Resend: empieza vacía, se marca y se lee', async () => {
      const { almacen } = await nuevo();
      expect(await almacen.cuotaHasta()).toBeNull();
      await almacen.marcarCuota(AHORA + HORA_MS);
      expect(await almacen.cuotaHasta()).toBe(AHORA + HORA_MS);
    });

    it('el tope se valida DENTRO del almacén: un tope de 50 no deja pasar más de 7', async () => {
      const { almacen } = await nuevo();
      const r = await Promise.all(Array.from({ length: 12 }, (_, i) => almacen.reservar(`tt_${i}`, DIA, AHORA, 50)));
      expect(r.filter((x) => x.ok)).toHaveLength(7);
    });
  });
}
