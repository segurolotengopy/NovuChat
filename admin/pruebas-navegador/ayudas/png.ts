/**
 * Un PNG de 1×1 válido, partido en dos a propósito: en una sola línea contiene `EAAAABCAYAAAAfFcSJ…`, que la compuerta de saneo
 * (`scripts/verificar-saneo.sh`, regla «token de Meta», `EAA` + 20 alfanuméricos) toma por un token. No es uno: son los bytes de una imagen.
 */
export const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAE' + 'AAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
