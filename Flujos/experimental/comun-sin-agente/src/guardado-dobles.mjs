/**
 * Los DOBLES de la rama común del guardado de medios (`guardado.mjs`) para las BATERÍAS en seco de cada flujo (`<flujo>/herramientas/bateria.mjs`):
 * sin red. `guardarMedio` responde «guardado_apagado» (la bandera por defecto, contrato M1↔M2 §2), así que la rama termina en silencio y la batería
 * mide exactamente lo mismo que antes. Las pruebas del comportamiento de la rama usan su propio doble del contrato (`admin/pruebas/lib/doble-guardado.ts`).
 */
const APAGADO = () => ({ statusCode: 409, headers: {}, body: { error: 'guardado_apagado' } });
export function doblesDeBateriaDelGuardado() {
  return {
    'Pedir el medio a Meta (guardado)': () => ({ id: 'm', url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/guardado', mime_type: 'image/jpeg', file_size: 1000 }),
    'Descargar medio (guardado)': () => ({ descargado: true }),
    'Anotar medio': APAGADO,
    'Guardar medio': APAGADO,
    'Reintentar el guardado': APAGADO,
    'Avisar falla del guardado': () => ({ messaging_product: 'whatsapp', messages: [{ id: 'wamid.GUARDADO' }] }),
  };
}
