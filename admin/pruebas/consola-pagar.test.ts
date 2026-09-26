/**
 * LA PANTALLA «PAGAR» Y EL RESUMEN DEL PREPAGO EN LA CONSOLA (bloque A-3).
 *
 * Lo que estas pruebas defienden, y por qué cada una existe:
 *
 *  1. LA CONSOLA NO CALCULA IMPORTES. La vista previa sale de `importeBs` y
 *     `tipoCambioVigente` del módulo del servidor. Si alguien la reemplazara
 *     por una multiplicación propia, el importe de la pantalla y el del QR
 *     podrían diferir, y la diferencia recién se vería en el banco.
 *  2. SIN TIPO DE CAMBIO NO HAY CIFRA. `montoBs` queda en `null` y el botón se
 *     deshabilita: el servidor también rechaza («No hay tipo de cambio del
 *     día»), y un importe estimado sería un número falso sobre el que el
 *     comercio decide.
 *  3. UN CORTE OBSERVADO NO SE LE MUESTRA AL COMERCIO. En modo observación el
 *     servidor anota `aplicado: false` para medir. Decirle «su servicio está
 *     cortado» mientras su asistente responde con normalidad es informar mal.
 *  4. LA PANTALLA NO ESCRIBE EN FIRESTORE. Emitir, consultar y anular son
 *     callables; las reglas niegan toda escritura del navegador sobre
 *     `/pagos` y `/cuenta`.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BOLSA, INSTALACION_USD, MESES_MAXIMO, PLANES, importeBs } from '../functions/src/prepago';
import {
  BOLSAS_POSIBLES, ESTADO_DEL_COBRO, MESES_POSIBLES, cobroSeMuestraParaPagar, mesEscrito, pideVolverAEntrar, planInicial,
  planesOfrecidos, vistaDelPedido,
} from '../web/src/lib/pagar';
import { PLANES_PUBLICADOS } from '../functions/src/planes';
import { facturaMetaAlComercio } from '../web/src/lib/ejes';
import { ResumenPrepago } from '../web/src/componentes/ResumenPrepago';
import { estadoDeServicio, type Corte } from '../functions/src/prepago';

const aqui = dirname(fileURLToPath(import.meta.url));
const leer = (ruta: string) => readFileSync(join(aqui, '..', ruta), 'utf8');

/** El cuerpo del archivo sin sus comentarios: lo que de verdad se muestra. */
const sinComentarios = (fuente: string) => fuente
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const desdeWeb = createRequire(join(aqui, '..', 'web', 'package.json'));
const { createElement } = desdeWeb('react') as { createElement: (c: unknown, p: unknown) => unknown };
const { renderToStaticMarkup } = desdeWeb('react-dom/server') as { renderToStaticMarkup: (e: unknown) => string };

/** 15 de octubre de 2026, 12:00 de Bolivia. */
const AHORA = Date.UTC(2026, 9, 15, 16, 0, 0);
const TC = { tco: 12.6, fecha: '2026-10-15', fuente: 'BCB' };

