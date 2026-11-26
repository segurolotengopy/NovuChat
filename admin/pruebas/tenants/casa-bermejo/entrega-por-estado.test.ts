/**
 * LA ENTREGA POR ESTADO Y POR CÓDIGO (rediseño del 25/11/2026; cuatro rondas de revisión independiente cayeron en lo mismo: adivinar modo, nombre y datos desde texto libre con LISTAS de palabras).
 * Esta suite corre el JSON versionado y prueba el DISEÑO, no listas: el modo lo fija un botón o una frase inequívoca (el mensaje ENTERO); el nombre sale de `entrega.nombre` que devuelve el MODELO, validado por código y solo si el asistente lo pidió;
 * una CONSULTA nunca es un dato; CI, ciudad y flota los lee el código en cualquier orden; el resumen muestra lo capturado con «Corregir datos». Mensajes por conversación: 0 agregados (el segundo botón va en el mismo mensaje).
 * Contiene la TABLA DE SONDEO de la cuarta revisión (`BERMEJO_sondeo-cuarta-revision-1098_2026-11-25.md`, 17 casos) y la de la Principal, con el modelo SANO, el ADVERSO y (en las consultas) un modelo DESCUIDADO que devuelve lo que no debe.
 */
import { describe, expect, it } from 'vitest';
import { ANA, ARGENTINO, BILLETERA, CATALOGO, catalogoOk, crear, hablar, mLista, modelo, modeloAdverso, modeloDeNombre, modeloSano, mTexto, mToque, mUbicacion, panelConQr, textoAlModelo, type Opciones } from './mundo';
import type { LlamadaDoble } from '../../lib/n8n-de-mentira';

const J = (x: unknown): string => JSON.stringify(x);
type Entrega = { modo: string; nombre: string; ciudad: string; documento: string; departamento: string; aclaracion: string };
type Ficha = { carrito: { id: string }[]; entrega: Entrega; pide: string[] };
const itemAr = { ...CATALOGO[1], moneda: 'ARS', precio: 450000, precioCentavos: 45000000, stock: 10, disponible: true };
type Mund = ReturnType<typeof crear>;
type Turno = ReturnType<typeof hablar>;
const ficha = (m: Mund): Ficha => (m.sd['casabermejo'] as Record<string, Ficha>)[ANA]!;
const hayQr = (t: Turno): boolean => t.mensajes.some((x) => x.tipo === 'image' && /qr/i.test(J(x.payload)));
const idsDe = (t: Turno): string[] => t.mensajes.flatMap((x) => ((x.payload['interactive'] as { action?: { buttons?: { reply: { id: string } }[] } } | undefined)?.action?.buttons ?? []).map((b) => b.reply.id));
const titulosDe = (t: Turno): string[] => t.mensajes.flatMap((x) => ((x.payload['interactive'] as { action?: { buttons?: { reply: { title: string } }[] } } | undefined)?.action?.buttons ?? []).map((b) => b.reply.title));
const confirmaDe = (t: Turno): string | undefined => idsDe(t).find((i) => i.startsWith('pedido:confirmar:'));
const cuerpos = (t: Turno): string => t.mensajes.map((x) => x.cuerpo).join(' ');
const llamadas = (m: Mund): { n: number } => {
  const c = { n: 0 };
  const previo = m.dobles['Conversar con el modelo'] as (...x: unknown[]) => unknown;
  m.dobles['Conversar con el modelo'] = (...a: unknown[]) => { c.n++; return previo(...a); };
  return c;
};
const PERSONA = /persona del equipo|se encargar/i;
const RETIRO = 'Retiro en tienda';

/** El modelo DESCUIDADO: devuelve como dato el texto entero del cliente (nombre, ciudad, CI y hasta el modo). Lo que el CÓDIGO ya rechaza por estructura (consulta, cifras, modo) no debe entrar aunque el modelo lo ofrezca. */
const descuidado = (): ((ll: LlamadaDoble) => unknown) => {
  let n = 0;
  return (ll) => { n++; const t = textoAlModelo(ll); return n === 1 ? modelo('Con gusto, lo anoto.', { lineas: BILLETERA }) : modelo('Listo.', { lineas: BILLETERA, entrega: { modo: 'Envío', nombre: t, ciudad: t, documento: '4412345', flota: t } }); };
};
type Modelo = 'sano' | 'adverso' | 'descuidado';
const modeloDe = (k: Modelo, entregaDe?: (t: string) => Record<string, string>): Opciones => (k === 'sano' ? { modeloDice: modeloSano(entregaDe) as Opciones['modeloDice'] } : k === 'adverso' ? { modeloDice: modeloAdverso() } : { sinSembrar: true, modeloDice: descuidado() as Opciones['modeloDice'] });
/** Una charla con la billetera en el pedido, el retiro elegido y el asistente esperando el nombre. */
const conNombrePedido = (o: Opciones, via: 'boton' | 'frase' = 'boton'): Mund => {
  const m = crear(o);
  hablar(m, ANA, mTexto('quiero una billetera'));
  hablar(m, ANA, via === 'boton' ? mToque('entrega:retiro', 'Recojo en tienda') : mTexto('recojo en tienda'));
  return m;
};
/** Una charla con la billetera y el ENVÍO elegido por el botón (el código está pidiendo el departamento por la lista). */
const conEnvio = (o: Opciones): Mund => {
  const m = crear(o);
  hablar(m, ANA, mTexto('quiero una billetera'));
  hablar(m, ANA, mToque('entrega:envio', 'Envío'));
  return m;
};
/** El envío con el departamento ya elegido por la lista y el código pidiendo la ciudad. */
const conCiudadPedida = (o: Opciones): Mund => { const m = conEnvio(o); hablar(m, ANA, mLista('dep:cb', 'Cochabamba')); return m; };
/** El envío con departamento y ciudad ya dados: el código pide el nombre y la cédula. */
const conNombreYCiPedidos = (o: Opciones): Mund => { const m = conCiudadPedida(o); hablar(m, ANA, mTexto('Cochabamba, oficina Zona Sur')); return m; };
const sinCambio = (m: Mund, t: Turno, modo: string = RETIRO): void => {
  expect(ficha(m).entrega.modo).toBe(modo);
  expect(ficha(m).entrega.nombre).toBe('');
  expect(ficha(m).entrega.documento).toBe('');
  expect(ficha(m).entrega.ciudad).toBe('');
  expect(ficha(m).entrega.departamento).toBe('');
  expect(confirmaDe(t)).toBeUndefined();
  expect(hayQr(t)).toBe(false);
  expect(ficha(m).carrito).toHaveLength(1);   // `lineas: []` del modelo adverso no borra el pedido
};

