/**
 * LA PÁGINA «NEGOCIOS» DE PLATAFORMA (`Analisis/41` §1.2, §4 consecuencia 3,
 * §7 fila F1: absorbe A-3b del prepago). NovuChat asigna los tres ejes, el
 * modelo y los umbrales, suspende y reactiva, carga un pago a mano con
 * comprobante y enciende el corte.
 *
 * Lo que estas pruebas defienden, y por qué:
 *  1. LA PANTALLA NO ESCRIBE EN FIRESTORE. Todo es una callable del propietario
 *     (`CALLABLES` de `lib/ejes.ts`), y las reglas niegan la escritura del
 *     navegador sobre `/cuenta`, `/pagos` y `/rutasWhatsApp`. La pantalla
 *     acompaña, el servidor manda (`CLAUDE.md` §7).
 *  2. NADA SE ESCRIBE SIN CONFIRMAR. Cada acción muestra qué va a cambiar y
 *     pide «Confirmar»; los `on…` no se llaman al primer clic.
 *  3. EL PAGO MANUAL ES IDEMPOTENTE Y LLEVA COMPROBANTE. El `pagoId` tiene la
 *     forma que exigen el servidor y `storage.rules`, y la evidencia va a la
 *     ruta y con el nombre que la regla acepta.
 *  4. LA VISTA PREVIA DEL PAGO USA LAS FUNCIONES DEL SERVIDOR (`importeBs`,
 *     `aplicarPago`): lo que el propietario ve es lo que el servidor compara.
 *  5. EL ERROR DEL SERVIDOR SE MUESTRA TAL CUAL, y el pedido de sesión
 *     reciente se reconoce para ofrecer volver a entrar.
 *
 * El dibujo se verifica con `renderToStaticMarkup`, sin DOM ni emulador, como
 * en `consola-pagar.test.ts`.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ID_PAGO, diaBolivia, esMedioManual, mensajeDeError, nombreEvidencia, nuevoPagoId, pideSesionReciente, resumenDeCambio,
  rutaEvidencia, vistaDelPagoManual,
} from '../web/src/plataforma/lib/negocios';
import { PanelEjes } from '../web/src/plataforma/componentes/PanelEjes';
import { SuspensionNegocio } from '../web/src/plataforma/componentes/SuspensionNegocio';
import { CortePrepago } from '../web/src/plataforma/componentes/CortePrepago';
import { FormularioPagoManual } from '../web/src/plataforma/componentes/FormularioPagoManual';
import { rutaDe } from '../web/src/lib/ejes';
import { BOLSA, MESES_MAXIMO, PLANES, aplicarPago, importeBs } from '../functions/src/prepago';
import { UMBRALES_ATENCION } from '../functions/src/atencion';

const aqui = dirname(fileURLToPath(import.meta.url));
const leer = (ruta: string) => readFileSync(join(aqui, '..', ruta), 'utf8');
const sinComentarios = (fuente: string) => fuente
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const desdeWeb = createRequire(join(aqui, '..', 'web', 'package.json'));
const { createElement } = desdeWeb('react') as { createElement: (c: unknown, p: unknown) => unknown };
const { renderToStaticMarkup } = desdeWeb('react-dom/server') as { renderToStaticMarkup: (e: unknown) => string };
const dibujar = (componente: unknown, props: Record<string, unknown>) =>
  renderToStaticMarkup(createElement(componente, props));

/** 15 de octubre de 2026, 12:00 de Bolivia. */
const AHORA = Date.UTC(2026, 9, 15, 16, 0, 0);
const TC = { tco: 12.6, fecha: '2026-10-15', fuente: 'BCB' };
const nada = () => undefined;
const acciones = { onPlan: nada, onModalidad: nada, onTitularidad: nada, onModelo: nada, onUmbrales: nada };

