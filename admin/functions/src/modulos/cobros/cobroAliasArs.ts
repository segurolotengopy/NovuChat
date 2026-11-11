import { onRequest } from 'firebase-functions/v2/https';
import type { Request } from 'firebase-functions/v2/https';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { REGION } from '../../core/region.js';
import { SECRETOS_POR_ALIAS, rutaAutenticada } from '../../core/seguridad/firma.js';
import { enmascarar, registrar } from '../../core/turno/bitacora.js';
import { tieneModulo, type FichaConCapacidades } from '../../registro.js';
import {
  DIAS_DE_VIDA_ALIAS, MAX_COMPROBANTES_ALIAS, MAX_INVALIDOS_ALIAS, MONEDA_ALIAS, VIGENCIA_ALIAS_MIN,
  aliasDelTenant, calificarAlias, huellasDeComprobante, pedidoCobrable, pedidoEsDe, pedidoSigueVivo,
  validarCuerpoCotejo, validarCuerpoPedir,
  type CodigoAlias, type EstadoDelCobro,
} from './aliasArs.js';

/**
 * =============================================================================
 * COBRO POR ALIAS EN PESOS ARGENTINOS — DOS ENDPOINTS (Casa Bermejo, B4b)
 * =============================================================================
 *
 *  - `pedirAliasArs`    `{ v: 1, pedidoId, telefono }`: abre (o devuelve) EL cobro del pedido: alias del comercio,
 *    monto en centavos, vigencia de 30 min. Idempotente por `pedidoId`: pedirlo dos veces devuelve el mismo cobro.
 *  - `cotejarAliasArs`  `{ v: 1, pedidoId, telefono, idMeta, legible, leido }`: el flujo leyó la imagen y manda lo
 *    leído; el SERVIDOR califica (`calificarAlias`) y decide. Responde un código FIJO (`CODIGOS_ALIAS`).
 *
 * Servidor a servidor, con la misma credencial de ingesta que los demás endpoints de Cobros (`rutaAutenticada`):
 * el comercio sale de la credencial, NUNCA del cuerpo. Un pedido de otro comercio no existe para esta llamada:
 * se busca solo bajo `tenants/{tenantId}/pedidos`.
 *
 * CONTROL DE ACCESO POR RECURSO. El `telefono` lo toma el flujo de `messages[0].from`, nunca del modelo, y el
 * pedido tiene que ser de esa conversación (`conversacionId === 'wa_' + dígitos`); si no, `409 sin_pedido`, la
 * misma respuesta que un pedido inexistente o ajeno. El cobro guarda solo el teléfono enmascarado.
 *
 * QUÉ DEBE HACER EL FLUJO. Ante `vencido` y ante `en_revision` el flujo TRANSFIERE a una persona (aviso a
 * recepción más el botón para escribirle, la política de «solo se ofrece lo que se cumple»). Con el plazo vencido
 * el servidor califica igual: un comprobante que habría sido `ok` pasa a `en_revision` (pudo pagar a tiempo y
 * escribir tarde); el resto es `vencido`.
 *
 * INTERRUPTOR: `tenants/{t}/config/cobros.aliasArActivo` (dato del tenant, apagado por defecto). Apagado, los dos
 * responden `409 { error: 'cerrado' }` ANTES de leer el cuerpo y sin escribir nada.
 *
 * PROHIBICIÓN 3: cobro REAL. `ok` es «el comprobante llegó y sus datos coinciden», nunca «pago acreditado».
 * Ni el alias ni nada leído de la imagen se registran en la bitácora ni en los logs.
 *
 * Los dos son Functions HTTP nuevas: NO nacen invocables (`scripts/nube-visor.sh` es la lista cerrada); abrirlas
 * es un paso aparte, con la autorización de Andres.
 *
 * Mensajes por conversación que agrega: 0.
 */

const db = () => getFirestore();

/** Lo mínimo que estos endpoints usan de la respuesta de Express. */
interface RespuestaHttp { status(codigo: number): { send(b: unknown): unknown; json(b: unknown): unknown } }

interface ContextoDeLlamada { tenantId: string; alias: string }