describe('TABLA DE SONDEO (cuarta revisión + Principal): con el nombre pedido, lo que NO es un nombre no deja nombre ni lleva a «Confirmar pedido» (modelo sano y adverso)', () => {
  // Filas 1 a 10 de la cuarta revisión más la tabla de la Principal. El modelo sano NO devuelve nombre para ninguna (no son nombres); el adverso devuelve `quiereHablar: true`.
  const FRASES = [
    'Aceptan tarjeta', 'Tienen stock', 'Otro color', 'Humano', 'Efectivo', 'Billeteras', 'Cuero', '70012345', 'Quiero 2, cuánto sale con envío a Oruro', 'Cuál es su dirección, 4412345',
    'Horario', 'Y el horario', 'Transferencia', 'Cancelo', 'Tarjeta', 'Chau', 'Bien', 'Todo', 'Vendedor', 'Excelente', 'Espera', 'Precios', 'Necesito el horario, 77712345',
  ];
  for (const frase of FRASES) {
    it(`«${frase}»: modelo sano → ningún dato, ni «Confirmar pedido» ni QR; modelo adverso → deriva (aviso) y tampoco`, () => {
      const sano = conNombrePedido(modeloDe('sano'));
      sinCambio(sano, hablar(sano, ANA, mTexto(frase)));
      const adv = conNombrePedido(modeloDe('adverso'));
      const t = hablar(adv, ANA, mTexto(frase));
      sinCambio(adv, t);
      expect(t.avisos.length).toBeGreaterThanOrEqual(1);
    });
  }
  it('las consultas por la dirección, la ubicación o el horario SIN el dato cargado se derivan por código con el modelo sano también (aviso + botón, sin modelo), y el pedido en curso queda intacto', () => {
    for (const frase of ['Horario', 'Y el horario']) {   // con cifras («…, 4412345») el reconocedor único no contesta por código: lo ve el modelo, que no puede capturarlo como dato
      const m = conNombrePedido(modeloDe('sano'));
      const c = llamadas(m);
      const t = hablar(m, ANA, mTexto(frase));
      expect(c.n, frase).toBe(0);
      expect(t.avisos.length, frase).toBeGreaterThanOrEqual(1);
      sinCambio(m, t);
    }
  });
  it('con el modelo DESCUIDADO (devuelve la frase como nombre, ciudad, CI y modo) las CONSULTAS siguen sin dejar nada: lo decide la estructura, no el modelo', () => {
    for (const frase of ['Aceptan tarjeta', 'Tienen stock', 'Horario', 'Y el horario', 'Precios', 'Quiero 2, cuánto sale con envío a Oruro', 'Cuál es su dirección, 4412345', 'Necesito el horario, 77712345', 'Hola, tienen envío a Tarija 70012345']) {
      const m = conNombrePedido(modeloDe('descuidado'));
      sinCambio(m, hablar(m, ANA, mTexto(frase)));
    }
  });
  it('FILA 8: un teléfono suelto («70012345») no es nombre ni CI aunque el retiro no lo use; con el envío elegido tampoco es el CI', () => {
    const m = conEnvio(modeloDe('sano'));
    hablar(m, ANA, mTexto('70012345'));
    expect(ficha(m).entrega.documento).toBe('');
    expect(ficha(m).entrega.nombre).toBe('');
  });
});

describe('FILAS 11 y 12: una CONSULTA que nombra «envío» o «tienda» NO elige el modo ni captura datos', () => {
  for (const k of ['sano', 'adverso', 'descuidado'] as const) {
    it(`FILA 11 (${k}): con el retiro elegido, «Hola, tienen envío a Tarija 70012345» no pasa a Envío ni captura el teléfono, la ciudad ni el CI`, () => {
      const m = conNombrePedido(modeloDe(k));
      const t = hablar(m, ANA, mTexto('Hola, tienen envío a Tarija 70012345'));
      sinCambio(m, t);
      if (k === 'adverso') expect(t.avisos.length).toBeGreaterThanOrEqual(1);
    });
    it(`FILA 12 (${k}): con el envío elegido, «La dirección de la tienda, 4412345» no pasa a Retiro ni captura el CI (el modelo adverso deriva)`, () => {
      const m = conEnvio(modeloDe(k));
      const t = hablar(m, ANA, mTexto('La dirección de la tienda, 4412345'));
      if (k === 'adverso') expect(t.avisos.length).toBeGreaterThanOrEqual(1);   // el modelo adverso deriva; con cifras no contesta el reconocedor de la tienda
      sinCambio(m, t, 'Envío');
    });
  }
  it('con el dato de la tienda CARGADO la consulta la responde el modelo (no se deriva por código) y sigue sin ser un dato', () => {
    const m = conNombrePedido({ ...modeloDe('descuidado'), base: { ubicacionTienda: 'Calle Sucre 12', horarioTienda: 'lunes a sábado de 9 a 19' } });
    const c = llamadas(m);
    const t = hablar(m, ANA, mTexto('La dirección de la tienda, 4412345'));
    expect(c.n).toBe(1);
    sinCambio(m, t);
  });
  it('NEGADO: un texto que solo CONTIENE «tienda» o «envío» no cambia el modo ya elegido (ni hacia envío ni hacia retiro)', () => {
    for (const frase of ['quiero ver la tienda', 'no quiero envío', 'el envío a Oruro dice que tarda', 'tienda en La Paz']) {
      const m = conNombrePedido(modeloDe('sano'));
      hablar(m, ANA, mTexto(frase));
      expect(ficha(m).entrega.modo, frase).toBe(RETIRO);
    }
    const m2 = conEnvio(modeloDe('sano'));
    hablar(m2, ANA, mTexto('quiero ver la tienda'));
    expect(ficha(m2).entrega.modo).toBe('Envío');
  });
});

