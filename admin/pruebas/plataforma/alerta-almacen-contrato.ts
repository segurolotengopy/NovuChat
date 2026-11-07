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
  estado: 'en_resumen', saneado: false, ...extra,
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
      const v = await almacen.desde(AHORA - HORA_MS);
      expect(v.filter((e) => e.id_unico === 'evt-dup-0001')).toHaveLength(1);
      expect(v.find((e) => e.id_unico === 'evt-dup-0001')!.asunto).toBe('Original');
    });

    it('poner cambia el estado; desde() filtra por la hora del SERVIDOR (recibido_ms), no por ocurrido_en', async () => {
      const { almacen } = await nuevo();
      await almacen.crear(eventoGuardado('evt-srv-0001', { ocurrido_ms: AHORA - 20 * 86_400_000, recibido_ms: AHORA }));
      await almacen.crear(eventoGuardado('evt-srv-0002', { ocurrido_ms: AHORA, recibido_ms: AHORA - 3 * 86_400_000 }));
      await almacen.poner('evt-srv-0001', 'enviado');
      const v = await almacen.desde(AHORA - 86_400_000);
      expect(v.map((e) => e.id_unico)).toEqual(['evt-srv-0001']);
      expect(v[0]!.estado).toBe('enviado');
    });

    it('la marca del resumen empieza vacía y se fija', async () => {
      const { almacen } = await nuevo();
      expect(await almacen.marcaResumen()).toBeNull();
      await almacen.fijarMarcaResumen(AHORA);
      expect(await almacen.marcaResumen()).toBe(AHORA);
    });
  });
}