describe('el pagoId y el comprobante tienen la forma que exigen el servidor y storage.rules', () => {
  it('nuevoPagoId da 22 caracteres de base64url, distintos cada vez', () => {
    const ids = new Set(Array.from({ length: 50 }, () => nuevoPagoId()));
    for (const id of ids) expect(id).toMatch(ID_PAGO);
    expect(ids.size).toBe(50);
    // La MISMA forma que `ID_PAGO` de functions/src/pagos.ts y que la regla de Storage.
    expect(leer('functions/src/pagos.ts')).toContain('export const ID_PAGO = /^[A-Za-z0-9_-]{22}$/;');
    expect(leer('storage.rules')).toContain("pagoId.matches('^[A-Za-z0-9_-]{22}$')");
  });

  it('la evidencia va bajo el pagoId con uno de los tres nombres fijos', () => {
    expect(rutaEvidencia('t-1', 'AbCdEfGhIjKlMnOpQrStUv', 'pdf')).toBe('tenants/t-1/pagos/AbCdEfGhIjKlMnOpQrStUv/evidencia.pdf');
    // Los tres nombres de `ARCHIVOS_EVIDENCIA` (functions/src/pagos.ts) y de `storage.rules`.
    const pagos = leer('functions/src/pagos.ts');
    const reglas = leer('storage.rules');
    for (const ext of ['jpg', 'png', 'pdf'] as const) {
      expect(pagos).toContain(`'${nombreEvidencia(ext)}'`);
      expect(reglas).toContain(`'${nombreEvidencia(ext)}'`);
    }
  });

  it('el medio es cerrado: efectivo o transferencia', () => {
    expect(esMedioManual('efectivo')).toBe(true);
    expect(esMedioManual('transferencia')).toBe(true);
    expect(esMedioManual('qr')).toBe(false);
    expect(esMedioManual(undefined)).toBe(false);
  });
});

describe('la vista previa del pago manual usa las funciones del servidor', () => {
  it('el importe es importeBs al TCO declarado, aunque el TCO no sea el vigente', () => {
    const v = vistaDelPagoManual({ modalidad: 'prepago', plan: 'pro' }, { tipo: 'mensualidad', plan: 'pro', meses: 2 }, 12.3, AHORA)!;
    expect(v.montoUsd).toBe(PLANES.pro.precioUsd * 2);
    expect(v.montoBs).toBe(importeBs(PLANES.pro.precioUsd * 2, 12.3));
  });

  it('dice hasta cuándo quedaría cubierto y la bolsa, con aplicarPago', () => {
    const cuenta = { modalidad: 'prepago', plan: 'impulso', periodoPagado: '2026-10' };
    const pedido = { tipo: 'mensualidad', plan: 'impulso', meses: 1 } as const;
    const v = vistaDelPagoManual(cuenta, pedido, TC.tco, AHORA)!;
    expect(v.cubiertoHasta).toBe(aplicarPago(cuenta, pedido, AHORA).cubiertoHasta);
    expect(v.cubiertoHasta).toBe('2026-11');
    const seis = vistaDelPagoManual(cuenta, { tipo: 'mensualidad', plan: 'impulso', meses: MESES_MAXIMO }, TC.tco, AHORA)!;
    expect(seis.conRegalo).toBe(true);
    expect(seis.bolsa).toBe(BOLSA.conversaciones);
  });

  it('sin TCO válido o con un pedido inválido no hay vista', () => {
    expect(vistaDelPagoManual({}, { tipo: 'instalacion' }, 0, AHORA)).toBeNull();
    expect(vistaDelPagoManual({}, { tipo: 'instalacion' }, Number.NaN, AHORA)).toBeNull();
    expect(vistaDelPagoManual({}, { tipo: 'bolsa', cantidad: 0 } as never, TC.tco, AHORA)).toBeNull();
  });

  it('diaBolivia fecha el TCO como el BCB: UTC−4', () => {
    // 01:00 UTC del 16 es todavía el 15 en Bolivia.
    expect(diaBolivia(Date.UTC(2026, 9, 16, 1, 0, 0))).toBe('2026-10-15');
  });
});

