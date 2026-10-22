/**
 * «EL PUENTE» DE ANTONIO — (23/10/2026) PARTE 1: el botón de Antonio va SOLO al derivar. PARTE 2: cancelar el QR abierto por código.
 * Escribe NEGANDO, con las frases EXACTAS de la prueba real y el vigilante de UX (invariante 13) en cada turno. 0 mensajes agregados: un mensaje por turno, o ninguno.
 */
import { describe, expect, it } from 'vitest';
import type { J } from '../../lib/flujo';
import type { Mundo, ResultadoTurno } from '../../lib/n8n-de-mentira';
import { ANA, COMPROBANTE, COTEJO_VALIDO, crear, hablar, mAudio, mImagen, mTexto, panelConQr, panelOk, type Opciones } from './mundo';
import { PLANES_CON_BOTON, PLANES_SIN_BOTON, llevaBotonDeContacto, vigilarUx, violacionesDeUx } from './vigilante-ux';

const NODO = 'Cancelar cobro en el servidor';
const nuevo = (o: Opciones = {}): Mundo => { const w = crear(o); vigilarUx(w); return w; };
const conQr = (o: Opciones = {}): Mundo => { const w = nuevo({ panel: panelConQr(49), ...o }); hablar(w, ANA, mTexto('hola')); return w; };
const fichaDe = (w: Mundo, tel = ANA): J => ((w.sd['antonio'] ?? {}) as J)[tel] as J;
const conBoton = (t: ResultadoTurno): boolean => t.mensajes.length > 0 && llevaBotonDeContacto(t.mensajes[0]!);
const eventos = (t: ResultadoTurno): string[] => t.registro.map((r) => String(r.cuerpo?.['evento'] ?? '')).filter(Boolean);
const planDe = (t: ResultadoTurno): string => String(t.porNodo['Armar mensajes']?.[0]?.['plan'] ?? '');
const PROHIBIDO = /reembols|devuelt|devolvimos|devoluci|cerré el QR|cancelado el pago|acreditad|verificad|recibimos tu pago/i;