describe('NOMBRE: un nombre real se captura solo porque el MODELO lo devuelve y el asistente lo pidió', () => {
  for (const nombre of ['Silvana', 'Mariana', 'Vale']) {
    it(`«${nombre}» con el modelo sano: se guarda, sale el resumen con «Confirmar pedido» y «Corregir datos»; con el adverso NO se captura, deriva y no sale «Confirmar pedido»`, () => {
      const sano = conNombrePedido({ modeloDice: modeloDeNombre() });
      const t = hablar(sano, ANA, mTexto(nombre));
      expect(ficha(sano).entrega.nombre).toBe(nombre);
      expect(t.avisos).toHaveLength(0);
      expect(confirmaDe(t)).toBeDefined();
      const adv = conNombrePedido({ modeloDice: modeloAdverso() });
      const t2 = hablar(adv, ANA, mTexto(nombre));
      expect(ficha(adv).entrega.nombre).toBe('');
      expect(t2.avisos.length).toBeGreaterThanOrEqual(1);
      expect(confirmaDe(t2)).toBeUndefined();
    });
  }
  it('un modelo que NO devuelve el nombre (sin quiereHablar): no se captura y se vuelve a pedir una vez, sin derivar', () => {
    const m = conNombrePedido({ modeloDice: modeloSano() });
    const t = hablar(m, ANA, mTexto('Silvana'));
    expect(ficha(m).entrega.nombre).toBe('');
    expect(cuerpos(t)).toMatch(/nombre/i);
    expect(t.avisos).toHaveLength(0);
    expect(confirmaDe(t)).toBeUndefined();
  });
  it('NEGADO: el estado manda: si la ficha dice que el código NO pidió el nombre (`pide` vacío), el que devuelve el modelo no se guarda aunque el retiro ya esté elegido, y el texto del asistente en la memoria no lo cambia', () => {
    const m = conNombrePedido({ modeloDice: modeloDeNombre() });
    const f = (m.sd['casabermejo'] as Record<string, { pide: string[]; hist: { r: string; t: string }[] }>)[ANA]!;
    expect(f.pide).toEqual(['nombre']);   // lo escribió el CÓDIGO al armar la pregunta
    f.pide = [];
    for (const h of f.hist) if (h.r === 'm') h.t = '¿A nombre de quién retira?';   // un texto que «parece» pedir el nombre no basta: manda el estado guardado
    hablar(m, ANA, mTexto('Silvana'));
    expect(ficha(m).entrega.nombre).toBe('');
  });
  it('si el texto del modelo no pide el nombre, el CÓDIGO agrega la pregunta (así el estado «el asistente pidió el nombre» es cierto) y el nombre del turno siguiente se captura', () => {
    const m = crear({ modeloDice: modeloSano((t) => ({ nombre: t }), 'Con gusto, sigo atento a lo que necesite.') });
    hablar(m, ANA, mTexto('quiero una billetera'));
    const t = hablar(m, ANA, mTexto('recojo en tienda'));
    expect(cuerpos(t)).toMatch(/sigo atento a lo que necesite\./i);
    expect(cuerpos(t)).toMatch(/nombre/i);
    hablar(m, ANA, mTexto('Silvana'));
    expect(ficha(m).entrega.nombre).toBe('Silvana');
  });
  it('NEGADO: sin que el asistente haya pedido el nombre, el que devuelve el modelo no se guarda (se lo pide cuando toca); el modelo descuidado con cifras o inventado tampoco', () => {
    let n = 0;
    const m = crear({ modeloDice: () => { n++; return modelo('Con gusto, lo anoto.', { lineas: BILLETERA, entrega: { nombre: 'Ana Pérez' } }); } });
    hablar(m, ANA, mTexto('soy Ana Pérez y quiero una billetera'));
    expect(ficha(m).entrega.nombre).toBe('');
    expect(n).toBe(1);
    const c = conNombrePedido({ modeloDice: modeloSano((t) => ({ nombre: t + ' 4455667' })) });
    hablar(c, ANA, mTexto('Silvana'));
    expect(ficha(c).entrega.nombre).toBe('');
    const d = conNombrePedido({ modeloDice: modeloSano(() => ({ nombre: 'Juan Pérez' })) });
    hablar(d, ANA, mTexto('Silvana'));
    expect(ficha(d).entrega.nombre).toBe('');
  });
  it('«Ana Factura»: «factura» como apellido la decide la capa de intenciones («Decidir turno» la deriva por código como un pedido de factura); la validación del nombre la acepta (prueba en venta-casa-bermejo-lib.test.ts)', () => {
    const m = conNombrePedido({ modeloDice: modeloDeNombre() });
    const t = hablar(m, ANA, mTexto('Ana Factura'));
    expect(t.avisos.length).toBeGreaterThanOrEqual(1);
  });
});

