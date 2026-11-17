/**
 * BAJA POR TEXTO en el esqueleto de Casa Bermejo («no me escribas más», «dame de baja», «stop»): UN solo texto fijo de confirmación y nada más.
 * Sin modelo, sin botones, sin menú, sin recordatorio de pago ni QR, sin aviso al negocio. Costo: 0 mensajes agregados (reemplaza la respuesta que el turno ya enviaba). Se prueba NEGANDO.
 * La pieza común es `Flujos/src/core/conversacion/baja.js`; el reconocimiento tiene su propia prueba en `admin/pruebas/core/ux-baja.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { ANA, crear, hablar, mTexto, panelConQr } from './mundo';

const TUTEO = 'Entendido, tomé nota de que no quieres recibir más mensajes. Si más adelante necesitas algo, escríbeme cuando quieras.';
const USTED = 'Entendido, tomé nota de que no quiere recibir más mensajes. Si más adelante necesita algo, puede escribirme cuando quiera.';
const corridos = (t: ReturnType<typeof hablar>): string[] => t.registro.map((r) => r.nodo);
/** El `evento` que «Reportar mensaje (entrante)» mandó al servidor en el turno (`no_contactar` apaga seguimientos y rescates). */
const eventoDelEntrante = (t: ReturnType<typeof hablar>): unknown => t.registro.find((r) => r.nodo === 'Reportar mensaje (entrante)')?.cuerpo?.['evento'];

const AUDIO = { type: 'audio', audio: { id: 'media-aud', mime_type: 'audio/ogg; codecs=opus', voice: true } };
/** El `evento` que «Reportar mensaje (saliente)» mandó al servidor en el turno (una baja por nota de voz se registra ahí). */
const eventoDelSaliente = (t: ReturnType<typeof hablar>): unknown => t.registro.find((r) => r.nodo === 'Reportar mensaje (saliente)')?.cuerpo?.['evento'];

function soloLaConfirmacion(t: ReturnType<typeof hablar>, texto: string): void {
  expect(t.mensajes).toHaveLength(1); // mensajes del turno = 1 (0 agregados: reemplaza la respuesta de siempre)
  expect(t.mensajes[0]?.payload['type']).toBe('text');
  expect(t.mensajes[0]?.payload['interactive']).toBeUndefined();
  expect(t.mensajes[0]?.cuerpo).toBe(texto);
  expect(t.avisos).toHaveLength(0);
  expect(corridos(t)).not.toContain('Conversar con el modelo');
  expect(corridos(t)).not.toContain('Enviar aviso');
  // Solo se confirma lo que el servidor registró: la confirmación y el `no_contactar` van juntos.
  expect(eventoDelEntrante(t)).toBe('no_contactar');
}

describe('la baja: un solo texto y nada más', () => {
  for (const frase of ['no me escribas más', 'dame de baja', 'stop', 'Para de escribirme, por favor']) {
    it(`«${frase}»: 1 mensaje de texto, el de confirmación, sin botones, sin modelo y sin aviso`, () => {
      const t = hablar(crear(), ANA, mTexto(frase));
      soloLaConfirmacion(t, TUTEO);
    });
  }
  it('con un QR abierto: ni recordatorio de pago ni QR, ni cotejo, ni aviso', () => {
    const t = hablar(crear({ panel: panelConQr(450) }), ANA, mTexto('no me escribas más'));
    soloLaConfirmacion(t, TUTEO);
    expect(JSON.stringify(t.mensajes)).not.toMatch(/QR|pagar|comprobante/);
    expect(corridos(t)).not.toContain('Cotejar en el servidor');
  });
  // BAJA POR NOTA DE VOZ (decisión de Andres, 16/11/2026): se decide sobre la TRANSCRIPCIÓN. El entrante de un audio va sin texto y no marca nada: el registro viaja en el reporte del mensaje SALIENTE de la confirmación.
  for (const dicho of ['no me escribas más', 'dame de baja', 'stop']) {
    it(`una nota de voz que dice «${dicho}»: la confirmación fija, sin modelo ni aviso, y el reporte SALIENTE lleva no_contactar`, () => {
      const t = hablar(crear({ medio: { transcripcion: dicho } }), ANA, AUDIO);
      expect(t.mensajes).toHaveLength(1);
      expect(t.mensajes[0]?.payload['type']).toBe('text');
      expect(t.mensajes[0]?.payload['interactive']).toBeUndefined();
      expect(t.mensajes[0]?.cuerpo).toBe(TUTEO);
      expect(t.avisos).toHaveLength(0);
      expect(corridos(t)).not.toContain('Conversar con el modelo');
      expect(corridos(t)).not.toContain('Enviar aviso');
      expect(eventoDelEntrante(t)).toBeUndefined(); // el entrante de un audio no marca nada
      expect(eventoDelSaliente(t)).toBe('no_contactar'); // confirmar y registrar van juntos
    });
  }
  it('con tratamiento «usted», la nota de voz de baja recibe la variante de usted y también se registra', () => {
    const t = hablar(crear({ base: { tratamiento: 'usted' }, medio: { transcripcion: 'dame de baja' } }), ANA, AUDIO);
    expect(t.mensajes.map((e) => e.cuerpo)).toEqual([USTED]);
    expect(eventoDelSaliente(t)).toBe('no_contactar');
  });
  it('NEGADO: la baja escrita no cambia (el entrante marca; el saliente no repite el evento)', () => {
    const t = hablar(crear(), ANA, mTexto('no me escribas más'));
    expect(eventoDelEntrante(t)).toBe('no_contactar');
    expect(eventoDelSaliente(t)).toBeUndefined();
  });
  it('con tratamiento «usted» sale la variante de usted', () => {
    const t = hablar(crear({ base: { tratamiento: 'usted' } }), ANA, mTexto('dame de baja'));
    soloLaConfirmacion(t, USTED);
  });
  it('NEGADO: la baja no borra lo ya anotado: al volver a escribir se atiende como siempre (el modelo conversa)', () => {
    const m = crear();
    soloLaConfirmacion(hablar(m, ANA, mTexto('stop')), TUTEO);
    const t = hablar(m, ANA, mTexto('hola, quiero una billetera'));
    expect(corridos(t)).toContain('Conversar con el modelo');
    expect(t.mensajes[0]?.cuerpo).not.toBe(TUTEO);
  });
});

