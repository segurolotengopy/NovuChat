/**
 * LÍMITE CONOCIDO ACEPTADO: TEXTO LIBRE COMO CIUDAD (26/11/2026; `PROPIO.md`). La ciudad se guarda tal cual lo escrito en el paso que la pidió, salvo lo que dispara un detector existente.
 * Por eso cortesías, formas de pago sin detector, rótulos e intenciones sin detector PUEDEN quedar como ciudad. Lo que se FIJA aquí, negando, es que eso es inocuo:
 * el envío de Bolivia (lista de departamentos → ciudad → nombre y cédula) termina SIEMPRE en el RESUMEN con «Confirmar pedido» y «Corregir datos» mostrando esa ciudad,
 * ningún turno hasta ahí emite el QR, el QR sale solo al tocar «Confirmar pedido» (o «confirmo mi pedido» con el pedido completo) y «Corregir datos» borra la ciudad.
 * Con modelo sano (no devuelve nada de la entrega) y con modelo adverso (devuelve el texto como `ciudad` y como `aclaracion`).
 */
import { describe, expect, it } from 'vitest';
import { ANA, crear, hablar, mLista, mTexto, mToque, modeloSano, type Opciones } from './mundo';

const J = (x: unknown): string => JSON.stringify(x);
type Mund = ReturnType<typeof crear>;
type Turno = ReturnType<typeof hablar>;
type FichaT = { entrega: Record<string, string>; pide: string[] };
const ficha = (m: Mund): FichaT => (m.sd['casabermejo'] as Record<string, FichaT>)[ANA]!;
const hayQr = (t: Turno): boolean => t.mensajes.some((x) => x.tipo === 'image' && /qr/i.test(J(x.payload)));
const enviosQr = (t: Turno): number => t.llamadas.ingesta.filter((x) => x['evento'] === 'qr_enviado').length;
const botonesDe = (t: Turno): { id: string; title: string }[] => t.mensajes.flatMap((x) => (((x.payload['interactive'] as { action?: { buttons?: { reply: { id: string; title: string } }[] } } | undefined)?.action?.buttons) ?? []).map((bt) => bt.reply));
const cuerpos = (t: Turno): string => t.mensajes.map((x) => x.cuerpo).join(' ');

const TEXTOS = ['Vale', 'Buenísimo','Yape', 'Tigo Money', 'Contra entrega', 'Destino', 'Localidad', 'CP', 'Más tarde', 'Mejor no', 'Olvídalo', 'Anular'];

const sano = (): Opciones => ({ modeloDice: modeloSano((t) => (/Ana/.test(t) ? { nombre: 'Ana Pérez' } : {})) });
/** El adverso: devuelve el texto del cliente como ciudad y como aclaración (y el nombre cuando lo hay). */
const adverso = (): Opciones => ({ modeloDice: modeloSano((t) => (/Ana/.test(t) ? { nombre: 'Ana Pérez' } : { ciudad: t, aclaracion: t })) });

/** Corre el envío de Bolivia con `texto` como respuesta al paso de la ciudad; devuelve el mundo, los turnos y el resumen. */
function envioConCiudad(o: Opciones, texto: string): { m: Mund; turnos: Turno[]; resumen: Turno } {
  const m = crear(o);
  const turnos: Turno[] = [];
  turnos.push(hablar(m, ANA, mTexto('quiero una billetera')));
  turnos.push(hablar(m, ANA, mToque('entrega:envio', 'Envío')));
  turnos.push(hablar(m, ANA, mLista('dep:cb', 'Cochabamba')));
  turnos.push(hablar(m, ANA, mTexto(texto)));
  const resumen = hablar(m, ANA, mTexto('Ana Pérez 4412345'));
  turnos.push(resumen);
  return { m, turnos, resumen };
}

for (const [nombreModelo, opciones] of [['modelo sano', sano], ['modelo adverso (devuelve el texto como dato)', adverso]] as const) {
  describe(`texto libre como ciudad, ${nombreModelo}`, () => {
    for (const texto of TEXTOS) {
      it(`«${texto}»: llega al RESUMEN con «Confirmar pedido» y «Corregir datos» mostrando esa ciudad, sin QR en ningún turno; el QR sale solo al confirmar; «Corregir datos» la borra`, () => {
        const { m, turnos, resumen } = envioConCiudad(opciones(), texto);
        for (const t of turnos) { expect(hayQr(t), texto).toBe(false); expect(enviosQr(t), texto).toBe(0); }
        const ciudad = ficha(m).entrega['ciudad']!;
        expect(ciudad.toLowerCase(), texto).toBe(texto.toLowerCase());
        expect(botonesDe(resumen).map((b) => b.title), texto).toEqual(['Confirmar pedido', 'Corregir datos']);
        expect(cuerpos(resumen), texto).toContain(`Ciudad: ${ciudad}`);
        // «Corregir datos» borra esa ciudad (y sigue sin haber QR).
        const c = hablar(m, ANA, mToque('pedido:corregir', 'Corregir datos'));
        expect(ficha(m).entrega['ciudad'], texto).toBe('');
        expect(hayQr(c), texto).toBe(false);
      });
      it(`«${texto}»: el QR sale con el toque de «Confirmar pedido» (una sola vez)`, () => {
        const { m, resumen } = envioConCiudad(opciones(), texto);
        const id = botonesDe(resumen).find((b) => b.id.startsWith('pedido:confirmar:'))!.id;
        const q = hablar(m, ANA, mToque(id, 'Confirmar pedido'));
        expect(hayQr(q), texto).toBe(true);
        expect(enviosQr(q), texto).toBe(1);
      });
    }
    it('«confirmo mi pedido» con el pedido ya completo (ciudad rara incluida) también emite el QR; antes del resumen, nunca', () => {
      const m = crear(opciones());
      hablar(m, ANA, mTexto('quiero una billetera'));
      hablar(m, ANA, mToque('entrega:envio', 'Envío'));
      hablar(m, ANA, mLista('dep:cb', 'Cochabamba'));
      const antes = hablar(m, ANA, mTexto('confirmo mi pedido'));   // falta la ciudad: no hay pedido completo
      expect(hayQr(antes)).toBe(false);
      hablar(m, ANA, mTexto('Mejor no'));
      const medio = hablar(m, ANA, mTexto('confirmo mi pedido'));   // falta nombre y cédula
      expect(hayQr(medio)).toBe(false);
      hablar(m, ANA, mTexto('Ana Pérez 4412345'));
      expect(hayQr(hablar(m, ANA, mTexto('confirmo mi pedido')))).toBe(true);
    });
  });
}