describe('FILA 15: el retiro dicho con el nombre', () => {
  it('«Ana Pérez, recojo en tienda» (el asistente acababa de pedir la entrega): modo y nombre en un solo turno → resumen y «Confirmar pedido»; con el modelo adverso, el modo por código sin derivar y el nombre se vuelve a pedir', () => {
    const sano = crear({ modeloDice: modeloSano((t) => ({ nombre: /Ana/.test(t) ? 'Ana Pérez' : '' })) });
    hablar(sano, ANA, mTexto('quiero una billetera'));
    const t = hablar(sano, ANA, mTexto('Ana Pérez, recojo en tienda'));
    expect(ficha(sano).entrega).toMatchObject({ modo: RETIRO, nombre: 'Ana Pérez' });
    expect(confirmaDe(t)).toBeDefined();
    const adv = crear({ modeloDice: modeloAdverso() });
    hablar(adv, ANA, mTexto('quiero una billetera'));
    const t2 = hablar(adv, ANA, mTexto('Ana Pérez, recojo en tienda'));
    expect(ficha(adv).entrega).toMatchObject({ modo: RETIRO, nombre: '' });
    expect(t2.avisos).toHaveLength(0);
    expect(cuerpos(t2)).not.toMatch(PERSONA);
    expect(cuerpos(t2)).toMatch(/nombre/i);
    expect(confirmaDe(t2)).toBeUndefined();
  });
  it('«recojo en tienda» y luego «Ana»: con el sano se completa; con el adverso («el nombre solo no basta») deriva', () => {
    const sano = conNombrePedido({ modeloDice: modeloDeNombre() }, 'frase');
    expect(confirmaDe(hablar(sano, ANA, mTexto('Ana')))).toBeDefined();
    const adv = conNombrePedido({ modeloDice: modeloAdverso() }, 'frase');
    expect(hablar(adv, ANA, mTexto('Ana')).avisos.length).toBeGreaterThanOrEqual(1);
  });
});