describe('vistaDelPedido: el importe es el del servidor, o no hay importe', () => {
  it('la mensualidad se cobra en bolivianos con el MISMO importeBs del servidor', () => {
    const v = vistaDelPedido({ modalidad: 'prepago', plan: 'pro' },
      { tipo: 'mensualidad', plan: 'pro', meses: 2 }, TC, AHORA)!;
    expect(v.montoUsd).toBe(PLANES.pro.precioUsd * 2);
    expect(v.montoBs).toBe(importeBs(PLANES.pro.precioUsd * 2, TC.tco));
    expect(v.tipoCambio).toEqual(TC);
  });

  it('la bolsa y la instalación usan los precios del catálogo, no números escritos a mano', () => {
    expect(vistaDelPedido({}, { tipo: 'bolsa', cantidad: 3 }, TC, AHORA)!.montoUsd)
      .toBe(BOLSA.precioUsd * 3);
    expect(vistaDelPedido({}, { tipo: 'instalacion' }, TC, AHORA)!.montoUsd).toBe(INSTALACION_USD);
  });

  it('sin tipo de cambio vigente NO inventa una cifra: montoBs es null', () => {
    for (const malo of [null, undefined, {}, { tco: 12.6, fecha: '2026-09-01', fuente: 'BCB' }]) {
      const v = vistaDelPedido({}, { tipo: 'mensualidad', plan: 'impulso', meses: 1 }, malo, AHORA)!;
      expect(v.montoBs, `con ${JSON.stringify(malo)}`).toBeNull();
      expect(v.tipoCambio).toBeNull();
      // El precio de lista sí se muestra: está en dólares y no depende del TCO.
      expect(v.montoUsd).toBe(PLANES.impulso.precioUsd);
    }
  });

  it('un tipo de cambio fuera de la cota de cordura no vale: se cobra mal o no se cobra', () => {
    const v = vistaDelPedido({}, { tipo: 'instalacion' }, { tco: 126, fecha: '2026-10-15', fuente: 'BCB' }, AHORA)!;
    expect(v.montoBs).toBeNull();
  });

  it('un pedido inválido no produce vista (y el botón no tiene qué emitir)', () => {
    expect(vistaDelPedido({}, { tipo: 'mensualidad', plan: 'pro', meses: 7 } as never, TC, AHORA)).toBeNull();
    expect(vistaDelPedido({}, { tipo: 'bolsa', cantidad: 0 } as never, TC, AHORA)).toBeNull();
    expect(vistaDelPedido({}, { tipo: 'demostracion' } as never, TC, AHORA)).toBeNull();
  });

  it('dice hasta cuándo quedaría cubierto, con la regla del servidor', () => {
    // Octubre ya pagado: un mes más cubre noviembre, no octubre otra vez.
    const v = vistaDelPedido({ modalidad: 'prepago', plan: 'impulso', periodoPagado: '2026-10' },
      { tipo: 'mensualidad', plan: 'impulso', meses: 1 }, TC, AHORA)!;
    expect(v.cubiertoHasta).toBe('2026-11');
  });

  it('los seis meses suman la bolsa de regalo, y se dice', () => {
    const v = vistaDelPedido({ modalidad: 'prepago', plan: 'impulso' },
      { tipo: 'mensualidad', plan: 'impulso', meses: MESES_MAXIMO }, TC, AHORA)!;
    expect(v.conRegalo).toBe(true);
    expect(v.bolsa).toBe(BOLSA.conversaciones);
    const cinco = vistaDelPedido({ modalidad: 'prepago', plan: 'impulso' },
      { tipo: 'mensualidad', plan: 'impulso', meses: MESES_MAXIMO - 1 }, TC, AHORA)!;
    expect(cinco.conRegalo).toBe(false);
    expect(cinco.bolsa).toBe(0);
  });
});

