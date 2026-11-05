/**
 * «NOCHES SIN INSOMNIO» DE RUBÉN (tenant rroca-ruben) — PR-2: LA CONVERSACIÓN. Los 4 casos del PDF de ejemplos, la crisis que se levanta sola, las objeciones por código y el prompt del modelo.
 *
 * Caja negra sobre los JSON VERSIONADOS con el n8n de mentira (como `venta.test.ts`). El CÓDIGO decide (plan, precio, botones, QR, avisos); el modelo solo redacta, filtrado por `cmRevisarRedaccion` y `rrSeguro`.
 * ESTA SUITE ESCRIBE NEGANDO. Lo que niega:
 *   - una captura de anuncio SIN texto no recibe el saludo genérico: abre con SU ángulo (dato de la campaña), y sin ángulo o con el modelo caído cae al saludo fijo, sin montos;
 *   - «¿precio y devolución?» da el precio Y deriva en un solo mensaje; la devolución sola nunca trae precios; jamás una promesa de devolución;
 *   - «¿me garantizan dormir?» no garantiza; dos preguntas juntas se responden en UN solo mensaje, nunca en dos;
 *   - la crisis NO se renueva con cada mensaje: vence a las 48 h de la ÚLTIMA SEÑAL; mientras dura, no hay venta; una señal nueva reinicia el plazo;
 *   - «lo voy a pensar» no abre un QR; el bono no se vende suelto; la muestra de voz solo sale si la piden; el modelo no habla de precios ni de la web;
 *   - ningún aviso a Rubén dice «validado», «acreditado» ni «verificado».
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { J } from '../../lib/flujo';
import type { Mundo, ResultadoTurno } from '../../lib/n8n-de-mentira';
import { COMPROBANTE, ANA, REC, crear, hablar, mBoton, mImagen, mTexto, panelConQr, panelOk, type Opciones } from './mundo';
import { cargarLibrerias } from './librerias';
import { vigilarUx } from './vigilante-ux';

const AQUI = dirname(fileURLToPath(import.meta.url));
const ANUNCIOS = (JSON.parse(readFileSync(join(AQUI, '../../../scripts/datos/rroca-ruben/campanas-rroca-ruben.json'), 'utf8')) as { anuncios: Array<{ id: string; titulares: string[]; angulo: string }> }).anuncios;
const ARTE_2 = ANUNCIOS.find((a) => a.id === 'mente-hace-cuentas')!;

const nuevo = (o: Opciones = {}): Mundo => { const w = crear(o); vigilarUx(w); return w; };
const fichaDe = (w: Mundo, tel = ANA): J => ((w.sd['ruben'] ?? {}) as J)[tel] as J;
const esBotonDeRuben = (t: ResultadoTurno): boolean => t.mensajes[0]?.payload['interactive']?.type === 'cta_url';
const titulos = (t: ResultadoTurno): string[] => ((t.mensajes[0]?.payload['interactive']?.action?.buttons ?? []) as J[]).map((b) => String(b['reply']?.title));
const salientes = (t: ResultadoTurno): J[] => t.llamadas.ingesta.filter((c) => c['direccion'] === 'saliente');
const PROHIBIDAS = /acreditad|verificad|validad|recibimos tu pago|pago (?:recibido|confirmado)|simulad/i;
const unico = (t: ResultadoTurno): string => { expect(t.mensajes).toHaveLength(1); return t.mensajes[0]!.cuerpo; };

describe('CASO (a) del PDF: una captura de anuncio SIN texto abre con SU ángulo', () => {
  const captura = (titular: string): Opciones['medio'] => ({ clasificacion: { categoria: 'publicidad', texto: '', titular_principal: titular, descripcion: '' } });
  const conAnuncios = (anuncios: J[], o: Opciones = {}): Mundo => nuevo({ panel: panelOk({ anuncios }), medio: captura(ARTE_2.titulares[0]!), ...o });

  it('como PRIMER mensaje: la presentación una vez y la apertura del modelo con el ángulo del anuncio como DATO; no el saludo genérico; UN mensaje; sin montos ni botones de producto', () => {
    const w = conAnuncios(ANUNCIOS, { modeloDice: 'Qué difícil es acostarse cansado mientras la mente sigue repasando el día. El libro enseña a bajar ese ruido con ejercicios sencillos. ¿Qué es lo que más te cuesta apagar por las noches?' });
    const t = hablar(w, ANA, mImagen({ caption: '' }));
    expect(t.fallo).toBeNull();
    const c = unico(t);
    expect(c).toMatch(/^¡Hola![^\n]*asistente virtual de Noches Sin Insomnio\./);
    expect(c).toMatch(/bajar ese ruido/);
    expect(c).not.toMatch(/¿Qué es lo que más te cuesta de tus noches: conciliar el sueño/);
    expect(c).not.toMatch(/\d+\s*Bs/);
    expect(titulos(t)).toEqual([]);
    expect(t.porNodo['Decidir turno']![0]!['plan']).toMatchObject({ tipo: 'angulo' });
    // El ángulo viaja al modelo como dato del anuncio (nunca en la instrucción de sistema).
    const ll = t.registro.find((r) => r.nodo === 'Conversar con el modelo')!;
    expect(JSON.stringify(ll.cuerpo!['contents'])).toContain(ARTE_2.angulo.slice(0, 40));
    expect(JSON.stringify(ll.cuerpo!['systemInstruction'])).not.toContain(ARTE_2.angulo.slice(0, 40));
    expect(salientes(t).some((s) => s['evento'] === 'qr_enviado')).toBe(false);
    expect(fichaDe(w)['saludado']).toBe(true);
  });

  it('cada arte de la campaña abre con SU ángulo (3 artes y la portada): el dato de la consola, no el código', () => {
    for (const a of ANUNCIOS) {
      const w = conAnuncios(ANUNCIOS, { medio: captura(a.titulares[0]!) });
      const t = hablar(w, ANA, mImagen({ caption: '' }));
      expect(t.porNodo['Decidir turno']![0]!['plan'], a.id).toMatchObject({ tipo: 'angulo' });
      const ll = t.registro.find((r) => r.nodo === 'Conversar con el modelo')!;
      expect(JSON.stringify(ll.cuerpo!['contents']), a.id).toContain(a.angulo.slice(0, 40));
    }
  });

  it('NEGANDO: con el modelo caído (o un texto rechazado: monto, promesa) sale el saludo FIJO, sin montos y UN solo mensaje; nunca una conversación vacía', () => {
    for (const modeloDice of ['cae', null, 'Con el Pack por 70 Bs duermes desde la primera noche.'] as const) {
      const w = conAnuncios(ANUNCIOS, { modeloDice });
      const t = hablar(w, ANA, mImagen({ caption: '' }));
      const c = unico(t);
      expect(c).toMatch(/asistente virtual de Noches Sin Insomnio/);
      expect(c).not.toMatch(/\d+\s*Bs|primera noche/);
      expect(t.avisos).toHaveLength(0);
    }
  });

  it('NEGANDO: un anuncio SIN ángulo (dato vacío) recibe el saludo fijo, sin modelo; un titular que no es de los anuncios no se reconoce como anuncio', () => {
    const sinAngulo = ANUNCIOS.map((a) => ({ ...a, angulo: '' }));
    const w = conAnuncios(sinAngulo);
    const t = hablar(w, ANA, mImagen({ caption: '' }));
    expect(t.ejecutados.has('Conversar con el modelo')).toBe(false);
    expect(unico(t)).toMatch(/asistente virtual de Noches Sin Insomnio/);
    const x = nuevo({ panel: panelOk({ anuncios: ANUNCIOS }), medio: captura('Oferta de zapatos de cuero') });
    const tx = hablar(x, ANA, mImagen({ caption: '' }));
    expect(tx.porNodo['Decidir turno']![0]!['plan']).not.toMatchObject({ tipo: 'angulo' });
  });

  it('el EJEMPLO 1 del PDF de punta a punta: captura, dolor y precio, botón del Pack, QR de 70 y comprobante válido con aviso a Rubén; UN mensaje por turno (cero de más)', () => {
    const w = conAnuncios(ANUNCIOS);
    const mensajes: ResultadoTurno[] = [];
    mensajes.push(hablar(w, ANA, mImagen({ caption: '' })));
    mensajes.push(hablar(w, ANA, mTexto('Exacto eso me pasa, me llevo todos los pendientes de la oficina a la cama. Pero soy pésimo para leer libros largos, ¿cómo funciona esto?')));
    const precios = hablar(w, ANA, mTexto('¿y cuánto cuesta?'));
    mensajes.push(precios);
    expect(titulos(precios)).toEqual(['Pack completo 70Bs', 'Libro con bono 35Bs', 'Solo audios']);
    const qr = hablar(w, ANA, mBoton('b_pack'));
    mensajes.push(qr);
    expect(qr.mensajes[0]!.tipo).toBe('image');
    expect(salientes(qr)[0]).toMatchObject({ evento: 'qr_enviado', monto: 70 });
    // El QR no nombra banco, cuenta ni titular.
    expect(qr.mensajes[0]!.cuerpo).not.toMatch(/banco|cuenta|titular|\d{9,}/i);
    w.dobles['Traer configuración'] = () => panelConQr(70, { anuncios: ANUNCIOS });
    w.dobles['Describir imagen'] = () => ({ content: { parts: [{ text: JSON.stringify(COMPROBANTE) }] } });
    const comp = hablar(w, ANA, mImagen());
    mensajes.push(comp);
    expect(comp.mensajes[0]!.cuerpo).toMatch(/Recibí tu comprobante y los datos coinciden/);
    expect(comp.mensajes[0]!.cuerpo).not.toMatch(PROHIBIDAS);
    expect(comp.avisos).toHaveLength(1);
    expect(comp.avisos[0]!.a).toBe(REC);
    expect(comp.avisos[0]!.cuerpo).not.toMatch(PROHIBIDAS);
    for (const t of mensajes) expect(t.mensajes.length).toBeLessThanOrEqual(1);
  });
});

describe('CASO (b) del PDF: «¿precio y devolución?» da el precio Y deriva, en un solo mensaje', () => {
  it('el ejemplo 2 (primer mensaje): presentación, los precios del catálogo, la derivación de la garantía, el botón de Rubén y el aviso; sin QR y sin prometer una devolución', () => {
    const w = nuevo();
    const t = hablar(w, ANA, mTexto('Hola, vi el video en Facebook. ¿Qué precio tiene y qué pasa si lo compro y siento que no me sirve, hay devolución?'));
    const c = unico(t);
    expect(c).toMatch(/asistente virtual de Noches Sin Insomnio/);
    expect(c).toMatch(/70 Bs/);
    expect(c).toMatch(/35 Bs/);
    expect(c).toMatch(/garantía o devolución, eso lo responde Rubén directamente/);
    expect(c).not.toMatch(/\b(?:sí|si),? (?:hay|tienes|puedes)\b[^.]*devoluci|te devolvemos|te devuelvo|reembols/i);
    expect(esBotonDeRuben(t)).toBe(true);
    expect(t.avisos).toHaveLength(1);
    expect(t.avisos[0]!.a).toBe(REC);
    // La CLAVE y el motivo del aviso son los de la garantía (no `no_supo`), y un segundo «¿precio y devolución?» dentro de 30 minutos no repite el aviso.
    expect(t.porNodo['Decidir turno']![0]!['plan']).toMatchObject({ tipo: 'derivar', clave: 'garantia', aviso: { clave: 'garantia', motivo: 'garantía o devolución' } });
    expect(t.porNodo['Armar avisos']![0]).toMatchObject({ clave: 'garantia', planeado: true });
    const otra = hablar(w, ANA, mTexto('perdón, ¿precio y devolución?'));
    expect(otra.avisos).toHaveLength(0);
    expect(esBotonDeRuben(otra)).toBe(true);
    expect(t.mensajes.some((m) => m.tipo === 'image')).toBe(false);
    expect(t.ejecutados.has('Conversar con el modelo')).toBe(false);
    expect(fichaDe(w)['saludado']).toBe(true);
  });

  it('«vi el video, ¿precio y devolución?» (corto) también; con un producto nombrado dice el precio de ESE producto', () => {
    const corto = hablar(nuevo(), ANA, mTexto('vi el video, ¿precio y devolución?'));
    expect(unico(corto)).toMatch(/70 Bs/);
    expect(esBotonDeRuben(corto)).toBe(true);
    const libro = hablar(nuevo(), ANA, mTexto('¿cuánto cuesta el libro y hay devolución?'));
    expect(unico(libro)).toMatch(/cuesta 35 Bs/);
    expect(unico(libro)).not.toMatch(/70 Bs/);
    expect(esBotonDeRuben(libro)).toBe(true);
  });

  it('NEGANDO: la devolución SIN pregunta de precio no trae montos; con un precio caído del catálogo no se inventa ninguno; el aviso no dice «validado»', () => {
    const sola = hablar(nuevo(), ANA, mTexto('¿hay devolución?'));
    expect(unico(sola)).not.toMatch(/\d+\s*Bs/);
    expect(esBotonDeRuben(sola)).toBe(true);
    const sinPrecios = hablar(nuevo({ panel: panelOk({ catalogo: [] }) }), ANA, mTexto('¿precio y devolución?'));
    expect(unico(sinPrecios)).not.toMatch(/\d+\s*Bs/);
    for (const t of [sola, sinPrecios]) for (const a of t.avisos) expect(a.cuerpo).not.toMatch(PROHIBIDAS);
  });

  it('una consulta de otro medio de pago o de volumen con precio también lo da; la crisis y la pregunta médica NO traen precio', () => {
    const volumen = hablar(nuevo(), ANA, mTexto('¿cuánto cuesta el pack? quiero comprar para revender'));
    expect(unico(volumen)).toMatch(/70 Bs/);
    const medica = hablar(nuevo(), ANA, mTexto('¿cuánto cuesta el libro? ¿cuánto clonazepam puedo tomar?'));
    expect(unico(medica)).not.toMatch(/\d+\s*Bs/);
  });
});

describe('CASOS (c) y (d) del PDF: no garantiza; dos preguntas juntas en UN solo mensaje', () => {
  it('(c) «¿me garantizan dormir?»: no garantiza, menciona el plan de 21 días, sin modelo y sin aviso', () => {
    const w = nuevo();
    hablar(w, ANA, mTexto('hola'));
    const t = hablar(w, ANA, mTexto('¿me garantizan que con esto voy a dormir?'));
    const c = unico(t);
    expect(c).toMatch(/No puedo prometerte/);
    expect(c).toMatch(/plan de 21 días/);
    expect(c).not.toMatch(/garantizado|te garantizo|desde la primera noche|sin pastillas|cura/i);
    expect(t.ejecutados.has('Conversar con el modelo')).toBe(false);
    expect(t.avisos).toHaveLength(0);
  });

  it('(d) duración de los audios + garantía: UN solo mensaje con las dos respuestas (7, 7 y 5 minutos, voz sintética, no garantiza)', () => {
    const w = nuevo();
    hablar(w, ANA, mTexto('hola'));
    const t = hablar(w, ANA, mTexto('Ah qué bueno que tenga audio. ¿Pero los audios duran mucho? ¿Y me garantizan que con eso ya duermo toda la noche?'));
    const c = unico(t);
    expect(c).toMatch(/7 minutos/);
    expect(c).toMatch(/5/);
    expect(c).toMatch(/voz sintética/);
    expect(c).toMatch(/No puedo prometerte/);
    expect(c).toMatch(/21 días/);
    expect(t.ejecutados.has('Conversar con el modelo')).toBe(false);
  });

  it('(d) precio + garantía: el precio y la respuesta de resultado en el MISMO mensaje; la sesión sigue siendo de ese teléfono', () => {
    const w = nuevo();
    const t = hablar(w, ANA, mTexto('¿cuánto cuesta el libro y me garantizan que voy a dormir?'));
    const c = unico(t);
    expect(c).toMatch(/cuesta 35 Bs/);
    expect(c).toMatch(/No puedo prometerte/);
    expect(c).toMatch(/asistente virtual/);
    expect(c).not.toMatch(/70 Bs/);
  });

  it('(d) NEGANDO: una respuesta del modelo con DOS preguntas se rechaza y cae al texto fijo (nunca dos preguntas en un mensaje); y precio + duración en uno', () => {
    const w = nuevo({ modeloDice: 'Entiendo lo que cuentas. ¿Desde cuándo te pasa? ¿Y qué has probado?' });
    hablar(w, ANA, mTexto('hola'));
    const t = hablar(w, ANA, mTexto('me despierto a las 3 y además mi jefe me escribe de noche'));
    expect((unico(t).match(/\?/g) ?? []).length).toBeLessThanOrEqual(1);
    const p = hablar(nuevo(), BETO_DE_PRUEBA, mTexto('¿cuánto cuesta el audiolibro y cuánto duran los audios?'));
    expect(unico(p)).toMatch(/cuesta 35 Bs/);
    expect(unico(p)).toMatch(/7 minutos/);
  });
});

const BETO_DE_PRUEBA = '59100000022';

describe('la crisis se levanta sola: vence a las 48 h de la ÚLTIMA SEÑAL, no del último mensaje', () => {
  const HORA = 60;
  const hablarTras = (w: Mundo, horas: number, texto: string): ResultadoTurno => { w.avanzar(horas * HORA); return hablar(w, ANA, mTexto(texto)); };
  const esCrisis = (t: ResultadoTurno): boolean => /Siento mucho que estés pasando por esto/.test(t.mensajes[0]?.cuerpo ?? '');
  const noContactar = (t: ResultadoTurno): boolean => salientes(t).some((c) => c['evento'] === 'no_contactar');

  it('la ficha guarda cuándo fue la señal (`riesgoMs`); un mensaje que NO es una señal no la renueva', () => {
    const w = nuevo();
    hablar(w, ANA, mTexto('hola'));
    const t0 = hablar(w, ANA, mTexto('ya no quiero vivir'));
    expect(esCrisis(t0)).toBe(true);
    const ms0 = fichaDe(w)['riesgoMs'] as number;
    expect(ms0).toBeGreaterThan(0);
    const t1 = hablarTras(w, 10, 'gracias');
    expect(esCrisis(t1)).toBe(true);
    expect(noContactar(t1)).toBe(true);
    expect(fichaDe(w)['riesgoMs']).toBe(ms0);
  });

  it('NEGANDO: dentro de las 48 h la crisis SIGUE cortando la venta (no hay libro, precio ni QR aunque pida comprar)', () => {
    const w = nuevo();
    hablar(w, ANA, mTexto('hola'));
    hablar(w, ANA, mTexto('quiero morir'));
    for (const [h, msg] of [[1, 'quiero comprar el libro'], [20, '¿cuánto cuesta el pack?'], [20, 'me llevo el pack']] as Array<[number, string]>) {
      const t = hablarTras(w, h, msg);
      expect(esCrisis(t), msg).toBe(true);
      expect(unico(t)).not.toMatch(/\d+\s*Bs|QR|Pack/);
      expect(t.mensajes.some((m) => m.tipo === 'image')).toBe(false);
      expect(esBotonDeRuben(t)).toBe(true);
    }
  });

  it('pasadas 48 h de la ÚLTIMA SEÑAL (aunque el último mensaje sea de hace poco) la protección se levanta y la venta vuelve; antes, no', () => {
    const w = nuevo();
    hablar(w, ANA, mTexto('hola'));
    hablar(w, ANA, mTexto('quiero morir'));
    expect(esCrisis(hablarTras(w, 40, 'gracias'))).toBe(true);   // 40 h de la señal
    const justo = hablarTras(w, 7, 'ok');                         // 47 h: todavía
    expect(esCrisis(justo)).toBe(true);
    const t = hablarTras(w, 2, 'hola, quiero el libro');          // 49 h de la señal, 2 h del último mensaje
    expect(esCrisis(t)).toBe(false);
    expect(fichaDe(w)['riesgo']).toBe(false);
    expect(fichaDe(w)['riesgoMs']).toBe(0);
    expect(t.mensajes[0]!.tipo).toBe('image');   // vuelve la venta: el QR del libro
  });

  it('NEGANDO: una señal NUEVA reinicia el plazo (a las 40 h otra frase de crisis: a las 49 h de la primera sigue la protección)', () => {
    const w = nuevo();
    hablar(w, ANA, mTexto('hola'));
    hablar(w, ANA, mTexto('quiero morir'));
    const ms0 = fichaDe(w)['riesgoMs'] as number;
    const t40 = hablarTras(w, 40, 'ya no quiero vivir');
    expect(esCrisis(t40)).toBe(true);
    expect(fichaDe(w)['riesgoMs'] as number).toBeGreaterThan(ms0);
    expect(esCrisis(hablarTras(w, 9, 'hola, quiero el libro'))).toBe(true);   // 49 h de la primera, 9 h de la segunda señal
    expect(esCrisis(hablarTras(w, 38, 'quiero el libro'))).toBe(true);        // 47 h de la segunda
    expect(esCrisis(hablarTras(w, 2, 'quiero el libro'))).toBe(false);        // 49 h de la segunda señal: se levantó
  });

  it('NEGANDO: dentro del plazo, quien sigue mal con palabras que ninguna lista reconoce («sigo igual de mal») RENUEVA el plazo; «gracias», «ok», «el libro» o «precio» no', () => {
    const w = nuevo();
    hablar(w, ANA, mTexto('hola'));
    hablar(w, ANA, mTexto('quiero morir'));
    const ms0 = fichaDe(w)['riesgoMs'] as number;
    for (const neutro of ['gracias', 'ok', 'listo', 'el libro', 'precio', '¿cuánto cuesta el pack?']) {
      hablarTras(w, 1, neutro);
      expect(fichaDe(w)['riesgoMs'], neutro).toBe(ms0);
    }
    expect(esCrisis(hablarTras(w, 40, 'sigo igual de mal'))).toBe(true);
    expect(fichaDe(w)['riesgoMs'] as number).toBeGreaterThan(ms0);
    expect(esCrisis(hablarTras(w, 9, 'quiero el libro'))).toBe(true);   // 49 h de la primera señal, 9 h de la renovación
    expect(esCrisis(hablarTras(w, 40, 'quiero el libro'))).toBe(false); // 49 h de la renovación
  });

  it('NEGANDO: un `riesgoMs` en el futuro (reloj adelantado) no alarga la protección más de 48 h desde ahora', () => {
    const w = nuevo();
    hablar(w, ANA, mTexto('hola'));
    hablar(w, ANA, mTexto('quiero morir'));
    ((w.sd['ruben'] as J)[ANA] as J)['riesgoMs'] = Number.MAX_SAFE_INTEGER;
    expect(esCrisis(hablarTras(w, 1, 'gracias'))).toBe(true);
    expect(esCrisis(hablarTras(w, 30, 'ok'))).toBe(true);
    expect(esCrisis(hablarTras(w, 19, 'quiero el libro'))).toBe(false);   // 49 h desde que se leyó la señal futura
  });

  it('la marca RIESGO del modelo también es una señal (fija el plazo) y levantada la protección una frase de venta no la reactiva', () => {
    const w = nuevo({ modeloDice: 'RIESGO' });
    hablar(w, ANA, mTexto('hola'));
    const t = hablar(w, ANA, mTexto('últimamente todo me pesa demasiado y no sé qué hacer'));
    expect(esCrisis(t)).toBe(true);
    expect(fichaDe(w)['riesgoMs'] as number).toBeGreaterThan(0);
  });

  it('las variantes del PR-2: «ya no aguanto más mi insomnio» NO es crisis (se conversa) y «me tomé muchas pastillas para dormir todas juntas» SÍ, con `no_contactar`', () => {
    const w = nuevo();
    hablar(w, ANA, mTexto('hola'));
    const fp = hablar(w, ANA, mTexto('ya no aguanto más mi insomnio'));
    expect(esCrisis(fp)).toBe(false);
    expect(fichaDe(w)['riesgo']).toBe(false);
    const c = hablar(w, ANA, mTexto('me tomé muchas pastillas para dormir todas juntas'));
    expect(esCrisis(c)).toBe(true);
    expect(noContactar(c)).toBe(true);
    expect(c.avisos).toHaveLength(1);
    expect(c.avisos[0]!.cuerpo).not.toMatch(/pastillas|todas juntas/i);
  });
});

describe('objeciones por código: «lo voy a pensar» y la muestra de voz', () => {
  /** Dos mensajes de conversación (la compuerta de las opciones abierta) y «lo voy a pensar». */
  const pensando = (w: Mundo): ResultadoTurno => { hablar(w, ANA, mTexto('hola')); hablar(w, ANA, mTexto('me despierto a las 3 todas las noches')); return hablar(w, ANA, mTexto('lo voy a pensar')); };
  it('«lo voy a pensar»: sin presión, con los DOS precios del catálogo, sin QR, sin modelo, sin botones y sin pregunta', () => {
    const w = nuevo();
    hablar(w, ANA, mTexto('hola'));
    hablar(w, ANA, mTexto('me despierto a las 3 todas las noches'));
    const t = hablar(w, ANA, mTexto('mmm lo voy a pensar'));
    const c = unico(t);
    expect(c).toMatch(/sin ninguna presión/);
    expect(c).toMatch(/35 Bs/);
    expect(c).toMatch(/70 Bs/);
    expect(c).not.toMatch(/\?/);
    expect(titulos(t)).toEqual([]);
    expect(t.mensajes[0]!.tipo).not.toBe('image');
    expect(t.ejecutados.has('Conversar con el modelo')).toBe(false);
    expect(salientes(t).some((s) => s['evento'] === 'qr_enviado')).toBe(false);
  });

  it('NEGANDO: antes de la charla (sin las opciones habilitadas) «lo voy a pensar» no trae montos: lo contesta el modelo', () => {
    const t = hablar(nuevo(), ANA, mTexto('lo voy a pensar'));
    expect(unico(t)).not.toMatch(/\d+\s*Bs/);
  });

  it('NEGANDO: los precios del texto son los del catálogo (cambian con él) y un catálogo sin precios no inventa ninguno', () => {
    const catalogo = [{ id: 'pack-completo', nombre: 'Pack completo', precio: 80 }, { id: 'libro-con-bono', nombre: 'Libro con bono', precio: 40 }];
    const t = pensando(nuevo({ panel: panelOk({ catalogo }) }));
    expect(unico(t)).toMatch(/40 Bs/);
    expect(unico(t)).toMatch(/80 Bs/);
    expect(unico(t)).not.toMatch(/35 Bs|70 Bs/);
    const sin = pensando(nuevo({ panel: panelOk({ catalogo: [{ id: 'pack-completo', nombre: 'Pack completo', precio: 70, agotado: true }, { id: 'libro-con-bono', nombre: 'Libro', precio: 35, agotado: true }] }) }));
    expect(unico(sin)).not.toMatch(/\d+\s*Bs/);
  });

  it('la muestra de voz SOLO si la piden: 50 segundos de «Cierra el día», voz sintética, sin enlaces; sin pedirla, nada de eso', () => {
    const w = nuevo();
    hablar(w, ANA, mTexto('hola'));
    const t = hablar(w, ANA, mTexto('¿puedo escuchar una muestra de la voz antes de comprar?'));
    const c = unico(t);
    expect(c).toMatch(/50 segundos/);
    expect(c).toMatch(/Cierra el día/);
    expect(c).toMatch(/voz sintética/);
    expect(c).not.toMatch(/https?:|www\.|\.com|\.bo\b/i);
    const sin = hablar(nuevo(), ANA, mTexto('quiero contarte cómo duermo'));
    expect(unico(sin)).not.toMatch(/50 segundos|Escucha un fragmento/);
  });

  it('NEGANDO: el modelo no habla de la web ni de enlaces, ni vende el bono suelto, ni da precios: cualquiera de esos textos cae al respaldo fijo', () => {
    for (const modeloDice of [
      'Puedes escuchar un fragmento en nuestra página web. ¿Te cuento más?',
      'Claro, el bono se vende suelto por 10 Bs. ¿Lo quieres?',
      'Mira esto: https://ejemplo.com/muestra ¿Qué te parece?',
      'El libro cuesta 35 Bs y el pack 70 Bs. ¿Cuál prefieres?',
    ]) {
      const w = nuevo({ modeloDice });
      hablar(w, ANA, mTexto('hola'));
      const t = hablar(w, ANA, mTexto('cuéntame un poco más del bono de regalo'));
      expect(unico(t), modeloDice).not.toMatch(/suelto|https?:|nuestra página|10 Bs|35 Bs y el pack/);
    }
  });
});