describe('el error del servidor se muestra tal cual', () => {
  it('repite el mensaje de la Function y solo cae al respaldo si no hay mensaje o es «internal»', () => {
    expect(mensajeDeError({ message: 'El umbral de bloqueo tiene que ser mayor que el de operador.' }, 'x'))
      .toBe('El umbral de bloqueo tiene que ser mayor que el de operador.');
    expect(mensajeDeError({ message: 'internal' }, 'respaldo')).toBe('respaldo');
    expect(mensajeDeError({ message: '   ' }, 'respaldo')).toBe('respaldo');
    expect(mensajeDeError(undefined, 'respaldo')).toBe('respaldo');
  });

  it('reconoce el pedido de sesión reciente de registrarPagoManual', () => {
    expect(pideSesionReciente({ code: 'functions/unauthenticated' })).toBe(true);
    expect(pideSesionReciente({ code: 'functions/permission-denied' })).toBe(false);
    expect(pideSesionReciente(null)).toBe(false);
  });

  it('resumenDeCambio: un valor igual al actual no es un cambio', () => {
    expect(resumenDeCambio('Plan', 'Impulso', 'Pro')).toBe('Plan: Impulso → Pro');
    expect(resumenDeCambio('Plan', 'Pro', 'Pro')).toBeNull();
  });
});

describe('PanelEjes: los tres ejes, el modelo y los umbrales, cada uno con su confirmación', () => {
  const base = {
    ficha: { modelo: 'gemini' }, cuenta: { modalidad: 'prepago', plan: 'impulso', umbralOperador: 20, umbralBloqueo: 40 },
    rutas: [rutaDe('111', { tenantId: 't', flujo: 'reservas', titularidad: 'comercio' }), rutaDe('222', { tenantId: 't', flujo: 'venta' })],
    tipoCambio: TC, ahoraMs: AHORA, ocupado: false, ...acciones,
  };

  it('muestra el plan con USD y Bs, la modalidad, la titularidad de cada número, el modelo y los umbrales propios', () => {
    const html = dibujar(PanelEjes, base);
    expect(html).toContain(PLANES.impulso.nombre);
    expect(html).toContain(`USD ${PLANES.impulso.precioUsd} al mes`);
    expect(html).toContain(`Bs ${importeBs(PLANES.impulso.precioUsd, TC.tco)}`);
    expect(html).toContain('Producción');
    expect(html).toContain('Número propio del comercio');
    expect(html).toContain('Número de NovuChat');
    expect(html).toContain('Gemini');
    expect(html).toContain('<strong>20</strong>');
    expect(html).toContain('<strong>40</strong>');
    expect(html).toContain('propios de esta cuenta');
  });

  it('el plan se elige del catálogo de lo que se vende: el interno de demostración no se ofrece', () => {
    const html = dibujar(PanelEjes, base);
    const selectPlan = /<select id="eje-plan"[\s\S]*?<\/select>/.exec(html)?.[0] ?? '';
    const selectModalidad = /<select id="eje-modalidad"[\s\S]*?<\/select>/.exec(html)?.[0] ?? '';
    for (const p of Object.keys(PLANES)) expect(selectPlan).toContain(`<option value="${p}"`);
    expect(selectPlan).not.toContain('<option value="demostracion"');
    // Y la modalidad sí ofrece las tres, por separado del plan.
    for (const m of ['demostracion', 'prueba', 'prepago']) expect(selectModalidad).toContain(`<option value="${m}"`);
  });

  it('cada eje tiene su botón de cambio y ninguno empieza confirmando', () => {
    const html = dibujar(PanelEjes, base);
    for (const b of ['Cambiar el plan', 'Cambiar la modalidad', 'Cambiar la titularidad', 'Cambiar el modelo', 'Fijar los umbrales']) {
      expect(html).toContain(b);
    }
    expect(html).not.toContain('¿Confirmar?');
    // Un valor igual al actual no es un cambio: el botón nace deshabilitado.
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Cambiar el plan<\/button>/);
  });

  it('sin umbrales propios dice los de respaldo y no ofrece «volver a los de respaldo»', () => {
    const html = dibujar(PanelEjes, { ...base, cuenta: { modalidad: 'prepago', plan: 'pro' } });
    expect(html).toContain(`los de respaldo (${UMBRALES_ATENCION.operador} / ${UMBRALES_ATENCION.bloqueo})`);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Volver a los de respaldo<\/button>/);
  });

  it('si no se pudieron leer los números lo dice; sin número, dice cómo se asigna (por script, con secreto)', () => {
    expect(dibujar(PanelEjes, { ...base, rutas: null })).toContain('No se pudieron leer los números');
    expect(dibujar(PanelEjes, { ...base, rutas: [] })).toContain('asignar-numero.mjs');
  });

  it('trae el contador de cambios incluidos del mes', () => {
    const mes = new Date(AHORA).toISOString().slice(0, 7);
    const html = dibujar(PanelEjes, { ...base, cuenta: { ...base.cuenta, cambios: { [mes]: 1 }, limites: { cambiosIncluidos: 2 } } });
    expect(html).toContain('1 de 2 incluidos este mes');
  });
});

