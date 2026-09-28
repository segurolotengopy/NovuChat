/**
 * La clave de la API de Gemini, para las comprobaciones que hace el servidor:
 * la foto del catálogo, el comportamiento del asistente y las campañas. Salió
 * de `imagenCatalogo.ts` en el corte C2 de F2 sin cambiar una línea, para que
 * Central y los módulos no importen del módulo Productos.
 */
import { defineSecret } from 'firebase-functions/params';

/**
 * Clave de la API de Gemini. Solo para esto; el modelo del asistente vive en n8n.
 *
 * SE DECLARA COMO SECRETO Y SE LEE DEL ENTORNO, las dos cosas. `defineSecret`
 * es lo que hace que Cloud Functions la inyecte desde Secret Manager; leerla de
 * `process.env` en vez de con `.value()` es lo que hace que la ausencia
 * degrade en lugar de romper.
 *
 * POR QUÉ IMPORTA ESA MEZCLA. Con `defineSecret` a secas, un despliegue hecho
 * antes de crear el secreto FALLA ENTERO y se lleva puesto todo lo que viajaba
 * con él: el 09/09 fueron el catálogo web, el mini inventario, la vista previa
 * y el importador, cuatro cosas terminadas esperando una clave. Así, el día que
 * alguien reconstruya el proyecto sin el secreto todavía cargado, lo único que
 * deja de funcionar es esta comprobación.
 *
 * Y SI LA CLAVE NO ESTÁ, la comprobación de que la foto SE VE corre igual —es
 * determinística y no usa modelo— y la de si la foto CORRESPONDE queda vacía:
 * se deja de opinar, no se empieza a mentir.
 */
export const CLAVE_GEMINI = defineSecret('GEMINI_API_KEY');
export const claveGemini = (): string => process.env['GEMINI_API_KEY'] ?? '';

