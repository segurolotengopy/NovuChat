# Monitor externo del n8n de producción

Política de Andres (11/10/2026): ningún monitoreo depende de su laptop, de la app
de escritorio ni de una sesión abierta. Decisiones del 12/11/2026 (por botón):
lo construye NovuChat; se reutilizan las cuentas de Healthchecks.io y Better
Stack; la alerta llega por correo; el latido del monitor es semanal.

Origen: el 11/11/2026 dos sesiones vieron «HTTP 000» al leer n8n desde la
oficina. Era un cortafuegos en el camino, no una caída, y la única forma de
saberlo fue escribirle a un demo desde un celular.

## Las tres fuentes

| Fuente | Qué prueba | Dónde vive | Cómo avisa |
|---|---|---|---|
| **Latido** (flujo `Flujos/latido-n8n.json`, cada 5 min) | n8n PROCESA: planificador, motor y salida a internet | Sale de n8n hacia un chequeo de Healthchecks.io | Correo de Healthchecks si calla 15 min |
| **Sonda de GitHub** (`.github/workflows/monitor-n8n.yml`, cada 10 min) | n8n RESPONDE en `/healthz/readiness` (base conectada), el dominio resuelve y el certificado es válido | GitHub Actions | Correo de GitHub al fallar dos rondas seguidas, y un chequeo de Healthchecks que avisa si la sonda deja de correr |
| **Sonda de tercero** | Lo mismo, desde otra red y con frecuencia regular | Better Stack | Correo de Better Stack |

Ninguna pasa por n8n, por la VM ni por la clave de correo que vive en la VM.
Ninguna consulta una ruta de webhook: son URL de capacidad y crearían
ejecuciones. `/metrics` sigue apagado.

## Cómo leer una alerta

| Lo que se observa | Qué es |
|---|---|
| Una sola fuente falla una vez | Nada (parpadeo) |
| Una sola fuente falla y las demás están bien | **Sospecha**: un corte en el camino de esa red |
| Latido en silencio **y** una sonda externa fallando | **Incidente: n8n o la VM caídos** |
| Latido en silencio y las sondas dan 200 | **Incidente: n8n responde pero no procesa** |
| Latido al día y las dos sondas externas fallan | **Incidente de entrada**: dominio, certificado o proxy |
| Certificado con menos de 14 días | Aviso: la renovación automática no está corriendo |

**Un correo es sospecha; dos correos de fuentes distintas en 15 minutos son
incidente.**

La sonda de GitHub nombra la causa en `estado`:

| `estado` | Significa |
|---|---|
| `no_resuelve` | El nombre no resuelve (DNS dinámico caído) |
| `sin_conexion` | Nadie escucha: proxy o VM caídos |
| `tiempo_agotado` | No respondió en 10 s |
| `tls` | Certificado vencido o inválido |
| `http_5xx` | El proxy vive y n8n no (502/504), o la base está caída (503) |
| `http_otro` | Respuesta inesperada (redirección, 404) |

En el registro de Healthchecks, el código de la sonda distingue **1 = n8n no
responde** de **2 = el monitor está mal configurado**.

## Reporte diario y latido del monitor

- **Diario** (`.github/workflows/monitor-n8n-reporte.yml`, 08:10 de La Paz):
  comenta en la Issue «Monitor n8n — reporte diario» cuántas sondas corrieron en
  24 h y cuántos días le quedan al certificado. La corrida **falla una vez al
  día** (un correo de GitHub) si la sonda casi no corrió, si la última falló o
  si el certificado tiene menos de 14 días.
- **Semanal**: el informe de los lunes de Healthchecks, con el estado de sus
  chequeos.
- **Si el reporte falta**: los workflows programados se desactivan juntos, así
  que el chequeo de la sonda calla y Healthchecks avisa.

## Regla para las sesiones

Antes de afirmar «n8n está caído» por un error visto desde la laptop, se mira
la última corrida del monitor:

    gh run list --workflow monitor-n8n.yml --limit 3

Esa consulta va a GitHub: no pasa por el dominio de n8n ni por el cortafuegos
de la oficina.

## Configuración (nada de esto está en el repositorio)

- Variable de repositorio `MONITOR_N8N_ACTIVO = si`: enciende el job programado.
- Environment `monitor-n8n`, **limitado a la rama `main`, sin revisores ni
  espera** (con cualquiera de los dos el job programado no correría nunca), con
  los secretos `MONITOR_N8N_URL` y `MONITOR_N8N_PING_URL`.
- El id del chequeo del latido: fila `REEMPLAZAR_ID_PING_LATIDO_N8N` de la tabla
  local de marcadores.
- El correo de falla de GitHub llega a **quien modificó por última vez la línea
  `cron`** del workflow.

## Los ids de los chequeos son URL de capacidad

Quien tenga el id de un chequeo puede simular latidos (y tapar una caída) o
forzar alertas falsas. No expone ningún dato. Por eso:

- viven solo en la tabla local de marcadores, en n8n y en el Environment de
  GitHub; nunca en el repositorio, el chat, un ticket o una captura;
- los secretos de GitHub se cargan con `scripts/monitor/cargar-secretos-monitor.sh`
  (seco por omisión; los valores viajan por la entrada estándar);
- **si un id se filtra**: crear un chequeo nuevo en Healthchecks, borrar el
  anterior y reponer el valor (`marcador-local.sh --reemplazar` y volver a
  publicar el flujo, o el script de secretos para la sonda);
- el registro de pings de Healthchecks muestra la IP de origen: un latido desde
  una IP que no sea la de la VM es la señal de un id filtrado.

## Prueba sin tocar producción

Corrida manual con `simulacro = host_inexistente`: sondea un host `.invalid`,
no lee el secreto del host y no avisa a Healthchecks. Debe terminar en falla
con `estado=no_resuelve` y llegar el correo de GitHub.

## Límites (verificados el 12/11/2026 en la documentación oficial)

- GitHub Actions: intervalo mínimo 5 min; el `schedule` puede retrasarse o
  descartarse con carga alta; solo corre en la rama por defecto; se desactiva
  tras 60 días sin actividad en un repositorio público; runners estándar gratis
  en repositorios públicos. Por eso la sonda de GitHub es la segunda red y no la
  primaria.
- Healthchecks.io (plan gratuito): 20 chequeos. Better Stack (plan gratuito): 10
  monitores y latidos en total.

## Lo que no cubre

- La entrada de un mensaje de punta a punta (Meta → receptor de clientes → n8n):
  la vigila el dueño del receptor, no este monitor.
- Las Functions de Firebase y el saldo del modelo: otro frente.