describe('FILAS 16 y 17: el ENVÍO por pasos («Intermedio», 26/11/2026): departamento por la lista → ciudad y aclaración en UN mensaje → nombre completo y cédula en UN mensaje (modelo sano y adverso)', () => {
  const entregaDe = (t: string): Record<string, string> => (/Ana/.test(t) ? { nombre: 'Ana Pérez' } : {});
  it('FILA 16, camino feliz (modelo sano): lista de departamentos → ciudad con aclaración → nombre y cédula → resumen con los datos y los dos botones → el QR al tocar «Confirmar pedido»; solo el nombre del paso lo pone el modelo', () => {
    const m = conEnvio({ modeloDice: modeloSano(entregaDe) });
    const c = llamadas(m);
    const t1 = hablar(m, ANA, mLista('dep:cb', 'Cochabamba'));
    expect(t1.mensajes).toHaveLength(1);
    expect(cuerpos(t1)).toMatch(/ciudad/i);
    expect(ficha(m).entrega.departamento).toBe('dep:cb');
    expect(c.n).toBe(0);   // el toque de la lista lo decide el código
    const t2 = hablar(m, ANA, mTexto('Cochabamba, oficina Zona Sur'));
    expect(ficha(m).entrega).toMatchObject({ ciudad: 'Cochabamba', aclaracion: 'oficina Zona Sur' });
    expect(cuerpos(t2)).toMatch(/nombre completo/i);
    expect(cuerpos(t2)).toMatch(/c[eé]dula/i);
    const t = hablar(m, ANA, mTexto('Ana Pérez, 4412345'));
    expect(ficha(m).entrega).toMatchObject({ modo: 'Envío', nombre: 'Ana Pérez', documento: '4412345', departamento: 'dep:cb', ciudad: 'Cochabamba', aclaracion: 'oficina Zona Sur' });
    expect(t.mensajes).toHaveLength(1);
    expect(titulosDe(t)).toEqual(['Confirmar pedido', 'Corregir datos']);
    for (const x of ['Recoge el envío: Ana Pérez', 'CI: 4412345', 'Departamento: Cochabamba', 'Ciudad: Cochabamba', 'Aclaración: oficina Zona Sur', 'Entrega: Envío']) expect(cuerpos(t)).toContain(x);
    expect(hayQr(hablar(m, ANA, mToque(confirmaDe(t)!, 'Confirmar pedido')))).toBe(true);
  });
  it('FILA 16 adversa: con un modelo que solo dice quiereHablar, el departamento (lista), la ciudad y la aclaración (los lee el código) NO derivan; y «Ana Pérez 4412345» (nombre y cédula leídos por código) completa el pedido sin derivar', () => {
    const m = conEnvio({ modeloDice: modeloAdverso() });
    expect(hablar(m, ANA, mLista('dep:cb', 'Cochabamba')).avisos).toHaveLength(0);
    const t2 = hablar(m, ANA, mTexto('Cochabamba, oficina Zona Sur'));
    expect(t2.avisos).toHaveLength(0);
    expect(cuerpos(t2)).not.toMatch(PERSONA);
    const t = hablar(m, ANA, mTexto('Ana Pérez 4412345'));
    expect(t.avisos).toHaveLength(0);
    expect(ficha(m).entrega).toMatchObject({ nombre: 'Ana Pérez', documento: '4412345' });
    expect(confirmaDe(t)).toBeDefined();
  });
  it('NEGADO: sin que el asistente haya pedido la entrega (no hay piezas), la frase «envío a …» dentro de un mensaje de datos NO fija el modo ni nada', () => {
    const m = crear({ sinSembrar: true, modeloDice: modelo('Hola, ¿qué pieza le interesa?') });
    hablar(m, ANA, mTexto('Ana Pérez, 4412345, envío a Cochabamba'));
    expect(ficha(m).entrega.modo).toBe('');
    expect(ficha(m).entrega.documento).toBe('');
    expect(ficha(m).entrega.ciudad).toBe('');
  });
  describe('un paso de DOS datos (nombre y cédula): con los dos, con uno solo y en desorden; solo se repregunta el que falta', () => {
    it('solo la cédula («4412345»): se guarda y se repregunta SOLO el nombre; después el nombre completa el pedido', () => {
      const m = conNombreYCiPedidos({ modeloDice: modeloSano(entregaDe) });
      const t = hablar(m, ANA, mTexto('4412345'));
      expect(ficha(m).entrega).toMatchObject({ documento: '4412345', nombre: '' });
      expect(ficha(m).pide).toEqual(['nombre']);
      expect(cuerpos(t)).toMatch(/nombre completo/i);
      expect(cuerpos(t)).not.toMatch(/c[eé]dula|carnet/i);
      expect(confirmaDe(t)).toBeUndefined();
      expect(confirmaDe(hablar(m, ANA, mTexto('Ana Pérez')))).toBeDefined();
    });
    it('solo el nombre («Ana Pérez»): se guarda y se repregunta SOLO la cédula; después la cédula completa el pedido', () => {
      const m = conNombreYCiPedidos({ modeloDice: modeloSano(entregaDe) });
      const t = hablar(m, ANA, mTexto('Ana Pérez'));
      expect(ficha(m).entrega).toMatchObject({ nombre: 'Ana Pérez', documento: '' });
      expect(ficha(m).pide).toEqual(['documento']);
      expect(cuerpos(t)).toMatch(/c[eé]dula/i);
      expect(cuerpos(t)).not.toMatch(/nombre completo/i);
      expect(confirmaDe(hablar(m, ANA, mTexto('4412345')))).toBeDefined();
    });
    for (const [que, texto] of [['en desorden, la cifra primero', '4412345 Ana Pérez'], ['con rótulo', 'CI 4412345, Ana Pérez'], ['con el nombre primero y rótulo', 'Ana Pérez, cédula 4412345'], ['con puntos en la cifra', 'Ana Pérez 4.412.345']] as const) {
      it(`los dos en un mensaje, ${que} («${texto}»): nombre y cédula quedan guardados y sale el resumen`, () => {
        const m = conNombreYCiPedidos({ modeloDice: modeloSano(() => ({})) });   // el modelo NO devuelve nada: lo leen los códigos
        const t = hablar(m, ANA, mTexto(texto));
        expect(ficha(m).entrega).toMatchObject({ nombre: 'Ana Pérez', documento: '4412345' });
        expect(confirmaDe(t)).toBeDefined();
      });
    }
    it('NEGADO: lo que no es un nombre ni una cédula no guarda nada y repregunta lo MISMO (no avanza al resumen ni al QR)', () => {
      for (const frase of ['Gracias', 'Ok dale', 'Otro color', '123', '70012345', 'Ana', 'quiero pagar']) {
        const m = conNombreYCiPedidos({ modeloDice: modeloSano((t) => ({ nombre: t })) });
        const t = hablar(m, ANA, mTexto(frase));
        expect(ficha(m).entrega.nombre, frase).toBe('');
        expect(ficha(m).entrega.documento, frase).toBe('');
        expect(confirmaDe(t), frase).toBeUndefined();
        expect(hayQr(t), frase).toBe(false);
        expect(ficha(m).pide, frase).toEqual(['nombre', 'documento']);
      }
    });
  });
  describe('el paso de la CIUDAD y la aclaración opcional: un mensaje, con o sin aclaración; si no se puede separar con seguridad, todo es la ciudad', () => {
    for (const [texto, ciudad, aclaracion] of [
      ['Cochabamba', 'Cochabamba', ''],
      ['Santa Cruz, oficina Zona Sur', 'Santa Cruz', 'oficina Zona Sur'],
      ['Tarija; agencia Centro', 'Tarija', 'agencia Centro'],
      ['Oruro\nsucursal Terminal', 'Oruro', 'sucursal Terminal'],
      ['Sucre oficina Calle Ravelo', 'Sucre', 'oficina Calle Ravelo'],
      ['Villa Tunari frente a la plaza', 'Villa Tunari frente a la plaza', ''],
    ] as const) {
      it(`«${texto.replace(/\n/g, '⏎')}» → ciudad «${ciudad}» y aclaración «${aclaracion}»`, () => {
        const m = conCiudadPedida({ modeloDice: modeloSano() });
        hablar(m, ANA, mTexto(texto));
        expect(ficha(m).entrega).toMatchObject({ ciudad, aclaracion });
        expect(ficha(m).pide).toEqual(['nombre', 'documento']);
      });
    }
    it('NEGADO: lo que no vale como ciudad (cortesía, orden de pagar, solo cifras, un documento, vacío) no se guarda y se repregunta la ciudad', () => {
      for (const frase of ['Gracias', 'quiero pagar', 'ok', '4412345', 'mi CI 4412345', 'quiero hablar con una persona']) {
        const m = conCiudadPedida({ modeloDice: modeloSano() });
        hablar(m, ANA, mTexto(frase));
        expect(ficha(m).entrega.ciudad, frase).toBe('');
        expect(ficha(m).pide, frase).toEqual(['ciudad']);
      }
    });
    it('NEGADO (ronda 10): una aclaración SIN ciudad («oficina Zona Sur», «, agencia Centro») no queda como ciudad ni como aclaración: se repregunta la ciudad', () => {
      for (const frase of ['oficina Zona Sur', ', oficina Zona Sur', 'agencia Centro', 'sucursal Terminal', 'Oficina Palermo']) {
        const m = conCiudadPedida({ modeloDice: modeloSano() });
        hablar(m, ANA, mTexto(frase));
        expect(ficha(m).entrega, frase).toMatchObject({ ciudad: '', aclaracion: '' });
        expect(ficha(m).pide, frase).toEqual(['ciudad']);
      }
    });
    it('NEGADO (ronda 10): una forma de pago, una pieza del catálogo, «cancelar», un vendedor, la palabra flota o una dirección con número NO se guardan como ciudad, con o sin aclaración (adversa); una ciudad sana con la misma forma sí', () => {
      for (const frase of ['Efectivo', 'Por QR', 'Transferencia bancaria', 'Cancelar', 'Vendedor', 'Billetera', 'flota Bolívar, donde sale a Tarija', 'Oruro y la flota después te digo', 'La Paz y pago con QR', 'mi dirección es Calle Florida 500', 'Provincia', 'Ciudad:']) {
        const m = conCiudadPedida({ modeloDice: modeloSano() });
        hablar(m, ANA, mTexto(frase));
        expect(ficha(m).entrega.ciudad, frase).toBe('');
        expect(ficha(m).pide, frase).toEqual(['ciudad']);
      }
      const m = conCiudadPedida({ modeloDice: modeloSano() });
      hablar(m, ANA, mTexto('Tarija, pago por QR'));
      expect(ficha(m).entrega).toMatchObject({ ciudad: 'Tarija', aclaracion: '' });   // la forma de pago no queda de aclaración
      const s = conCiudadPedida({ modeloDice: modeloSano() });
      hablar(s, ANA, mTexto('Ciudad Evita'));
      expect(ficha(s).entrega.ciudad).toBe('Ciudad Evita');   // una ciudad cuyo nombre trae un rótulo SÍ vale
    });
    it('NEGADO: un teléfono o documento dentro de la aclaración no se guarda en el texto libre', () => {
      const m = conCiudadPedida({ modeloDice: modeloSano() });
      hablar(m, ANA, mTexto('Cochabamba, oficina Zona Sur teléfono 70012345'));
      expect(JSON.stringify(ficha(m).entrega)).not.toMatch(/70012345/);
      expect(ficha(m).entrega.ciudad).toBe('Cochabamba');   // lo que sí se pudo separar con seguridad
    });
  });
  it('FILA 17 adversa: «Ana Pérez» solo deriva (el nombre solo no basta) y NO se captura; la cédula con su rótulo sí; la derivación NO borra lo que se estaba pidiendo (`pide` persiste)', () => {
    const m = conNombreYCiPedidos({ modeloDice: modeloAdverso() });
    const t1 = hablar(m, ANA, mTexto('Ana Pérez'));
    expect(t1.avisos.length).toBeGreaterThanOrEqual(1);
    expect(ficha(m).entrega.nombre).toBe('');
    expect(ficha(m).pide).toEqual(['nombre', 'documento']);
    const t2 = hablar(m, ANA, mTexto('CI 4412345'));
    expect(t2.avisos).toHaveLength(0);
    expect(ficha(m).entrega).toMatchObject({ nombre: '', documento: '4412345' });
    expect(confirmaDe(t2)).toBeUndefined();
    expect(cuerpos(t2)).toMatch(/nombre completo/i);
    expect(cuerpos(t2)).not.toMatch(/c[eé]dula|carnet/i);
  });
  it('el modelo que se recupera: adverso en un mensaje y sano después → el paso se repregunta y completa el pedido', () => {
    let n = 0;
    const m = conNombreYCiPedidos({ modeloDice: (ll) => { n++; return n <= 3 ? modelo('Con gusto, lo anoto.', { lineas: BILLETERA }) : n === 4 ? modelo('Una persona del equipo se encargará.', { lineas: [], quiereHablar: true }) : modelo('Listo.', { lineas: BILLETERA, entrega: { nombre: textoAlModelo(ll) } }); } });
    hablar(m, ANA, mTexto('Ana Pérez'));   // el adverso deriva y no guarda
    expect(ficha(m).entrega.nombre).toBe('');
    hablar(m, ANA, mTexto('4412345'));
    const t = hablar(m, ANA, mTexto('Ana Pérez'));
    expect(ficha(m).entrega.nombre).toBe('Ana Pérez');
    expect(confirmaDe(t)).toBeDefined();
  });
});

