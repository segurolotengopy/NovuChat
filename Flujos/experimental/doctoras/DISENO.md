# Las doctoras (tenants `rroca-evy` y `rroca-emma`): captación con derivación a recepción

Plan: `DOCTORAS_plan-y-guion-vs-flujo_2026-10-22.md` (en `~/CLAUDE_DESCARGAS/`). Zona: `Flujos/experimental/doctoras/` (Flujo de cliente, fuera de `fronteras.test.ts`, como Antonio). Armador: `../comun-sin-agente/construir.mjs`, importado, nunca copiado.
UN código y UNA plantilla; los datos de cada doctora en `admin/scripts/datos/doctoras/<tenant>.json`. `node construir.mjs` escribe `doctoras.<tenant>.json` y `doctoras.<tenant>.prueba.json`. No se publica nada en este PR.

## Estado por commit (un solo PR)

| Commit | Contenido |
|---|---|
| A | Esqueleto: receptor (6 nodos), núcleo, medios comunes incluidos (audio, imagen, PDF), armado, cadena de envío común, resumen con verificación de entrega, baja y riesgo detectados en la entrada; datos de Evy |
| B | Conversación, consentimiento y baja, aviso a recepción, médica, suite negada |
| C | Guardia `--publicable` y datos de Emma |

## Decisiones del commit A

- **Sin cobro, QR ni comprobante** (los 3 nodos de cotejo de Antonio se quitan). Fuente única para dos tenants; la alternativa «carpeta por tenant» (decisión pendiente P8) duplicaría cada cambio.
- **Medios**: `Preparar transcripción`, `Preparar imagen` y `Medio no aceptado` incluidos byte a byte desde `Flujos/src/core/medios/`; `Describir imagen/documento` clasifican `publicidad | documento_salud | otro` y no describen personas.
- **Número de otro país**: se descarta sin responder (no hay texto de «pago con QR boliviano»).
- **Retención de ejecuciones**: `saveDataErrorExecution: all` (~14 días) guardaría textos de salud de turnos fallidos. Aceptado por Andres para Rubén y Antonio, pero con datos de salud queda como **DECISIÓN PENDIENTE (P7)**: no está aceptada para estos flujos.
- **Mensajes por conversación**: 0 agregados en este commit.
