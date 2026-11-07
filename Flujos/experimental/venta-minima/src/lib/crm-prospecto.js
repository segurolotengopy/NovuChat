// PUERTA DE «Prospecto para la planilla» (miniCRM del restaurante). Se concatena ENTRE `crm.js` y `nodo-prospecto.js` del módulo `crm` y corre primero.
// «Armar mensajes» calcula el prospecto ANTES de comprometer el estado: si el compromiso cedió (conflicto de versión sin hecho externo: no sale nada) o falló (5xx o tiempo agotado: sale solo
// el genérico y el pedido NO quedó guardado), la hoja recibiría un pedido que no existe. Con `modo === 'comprometer'` el prospecto solo pasa si «Soltar mensajes» emitió ítems Y el
// compromiso quedó ok (`sesion.comprometido`). Cualquier duda (el nodo no corrió, no hay ítems, no se puede leer) descarta: falla cerrada. Sin nodos nuevos. MENSAJES: ninguno.
{
  let descartar = false;
  try {
    const armado = $('Armar mensajes').first().json || {};
    if (armado.modo === 'comprometer') {
      const sueltos = $('Soltar mensajes').all();
      descartar = !(sueltos.length > 0 && sueltos[0].json && sueltos[0].json.sesion && sueltos[0].json.sesion.comprometido === true);
    }
  } catch (e) { descartar = true; }
  if (descartar) return [];
}