describe('SuspensionNegocio: suspender pide motivo y muestra lo que leerá el comercio; reactivar no espera', () => {
  it('activo: ofrece suspender, deshabilitado hasta que haya motivo, con el texto visible por defecto', () => {
    const html = dibujar(SuspensionNegocio, { ficha: { estado: 'activo' }, ocupado: false, onSuspender: nada, onReactivar: nada });
    expect(html).toContain('Activo.');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Suspender<\/button>/);
    expect(html).toContain('Servicio suspendido. Comuníquese con NovuChat');
    expect(html).toContain('mensaje de cortesía neutro, sin');
    expect(html).not.toContain('Reactivar');
  });

  it('suspendido: muestra el motivo interno y ofrece reactivar', () => {
    const html = dibujar(SuspensionNegocio, {
      ficha: { estado: 'suspendido', motivoSuspension: 'dos meses sin pago' }, ocupado: false, onSuspender: nada, onReactivar: nada,
    });
    expect(html).toContain('Suspendido.');
    expect(html).toContain('dos meses sin pago');
    expect(html).toContain('>Reactivar</button>');
    expect(html).not.toContain('>Suspender</button>');
  });

  it('dado de baja: no se reactiva desde acá', () => {
    const html = dibujar(SuspensionNegocio, { ficha: { estado: 'dado_de_baja' }, ocupado: false, onSuspender: nada, onReactivar: nada });
    expect(html).toContain('Dado de baja');
    expect(html).not.toContain('<button');
  });
});

describe('CortePrepago: la compuerta dice lo que hace, pide motivo y confirma', () => {
  it('apagada: «modo observación», botón de encender deshabilitado sin motivo', () => {
    const html = dibujar(CortePrepago, { plataforma: {}, alcance: 'global', ocupado: false, onFijar: nada });
    expect(html).toContain('Corte en modo observación');
    expect(html).toContain('todos los comercios en producción');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Encender el corte<\/button>/);
  });

  it('encendida: «Corte activo» y ofrece apagar; para un comercio habla de «este comercio»', () => {
    const html = dibujar(CortePrepago, { plataforma: { corteActivo: true }, alcance: 'comercio', ocupado: false, onFijar: nada });
    expect(html).toContain('Corte activo');
    expect(html).toContain('este comercio');
    expect(html).toContain('Apagar el corte');
  });

  it('mientras carga no ofrece nada', () => {
    const html = dibujar(CortePrepago, { plataforma: undefined, alcance: 'global', ocupado: false, onFijar: nada });
    expect(html).toContain('Leyendo el estado del corte');
    expect(html).toMatch(/<button[^>]*disabled=""/);
  });
});

