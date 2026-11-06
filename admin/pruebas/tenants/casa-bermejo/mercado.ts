/** `ceMercadoDePrefijo` (venta-digital/src/catalogo-externo.js) cargada en un contexto vacío de `node:vm`, para comparar la expresión del nodo HTTP con la regla del código. */
import { join } from 'node:path';
import { cargarFuente } from '../../core/fuente-vm';
import { RAIZ_REPO } from '../../core/fuente-vm';

const F = cargarFuente<{ ceMercadoDePrefijo: (t: string) => string | null }>([join(RAIZ_REPO, 'Flujos/experimental/venta-digital/src/catalogo-externo.js')], ['ceMercadoDePrefijo']);
export const ceMercadoDePrefijo = (t: string): string | null => F.ceMercadoDePrefijo(t);