describe('PARTE 1. el botón de Antonio va SOLO al derivar', () => {
  it('con un QR abierto: «cuánto cuesta el libro» y «¿qué otras opciones tengo?», escritos o por voz, salen en texto plano, sin botón de Antonio ni de producto', () => {
    const casos: Array<[string, Opciones['medio'] | null]> = [
      ['¿cuánto cuesta el libro?', null], ['¿qué otras opciones tengo?', null],
      ['(audio)', { transcripcion: 'cuánto cuesta el libro' }], ['(audio)', { transcripcion: 'qué otras opciones tengo' }],
    ];
    for (const [x, medio] of casos) {
      const w = conQr(medio ? { medio } : {});
      const t = hablar(w, ANA, medio ? mAudio() : mTexto(x));
      expect(t.mensajes, x).toHaveLength(1);
      expect(t.mensajes[0]!.tipo, x).toBe('text');
      expect(conBoton(t), x).toBe(false);
      expect(t.avisos, x).toHaveLength(0);
    }
  });
  it('con un QR abierto: el recordatorio, «resultado» e «imágenes» también salen sin botón; el texto del recordatorio no menciona el botón', () => {
    const w = conQr();
    for (const x of ['¿cómo pago?', '¿me garantiza recuperar mi relación?', '¿tienes imágenes del libro?']) {
      const t = hablar(w, ANA, mTexto(x));
      expect(conBoton(t), x).toBe(false);
      expect(t.mensajes[0]!.cuerpo, x).not.toMatch(/con el botón/);
      w.avanzar(31);
    }
  });
  it('lo que DERIVA sí lleva el botón: factura, garantía, reclamo, fuera de país, repetición y «no supo» del modelo', () => {
    const w = nuevo();
    hablar(w, ANA, mTexto('hola'));
    for (const x of ['necesito factura', 'tengo un reclamo']) {
      const t = hablar(w, ANA, mTexto(x));
      expect(planDe(t), x).toBe('derivar');
      expect(conBoton(t), x).toBe(true);
      w.avanzar(31);
    }
    const v = nuevo({ modeloDice: 'DERIVAR' });
    hablar(v, ANA, mTexto('hola'));
    const t = hablar(v, ANA, mTexto('estamos distanciados desde hace meses'));
    expect(planDe(t)).toBe('derivar');
    expect(conBoton(t)).toBe(true);
    const r = nuevo();
    hablar(r, ANA, mTexto('hola'));
    hablar(r, ANA, mTexto('hola'));
    const rep = hablar(r, ANA, mTexto('hola'));
    expect(planDe(rep)).toBe('repetido');
    expect(conBoton(rep)).toBe(true);
  });
  it('NEGANDO el vigilante: un plan que resuelve con el botón, y un plan que deriva sin él, dan violación', () => {
    const cta: J = { type: 'interactive', interactive: { type: 'cta_url', action: {} } };
    const plano: J = { type: 'text', text: { body: 'x' } };
    const salida = (payload: J) => [{ tipo: 'interactive', cuerpo: 'Hola', payload }];
    for (const plan of ['precio', 'catalogo', 'imagenes', 'resultado', 'menu', 'qr_pendiente', 'saludo', 'bonos']) {
      expect(violacionesDeUx(new Set(), { type: 'text' }, salida(cta), undefined, '', { plan }).join('|'), plan).toMatch(/resuelve y no deriva/);
      expect(violacionesDeUx(new Set(), { type: 'text' }, salida(plano), undefined, '', { plan }).join('|'), plan).not.toMatch(/botón/);
    }
    for (const plan of ['derivar', 'repetido', 'fuera_pais', 'cobro_cerrado']) {
      expect(violacionesDeUx(new Set(), { type: 'text' }, salida(plano), undefined, '', { plan }).join('|'), plan).toMatch(/deriva a Antonio, pero salió sin su botón/);
      expect(violacionesDeUx(new Set(), { type: 'text' }, salida(cta), undefined, '', { plan }).join('|'), plan).not.toMatch(/botón/);
    }
    expect(PLANES_SIN_BOTON.filter((p) => PLANES_CON_BOTON.includes(p))).toEqual([]);
  });
});