describe('FormularioPagoManual: lo que se ve antes de registrar', () => {
  it('precarga el TCO vigente, muestra el importe del servidor y exige comprobante en transferencia', () => {
    const html = dibujar(FormularioPagoManual, { cuenta: { modalidad: 'prepago', plan: 'impulso' }, tipoCambio: TC, ahoraMs: AHORA, ocupado: false, onRegistrar: nada });
    expect(html).toContain('value="12.6"');
    expect(html).toContain(`Vigente del BCB: ${TC.tco} del ${TC.fecha}`);
    expect(html).toContain(`Bs ${importeBs(PLANES.impulso.precioUsd, TC.tco)}`);
    expect(html).toContain('Comprobante (PDF, JPG o PNG)');
    // Sin referencia ni comprobante no se puede registrar.
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>\s*Registrar el pago\s*<\/button>/);
    // Y nunca dice que la plata entró.
    expect(html.toLowerCase()).not.toContain('pago acreditado');
    expect(html).toContain('eso lo confirma el banco');
  });

  it('sin tipo de cambio del día lo dice y deja declararlo', () => {
    const html = dibujar(FormularioPagoManual, { cuenta: {}, tipoCambio: null, ahoraMs: AHORA, ocupado: false, onRegistrar: nada });
    expect(html).toContain('No hay tipo de cambio del día cargado');
  });
});

describe('las pantallas no escriben en Firestore y llaman a las callables por el contrato', () => {
  const pagina = sinComentarios(leer('web/src/plataforma/paginas/CuentaNegocio.tsx'));
  const cartera = sinComentarios(leer('web/src/paginas/Tenants.tsx'));
  const app = sinComentarios(leer('web/src/App.tsx'));

  it('ni Negocios ni Administrar usan setDoc, updateDoc, addDoc, deleteDoc, writeBatch ni runTransaction', () => {
    for (const fuente of [pagina, cartera]) {
      for (const escritura of ['setDoc', 'updateDoc', 'addDoc', 'deleteDoc', 'writeBatch', 'runTransaction']) {
        expect(fuente).not.toContain(escritura);
      }
    }
  });

  it('cada acción es una callable de CALLABLES: cuenta, ejes, suspender, reactivar, corte y pago manual', () => {
    for (const c of ['CALLABLES.cuenta', 'CALLABLES.ejes', 'CALLABLES.suspender', 'CALLABLES.reactivar', 'CALLABLES.corte', 'CALLABLES.pagoManual']) {
      expect(pagina).toContain(c);
    }
    expect(cartera).toContain('CALLABLES.corte');
    // La compuerta global va SIN tenantId; la del comercio, con él.
    expect(cartera).toContain("httpsCallable(funciones, CALLABLES.corte)({ corteActivo, motivo })");
    expect(pagina).toContain('httpsCallable(funciones, nombre)({ tenantId, ...datos })');
  });

  it('el comprobante se sube ANTES de registrar, bajo el pagoId del formulario, y el pagoId se renueva solo tras registrar', () => {
    expect(pagina).toContain('uploadBytes(ref(storage, rutaEvidencia(tenantId, pagoId, v.ext))');
    expect(pagina.indexOf('uploadBytes(')).toBeLessThan(pagina.indexOf('CALLABLES.pagoManual)'));
    expect(pagina).toContain('setPagoId(nuevoPagoId())');
    expect(pagina).toContain('useState(() => nuevoPagoId())');
  });

  it('el error del servidor se muestra tal cual y el pedido de sesión reciente ofrece volver a entrar con Google', () => {
    expect(pagina).toContain('setError(mensajeDeError(e,');
    expect(pagina).toContain('if (pideSesionReciente(e)) setReautenticar(pedido);');
    expect(pagina).toContain('reauthenticateWithPopup(auth.currentUser, proveedor)');
  });

  it('la ruta existe solo para el propietario, con su título, y la cartera enlaza a ella', () => {
    expect(app).toContain("administrar: 'Administrar negocio',");
    expect(app).toContain('<Route path="/negocios/:tenantId/administrar" element={\n          <Proteger requiere="propietario"><><Cabecera /><CuentaNegocio /></></Proteger>} />');
    expect(cartera).toContain('/negocios/${encodeURIComponent(t.id)}/administrar');
  });

  it('la cartera muestra la titularidad por número y la compuerta global del corte', () => {
    expect(cartera).toContain("collection(db, 'rutasWhatsApp')");
    expect(cartera).toContain('ETIQUETA_TITULARIDAD[titularidadDe(r)]');
    expect(cartera).toContain('<CortePrepago plataforma={plataforma} alcance="global"');
    expect(cartera).toContain('<th>Modalidad</th>');
    expect(cartera).toContain('<th>Titularidad</th>');
  });
});