describe('las opciones que ofrece la pantalla salen del catálogo', () => {
  // NO SE ESCRIBE LA LISTA A MANO. El 23/09 apareció `byoc` en el catálogo y
  // una prueba con los tres nombres escritos se cayó sin que nada estuviera
  // mal: lo que hay que fijar es la REGLA, no el contenido de ese día
  // (`CLAUDE.md` §7.4, «el límite se lee del plan, no se escribe en el código»).
  it('ofrece exactamente los planes publicados, en el orden del sitio', () => {
    expect(planesOfrecidos({})).toEqual([...PLANES_PUBLICADOS]);
    expect(planesOfrecidos(null)).toEqual([...PLANES_PUBLICADOS]);
  });

  it('nunca ofrece el plan de demostración: no se vende ni se paga', () => {
    for (const cuenta of [{}, { plan: 'demostracion' }, { modalidad: 'demostracion', plan: 'demostracion' }]) {
      expect(planesOfrecidos(cuenta) as readonly string[]).not.toContain('demostracion');
    }
    expect(planInicial({ plan: 'demostracion' })).toBe('impulso');
  });

  it('a un comercio con un plan que NO se publica le ofrece también el suyo', () => {
    // Si no estuviera, renovar lo sacaría de su plan sin que nadie lo decida:
    // pagar una mensualidad fija el plan (`aplicarPago`).
    const noPublicados = (Object.keys(PLANES) as (keyof typeof PLANES)[])
      .filter((p) => !(PLANES_PUBLICADOS as readonly string[]).includes(p));
    for (const p of noPublicados) {
      const ofrecidos = planesOfrecidos({ plan: p });
      expect(ofrecidos, `el plan ${p} tiene que poder renovarse`).toContain(p);
      expect(ofrecidos.length).toBe(PLANES_PUBLICADOS.length + 1);
      // Y el suyo es el que viene marcado.
      expect(planInicial({ plan: p })).toBe(p);
    }
    // La prueba solo vale si de verdad hay alguno: hoy es BYOC.
    expect(noPublicados.length).toBeGreaterThan(0);
  });

  it('un plan publicado no se duplica cuando ya es el del comercio', () => {
    for (const p of PLANES_PUBLICADOS) {
      expect(planesOfrecidos({ plan: p })).toEqual([...PLANES_PUBLICADOS]);
      expect(planInicial({ plan: p })).toBe(p);
    }
  });

  it('dice si Meta le factura el consumo al comercio: lo decide la TITULARIDAD de sus números, no el plan', () => {
    // `Analisis/41` §4: BYOC deja de ser un plan; es titularidad `comercio` más
    // un plan. La pantalla lo avisa mirando cada `rutasWhatsApp/{n}`.
    // Los números llegan de `ejesDeCuenta.numeros` (el comercio no lee
    // `rutasWhatsApp`); los dos `{ ... }` sin titularidad son de antes de F1.
    const propio = { phoneNumberId: '1', titularidad: 'comercio' };
    const provisto = { phoneNumberId: '2', titularidad: 'novuchat' };
    const sinDato = { phoneNumberId: '3' };
    expect(facturaMetaAlComercio([])).toBe(false);
    expect(facturaMetaAlComercio([provisto, sinDato])).toBe(false);
    expect(facturaMetaAlComercio([provisto, propio])).toBe(true);
    // Y el plan ya no dice nada al respecto: ni `pagaMeta`, ni el nombre BYOC,
    // ni el viejo `paganEllosAMeta(plan)`.
    expect(sinComentarios(leer('web/src/lib/pagar.ts'))).not.toMatch(/\bpagaMeta\b|paganEllosAMeta/);
    expect(sinComentarios(leer('web/src/paginas/Pagar.tsx'))).not.toMatch(/\bpagaMeta\b|'byoc'|paganEllosAMeta/);
  });

  it('los meses y las bolsas son los topes del servidor, no listas escritas a mano', () => {
    expect(MESES_POSIBLES).toEqual([1, 2, 3, 4, 5, 6]);
    expect(MESES_POSIBLES.at(-1)).toBe(MESES_MAXIMO);
    expect(BOLSAS_POSIBLES.at(-1)).toBe(12);
  });

  it('mesEscrito escribe el mes en palabras, y no se rompe con basura', () => {
    expect(mesEscrito('2026-09')).toBe('septiembre de 2026');
    expect(mesEscrito('2026-12')).toBe('diciembre de 2026');
    expect(mesEscrito('')).toBe('—');
    expect(mesEscrito('2026-9')).toBe('—');
  });
});