describe('contraprueba: lo que NO es baja sigue el camino normal', () => {
  it('NIEGA: un toque de lista cuyo título pide la baja NO se confirma (el reporte entrante mira el texto escrito, que ahí va vacío)', () => {
    const t = hablar(crear(), ANA, { type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'fila-1', title: 'Dame de baja' } } });
    expect(eventoDelEntrante(t)).toBeUndefined();
    expect(t.mensajes.map((e) => e.cuerpo)).not.toContain(TUTEO);
  });
  for (const frase of ['no me escribas el precio, mándame el QR', 'el doctor dijo que no me escriban', 'no me escribiste el precio']) {
    it(`«${frase}» llega al modelo y no sale la confirmación`, () => {
      const t = hablar(crear(), ANA, mTexto(frase));
      expect(corridos(t)).toContain('Conversar con el modelo');
      expect(t.mensajes.map((e) => e.cuerpo)).not.toContain(TUTEO);
    });
  }
  for (const dicho of ['mándame el QR', 'no me escribió el precio', 'no me escribas el precio, mándame el QR']) {
    it(`NIEGA: una nota de voz que dice «${dicho}» no se confirma como baja ni registra no_contactar`, () => {
      const t = hablar(crear({ medio: { transcripcion: dicho } }), ANA, AUDIO);
      expect(t.mensajes.map((e) => e.cuerpo)).not.toContain(TUTEO);
      expect(eventoDelSaliente(t)).not.toBe('no_contactar');
    });
  }
  it('NIEGA: un audio ininteligible (sin transcripción) o vacío sigue su camino de siempre: ni baja ni no_contactar', () => {
    for (const transcripcion of [null, '']) {
      const t = hablar(crear({ medio: { transcripcion } }), ANA, AUDIO);
      expect(t.mensajes.map((e) => e.cuerpo)).not.toContain(TUTEO);
      expect(eventoDelSaliente(t)).not.toBe('no_contactar');
    }
  });
  describe('tope de la transcripción (segunda pasada, 16/11/2026): hasta 160 caracteres', () => {
    const RELLENO = ' Estoy en la oficina con mucho trabajo, hablando con varios proveedores y revisando facturas, entonces después te escribo con calma sobre todo lo demás que necesito.';
    it('SÍ: una frase corta («mándame el QR y no me llames que estoy en reunión») es baja', () => {
      const t = hablar(crear({ medio: { transcripcion: 'mándame el QR y no me llames que estoy en reunión' } }), ANA, AUDIO);
      expect(t.mensajes.map((e) => e.cuerpo)).toContain(TUTEO);
      expect(eventoDelSaliente(t)).toBe('no_contactar');
    });
    for (const base of ['mándame el QR y no me llames que estoy en reunión.', 'ya pagué, no me contacten por teléfono.']) {
      it(`NO: «${base}» de más de 160 caracteres sigue el camino normal`, () => {
        const dicho = base + RELLENO;
        expect(dicho.length).toBeGreaterThan(160);
        const t = hablar(crear({ medio: { transcripcion: dicho } }), ANA, AUDIO);
        expect(t.mensajes.map((e) => e.cuerpo)).not.toContain(TUTEO);
        expect(eventoDelSaliente(t)).not.toBe('no_contactar');
      });
    }
  });
});