describe('CAMINO FELIZ del retiro: hasta «Confirmar pedido» y el QR (el nombre lo devuelve el modelo)', () => {
  it('mensajes separados (frase inequívoca): 1 mensaje por turno, el segundo botón va en el mismo mensaje y el QR sale al tocar «Confirmar pedido» sin modelo', () => {
    const m = crear({ modeloDice: modeloDeNombre() });
    expect(hablar(m, ANA, mTexto('quiero una billetera')).mensajes).toHaveLength(1);
    expect(hablar(m, ANA, mTexto('recojo en tienda')).mensajes).toHaveLength(1);
    const t = hablar(m, ANA, mTexto('Ana Pérez'));
    expect(t.mensajes).toHaveLength(1);   // 0 mensajes agregados por «Corregir datos»
    expect(titulosDe(t)).toEqual(['Confirmar pedido', 'Corregir datos']);
    for (const b of titulosDe(t)) expect(b.length).toBeLessThanOrEqual(20);
    expect(idsDe(t)[1]).toBe('pedido:corregir');
    const c = llamadas(m);
    expect(hayQr(hablar(m, ANA, mToque(confirmaDe(t)!, 'Confirmar pedido')))).toBe(true);
    expect(c.n).toBe(0);
  });
});

describe('E. «Corregir datos»: el cliente VE lo capturado y puede borrarlo (un dato mal leído nunca llega al cobro sin que lo vea)', () => {
  const listo = (): { m: Mund; t: Turno } => { const m = conNombrePedido({ modeloDice: modeloDeNombre() }); return { m, t: hablar(m, ANA, mTexto('Ana Pérez')) }; };
  it('el resumen muestra el modo y el nombre', () => {
    const { t } = listo();
    expect(cuerpos(t)).toContain('Entrega: Retiro en tienda');
    expect(cuerpos(t)).toContain('Retira: Ana Pérez');
  });
  it('tocar «Corregir datos» (id exacto): sin modelo, 1 mensaje, borra nombre/CI/ciudad/flota, CONSERVA el modo, vuelve a pedir lo que falta y el botón viejo de «Confirmar pedido» ya no emite el QR', () => {
    const { m, t } = listo();
    const viejo = confirmaDe(t)!;
    const c = llamadas(m);
    const t2 = hablar(m, ANA, mToque('pedido:corregir', 'Corregir datos'));
    expect(c.n).toBe(0);
    expect(t2.mensajes).toHaveLength(1);
    expect(ficha(m).entrega).toMatchObject({ modo: RETIRO, nombre: '' });
    expect(cuerpos(t2)).toMatch(/nombre/i);
    expect(confirmaDe(t2)).toBeUndefined();
    expect(hayQr(hablar(m, ANA, mToque(viejo, 'Confirmar pedido')))).toBe(false);
    // y se puede volver a dar el dato y confirmar
    const t3 = hablar(m, ANA, mTexto('Mariana'));
    expect(ficha(m).entrega.nombre).toBe('Mariana');
    expect(hayQr(hablar(m, ANA, mToque(confirmaDe(t3)!, 'Confirmar pedido')))).toBe(true);
  });
  it('en el envío borra departamento, ciudad, aclaración, nombre y CI también, CONSERVA el modo y vuelve a pedir desde el primer paso (la lista de departamentos); un dato ya capturado no se pisa sin «Corregir datos»', () => {
    const m = conNombreYCiPedidos({ modeloDice: modeloSano((t) => ({ nombre: /Ana/.test(t) ? 'Ana Pérez' : '' })) });
    hablar(m, ANA, mTexto('Ana Pérez, 4412345'));
    // sin «Corregir datos», una lista vieja no pisa el departamento ya capturado
    hablar(m, ANA, mLista('dep:lp', 'La Paz'));
    expect(ficha(m).entrega.departamento).toBe('dep:cb');
    const t = hablar(m, ANA, mToque('pedido:corregir', 'Corregir datos'));
    expect(ficha(m).entrega).toMatchObject({ modo: 'Envío', nombre: '', documento: '', ciudad: '', aclaracion: '', departamento: '' });
    expect(J(t.mensajes[0]!.payload)).toContain('"type":"list"');
    expect(cuerpos(t)).toMatch(/departamento/i);
    // y entonces sí se puede elegir otro
    hablar(m, ANA, mLista('dep:lp', 'La Paz'));
    expect(ficha(m).entrega.departamento).toBe('dep:lp');
  });
  it('NEGADO: un id inventado no hace nada («toque viejo»): ni borra los datos ni emite un QR; los que empiezan como el botón ni siquiera llaman al modelo', () => {
    for (const id of ['pedido:corregir:x', 'pedido:corregir ', 'PEDIDO:CORREGIR', 'pedido:corregi', 'pedido:corregir2', 'corregir']) {
      const { m } = listo();
      const antes = J(ficha(m).entrega);
      const c = llamadas(m);
      const t = hablar(m, ANA, mToque(id, 'Corregir datos'));
      if (id.startsWith('pedido:corregir')) expect(c.n, id).toBe(0);
      expect(J(ficha(m).entrega), id).toBe(antes);
      expect(hayQr(t), id).toBe(false);
    }
  });
  it('NEGADO: sin pedido, sin modo elegido o con un QR abierto el toque exacto tampoco borra nada', () => {
    const vacia = crear({ modeloDice: modelo('Hola.') });
    hablar(vacia, ANA, mToque('pedido:corregir', 'Corregir datos'));
    expect(ficha(vacia).carrito).toEqual([]);
    const sinModo = crear({ modeloDice: modeloDeNombre() });
    hablar(sinModo, ANA, mTexto('quiero una billetera'));
    hablar(sinModo, ANA, mToque('pedido:corregir', 'Corregir datos'));
    expect(ficha(sinModo).entrega.modo).toBe('');
    const { m } = listo();
    m.dobles['Traer configuración'] = () => panelConQr(450);
    hablar(m, ANA, mToque('pedido:corregir', 'Corregir datos'));
    expect(ficha(m).entrega.nombre).toBe('Ana Pérez');
  });
});