describe('el prompt del modelo: la base de conocimiento, las reglas de salud y la transparencia', () => {
  const L = cargarLibrerias('RR_PROMPT') as { RR_PROMPT: string };
  const p = L.RR_PROMPT;
  it('cabe en el tope de 4.670 caracteres (el mismo de Antonio) y trae los datos del libro', () => {
    expect(p.length).toBeLessThanOrEqual(4670);
    for (const dato of [/208 páginas/, /14 eslabones/, /ejercicio por eslabón/, /Diario del sueño/, /registro semanal/, /Anexo C/, /plan de 21 días/, /18 páginas/, /5 pasos/, /14 capítulos/, /Cierra el día/, /Suelta el cuerpo/, /Si despiertas de madrugada/, /pago único/, /sin suscripción/]) expect(p).toMatch(dato);
  });
  it('el bono es un REGALO que no se vende suelto; el audio lleva voz sintética y el libro se hizo con apoyo de IA; sin testimonios', () => {
    expect(p).toMatch(/REGALO[^.]*NO se vende suelto/);
    expect(p).toMatch(/voz sintética/);
    expect(p).toMatch(/apoyo de inteligencia artificial/);
    expect(p).toMatch(/No inventes testimonios/);
    expect(p).toMatch(/eres un asistente virtual con inteligencia artificial/);
  });
  it('las objeciones y las reglas de salud de la base: no curar, no promesas, no consejo médico, no suspender medicación, no diagnosticar, cuándo ver a un profesional', () => {
    for (const dato of [/ya probé de todo/i, /no hay plazo garantizado/, /plan de 21 días es para practicar/, /no es médico/, /no reemplaza una consulta/, /No diagnostiques/, /NO debe suspender ni cambiar nada/, /no des dosis/, /muchas semanas/, /ronquidos fuertes/, /ansiedad intensa/, /tristeza persistente/, /\(«Cuándo pedir ayuda»\)/, /nada de «curar»/, /RIESGO/, /DERIVAR/]) expect(p).toMatch(dato);
  });
  it('NEGANDO: el prompt no lleva precios, montos ni descuentos, ni banco, cuenta, titular ni números largos, ni repite «sin depender de pastillas», ni afirma «curar» o «garantizado» como algo propio', () => {
    expect(p).not.toMatch(/\b\d+\s*Bs\b|\bBs\.?\s*\d|bolivianos|\$|descuento de|\b\d{7,}\b/);
    expect(p).not.toMatch(/Mercantil|Ichazo|1006|sin depender de pastillas/i);
    // Las únicas menciones de «sin pastillas», «curar» y «garantizado» son prohibiciones.
    for (const m of p.matchAll(/[^.]*(?:sin pastillas|curar|garantizado)[^.]*\./g)) expect(m[0], m[0]).toMatch(/No prometas|nada de|garantizado/);
  });
  it('el prompt llega al modelo como instrucción del sistema, junto con el nombre del negocio de la consola', () => {
    const w = nuevo();
    hablar(w, ANA, mTexto('hola'));
    const t = hablar(w, ANA, mTexto('me cuesta dormir'));
    const ll = t.registro.find((r) => r.nodo === 'Conversar con el modelo')!;
    const sistema = String((ll.cuerpo!['systemInstruction'] as J)['parts'][0]['text']);
    expect(sistema.startsWith(p)).toBe(true);
    expect(sistema).toMatch(/Nombre del negocio: Noches Sin Insomnio/);
  });
});

