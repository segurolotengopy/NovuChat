# Checklist de ensayo — Demos NovuChat (imprimir o marcar en pantalla)

> Derivado de las tablas de prueba de Silvana (suites del `03-plan-demos.md`
> §4). **Regla:** un demo se da por listo cuando TODAS sus casillas pasaron en
> un teléfono real, no antes. Ensayo general: 6–7/09. Congelamiento: 8/09.

## Preparación (una sola vez, antes de ensayar)

- [ ] Los 5 números registrados en el número de prueba de la app A (y de la B)
- [ ] Flujo activado en n8n y webhook **en verde** (Bloque 6 de la guía Meta)
- [ ] Calendario "NovuChat Demo A" creado, con `calendario-demo-relleno.ics`
      importado y su ID cargado en `Config del negocio`
- [ ] `qr-demo.png` alojado en URL pública y cargada en `Config del negocio` (Demo B)
- [ ] Celular "del dueño" definido y cargado en `numeroDueno` (Demo B)

## Suite Demo A — Agendamiento (Belleza y Salud)

- [ ] A1 · "Hola, ¿qué servicios tienen y cuánto cuestan?" → catálogo de
      belleza CON precios en Bs + pregunta de cierre ("¿Te gustaría agendar?")
- [ ] A2 · "Quiero agendar un corte para el viernes en la tarde" → propone
      **máximo 3 horarios exactos**, todos en la tarde del viernes correcto,
      todos realmente libres en el calendario, ninguno en el pasado
- [ ] A3 · "Me quedo con el de las 15:00" → pide el nombre (si no lo dio),
      el evento **aparece en Google Calendar** como "Cita <nombre> — Corte",
      confirma servicio + día + hora y se despide
- [ ] A4 · "¿Qué especialidades de salud atienden?" → lista SIN precios +
      ofrece agendar evaluación
- [ ] A5 · "¿Cuánto cuesta una curación?" → NO da precio; explica que depende
      de la evaluación y redirige a la cita de diagnóstico
- [ ] A6 · "Quiero ir mañana en la mañana" → propone horarios de la mañana
      de mañana (calendario de relleno: deben salir ~10:00, 11:30 o 13:00)
- [ ] A7 · "No puedo a esas horas, ¿en la tarde?" → retiene que es MAÑANA y
      propone solo horarios de tarde de ese mismo día (memoria funciona)
- [ ] A8 · Tercer rechazo consecutivo → se disculpa, anuncia transferencia a
      recepción, el mensaje al cliente NO muestra la marca `[TRANSFERIR]`, y
      **llega el aviso al celular de recepción**

## Suite Demo B — Venta y cobro (Gastronomía y Retail)

- [ ] B1 · "Hola" → llega la **lista interactiva** con las 3 opciones
      (Delivery / Recoger / Ver menú)
- [ ] B2 · Elegir "Delivery" y pedir "1 hamburguesa doble y 1 gaseosa" →
      pregunta por notas especiales
- [ ] B3 · "Sin tomate por favor y la gaseosa zero" → registra las notas y,
      como YA eligió Delivery, NO vuelve a preguntar la modalidad; pide la
      dirección (escenario A de la ayuda memoria)
- [ ] B3b · Repetir desde "Ver menú": tras las notas SÍ pregunta la modalidad
      (escenario B)
- [ ] B4 · "A Obrajes, calle 2" → total desglosado (comida + 7 Bs de envío) y
      **llega la imagen del QR** con el caption "🧪 DEMOSTRACIÓN — este QR no cobra"
- [ ] B5 · Enviar cualquier foto (el "comprobante") → "Pago verificado
      (simulado — demo)" + resumen del pedido + tiempo estimado + puntos, y
      **suena el celular del dueño** con el resumen
- [ ] B6 · Retail: "Quiero una chaqueta negra" → pregunta la talla antes de cobrar
- [ ] B7 · "Talla M, ¿hacen envíos a Oruro?" → pide Nombre completo y CI, y
      confirma el celular con el número del remitente ("¿usamos este mismo…?")
- [ ] B8 · Intentar pagar sin dar CI → el bot NO entrega el QR
- [ ] B9 · "Juan Pérez, CI 1234567" → total con recargo de terminal (10 Bs) + QR

## Casos hostiles (ambos demos)

- [ ] H1 · Sticker, audio y ubicación → respuesta cortés "por ahora atiendo
      por texto"; en n8n la ejecución termina SIN error
- [ ] H2 · Dos celulares conversando a la vez → cero cruce de contexto
- [ ] H3 · "¿Venden pizza?" (Demo B) / "¿Hacen tatuajes?" (Demo A) → dice que
      no está en el catálogo, sin inventar
- [ ] H4 · "¿Eres un robot?" → no lo niega, lo dice con naturalidad y sigue
- [ ] H5 · Mensaje doble rápido (dos textos seguidos) → responde coherente,
      sin duplicar QR ni citas
- [ ] H6 · Silencio de 30+ min y volver a escribir → conversación coherente
      (con Window Buffer la memoria persiste mientras n8n no se reinicie;
      verificar que no confunda un pedido viejo con el nuevo)
- [ ] H7 · Acuses de entrega/lectura NO generan ejecuciones del agente
      (revisar en n8n → Executions: solo mensajes reales)

## Cierre del ensayo general (7/09)

- [ ] Grabar el **video de respaldo** de cada guion feliz (pantalla + celular)
- [ ] Actualizar `Simulador.html` con los textos reales de los flujos
- [ ] Exportar ambos flujos a JSON → repo Git (sin secretos, criterio D-15)
- [ ] 8/09: CONGELAMIENTO — no se toca ningún flujo hasta después del 10/09
