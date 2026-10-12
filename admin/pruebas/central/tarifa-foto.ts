/**
 * LA «FOTO» DE UNA CUENTA: todo lo que el código dice de ella, campo por campo.
 *
 * La usa `planes-tarifa.test.ts` para demostrar que una cuenta SIN `tarifa` (el
 * caso de Bellido, de Platinum y de los demos) queda IDÉNTICA después de la
 * tarifa: la foto de hoy se compara con una foto sacada UNA VEZ con el código
 * anterior a la tarifa (`tarifa-antes.json`, de `origin/main` 712bb490 más la
 * rama de #488), con cuentas sintéticas. Ningún dato real: las cuentas de abajo
 * se parecen a las de producción en la forma (plan, copia, modalidad), no en
 * nada más.
 *
 * Se llama SOLO con funciones que ya existían antes de la tarifa y con las
 * mismas firmas de entonces (las que reciben la cuenta), para que el mismo
 * archivo corra sobre el código viejo y sobre el nuevo.
 */
import { aplicarPago, camposDerivados, estadoDeServicio } from '../../functions/src/central/cuenta/prepago.ts';
import {
  avisoDeConsumo, copiaDeLimites, limiteDeCampanas, limitesDeCuenta, porContratoDe, precioMensualDe,
} from '../../functions/src/central/cuenta/planes.ts';
import { planDeLaCuenta } from '../../web/src/central/lib/pagar.ts';

/** Un instante fijo (octubre de 2026) para que la foto no dependa del reloj. */
export const AHORA_MS = Date.parse('2026-10-15T16:00:00Z');

/** Las cuentas sintéticas: ninguna trae `tarifa`. */
export const CUENTAS_SIN_TARIFA: Readonly<Record<string, Record<string, unknown>>> = {
  // La forma de la cuenta de un piloto con Impulso, en prueba, con la copia de 100.
  impulso_prueba_copia_100: {
    plan: 'impulso', modalidad: 'prueba', periodoPrueba: '2026-10', bolsaPrueba: 20,
    limites: { conversaciones: 100, productos: 20, agendas: 1, cambiosIncluidos: 0 },
    catalogoPlanes: '2026-09-25',
  },
  // La misma, ya en producción y con una bolsa comprada.
  impulso_produccion_copia_100: {
    plan: 'impulso', modalidad: 'prepago', periodoPagado: '2026-10', bolsa: 30,
    limites: { conversaciones: 100, productos: 20, agendas: 1, cambiosIncluidos: 0 },
    catalogoPlanes: '2026-09-25',
  },
  // Una cuenta vieja: plan del catálogo y ninguna copia.
  crecimiento_sin_copia: { plan: 'crecimiento', modalidad: 'prepago', periodoPagado: '2026-10' },
  // Un demo: modalidad `demostracion` con Pro y su copia.
  demo_pro: {
    plan: 'pro', modalidad: 'demostracion',
    limites: { conversaciones: 500, productos: 500, agendas: 10, cambiosIncluidos: 2 },
    catalogoPlanes: '2026-09-25',
  },
  // Pro con 4 cambios por contrato, en prueba.
  pro_prueba_cambios_por_contrato: {
    plan: 'pro', modalidad: 'prueba', periodoPrueba: '2026-10', bolsaPrueba: 20,
    limites: { conversaciones: 500, productos: 500, agendas: 10, cambiosIncluidos: 4 },
    limitesPorContrato: ['cambiosIncluidos'], catalogoPlanes: '2026-09-25',
  },
  // Un plan que no es del catálogo y sin copia: el respaldo.
  basico_viejo: { plan: 'basico', modalidad: 'prepago', periodoPagado: '2026-10' },
};

/**
 * Un instante en milisegundos se escribe como fecha ISO: legible, y sin una
 * secuencia de 13 dígitos que el saneo del repositorio público tomaría por un
 * identificador (`scripts/verificar-saneo.sh`).
 */
const ordenar = (v: unknown): unknown =>
  typeof v === 'number' && Number.isFinite(v) && v > 1e12 ? new Date(v).toISOString()
    : Array.isArray(v) ? v.map(ordenar)
    : v !== null && typeof v === 'object'
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, ordenar(x)]))
      : v;

/** Todo lo que el código dice de la cuenta, en un objeto JSON estable. */
export function fotoDe(cuenta: Record<string, unknown>): unknown {
  const estado = estadoDeServicio(cuenta, 79, AHORA_MS);
  const planes = ['impulso', 'crecimiento', 'pro'] as const;
  return ordenar({
    limitesDeCuenta: limitesDeCuenta(cuenta),
    porContrato: porContratoDe(cuenta),
    campanas: limiteDeCampanas(cuenta),
    precioMensualUsd: precioMensualDe(cuenta),
    avisos: [79, 80, 100, 176, 400].map((n) => avisoDeConsumo(cuenta, n, '2026-10')),
    estadoDeServicio: estado,
    camposDerivados: camposDerivados(estado, cuenta),
    // Renovar el mismo plan 1 mes y 6 meses, y pagar una bolsa: lo que queda en la cuenta.
    renovar1: aplicarPago(cuenta, { tipo: 'mensualidad', plan: estado.plan, meses: 1 }, AHORA_MS),
    renovar6: aplicarPago(cuenta, { tipo: 'mensualidad', plan: estado.plan, meses: 6 }, AHORA_MS),
    bolsa2: aplicarPago(cuenta, { tipo: 'bolsa', cantidad: 2 }, AHORA_MS),
    // Lo que la consola pinta de cada plan para esa cuenta.
    consolaPagar: planes.map((p) => planDeLaCuenta(cuenta, p)),
    // La copia que quedaría al cambiar de plan.
    cambiarAImpulso: copiaDeLimites(cuenta, { plan: 'impulso' }),
    cambiarACrecimiento: copiaDeLimites(cuenta, { plan: 'crecimiento' }),
    cambiarAPro: copiaDeLimites(cuenta, { plan: 'pro' }),
    sinCambioDePlan: copiaDeLimites(cuenta, {}),
  });
}

/** La foto de todas las cuentas sintéticas. */
export function fotoDeTodas(): Record<string, unknown> {
  return Object.fromEntries(Object.entries(CUENTAS_SIN_TARIFA).map(([k, c]) => [k, fotoDe(c)]));
}
