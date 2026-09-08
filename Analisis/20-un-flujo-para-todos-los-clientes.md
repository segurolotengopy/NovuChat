# ¿Puede un mismo flujo de n8n atender a todos los clientes?

**08-sep-2026.** Orientación pedida por Andres. Analizado contra el flujo que
corre hoy (`Flujos/demo-a-agendamiento.json` en `main`).

**La respuesta corta:** sí, y **los parámetros de inicio ya existen**. Lo que
obliga a un flujo por cliente no es la configuración: son **cuatro credenciales**,
y de ellas la que de verdad bloquea es una sola. Esa se elimina con un trámite de
Meta, no con trabajo de n8n.

---

## 1. El flujo ya está parametrizado

No es solo un modelo conceptual. Los nodos ya eligen a quién le hablan con
expresiones, no con valores fijos:

| Nodo | Cómo resuelve el comercio |
|---|---|
| `Responder al cliente` | `phoneNumberId: {{ $('Config del negocio').item.json.phoneNumberId }}` |
| `Avisar a recepción` | el número de recepción sale de la configuración |
| `Traer configuración` | cabecera `X-NovuChat-Numero` con el número del webhook |
| `Reportar mensaje` | la misma cabecera |

Y desde el 7 de septiembre **toda la configuración del negocio llega del panel**
—identidad, catálogo, horarios, funcionarios, estado— resuelta por
`phone_number_id`. La lógica del flujo **ya es genérica**.

---

## 2. Lo que obliga a un flujo por cliente: las credenciales

| Credencial | Qué guarda | Por qué es por cliente | ¿Bloquea? |
|---|---|---|---|
| **WhatsApp Trigger** | App ID + App Secret | Valida la firma del webhook. **Cada app de Meta tiene una sola URL de webhook** | **Sí. Es el bloqueo real** |
| **WhatsApp envío** | Token permanente + WABA | El token pertenece a la WABA del cliente | Sí, pero evitable |
| **Cabecera de ingesta y configuración** | El secreto del alias | Uno por número, por diseño (`firma.ts`) | Sí, pero evitable |
| **Google Calendar** | OAuth2 | Compartible si los calendarios se comparten con la cuenta de NovuChat | **No**, con la opción recomendada en `13-…` §4 |

**El disparador es el que manda.** Un nodo WhatsApp Trigger tiene exactamente
una credencial, y cada app de Meta apunta a una sola URL. Mientras cada cliente
tenga su propia app, cada cliente necesita su propio disparador. **Eso no se
arregla con parámetros.**

---

## 3. Tres niveles

### Nivel 1 — Un flujo por cliente (hoy)

Se copia el JSON versionado con `preparar-import.sh`, se conectan credenciales y
se publica. Se actualiza con `publicar-flujo.sh`.

- **Funciona y no es artesanal**, pero un cambio de prompt son N aplicaciones.
- Tolerable hasta unas decenas de clientes con la disciplina del §5.

### Nivel 2 — Un flujo, varios disparadores (posible hoy, **no recomendado**)

n8n admite varios nodos trigger en un mismo workflow. Cada cliente aporta el
suyo con su credencial, y todos alimentan la misma lógica.

- **A favor:** la lógica se corrige una vez.
- **En contra:** hay que editar el lienzo en cada alta, el flujo se vuelve
  enorme, y **el envío seguiría necesitando el token correcto**. Habría que
  reemplazar el nodo de WhatsApp por uno HTTP con el token en la cabecera por
  expresión, y entonces **el token viaja en los datos de ejecución**, visible en
  el historial de n8n para cualquiera que entre. Hoy vive cifrado en una
  credencial.
- **Verificar antes de apostar:** el límite de disparadores por workflow en la
  versión 2.36.5.

**Recomendación: no invertir acá.** Es trabajo que se tira cuando llegue el
nivel 3, y compra un compromiso de seguridad real con los tokens.

### Nivel 3 — Tech Provider con Embedded Signup (el destino)

Las WABA de todos los clientes se comparten con **una** app de NovuChat.

- **Un App Secret, un webhook, un disparador.**
- **Un token de usuario de sistema** que alcanza a todas las WABA compartidas.
- El flujo enruta por `phone_number_id`, **que es exactamente lo que ya hace**.
- Habilita además la coexistencia app + API, o sea poder ofrecer «conectá tu
  número» de verdad (`13-…` §2 y §3).

**El problema desaparece por construcción.** No es un problema de n8n: es un
trámite de Meta. Exige NovuChat verificada con NIT propio, la app en Live con
condiciones del servicio, y App Review con acceso avanzado a
`whatsapp_business_messaging` y `whatsapp_business_management`.

---

## 4. La orientación

**Saltar el nivel 2 e ir al 3**, y mientras tanto operar el nivel 1 con
disciplina.

**Empezar el trámite de verificación con el NIT propio ahora.** Se mide en
semanas y es el camino crítico de dos cosas a la vez: la generalización del flujo
y poder ofrecer «conectá tu número». Es la misma recomendación a la que se había
llegado por el lado comercial en `13-…` §8, ahora con un segundo motivo.

---

## 5. La disciplina que sostiene el nivel 1

- **Nunca editar el flujo de un cliente a mano.** Se edita el JSON versionado y
  se reaplica. Es lo que convierte N flujos en N ejecuciones de un script.
- **Un cambio de flujo se aplica a todos o a ninguno.** Un cliente con el prompt
  viejo es un defecto que nadie va a notar hasta que reclame.
- Vale la pena un script que recorra los clientes y aplique el JSON a cada uno,
  informando cuáles quedaron distintos. `publicar-flujo.sh` ya hace lo difícil
  —hereda credenciales por tipo— y toma el identificador del flujo del entorno;
  falta el bucle y el informe.

---

## 6. El límite que aparece después

Resuelto lo de las credenciales, el techo siguiente **no es de arquitectura sino
de capacidad**: con 300 clientes a 120 conversaciones de 10 mensajes son unas
**360.000 ejecuciones al mes** sobre una instancia Community en dos núcleos, o
sea unas 8 por minuto de promedio, con picos.

Es plausible y probablemente alcance, pero **nadie lo midió**. Conviene medirlo
antes de firmar el cliente número cincuenta, no el trescientos. Se mide con el
historial de ejecuciones que `ver-ejecuciones.sh` ya consulta.