describe('ResumenPrepago: el corte observado no existe para el comercio, y se llama «producción»', () => {
  const dibujar = (cuenta: Record<string, unknown>, consumidas: number, corte: Corte | null) =>
    renderToStaticMarkup(createElement(ResumenPrepago, {
      servicio: estadoDeServicio(cuenta, consumidas, AHORA), corte,
    }));

  const corteObservado: Corte = {
    motivo: 'sin_pago', desdeMs: AHORA - 3 * 86_400_000, perdidas: 7, mensajesPerdidos: 19, aplicado: false,
  };
  const corteAplicado: Corte = { ...corteObservado, aplicado: true };
  const cuentaVencida = { modalidad: 'prepago', plan: 'impulso', periodoPagado: '2026-08' };

  it('con el corte en observación no dice «cortado desde» ni cuenta clientes perdidos', () => {
    const html = dibujar(cuentaVencida, 10, corteObservado);
    expect(html).not.toContain('Servicio cortado desde');
    expect(html).not.toContain('sin atender');
    expect(html).not.toContain('7 personas');
    // Sí dice que el mes venció: eso es cierto y es lo que lo mueve a pagar.
    expect(html).toContain('venció');
  });

  it('con el corte aplicado sí lo dice, con la fecha y los clientes que escribieron', () => {
    const html = dibujar(cuentaVencida, 10, corteAplicado);
    expect(html).toContain('Servicio cortado desde');
    expect(html).toContain('7 personas distintas escribieron');
  });

  it('en gracia avisa la cortesía y no habla de corte', () => {
    // Vencido hace pocas horas: dentro de las 48 h de gracia.
    const recien = Date.UTC(2026, 9, 1, 10, 0, 0);
    const html = renderToStaticMarkup(createElement(ResumenPrepago, {
      servicio: estadoDeServicio({ modalidad: 'prepago', plan: 'impulso', periodoPagado: '2026-09' }, 5, recien),
      corte: null,
    }));
    expect(html).toContain('cortesía');
    expect(html).not.toContain('cortado');
  });

  it('muestra el saldo con las bolsas, que es lo que de verdad le queda', () => {
    const html = dibujar({ modalidad: 'prepago', plan: 'impulso', periodoPagado: '2026-10', bolsa: 30 }, 40, null);
    expect(html).toContain(`de ${PLANES.impulso.conversaciones} incluidas`);
    expect(html).toContain('30 en bolsas');
    expect(html).toContain('90'); // 100 - 40 + 30
  });

  it('al comercio se le dice «producción», nunca «prepago» (Analisis/41 §6.1 punto 6)', () => {
    const html = dibujar({ modalidad: 'prepago', plan: 'impulso', periodoPagado: '2026-10' }, 1, null);
    expect(html).toContain('Su servicio en producción');
    expect(html.toLowerCase()).not.toContain('prepago');
  });
});

describe('la pantalla no escribe, y no promete lo que no sabe', () => {
  const pagar = leer('web/src/paginas/Pagar.tsx');

  it('no usa setDoc, updateDoc, addDoc ni deleteDoc: emitir y anular son callables', () => {
    for (const escritura of ['setDoc', 'updateDoc', 'addDoc', 'deleteDoc', 'writeBatch', 'runTransaction']) {
      expect(pagar, `Pagar.tsx no debe llamar a ${escritura}`).not.toContain(escritura);
    }
    for (const callable of ['crearCobroPrepago', 'consultarPagoPendiente', 'anularPagoPendiente']) {
      expect(pagar).toContain(callable);
    }
  });

  it('nunca dice que un pago está acreditado o verificado (prohibición 3 de CLAUDE.md)', () => {
    // Sin los comentarios: el encabezado del archivo NOMBRA la prohibición
    // para explicarla, y eso no es lo que ve el comercio.
    const texto = sinComentarios(pagar).toLowerCase();
    for (const prohibido of ['pago acreditado', 'pago verificado', 'recibimos tu pago', 'recibimos su pago']) {
      expect(texto, `«${prohibido}» no puede aparecer en la pantalla`).not.toContain(prohibido);
    }
    // Y sí dice quién confirma de verdad.
    expect(texto).toContain('la confirmación la da el banco');
  });

  it('el botón de emitir se deshabilita si no hay importe en bolivianos', () => {
    expect(pagar).toContain('vista.montoBs === null');
  });

  it('muestra los tres ejes por separado y no deduce nada del nombre del plan', () => {
    // `Analisis/41` §4, consecuencia 3: Cuenta y Pagar muestran plan,
    // modalidad y titularidad; Negocios es el único lugar donde se asignan.
    const texto = sinComentarios(pagar);
    expect(texto).toContain('<EjesDeLaCuenta');
    expect(texto).not.toMatch(/=== 'demostracion'|!== 'demostracion'/);
    expect(texto).toContain('facturaMetaAlComercio(ejes?.numeros ?? [])');
    // La titularidad llega SOLO por `ejesDeCuenta`: `rutasWhatsApp` es del propietario.
    expect(texto).toContain('useEjesDeCuenta(tenantId)');
    expect(texto).not.toContain('rutasWhatsApp');
    const cuenta = sinComentarios(leer('web/src/paginas/EstadoCuenta.tsx'));
    expect(cuenta).toContain('<EjesDeLaCuenta');
    expect(cuenta).not.toMatch(/plan === 'demostracion'|\bpagaMeta\b/);
    expect(cuenta).toContain('useEjesDeCuenta(tenantId)');
    expect(cuenta).not.toContain('rutasWhatsApp');
  });
});