/** Método, credencial, ruta, módulo e interruptor. Si algo falla, ya contestó y devuelve `null`. */
async function contextoDe(peticion: Request, respuesta: RespuestaHttp): Promise<ContextoDeLlamada | null> {
  if (peticion.method !== 'POST') { respuesta.status(405).send('metodo'); return null; }
  const ruta = await rutaAutenticada(peticion);
  if (!ruta) { respuesta.status(401).send('no autorizado'); return null; }
  if (ruta.estado !== 'activo') { respuesta.status(409).json({ estado: ruta.estado }); return null; }
  if (ruta.flujo !== 'venta') { respuesta.status(409).json({ estado: 'flujo_no_admitido' }); return null; }
  const { tenantId } = ruta;
  const [config, ficha] = await Promise.all([
    db().doc(`tenants/${tenantId}/config/cobros`).get(),
    db().doc(`tenants/${tenantId}`).get(),
  ]);
  const alias = aliasDelTenant(config.data());
  const fichaDatos = ficha.data() as FichaConCapacidades | undefined;
  if (alias === null || ficha.get('estado') !== 'activo'
    || !tieneModulo(fichaDatos, 'cobros') || !tieneModulo(fichaDatos, 'pedidos')) {
    respuesta.status(409).json({ error: 'cerrado' });
    return null;
  }
  return { tenantId, alias };
}

const msDe = (v: unknown): number => (v instanceof Timestamp ? v.toMillis() : 0);
const refCobro = (tenantId: string, pedidoId: string) => db().doc(`tenants/${tenantId}/cobrosAlias/${pedidoId}`);

interface ComprobanteAnotado { idMeta: string; codigo: CodigoAlias; montoLeidoCentavos: number | null }

// =============================================================================
// pedirAliasArs
// =============================================================================

type SalidaPedir =
  | { codigo: 200; cuerpo: Record<string, unknown> }
  | { codigo: 409; cuerpo: { error: string } };

export const pedirAliasArs = onRequest(
  { region: REGION, secrets: Object.values(SECRETOS_POR_ALIAS), cors: false, maxInstances: 10 },
  async (peticion, respuesta) => {
    const ctx = await contextoDe(peticion, respuesta);
    if (!ctx) return;
    const cuerpo = validarCuerpoPedir(peticion.body);
    if (!cuerpo.ok) { respuesta.status(400).json({ error: cuerpo.error }); return; }
    const { pedidoId, telefono } = cuerpo.valor;
    const ref = refCobro(ctx.tenantId, pedidoId);
    const refPedido = db().doc(`tenants/${ctx.tenantId}/pedidos/${pedidoId}`);
    const ahoraMs = Date.now();

    const salida = await db().runTransaction(async (tx): Promise<SalidaPedir> => {
      // Todas las lecturas primero. El pedido se lee SIEMPRE: es de quien escribe (por teléfono) y sigue vivo.
      const cobro = await tx.get(ref);
      const pedido = (await tx.get(refPedido)).data();
      // Mismo error que un pedido inexistente o de otro comercio: no se distingue.
      if (!pedidoEsDe(pedido, telefono)) return { codigo: 409, cuerpo: { error: 'sin_pedido' } };

      if (cobro.exists) {
        let estado = cobro.get('estado') as EstadoDelCobro;
        const venceMs = msDe(cobro.get('venceEn'));
        if (estado === 'abierto' && !pedidoSigueVivo(pedido, Number(cobro.get('montoCentavos')))) {
          tx.update(ref, { estado: 'vencido', vencidoPor: 'pedido' });
          estado = 'vencido';
        } else if (estado === 'abierto' && ahoraMs >= venceMs) {
          tx.update(ref, { estado: 'vencido', vencidoPor: 'plazo' });
          estado = 'vencido';
        }
        return {
          codigo: 200,
          cuerpo: {
            estado: estado === 'coincide' ? 'ok' : estado,
            montoCentavos: cobro.get('montoCentavos'), moneda: MONEDA_ALIAS, reutilizado: true,
            // El alias sale solo mientras el cobro está abierto: el que se le dio al cliente, el del cobro.
            ...(estado === 'abierto'
              ? { alias: cobro.get('alias'), venceEn: new Date(venceMs).toISOString() } : {}),
          },
        };
      }

      // Un cobro NUEVO: solo de un pedido de menos de 24 h. Si el cobro anterior (vencido o en revisión) ya lo
      // borró el TTL, el pedido tiene más de 24 h y esta regla impide abrir otro del mismo pedido.
      const cobrable = pedidoCobrable(pedido, ahoraMs);
      if (!cobrable.ok) return { codigo: 409, cuerpo: { error: cobrable.motivo } };
      const venceEnMs = ahoraMs + VIGENCIA_ALIAS_MIN * 60_000;
      tx.create(ref, {
        pedidoId, montoCentavos: cobrable.montoCentavos, moneda: MONEDA_ALIAS, alias: ctx.alias,
        // Solo el enmascarado: el teléfono completo está en la conversación.
        telefonoEnmascarado: enmascarar(telefono),
        creadoEn: Timestamp.fromMillis(ahoraMs), venceEn: Timestamp.fromMillis(venceEnMs),
        estado: 'abierto', intentosInvalidos: 0, comprobantes: [],
        vence: Timestamp.fromMillis(ahoraMs + DIAS_DE_VIDA_ALIAS * 86_400_000),
      });
      return {
        codigo: 200,
        cuerpo: {
          estado: 'abierto', alias: ctx.alias, montoCentavos: cobrable.montoCentavos, moneda: MONEDA_ALIAS,
          venceEn: new Date(venceEnMs).toISOString(), reutilizado: false,
        },
      };
    });
    respuesta.status(salida.codigo).json(salida.cuerpo);
  },
);