describe('1. QUEDAN FUERA (26/11/2026): dirección exacta, teléfono, ubicación compartida y empresa de transporte NO se piden ni se guardan; «dirección» y «dónde» siguen siendo consulta por su FORMA', () => {
  it('NEGADO: con el envío completo, la ficha solo tiene los datos de la lista (modo, departamento, región, provincia, ciudad, aclaración, nombre, documento): ni dirección, ni teléfono, ni ubicación, ni flota', () => {
    const m = conNombreYCiPedidos({ modeloDice: modeloSano((t) => (/Ana/.test(t) ? { nombre: 'Ana Pérez' } : {})) });
    hablar(m, ANA, mTexto('Ana Pérez, 4412345'));
    expect(Object.keys(ficha(m).entrega).sort()).toEqual(['aclaracion', 'ciudad', 'departamento', 'documento', 'modo', 'nombre', 'provincia', 'region']);
  });
  it('NEGADO: ningún mensaje del flujo pide una ubicación compartida, una dirección exacta, un teléfono ni la empresa de transporte (todos los pasos del envío, Bolivia y Argentina)', () => {
    for (const mercado of ['BO', 'AR'] as const) {
      const tel = mercado === 'AR' ? ARGENTINO : ANA;
      const m = crear({ ...(mercado === 'AR' ? { catalogo: catalogoOk({ mercado: 'AR', moneda: 'ARS' }, [itemAr] as never) } : {}), modeloDice: modeloSano((t) => (/Ana/.test(t) ? { nombre: 'Ana Pérez' } : {})) });
      hablar(m, tel, mTexto('quiero una billetera'));
      const todos = [hablar(m, tel, mToque('entrega:envio', 'Envío'))];
      if (mercado === 'AR') { todos.push(hablar(m, tel, mLista('reg:centro', 'Centro'))); todos.push(hablar(m, tel, mLista('prov:ar-x', 'Córdoba'))); } else todos.push(hablar(m, tel, mLista('dep:cb', 'Cochabamba')));
      todos.push(hablar(m, tel, mTexto('Córdoba, oficina Zona Sur')));
      todos.push(hablar(m, tel, mTexto('Ana Pérez 30123456')));
      const dicho = todos.map((t) => J(t.mensajes.map((x) => x.payload))).join(' ');
      expect(dicho, mercado).not.toMatch(/location_request_message|send_location|direcci[oó]n exacta|tel[eé]fono|ubicaci[oó]n compartida|enviar ubicaci[oó]n|empresa de flota|terminal/i);
    }
  });
  it('NEGADO: una ubicación compartida (pin) en medio del envío no se guarda ni cambia nada: sale el texto cortés de siempre y el dato pedido sigue siendo el mismo', () => {
    const m = conCiudadPedida({ modeloDice: modeloSano() });
    const antes = J(ficha(m).entrega);
    const pideAntes = J(ficha(m).pide);
    const t = hablar(m, ANA, mUbicacion());
    expect(J(ficha(m).entrega)).toBe(antes);
    expect(J(ficha(m).pide)).toBe(pideAntes);
    expect(J(m.sd)).not.toMatch(/-16\.5|-68\.15/);
    expect(confirmaDe(t)).toBeUndefined();
    expect(hayQr(t)).toBe(false);
  });
  it('«La dirección de la tienda» sigue siendo consulta (se deriva sin dato cargado) y NO es el dato de la ciudad', () => {
    const m = conCiudadPedida({ modeloDice: modeloSano() });
    hablar(m, ANA, mTexto('La dirección de la tienda'));
    expect(ficha(m).entrega.ciudad).toBe('');
    expect(ficha(m).pide).toEqual(['ciudad']);
  });
});