describe('el cobro que el banco ya confirmó y espera en revisión (tercera vuelta de #212, LOW 1)', () => {
  const pagar = sinComentarios(leer('web/src/paginas/Pagar.tsx'));

  it('CONFIRMADO se lee «el banco confirmó el pago; NovuChat lo está registrando», sin decir acreditado', () => {
    expect(ESTADO_DEL_COBRO['CONFIRMADO']).toBe('el banco confirmó el pago; NovuChat lo está registrando');
    for (const texto of Object.values(ESTADO_DEL_COBRO)) {
      for (const prohibido of ['acreditado', 'verificado', 'recibimos']) expect(texto.toLowerCase()).not.toContain(prohibido);
    }
    // La tabla vive en el módulo puro y la pantalla la usa: no hay una segunda copia.
    expect(pagar).toContain('ESTADO_DEL_COBRO[estado]');
    expect(pagar).not.toMatch(/const ESTADO_DEL_COBRO/);
  });

  it('en CONFIRMADO no se muestran el QR ni «Cancelar este cobro»; en los demás estados, sí', () => {
    expect(cobroSeMuestraParaPagar('CONFIRMADO')).toBe(false);
    for (const e of ['SIN_EMITIR', 'BORRADOR', 'QR_ACTIVO', 'PAGO_DETECTADO', 'EN_REVISION', 'QR_SUELTO', undefined, null]) {
      expect(cobroSeMuestraParaPagar(e), String(e)).toBe(true);
    }
    // La rama sin QR vuelve ANTES de dibujar la imagen y el botón de cancelar.
    const rama = pagar.indexOf('if (!paraPagar)');
    expect(rama).toBeGreaterThan(0);
    expect(rama).toBeLessThan(pagar.indexOf("urlDeFuncionHttp('imagenDePago'"));
    expect(rama).toBeLessThan(pagar.indexOf('Cancelar este cobro'));
    const sinQr = pagar.slice(rama, pagar.indexOf('return (', pagar.indexOf('return (', rama) + 1));
    expect(sinQr).not.toContain('imagenDePago');
    expect(sinQr).not.toContain('onAnular');
    expect(sinQr).toContain('No hace falta pagar otra vez');
  });

  it('el pedido de sesión reciente al emitir otro plan ofrece volver a entrar con Google y repetir el MISMO pedido (LOW 3)', () => {
    expect(pideVolverAEntrar({ code: 'functions/unauthenticated' })).toBe(true);
    for (const e of [{ code: 'functions/permission-denied' }, { code: 'unauthenticated' }, null, undefined, 'x']) {
      expect(pideVolverAEntrar(e)).toBe(false);
    }
    expect(pagar).toContain("if (pideVolverAEntrar(e) && conGoogle) setReintento(p);");
    expect(pagar).toContain('reauthenticateWithPopup(auth.currentUser, proveedor)');
    expect(pagar).toContain('await emitirPedido(pendienteDeEmitir);');
  });
});
