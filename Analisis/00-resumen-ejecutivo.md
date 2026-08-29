# NovuChat — Resumen ejecutivo del análisis de Preliminares

> **Fecha:** 28 de agosto de 2026 · **Elaborado para:** Andres y Silvana
> **Insumos:** los 12 archivos de `NovuChat/Preliminares/`, el repositorio
> `WhatsApp-Modular` (código y `docs/`), y el estado real de la plataforma
> n8n en OCI (`n8n-oci/00-estado-del-proyecto.md`).
> **Documentos hermanos:** `01-analisis-documentos-preliminares.md` ·
> `02-criterios-implementacion.md` · `03-plan-demos.md`

---

## Qué se encontró

El material de Silvana es un excelente punto de partida comercial y funcional:
los guiones de conversación están bien pensados (casos de prueba con criterio
de éxito, manejo de rechazos, límite de iteraciones con derivación a humano) y
la presentación define un modelo de negocio con precios blindados (planes de
150/250/350 Bs). La guía técnica (`guia novuchat.docx`) acierta en lo
estructural: arquitectura orientada a eventos, memoria por cliente, control de
consumo de tokens y *function calling* para acciones reales.

Sin embargo, entre los documentos y la infraestructura real hay **siete
inconsistencias que deben resolverse antes de construir los demos**, siendo
las tres más importantes:

1. **Canal de WhatsApp.** Los documentos recomiendan Evolution API como opción
   económica; ese canal fue probado y **retirado el 22/08** por decisión
   propia (rotura silenciosa del 18/08 por la migración `@lid`, riesgo de
   baneo, fuera de los ToS de Meta). **Decisión tomada (28/08): número de
   prueba de la Meta Cloud API** — oficial, gratuito y suficiente para un
   demo controlado (hasta 5 destinatarios verificados).
2. **Memoria de conversación.** Los flujos JSON de ejemplo usan *Window Buffer
   Memory* sin clave de sesión: con un webhook de WhatsApp, **todas las
   conversaciones de números distintos se mezclarían en una sola memoria**.
   Es el defecto más grave de los borradores y el que arruinaría un demo con
   dos celulares del público. La clave de sesión debe ser el número de origen.
3. **Modelo de IA.** Los JSON usan OpenAI, la guía propone Claude con un
   nombre de modelo inexistente. **Decisión tomada (28/08): Gemini (nivel
   gratuito de AI Studio) para los demos; Claude API para producción.** El
   nodo *AI Agent* de n8n permite ese cambio sin tocar el flujo.

## Qué se decidió (28/08/2026)

| Decisión | Resolución |
|---|---|
| Canal WhatsApp de los demos | Meta Cloud API, número de prueba (app dedicada para NovuChat) |
| LLM de los demos | Gemini (Google AI Studio, nodo nativo de n8n) |
| LLM de producción | Claude API (Anthropic) |
| Alcance de la siguiente fase | Además del análisis, generar los dos flujos JSON importables adaptados a n8n 2.36.5 en OCI |
| Evolution API / Baileys | No se reintroduce, ni siquiera para demos |

## Los dos demos propuestos

Alineados con las demostraciones comerciales del **9 y 10 de septiembre**:

- **Demo A — Agendamiento con calendario real (Belleza y Salud):** agente
  conversacional con Google Calendar como herramienta (consulta disponibilidad
  real y crea el evento), reglas por vertical (belleza con precios, salud sin
  precios y con manejo de objeción), límite de 3 rechazos con derivación a
  humano.
- **Demo B — Venta y cobro (Gastronomía y Retail):** pedido con notas
  especiales, captura de variantes (talla/color), datos para envío por flota
  (nombre y CI antes del QR), QR de pago **rotulado como simulacro**,
  confirmación al recibir la imagen del comprobante y alerta paralela al
  dueño del negocio.

El detalle operativo, los criterios de aceptación (derivados de las tablas de
prueba de Silvana) y el cronograma están en `03-plan-demos.md`.

## Riesgo principal del calendario

La Business Verification de AAB1 fue **enviada el 27/08** y tarda de 3 días a
3 semanas. Nada del plan de demos depende de ella (el número de prueba no la
requiere), pero sí la limita en una cosa: **los recordatorios de cita "24 h
antes" exigen plantilla aprobada** y no deben prometerse en vivo — se muestran
como parte del roadmap. El Simulador HTML de Silvana queda como plan B de
contingencia, junto con un video grabado del flujo real.
