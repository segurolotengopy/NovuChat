# Recursos del demo — qué es cada archivo y cómo usarlo

| Archivo | Para qué sirve |
|---|---|
| `calendario-demo-relleno.ics` | 55 eventos "ocupados" (1–12 sep, sin domingos) para el calendario del Demo A |
| `qr-demo.png` | Imagen del QR de cobro simulado del Demo B, con el rótulo impreso en la propia imagen |
| `prueba-humo-meta.sh` | Verificación del número de Meta desde la terminal, antes de conectar n8n |
| `checklist-ensayo.md` | Suite de aceptación completa (A, B y casos hostiles) para marcar en el ensayo |
| `guion-presentacion-demos.md` | Guion del presentador para los demos del 9–10/09 |
| `Simulador-NovuChat-v2.html` | Plan B offline: los 4 guiones reales animados, con el celular del dueño |

## 1. Calendario del Demo A (`calendario-demo-relleno.ics`)

1. En Google Calendar (la cuenta que usará la credencial OAuth de n8n):
   rueda ⚙️ → **Configuración → Agregar calendario → Crear calendario nuevo**
   → nombre `NovuChat Demo A` → zona horaria **La Paz**.
2. **Importar y exportar → Importar**: seleccionar el `.ics` y, en "Agregar a",
   elegir **NovuChat Demo A** (no el calendario personal).
3. Copiar el **ID del calendario** (Configuración del calendario → "ID de
   calendario", termina en `@group.calendar.google.com`) → pegarlo en el nodo
   `Config del negocio` del flujo A.

**Diseño de las franjas (horario 09:00–19:00):** cada día quedan ocupadas
09:00–10:00, 10:30–11:30, 12:00–13:00, 14:00–15:00 y 16:00–17:00. Es decir,
quedan **libres a propósito**: 10:00–10:30, 11:30–12:00, 13:00–14:00 por la
mañana, y 15:00–16:00, 17:00–19:00 por la tarde — así el agente siempre tiene
2–3 opciones reales que ofrecer y el público ve huecos y ocupados de verdad si
se proyecta el calendario. Las citas que el bot cree durante los ensayos se
borran a mano (o se deja que "llenen" el día, que también luce bien en vivo).

## 2. QR del Demo B (`qr-demo.png`)

- Estructura **EMVCo real** (TLV + CRC-16 verificado): cualquier lector lo
  escanea, pero los datos de comercio son ficticios (`COMERCIO_DEMO`) y una
  app bancaria real lo **rechaza a propósito** (criterio C-12; lección de
  `reservas-bot`, docs/16). El rótulo va impreso en la imagen, además del
  caption que agrega el flujo.
### Cómo llega la imagen al chat (dos rutas)

**Ruta A — media ID de Meta (recomendada, sin hosting).** Se sube el archivo
una vez a la propia WhatsApp Cloud API y se obtiene un **media ID válido por
30 días**; el flujo envía la imagen por ese ID, no por URL. No hace falta
publicar nada en internet, la entrega es más rápida (Meta ya tiene el archivo)
y no queda ningún enlace expuesto.

```bash
# WA_TOKEN y WA_PHONE_ID deben ser los de la app que ENVÍA el QR (Demo B):
# el media ID queda ligado al número que lo sube.
curl -sS -X POST "https://graph.facebook.com/v26.0/${WA_PHONE_ID}/media" \
  -H "Authorization: Bearer ${WA_TOKEN}" \
  -F "messaging_product=whatsapp" \
  -F "file=@Demo-Recursos/qr-demo.png;type=image/png"
# → {"id":"1234567890123456"}
```

También se puede hacer sin terminal, desde el propio n8n: nodo **WhatsApp**,
recurso **Media → Upload**, ejecutándolo una sola vez a mano.

Con el ID en mano, en el nodo **"Enviar QR (imagen DEMO)"** del Demo B se
cambia el selector de origen de la imagen de **Link** a **ID** y se pega el
valor. El campo `qrUrl` de `Config del negocio` queda sin uso (se puede
reutilizar para guardar el media ID).

> Vigencia: 30 días desde la subida. Si se sube a inicios de septiembre cubre
> con holgura los demos del 9 y 10; si expirara, se repite el mismo comando.

**Ruta B — URL pública (solo si prefieren un enlace estable).** Meta debe
poder descargar el archivo por HTTPS sin autenticación (PNG/JPG, hasta 5 MB;
el nuestro pesa 30 KB). Opciones, en orden de conveniencia para esta
infraestructura:

1. **OCI Object Storage con *pre-authenticated request*** de solo lectura
   sobre el objeto. Ya tienen bucket, namespace y el OCI CLI con *instance
   principal* en la VM. Conviene un bucket aparte para material público: el de
   respaldos tiene una regla de ciclo de vida que borra objetos a los 180 días.
2. **GitHub raw**, solo si el repositorio de NovuChat es **público**. En un
   repo privado la URL *raw* exige token y Meta no podrá descargarla.
3. Servirlo desde el Nginx Proxy Manager de la VM: funciona, pero implica
   montar un origen estático — más trabajo que las dos anteriores.

## 3. Simulador v2 (`Simulador-NovuChat-v2.html`)

Sucesor del `Simulador.html` de Silvana (el original queda intacto en
`Preliminares/`). Se abre con doble clic, **sin internet y sin dependencias
externas** — por eso es la contingencia #3 del guion de presentación.

Qué cambió respecto del original:

- Los cuatro guiones son ahora los **reales de los flujos de n8n**: mismos
  precios (hamburguesa doble 35 Bs, envío 7 Bs, chaqueta 180 Bs, recargo de
  terminal 10 Bs, manicure 50 Bs, corte 70 Bs), mismas reglas y mismos textos.
- Se agregó el escenario **Salud con los tres rechazos** y la transferencia a
  recepción, que es el diferenciador comercial del Demo A y no estaba.
- Se agregó el **celular del negocio** a la derecha: la alerta al dueño (o a
  recepción) aparece sola cuando corresponde — el momento más vendedor del
  Demo B, ahora también en el plan B.
- El QR va **rotulado como simulacro** en la propia burbuja, y la
  confirmación dice "Pago verificado (simulado — demo)" (criterio C-12).
- El saludo del flujo de gastronomía muestra la **lista interactiva** tal como
  la envía el flujo real.

Si Silvana cambia precios o textos en el System Message de un flujo, se
actualizan también aquí (están en el objeto `flowsData`, al inicio del script)
para que el plan B nunca contradiga lo que ve el cliente en vivo.

## 4. Prueba de humo (`prueba-humo-meta.sh`)

Se ejecuta en la laptop al terminar los Bloques 2–4 de
`GUIA-META-NOVUCHAT.md`, con un `.env.meta` local (jamás versionado). Prueba
la plantilla `hello_world` y el texto libre dentro de la ventana de 24 h, con
los errores típicos explicados. Si las dos pruebas pasan, todo fallo posterior
está en n8n, no en Meta — eso corta a la mitad el espacio de depuración.
