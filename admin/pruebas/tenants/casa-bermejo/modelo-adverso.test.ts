/**
 * COMPRA COMPLETA CON EL MODELO ADVERSO (reclamo de Andres, 24/11/2026: «recojo en tienda» terminaba en «una persona del equipo se encargará» y no se guardaba el modo).
 * El modelo simulado hace lo peor que ha hecho: pone quiereHablar en true, devuelve lineas: [] sin que nadie vacíe el pedido, `entrega: {}` y redacta «una persona del equipo se encargará».
 * REDISEÑO DEL 25/11/2026 (4.ª revisión independiente): el MODO lo fija el código con un botón o una frase inequívoca; el NOMBRE solo lo captura el código si lo devuelve el modelo (`entrega.nombre`) Y el asistente lo pidió;
 * el CI, la ciudad y la flota los lee el código aunque el modelo no los devuelva. Con el modelo adverso el nombre NO se captura (se vuelve a pedir) y nunca sale «Confirmar pedido» sin él. Se prueba NEGANDO.
 * El detalle de la tabla de sondeo está en `entrega-por-estado.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { ANA, BILLETERA, completarEnvio, crear, hablar, mLista, modelo, modeloAdverso, modeloDeNombre, modeloSano, mTexto, mToque } from './mundo';

const J = (x: unknown): string => JSON.stringify(x);
type Ficha = { carrito: { id: string }[]; entrega: { modo: string; nombre: string; ciudad?: string; flota?: string; documento?: string } };
const ficha = (m: ReturnType<typeof crear>): Ficha => (m.sd['casabermejo'] as Record<string, Ficha>)[ANA]!;
const hayQr = (t: ReturnType<typeof hablar>): boolean => t.mensajes.some((x) => x.tipo === 'image' && /qr/i.test(J(x.payload)));
const ids = (t: ReturnType<typeof hablar>): string[] => t.mensajes.flatMap((x) => J(x.payload).match(/"id":"[^"]+"/g) ?? []);
const cuerpos = (t: ReturnType<typeof hablar>): string => t.mensajes.map((x) => x.cuerpo).join(' ');
const PERSONA = /persona del equipo|se encargar/i;
const CONFIRMA = /pedido:confirmar:/;

describe('recojo en tienda con el modelo adverso', () => {
  it('el modo escrito («recojo en tienda») lo guarda el CÓDIGO, no deriva, el carrito sobrevive al `lineas: []` y el texto lo arma el código (nunca «una persona del equipo»); pide el nombre', () => {
    const m = crear({ modeloDice: modeloAdverso() });
    hablar(m, ANA, mTexto('quiero una billetera'));
    expect(ficha(m).carrito.map((l) => l.id)).toEqual(['billetera-cuero']);
    const t1 = hablar(m, ANA, mTexto('recojo en tienda'));
    expect(ficha(m).entrega.modo).toMatch(/retiro|recojo/i);
    expect(ficha(m).carrito).toHaveLength(1);
    expect(cuerpos(t1)).not.toMatch(PERSONA);
    expect(cuerpos(t1)).toMatch(/nombre/i);
    expect(t1.avisos).toHaveLength(0);
  });
  it('el nombre lo devuelve el MODELO: con el modelo adverso («Silvana») NO se captura y deriva; con el modelo sano se captura y sale «Confirmar pedido» con el resumen', () => {
    const m = crear({ modeloDice: modeloAdverso() });
    hablar(m, ANA, mTexto('quiero una billetera'));
    hablar(m, ANA, mTexto('recojo en tienda'));
    const t2 = hablar(m, ANA, mTexto('Silvana'));
    expect(t2.avisos.length).toBeGreaterThanOrEqual(1);
    expect(ficha(m).entrega.nombre).toBe('');
    expect(ids(t2).join(' ')).not.toMatch(CONFIRMA);
    const b = crear({ modeloDice: modeloDeNombre() });
    hablar(b, ANA, mTexto('quiero una billetera'));
    hablar(b, ANA, mTexto('recojo en tienda'));
    const t3 = hablar(b, ANA, mTexto('Silvana'));
    expect(t3.avisos).toHaveLength(0);
    expect(cuerpos(t3)).toMatch(/Billetera de cuero/);
    expect(ids(t3).join(' ')).toMatch(CONFIRMA);
  });
  it('tocar «Confirmar pedido» emite el QR en el mismo turno', () => {
    const m = crear({ modeloDice: modeloDeNombre() });
    hablar(m, ANA, mTexto('quiero una billetera'));
    hablar(m, ANA, mTexto('recojo en tienda'));
    const t2 = hablar(m, ANA, mTexto('Ana Pérez'));
    const id = /"id":"(pedido:confirmar:[a-z0-9]+)"/.exec(J(t2.mensajes.map((x) => x.payload)))?.[1] ?? 'sin-boton';
    expect(hayQr(hablar(m, ANA, mToque(id, 'Confirmar pedido')))).toBe(true);
  });
  it('con el botón de entrega y el modelo adverso: el modo se guarda sin derivar y el nombre se vuelve a pedir; nunca «Confirmar pedido» sin nombre', () => {
    const m = crear({ modeloDice: modeloAdverso() });
    hablar(m, ANA, mTexto('quiero una billetera'));
    const t1 = hablar(m, ANA, mToque('entrega:retiro', 'Recojo en tienda'));
    expect(cuerpos(t1)).not.toMatch(PERSONA);
    expect(t1.avisos).toHaveLength(0);
    const t2 = hablar(m, ANA, mTexto('Silvana'));
    expect(ids(t2).join(' ')).not.toMatch(CONFIRMA);
    expect(hayQr(t2)).toBe(false);
  });
});

describe('envío con el modelo adverso', () => {
  it('«con envío» guarda el modo y pide el departamento por la LISTA; el departamento (por la lista) y la ciudad (la lee el código) siguen sin derivar con el modelo adverso; no sale «Confirmar pedido» sin el nombre y la cédula', () => {
    const m = crear({ modeloDice: modeloAdverso() });
    hablar(m, ANA, mTexto('quiero una billetera'));
    const t1 = hablar(m, ANA, mTexto('con envío'));
    expect(ficha(m).entrega.modo).toMatch(/env/i);
    expect(cuerpos(t1)).not.toMatch(PERSONA);
    expect(t1.avisos).toHaveLength(0);
    expect(J(t1.mensajes[0]!.payload)).toContain('"type":"list"');
    const t1b = hablar(m, ANA, mLista('dep:cb', 'Cochabamba'));
    expect(t1b.avisos).toHaveLength(0);
    const t2 = hablar(m, ANA, mTexto('Cochabamba, oficina Zona Sur'));
    expect(cuerpos(t2)).not.toMatch(PERSONA);
    expect(ficha(m).carrito).toHaveLength(1);
    expect(ficha(m).entrega).toMatchObject({ departamento: 'dep:cb', ciudad: 'Cochabamba', aclaracion: 'oficina Zona Sur', nombre: '', documento: '' });
    expect(cuerpos(t2)).toMatch(/nombre completo/i);
    expect(cuerpos(t2)).not.toMatch(/ciudad de destino/i);   // lo ya capturado no se repregunta
    expect(ids(t2).join(' ')).not.toMatch(CONFIRMA);
  });
  it('con el modelo sano: «con envío» → departamento por la lista → ciudad → «Ana Pérez 4412345» completa el pedido y tocar «Confirmar pedido» emite el QR', () => {
    const m = crear({ modeloDice: modeloSano((t) => ({ nombre: /Ana/.test(t) ? 'Ana Pérez' : '' })) });
    hablar(m, ANA, mTexto('quiero una billetera'));
    hablar(m, ANA, mTexto('con envío'));
    const t2 = completarEnvio(m, ANA);
    expect(ficha(m).entrega.nombre).toMatch(/Ana/);
    const id = /"id":"(pedido:confirmar:[a-z0-9]+)"/.exec(J(t2.mensajes.map((x) => x.payload)))?.[1] ?? 'sin-boton';
    expect(id).toMatch(/^pedido:confirmar:/);
    expect(hayQr(hablar(m, ANA, mToque(id, 'Confirmar pedido')))).toBe(true);
  });
});

describe('NEGADO: lo que el código no reconoce como elegir modo sigue derivando aunque haya pedido en curso', () => {
  it('SIN «?» y sin tildes: «el envio tiene garantia», «cuanto cuesta el envio» y «precio del envio a Oruro» derivan y no eligen el envío', () => {
    for (const consulta of ['el envio tiene garantia', 'cuanto cuesta el envio', 'precio del envio a Oruro']) {
      const m = crear({ modeloDice: modeloAdverso() });
      hablar(m, ANA, mTexto('quiero una billetera'));
      hablar(m, ANA, mTexto('recojo en tienda'));
      const modoAntes = ficha(m).entrega.modo;
      const t = hablar(m, ANA, mTexto(consulta));
      expect(t.avisos.length, consulta).toBeGreaterThanOrEqual(1);
      expect(ficha(m).entrega.modo, consulta).toBe(modoAntes);
    }
  });
  it('con el recojo ya elegido, «¿tienen garantía?» o una pieza que no existe pasan con recepción (aviso)', () => {
    for (const pregunta of ['¿tienen garantía?', '¿tienen la mochila negra?']) {
      const m = crear({ modeloDice: modeloAdverso() });
      hablar(m, ANA, mTexto('quiero una billetera'));
      hablar(m, ANA, mTexto('recojo en tienda'));
      const t = hablar(m, ANA, mTexto(pregunta));
      expect(t.avisos.length, pregunta).toBeGreaterThanOrEqual(1);
    }
  });
  it('«Vale» y «Mariana» sí son un nombre de una palabra cuando el asistente lo pidió y el modelo los devuelve', () => {
    for (const nombre of ['Vale', 'Mariana']) {
      const m = crear({ modeloDice: modeloDeNombre() });
      hablar(m, ANA, mTexto('quiero una billetera'));
      hablar(m, ANA, mToque('entrega:retiro', 'Recojo en tienda'));
      hablar(m, ANA, mTexto(nombre));
      expect(ficha(m).entrega.nombre, nombre).toBe(nombre);
    }
  });
  it('un modo que SOLO propuso el modelo (el cliente no lo dijo) más una pregunta de garantía sigue derivando, y el modo no se guarda', () => {
    let n = 0;
    const m = crear({ sinSembrar: true, modeloDice: () => { n++; return n === 1 ? modelo('Con gusto, lo anoto.', { lineas: BILLETERA }) : modelo('Una persona lo verá.', { lineas: BILLETERA, entrega: { modo: 'Retiro en tienda' }, quiereHablar: true }); } });
    hablar(m, ANA, mTexto('quiero una billetera'));
    expect(hablar(m, ANA, mTexto('¿tienen garantía?')).avisos.length).toBeGreaterThanOrEqual(1);
    expect(ficha(m).entrega.modo).toBe('');
  });
  it('el modo que propone el modelo se IGNORA aunque el cliente no pregunte nada: sigue sin modo, con los botones de entrega y sin su texto', () => {
    const m = crear({ sinSembrar: true, modeloDice: modelo('Perfecto, retiro en tienda, ya quedó.', { lineas: BILLETERA, entrega: { modo: 'Retiro en tienda', nombre: 'Ana Pérez' } }) });
    const t = hablar(m, ANA, mTexto('quiero una billetera para mi mamá'));
    expect(ficha(m).entrega.modo).toBe('');
    expect(ficha(m).entrega.nombre).toBe('');
    expect(ids(t).join(' ')).toMatch(/entrega:retiro/);
    expect(cuerpos(t)).not.toMatch(/ya quedó/);
  });
});

describe('«cancelar» es PAGAR en Bolivia: no vacía el carrito', () => {
  it('«ya cancelé» y «no quiero envío, lo recojo» con lineas: [] del modelo conservan el carrito', () => {
    for (const frase of ['ya cancelé', 'no quiero envío, lo recojo']) {
      let n = 0;
      const m = crear({ modeloDice: () => { n++; return n === 1 ? modelo('Con gusto, lo anoto.', { lineas: BILLETERA }) : modelo('Listo.', { lineas: [] }); } });
      hablar(m, ANA, mTexto('quiero una billetera'));
      hablar(m, ANA, mTexto(frase));
      expect(ficha(m).carrito, frase).toHaveLength(1);
    }
  });
});

describe('cambiar la entrega o frases comunes NO vacían el carrito (lineas: [] del modelo)', () => {
  it('«ya no quiero la entrega a domicilio, mejor recojo», «cancela el pedido por QR», «cuando sacan el pedido» y «me quitas una duda» conservan la billetera', () => {
    for (const frase of ['ya no quiero la entrega a domicilio, mejor recojo', 'cancela el pedido por QR', 'cuando sacan el pedido', 'me quitas una duda']) {
      let n = 0;
      const m = crear({ modeloDice: () => { n++; return n === 1 ? modelo('Con gusto, lo anoto.', { lineas: BILLETERA }) : modelo('Listo.', { lineas: [] }); } });
      hablar(m, ANA, mTexto('quiero una billetera'));
      hablar(m, ANA, mTexto(frase));
      expect(ficha(m).carrito, frase).toHaveLength(1);
    }
  });
  it('«ya no quiero la billetera» y «vacía el pedido» sí lo vacían', () => {
    for (const frase of ['ya no quiero la billetera', 'vacía el pedido']) {
      let n = 0;
      const m = crear({ modeloDice: () => { n++; return n === 1 ? modelo('Con gusto, lo anoto.', { lineas: BILLETERA }) : modelo('Listo.', { lineas: [] }); } });
      hablar(m, ANA, mTexto('quiero una billetera'));
      hablar(m, ANA, mTexto(frase));
      expect(ficha(m).carrito, frase).toHaveLength(0);
    }
  });
});

describe('lineas: [] del modelo', () => {
  it('sin una orden de quitar conserva el carrito; con «quita la billetera» lo vacía', () => {
    let n = 0;
    const m = crear({ modeloDice: () => { n++; return n === 1 ? modelo('Con gusto, lo anoto.', { lineas: BILLETERA }) : modelo('Listo.', { lineas: [] }); } });
    hablar(m, ANA, mTexto('quiero una billetera'));
    hablar(m, ANA, mTexto('hola de nuevo, ¿qué más tienen?'));
    expect(ficha(m).carrito).toHaveLength(1);
    hablar(m, ANA, mTexto('quita la billetera'));
    expect(ficha(m).carrito).toHaveLength(0);
  });
});

describe('NEGADO: el cliente que sí pide una persona sigue derivando', () => {
  it('«quiero hablar con una persona» deriva (aviso + botón) aunque haya pedido en curso', () => {
    const m = crear({ modeloDice: modeloAdverso() });
    hablar(m, ANA, mTexto('quiero una billetera'));
    hablar(m, ANA, mTexto('recojo en tienda'));
    expect(hablar(m, ANA, mTexto('quiero hablar con una persona')).avisos.length).toBeGreaterThanOrEqual(1);
  });
  it('sin pedido en curso, el quiereHablar del modelo (una pieza que no existe) sigue derivando', () => {
    const m = crear({ modeloDice: modelo('Lo verá una persona del equipo.', { lineas: [], quiereHablar: true }) });
    expect(hablar(m, ANA, mTexto('quiero un televisor de 80 pulgadas')).avisos.length).toBeGreaterThanOrEqual(1);
  });
  it('un nombre capturado NUNCA basta para ignorar un quiereHablar: deriva y GUARDA el nombre (no se repite)', () => {
    let n = 0;
    const m = crear({ modeloDice: () => { n++; return n === 1 ? modelo('Con gusto, lo anoto.', { lineas: BILLETERA }) : modelo('Una persona lo verá.', { lineas: BILLETERA, entrega: { nombre: 'Ana Pérez' }, quiereHablar: true }); } });
    hablar(m, ANA, mTexto('quiero una billetera'));
    hablar(m, ANA, mToque('entrega:retiro', 'Recojo en tienda'));
    const t = hablar(m, ANA, mTexto('Ana Pérez'));
    expect(t.avisos.length).toBeGreaterThanOrEqual(1);
    expect(ficha(m).entrega.nombre).toBe('Ana Pérez');
  });
});