describe('PARTE 2. cancelar el QR abierto por código', () => {
  it('con un QR abierto y SIN comprobante: «cancela ese qr», «no quiero comprar», «ya no lo quiero», «cancela mi pedido» reportan cobro_cancelado, liberan la guarda y responden UNA vez', () => {
    for (const x of ['cancela ese qr', 'no quiero comprar', 'ya no lo quiero', 'cancela mi pedido']) {
      const w = conQr();
      const t = hablar(w, ANA, mTexto(x));
      expect(t.ejecutados.has(NODO), x).toBe(true);
      const llamada = t.registro.find((r) => r.nodo === NODO)!;
      expect(llamada.cuerpo, x).toMatchObject({ direccion: 'entrante', evento: 'cobro_cancelado', telefono: ANA });
      expect(eventos(t).filter((e) => e === 'cobro_cancelado'), x).toHaveLength(1);
      expect(t.mensajes, x).toHaveLength(1);
      expect(planDe(t), x).toBe('cobro_cerrado');
      expect(t.mensajes[0]!.cuerpo, x).toMatch(/^Listo, cerré tu pedido\.\n\nNo pagues con ese QR: si ya lo hiciste, envíame el comprobante o escríbele a Antonio con el botón; el pago lo revisa él\.$/);
      expect(t.mensajes[0]!.cuerpo, x).not.toMatch(PROHIBIDO);
      expect(conBoton(t), x).toBe(true);
      expect(t.avisos, x).toHaveLength(1);
      expect(t.avisos[0]!.cuerpo, x).toMatch(/cerró su pedido; si pagó, revisar/);
      expect(t.ejecutados.has('Conversar con el modelo'), x).toBe(false);
      expect(fichaDe(w)['qrHastaMs'], x).toBe(0);
    }
  });
  it('NEGANDO: con un cobro de REGLA 1, o con la guarda local sola (el servidor no ve cobro abierto), no se llama al servidor ni se dice que se cerró', () => {
    const regla1 = nuevo({ panel: panelOk({ cobro: { activo: true, qr: { url: 'https://qr.example.com/q.png' }, pendiente: true, monto: 49, pedido: 'AN1', regla: 1 } }) });
    hablar(regla1, ANA, mTexto('hola'));
    const a = hablar(regla1, ANA, mTexto('cancela ese qr'));
    expect(a.ejecutados.has(NODO)).toBe(false);
    expect(eventos(a)).not.toContain('cobro_cancelado');
    expect(a.mensajes[0]!.cuerpo).not.toMatch(/cerré tu pedido/);
    const w = nuevo();
    hablar(w, ANA, mTexto('quiero el pack')); // el QR sale y deja la guarda local; el servidor (doble) sigue sin cobro pendiente
    expect(Number(fichaDe(w)['qrHastaMs'])).toBeGreaterThan(0);
    const b = hablar(w, ANA, mTexto('cancela ese qr'));
    expect(b.ejecutados.has(NODO)).toBe(false);
    expect(eventos(b)).not.toContain('cobro_cancelado');
    expect(b.mensajes[0]!.cuerpo).not.toMatch(/cerré tu pedido/);
    expect(conBoton(b)).toBe(true);
  });
  it('«cancela ese qr» por AUDIO llama al servidor exactamente una vez', () => {
    const w = conQr({ medio: { transcripcion: 'cancela ese qr' } });
    const t = hablar(w, ANA, mAudio());
    expect(t.registro.filter((r) => r.nodo === NODO)).toHaveLength(1);
    expect(eventos(t).filter((e) => e === 'cobro_cancelado')).toHaveLength(1);
    expect(planDe(t)).toBe('cobro_cerrado');
    expect(t.mensajes[0]!.cuerpo).toMatch(/^Listo, cerré tu pedido\./);
  });
  it('el aviso a Antonio respeta el límite de 30 minutos por motivo', () => {
    const w = conQr();
    expect(hablar(w, ANA, mTexto('cancela ese qr')).avisos).toHaveLength(1);
    const t = hablar(w, ANA, mTexto('cancela mi pedido'));
    expect(t.avisos).toHaveLength(0);
  });
  it('si el servidor NIEGA (409, 500) o no responde, cae a la escalada: NO dice que se cerró', () => {
    for (const cancelar of ['cae', { statusCode: 409, body: { estado: 'suspendido' } }, { statusCode: 500, body: {} }, { statusCode: 200, body: { servicio: { estado: 'cortado' } } }] as const) {
      const w = conQr({ cancelar });
      const t = hablar(w, ANA, mTexto('cancela ese qr'));
      expect(t.ejecutados.has(NODO)).toBe(true);
      expect(planDe(t)).toBe('derivar');
      expect(t.mensajes[0]!.cuerpo).toMatch(/no puedo cancelar un pedido/);
      expect(t.mensajes[0]!.cuerpo).not.toMatch(/cerré tu pedido/);
      expect(t.avisos).toHaveLength(1);
      expect(t.avisos[0]!.cuerpo).not.toMatch(/cerró su pedido/);
      expect(conBoton(t)).toBe(true);
    }
  });
  it('con un comprobante previo NO cancela: reporta anulacion_avisada (solo avisa) y escala como siempre', () => {
    const w = nuevo({ panel: panelConQr(49), medio: { clasificacion: COMPROBANTE }, cotejo: COTEJO_VALIDO });
    hablar(w, ANA, mImagen());
    w.dobles['Traer configuración'] = () => panelOk();
    w.avanzar(31);
    const t = hablar(w, ANA, mTexto('cancela mi pedido'));
    expect(t.ejecutados.has(NODO)).toBe(false);
    expect(eventos(t)).not.toContain('cobro_cancelado');
    expect(eventos(t)).toContain('anulacion_avisada');
    expect(t.mensajes[0]!.cuerpo).toMatch(/no puedo cancelar un pedido/);
    expect(t.mensajes[0]!.cuerpo).not.toMatch(/cerré tu pedido/);
    expect(conBoton(t)).toBe(true);
  });
  it('con el cobro en revisión (el servidor lo dice) tampoco cancela', () => {
    const w = nuevo({ panel: panelOk({ cobro: { activo: true, qr: { url: 'https://qr.example.com/q.png' }, pendiente: false, enRevision: true, regla: 2 } }) });
    hablar(w, ANA, mTexto('hola'));
    const t = hablar(w, ANA, mTexto('cancela mi pedido'));
    expect(t.ejecutados.has(NODO)).toBe(false);
    expect(eventos(t)).not.toContain('cobro_cancelado');
  });
  it('sin QR abierto ni pedido no hay evento ni llamada: «cancela mi pedido» sigue su camino', () => {
    const w = nuevo();
    hablar(w, ANA, mTexto('hola'));
    const t = hablar(w, ANA, mTexto('cancela mi pedido'));
    expect(t.ejecutados.has(NODO)).toBe(false);
    expect(eventos(t)).not.toContain('cobro_cancelado');
    expect(t.mensajes[0]!.cuerpo).not.toMatch(/cerré tu pedido/);
  });
  it('la segunda cancelación seguida recibe «ya cerrado»: sin llamada, sin evento, sin aviso nuevo', () => {
    const w = conQr();
    hablar(w, ANA, mTexto('cancela ese qr'));
    w.dobles['Traer configuración'] = () => panelOk(); // el servidor ya cerró el cobro: no hay QR abierto
    for (const x of ['cancela mi pedido', 'ya no lo quiero']) {
      const t = hablar(w, ANA, mTexto(x));
      expect(t.ejecutados.has(NODO), x).toBe(false);
      expect(eventos(t), x).not.toContain('cobro_cancelado');
      expect(t.avisos, x).toHaveLength(0);
      expect(t.mensajes[0]!.cuerpo, x).not.toMatch(/cerré tu pedido/);
      expect(conBoton(t), x).toBe(true);
    }
    const u = hablar(conQr(), ANA, mTexto('cancela ese qr'));
    expect(u.mensajes[0]!.cuerpo).toMatch(/cerré tu pedido/);
  });
  it('«otras opciones», preguntas y pagos NUNCA llaman al servidor ni reportan cobro_cancelado (en ningún otro turno)', () => {
    for (const x of ['quiero ver otras opciones', 'no quiero comprar, quiero ver otras opciones', 'qué otras opciones tengo?', '¿cuánto cuesta el libro?', 'ya pagué', 'cancelé', 'ya cancelé el libro', 'solo quiero saber qué incluye', 'hola', '¿cómo pago?']) {
      const w = conQr();
      const t = hablar(w, ANA, mTexto(x));
      expect(t.ejecutados.has(NODO), x).toBe(false);
      expect(eventos(t), x).not.toContain('cobro_cancelado');
    }
    // Y a lo largo de una conversación entera, el evento sale una sola vez.
    const w = conQr();
    let n = 0;
    const abierto = w.dobles['Traer configuración'];
    for (const x of ['¿cuánto cuesta el libro?', 'cancela ese qr', 'hola', 'cancela mi pedido', '¿qué vendes?']) {
      n += eventos(hablar(w, ANA, mTexto(x))).filter((e) => e === 'cobro_cancelado').length;
      w.dobles['Traer configuración'] = n > 0 ? () => panelOk() : abierto!; // tras el cierre, el servidor ya no ve un cobro abierto
      w.avanzar(1);
    }
    expect(n).toBe(1);
  });
  it('si el mensaje no salió (Meta lo rechaza), la guarda local vuelve a su valor y la firma no queda en «cobro_cerrado»', () => {
    const w = conQr();
    const antes = fichaDe(w)['qrHastaMs'];
    const falla = () => ({ error: { message: '(#131053) Media upload error', code: 131053 } });
    w.dobles['Enviar a WhatsApp'] = falla;
    w.dobles['Enviar respaldo'] = falla;
    const t = hablar(w, ANA, mTexto('cancela ese qr'), { toleraFallo: true });
    expect(t.fallo).not.toBeNull();
    expect(fichaDe(w)['qrHastaMs']).toBe(antes);
    expect(fichaDe(w)['ultimaFirma']).not.toBe('cobro_cerrado');
  });
});