describe('el aviso a Rubén y el upgrade, otra vez negando', () => {
  it('el aviso de un comprobante que cuadra, el de una derivación y el de la crisis NO dicen «validado», «acreditado» ni «verificado»', () => {
    const w = nuevo({ panel: panelConQr(35), medio: { clasificacion: COMPROBANTE } });
    const comp = hablar(w, ANA, mImagen());
    const der = hablar(nuevo(), ANA, mTexto('quiero comprar 50 copias para revender'));
    const cri = hablar(nuevo(), ANA, mTexto('ya no quiero vivir'));
    for (const t of [comp, der, cri]) {
      expect(t.avisos.length).toBeGreaterThan(0);
      for (const a of t.avisos) expect(a.cuerpo).not.toMatch(PROHIBIDAS);
      for (const m of t.mensajes) expect(m.cuerpo).not.toMatch(PROHIBIDAS);
    }
  });

  it('el botón de Rubén solo sale al derivar: una charla, un precio y un «lo voy a pensar» no lo traen', () => {
    const w = nuevo();
    hablar(w, ANA, mTexto('hola'));
    for (const msg of ['me despierto a las 3', '¿cuánto cuesta el libro?', 'lo voy a pensar']) expect(esBotonDeRuben(hablar(w, ANA, mTexto(msg))), msg).toBe(false);
  });
});