describe('2. el «pagar» escrito no se salta el resumen: solo cierra un pedido que YA estaba completo antes de este turno', () => {
  const sinQr = (t: Turno): void => { expect(hayQr(t)).toBe(false); };
  it('«Juan Perez, quiero pagar» con el nombre pedido: se completa en este turno → resumen con «Confirmar pedido» y «Corregir datos», SIN QR; recién el botón (o un «pagar» después) emite el QR', () => {
    const m = conNombrePedido({ modeloDice: modeloSano((t) => ({ nombre: /Juan Perez/.test(t) ? 'Juan Perez' : '' })) });
    const t = hablar(m, ANA, mTexto('Juan Perez, quiero pagar'));
    expect(ficha(m).entrega.nombre).toBe('Juan Perez');
    sinQr(t);
    expect(titulosDe(t)).toEqual(['Confirmar pedido', 'Corregir datos']);
    expect(cuerpos(t)).toContain('Retira: Juan Perez');
    expect(hayQr(hablar(m, ANA, mTexto('quiero pagar')))).toBe(true);
  });
  it('NEGADO: «quiero pagar» antes de dar el nombre no cierra; y ese pedido de pagar guardado no hace que el siguiente turno (que completa el pedido) salga con QR', () => {
    const m = conNombrePedido({ modeloDice: modeloSano((t) => (/^Ana/.test(t) ? { nombre: 'Ana Pérez' } : {})) });
    sinQr(hablar(m, ANA, mTexto('quiero pagar')));
    expect(ficha(m).entrega.nombre).toBe('');
    (m.sd['casabermejo'] as Record<string, { cierre: boolean }>)[ANA]!.cierre = true;   // un cierre guardado de un turno con el pedido incompleto
    const t = hablar(m, ANA, mTexto('Ana Pérez'));
    sinQr(t);
    expect(titulosDe(t)).toEqual(['Confirmar pedido', 'Corregir datos']);
    expect(ficha(m).entrega.nombre).toBe('Ana Pérez');
  });
});

describe('5. un mensaje de DATOS con «¿está bien?» captura el dato del paso y no es consulta (modelo sano y adverso)', () => {
  for (const k of ['sano', 'adverso'] as const) {
    it(`${k}: «Cochabamba, oficina Zona Sur ¿está bien?» en el paso de la ciudad guarda la ciudad y la aclaración y no deriva`, () => {
      const m = conCiudadPedida(k === 'sano' ? { modeloDice: modeloSano() } : modeloDe('adverso'));
      const t = hablar(m, ANA, mTexto('Cochabamba, oficina Zona Sur ¿está bien?'));
      expect(ficha(m).entrega).toMatchObject({ ciudad: 'Cochabamba', aclaracion: 'oficina Zona Sur' });
      expect(t.avisos).toHaveLength(0);
    });
  }
  it('NEGADO: una pregunta de verdad («¿tienen envío a Cochabamba?») en el paso de la ciudad sigue siendo consulta: no captura nada y se repregunta la ciudad', () => {
    const m = conCiudadPedida(modeloDe('descuidado'));
    hablar(m, ANA, mTexto('¿tienen envío a Cochabamba?'));
    expect(ficha(m).entrega.ciudad).toBe('');
    expect(ficha(m).pide).toEqual(['ciudad']);
  });
});

describe('6. el CI sale enmascarado del texto que se REPORTA (el cliente sí lo ve completo)', () => {
  it('«Ana Pérez, 4.412.345»: el mensaje al cliente muestra el CI y lo que se reporta a la conversación lo lleva como [CI]', () => {
    const m = conNombreYCiPedidos({ modeloDice: modeloSano((t) => (/Ana/.test(t) ? { nombre: 'Ana Pérez' } : {})) });
    const t = hablar(m, ANA, mTexto('Ana Pérez, 4.412.345'));
    expect(cuerpos(t)).toContain('CI: 4412345');
    const repo = t.llamadas.ingesta.map((x) => String(x['texto'] ?? '')).filter((x) => /Datos de entrega/.test(x));
    expect(repo).toHaveLength(1);
    expect(repo[0]).toContain('CI: [CI]');
    expect(repo[0]).not.toMatch(/4[\s.-]?412[\s.-]?345/);
  });
});
