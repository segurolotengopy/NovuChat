export const meta = {
  name: 'alta-cliente',
  description: 'Alta de un cliente de NovuChat por etapas: preparar, canal, plataforma o flujo',
  whenToUse: 'Al empezar o retomar el alta de un comercio. Se corre una vez por etapa: los pasos en Meta y las confirmaciones quedan entre una etapa y la siguiente, a cargo de una persona.',
  phases: [
    { title: 'Leer', detail: 'estado del alta y lo que cambió en main' },
    { title: 'Etapa', detail: 'el trabajo de la etapa pedida' },
    { title: 'Consolidar', detail: 'estado.md y el siguiente paso' },
  ],
}

// Uso: /alta-cliente con args { cliente: 'NOMBRE', fase: 'preparar' | 'canal' | 'plataforma' | 'flujo',
//      tenant?: 'id-del-tenant', flujo?: 'agendamiento' | 'venta' | 'onboarding', proyecto?: 'id-gcp' }
//
// Por qué una etapa por corrida: entre etapas hay trabajo humano en Meta y
// confirmaciones de acciones sensibles. La documentación de workflows lo pide
// así: «para aprobar entre etapas, corra cada etapa como su propio workflow».
const a = args || {}
const CLIENTE = String(a.cliente || '').toUpperCase()
const FASE = String(a.fase || 'preparar')
const FASES = ['preparar', 'canal', 'plataforma', 'flujo']
if (!/^[A-Z][A-Z0-9]{1,19}$/.test(CLIENTE)) {
  return { error: 'Falta args.cliente en MAYÚSCULAS, como su carpeta en CLIENTES/ (p. ej. QTACO).' }
}
if (!FASES.includes(FASE)) {
  return { error: `args.fase debe ser una de: ${FASES.join(', ')}` }
}
const CARPETA = `~/NovuChat/CLIENTES/${CLIENTE}`
const DATOS = `Cliente ${CLIENTE}, carpeta ${CARPETA}. Tenant: ${a.tenant || '(por decidir)'}. `
  + `Flujo: ${a.flujo || '(por decidir)'}. Proyecto GCP: ${a.proyecto || '(el de producción, ver CONFIGURACION.md)'}.`

const ESTADO = {
  type: 'object',
  required: ['etapa', 'hecho', 'pendientesPersona', 'siguiente'],
  properties: {
    etapa: { type: 'string' },
    hecho: { type: 'array', items: { type: 'string' } },
    noVerificado: { type: 'array', items: { type: 'string' } },
    pendientesPersona: { type: 'array', items: { type: 'string' } },
    fallasNuevas: { type: 'array', items: { type: 'string' } },
    siguiente: { type: 'string' },
  },
}

phase('Leer')
const contexto = await agent(
  `${DATOS} Lea docs/alta-cliente/RUNBOOK.md, y ${CARPETA}/ficha.md y estado.md si existen. `
  + `Devuelva en pocas líneas: qué etapas están hechas según estado.md, y si la etapa «${FASE}» `
  + 'puede empezar (qué le falta, si le falta algo). No escriba nada.',
  { agentType: 'alta-cliente', label: `leer ${CLIENTE}` })

phase('Etapa')
const PROMPTS = {
  preparar: [
    { tipo: 'alta-cliente', texto: `${DATOS} Etapa 0 del runbook: si no existe, cree ${CARPETA}/ con ficha.md `
      + '(desde docs/alta-cliente/plantilla-ficha.md) y estado.md (una fila por etapa). Complete lo que ya se sepa '
      + 'y liste lo que hay que pedirle al cliente antes de la reunión de Meta.' },
    { tipo: 'meta-whatsapp', texto: `${DATOS} Prepare la guía de las etapas 1 y 2 del runbook para ESTE cliente: `
      + 'pasos numerados, con cada tropiezo conocido adelantado antes del paso donde aparece. No ejecute nada.' },
  ],
  canal: [
    { tipo: 'meta-whatsapp', texto: `${DATOS} Etapa 3 del runbook: desde ~/NovuChat corra `
      + `./scripts/verificar-meta.sh --env .env.${CLIENTE.toLowerCase()} y compare por sus últimos 4 dígitos la app, `
      + 'la WABA y el número con los demás entornos de CONFIGURACION.local.md, sin imprimir valores completos. '
      + 'Si falta la suscripción, proponga --suscribir (pedirá confirmación). Anote el resultado en la ficha.' },
  ],
  plataforma: [
    { tipo: 'plataforma', texto: `${DATOS} Etapa 4 del runbook. Primero en seco: alta-comercio.mjs (si el tenant `
      + 'no existe) y asignar-numero.mjs --listar y en seco con el siguiente alias libre. Muestre las salidas. '
      + 'Si son las esperadas, repita con --aplicar: el control pedirá confirmación a la persona; si la niega, '
      + 'deténgase y devuelva los comandos listos. Nunca lea el valor de un secreto.' },
  ],
  flujo: [
    { tipo: 'flujos-n8n', texto: `${DATOS} Etapa 5 del runbook. Revise qué cambió en origin/main en Flujos/ y en `
      + 'admin/functions/src/ desde el flujo vigente del vertical; prepare o actualice el flujo del cliente con su '
      + 'suite, corra las pruebas con un puerto de emulador propio y verificar-saneo.sh, y deje el comando de '
      + `preparar-import.sh con .env.${CLIENTE.toLowerCase()}. No publique en n8n sin la confirmación del control.` },
  ],
}

const resultados = await pipeline(PROMPTS[FASE], (p) =>
  agent(`${p.texto}\n\nContexto leído del alta:\n${contexto || '(sin contexto)'}`,
    { agentType: p.tipo, label: `${FASE} · ${p.tipo}`, phase: 'Etapa' }))

phase('Consolidar')
const estado = await agent(
  `${DATOS} Consolide en ${CARPETA}/estado.md el resultado de la etapa «${FASE}». Anote la evidencia que dieron `
  + 'los agentes, lo no verificado, lo que queda para la persona y cualquier falla nueva respecto del runbook. '
  + `Resultados de los agentes:\n\n${resultados.filter(Boolean).join('\n\n---\n\n')}`,
  { agentType: 'alta-cliente', schema: ESTADO, label: `consolidar ${CLIENTE}` })

return { cliente: CLIENTE, fase: FASE, estado }