// =============================================================================
// cotejarAliasArs
// =============================================================================

type SalidaCotejo =
  | { codigo: 200; cuerpo: { codigo: CodigoAlias; montoLeidoCentavos?: number; intentosRestantes: number; reintento: boolean } }
  | { codigo: 409; cuerpo: { error: string } };

export const cotejarAliasArs = onRequest(
  { region: REGION, secrets: Object.values(SECRETOS_POR_ALIAS), cors: false, maxInstances: 10 },
  async (peticion, respuesta) => {
    const ctx = await contextoDe(peticion, respuesta);
    if (!ctx) return;
    const cuerpo = validarCuerpoCotejo(peticion.body);
    if (!cuerpo.ok) { respuesta.status(400).json({ error: cuerpo.error }); return; }
    const { pedidoId, telefono, idMeta, legible, leido } = cuerpo.valor;
    const ref = refCobro(ctx.tenantId, pedidoId);
    const refPedido = db().doc(`tenants/${ctx.tenantId}/pedidos/${pedidoId}`);
    const ahoraMs = Date.now();

    const transaccion = () => db().runTransaction(async (tx): Promise<SalidaCotejo> => {
      const cobro = await tx.get(ref);
      if (!cobro.exists) return { codigo: 409, cuerpo: { error: 'sin_cobro' } };
      const pedido = (await tx.get(refPedido)).data();
      // Control de acceso por recurso: el pedido es de la conversación de este teléfono. Misma respuesta que ajeno.
      if (!pedidoEsDe(pedido, telefono)) return { codigo: 409, cuerpo: { error: 'sin_pedido' } };

      const estado = cobro.get('estado') as EstadoDelCobro;
      const intentos = Number(cobro.get('intentosInvalidos') ?? 0);
      const restantes = (n: number) => Math.max(0, MAX_INVALIDOS_ALIAS - n);
      const anotados = (Array.isArray(cobro.get('comprobantes')) ? cobro.get('comprobantes') : []) as ComprobanteAnotado[];
      const montoCentavos = Number(cobro.get('montoCentavos'));
      const respuestaDe = (codigo: CodigoAlias, n: number, reintento: boolean, monto: number | null = null): SalidaCotejo => ({
        codigo: 200,
        cuerpo: {
          codigo, ...(codigo === 'monto_distinto' && monto !== null ? { montoLeidoCentavos: monto } : {}),
          intentosRestantes: restantes(n), reintento,
        },
      });
      const anotar = (codigo: CodigoAlias, monto: number | null): ComprobanteAnotado[] =>
        anotados.length >= MAX_COMPROBANTES_ALIAS ? anotados : [...anotados, { idMeta, codigo, montoLeidoCentavos: monto }];

      // EL MISMO MENSAJE OTRA VEZ (reintento de n8n): se repite lo que se contestó, sin contar ni escribir.
      const previo = anotados.find((c) => c.idMeta === idMeta);
      if (previo) return respuestaDe(previo.codigo, intentos, true, previo.montoLeidoCentavos);

      // Estados finales. Un comprobante nuevo sobre un cobro que ya tiene uno que coincide es `repetido`: el
      // cobro no se cobra dos veces. Nada de esto cuenta como inválido ni escribe.
      if (estado === 'coincide') return respuestaDe('repetido', intentos, false);
      if (estado === 'en_revision') return respuestaDe('en_revision', intentos, false);

      // El pedido se relee DENTRO de la transacción: si ya no está recibido o su total cambió, este cobro ya no
      // corresponde a él. Es `vencido`, no un intento inválido, y ningún comprobante lo revive.
      if ((estado === 'vencido' && cobro.get('vencidoPor') === 'pedido') || !pedidoSigueVivo(pedido, montoCentavos)) {
        if (estado === 'abierto') tx.update(ref, { estado: 'vencido', vencidoPor: 'pedido' });
        return respuestaDe('vencido', intentos, false);
      }

      const cal = calificarAlias(
        { montoCentavos, alias: String(cobro.get('alias') ?? ''), creadoEnMs: msDe(cobro.get('creadoEn')) },
        legible, leido, ahoraMs,
      );

      // PLAZO VENCIDO: se califica igual. Lo que habría sido `ok` va a una PERSONA (`en_revision`: pudo haber
      // pagado a tiempo y escribir tarde); lo demás es `vencido`. Ninguno cuenta como inválido ni registra huella.
      if (estado === 'vencido' || ahoraMs >= msDe(cobro.get('venceEn'))) {
        if (cal.codigo === 'ok') {
          tx.update(ref, { estado: 'en_revision', comprobantes: anotar('en_revision', null) });
          return respuestaDe('en_revision', intentos, false);
        }
        tx.update(ref, {
          ...(estado === 'abierto' ? { estado: 'vencido', vencidoPor: 'plazo' } : {}),
          comprobantes: anotar('vencido', null),
        });
        return respuestaDe('vencido', intentos, false);
      }

      // Las DOS huellas que se puedan calcular, todas leídas ANTES de toda escritura.
      let refsHuella: FirebaseFirestore.DocumentReference[] = [];
      let hayHuellaPrevia = false;
      if (cal.codigo === 'ok') {
        const { hOp, hMf } = huellasDeComprobante(leido, montoCentavos);
        refsHuella = [hOp, hMf].filter((h): h is string => h !== null)
          .map((h) => db().doc(`tenants/${ctx.tenantId}/comprobantesAlias/${h}`));
        for (const r of refsHuella) if ((await tx.get(r)).exists) hayHuellaPrevia = true;
      }

      if (cal.codigo === 'ok' && refsHuella.length > 0 && !hayHuellaPrevia) {
        tx.update(ref, { estado: 'coincide', coincideEn: Timestamp.fromMillis(ahoraMs), comprobantes: anotar('ok', null) });
        // El mismo comprobante no sirve para otro pedido. Solo hashes: nada leído de la imagen. `create`: si una
        // carrera ya la creó, falla con ALREADY_EXISTS y se reintenta (y entonces da `repetido`).
        for (const r of refsHuella) {
          tx.create(r, {
            pedidoId, idMeta, en: Timestamp.fromMillis(ahoraMs),
            vence: Timestamp.fromMillis(ahoraMs + DIAS_DE_VIDA_ALIAS * 86_400_000),
          });
        }
        return respuestaDe('ok', intentos, false);
      }

      // Todo lo demás es un intento inválido: un comprobante que no cuadra, o uno que ya se usó en otro pedido.
      const codigo: CodigoAlias = cal.codigo === 'ok' ? (hayHuellaPrevia ? 'repetido' : 'ilegible') : cal.codigo;
      const n = intentos + 1;
      if (n >= MAX_INVALIDOS_ALIAS) {
        tx.update(ref, { estado: 'en_revision', intentosInvalidos: n, comprobantes: anotar('en_revision', null) });
        return respuestaDe('en_revision', n, false);
      }
      const monto = codigo === 'monto_distinto' ? cal.montoLeidoCentavos : null;
      tx.update(ref, { intentosInvalidos: n, comprobantes: anotar(codigo, monto) });
      return respuestaDe(codigo, n, false, monto);
    });

    // ALREADY_EXISTS: dos cotejos crearon la misma huella a la vez. Se reintenta: la segunda vuelta la ve y
    // contesta `repetido`. Nunca un 500 por esto.
    let salida: SalidaCotejo | null = null;
    for (let intento = 0; intento < 3 && salida === null; intento++) {
      try { salida = await transaccion(); } catch (e) {
        const raro = e as { code?: unknown; message?: unknown };
        if (!(raro.code === 6 || raro.code === 'already-exists' || String(raro.message ?? '').includes('ALREADY_EXISTS'))) throw e;
      }
    }
    salida ??= { codigo: 200, cuerpo: { codigo: 'repetido', intentosRestantes: 0, reintento: false } };

    if (salida.codigo === 200) {
      // Solo el código: ni alias, ni teléfono, ni pedido, ni nada leído de la imagen.
      await registrar(ctx.tenantId, { tipo: 'cobro_cotejado', resultado: 'ok', codigo: salida.cuerpo.codigo });
    }
    respuesta.status(salida.codigo).json(salida.cuerpo);
  },
);
