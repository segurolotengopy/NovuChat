// ZONA CENTRAL: constancia de los cambios de configuración. Salió de
// `index.ts` sin cambiar lógica (F2, P1); `index.ts` la reexporta.
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { REGION } from '../core/region.js';
import { registrar } from '../core/turno/bitacora.js';

// ---------------------------------------------------------------------------
// CONSTANCIA DE LOS CAMBIOS DE CONFIGURACIÓN
//
// La configuración la escribe el panel DIRECTAMENTE en Firestore —las reglas
// validan el esquema—, así que no hay ninguna Function por la que pase. Sin un
// disparador, el cambio que hace que el asistente empiece a decir otra cosa no
// quedaría registrado en ninguna parte.
//
// Importa porque el panel es la fuente de verdad: cuando alguien pregunte «¿por
// qué el asistente dijo eso el martes?», la respuesta está en saber qué decía la
// configuración el martes. Acá queda el CUÁNDO y el QUÉ CAMBIÓ (los nombres de
// los campos), no los valores: los valores de un campo como `direccion` o
// `instruccionesExtra` son texto del comercio y la bitácora no guarda texto.
// ---------------------------------------------------------------------------
export const registrarCambioConfig = onDocumentWritten(
  { document: 'tenants/{tenantId}/config/negocio', region: REGION, maxInstances: 5 },
  async (evento) => {
    const antes = (evento.data?.before.data() ?? {}) as Record<string, unknown>;
    const despues = (evento.data?.after.data() ?? {}) as Record<string, unknown>;
    if (!evento.data?.after.exists) return;

    const cambiados = [...new Set([...Object.keys(antes), ...Object.keys(despues)])]
      .filter((k) => k !== 'actualizadoEn' && k !== 'actualizadoPor')
      .filter((k) => JSON.stringify(antes[k]) !== JSON.stringify(despues[k]))
      .sort();
    if (cambiados.length === 0) return;

    // Lo vigente y su revisión los escribe SOLO el servidor (la Function
    // `verificarComportamiento` o un script de NovuChat): las reglas se lo
    // niegan al navegador. Si eso es lo único que cambió, el canal es
    // `sistema`, no el panel. Ver `comportamiento.ts`.
    const soloDelServidor = cambiados.every((k) => k === 'instruccionesVigentes' || k === 'instruccionesRevision');

    await registrar(evento.params.tenantId, {
      tipo: 'config_publicada',
      resultado: 'ok',
      canal: soloDelServidor ? 'sistema' : 'panel',
      // Solo los NOMBRES de los campos, recortados al tope de `detalle`.
      detalle: cambiados.join(','),
    });
  },
);
