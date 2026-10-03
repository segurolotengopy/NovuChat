# Caché de Gemini: qué se puede activar, cuánto rinde y qué exige

**28-sep-2026.** Sesión de análisis financiero y comercial. Andres pide evaluar
la activación de la caché junto con la prueba de Gemini 3.7 Flash
(`Analisis/44`). Modelo reproducible: `Analisis/45-modelo-cache-gemini.py`, que
reutiliza los tokens medidos de `43` y los escenarios de `44`.

> **Actualización del 01/10/2026:** la caché **solo importa en los flujos con agente** (Demo A,
> Platinum, Demo B, captación). «Agenda mínima» (`Analisis/43` §8) manda prompts de 800 a
> 1.100 tokens, por debajo del mínimo de caché de Google, y Gemini ya es el 2,5 % de su costo
> variable: ahí no hay nada que ahorrar con caché. Los requisitos del §7 quedan para cuando se
> trabaje sobre los flujos con agente.

---

## 0. Conclusión, adelantada

| | |
|---|---|
| **La caché implícita ya está activa; no hay nada que «encender»** | Google la aplica sola desde los modelos 2.5, sin almacenamiento y sin garantía. Lo que se puede hacer es **ayudarla a acertar y medir cuánto acierta**. Hoy nadie lo sabe: n8n no guarda el dato |
| **`Analisis/43` y `44` supusieron el techo** | Su escenario «con caché» contaba el 100 % de aciertos sin costo. Una estimación realista de la implícita da entre el 50 % y el 85 %. Con 3.7 Flash al precio de 2027 y mejora media, **el margen de Crecimiento no es 6 %, es −9 %** (§3). Esta corrección empeora el caso del cambio de modelo |
| **La caché explícita no se puede con el nodo de n8n** | El sub-nodo de chat de Gemini de n8n 2.36.5 no tiene `cachedContent` (revisado en el paquete). Para usarla hay que llamar a Gemini con un **conector propio**. Es la misma construcción que hace falta para fijar el razonamiento (`44` §4): **una sola obra resuelve las dos palancas** |
| **Explícita por comercio: conviene con 3.7, no con Flash-Lite** | Cada comercio paga su propio almacenamiento: USD 2,40 (2026) a 4,75 (2027) al mes por cada prompt distinto. Con 3.7 Flash conviene desde **70 a 280 conversaciones al mes**; con Flash-Lite, desde **290 a 990**. Con Flash-Lite no vale la pena construirla (§4) |
| **La palanca más barata: ordenar el prompt por capas** | El 90 % del prompt de reservas es texto igual para todos los comercios, pero hoy **empieza con el nombre del asistente y del negocio**: el prefijo común entre comercios es de 95 caracteres. Si el prompt va *núcleo → módulo → comercio*: (a) la implícita acierta con el tráfico de **todos** los comercios, no de uno; (b) la explícita pasa a ser **una caché por módulo** (~USD 4 al mes en total), no una por comercio. Es el «prompt por capas» que F3b ya tiene en el plano (§5) |
| **La caché sola no rescata a 3.7 Flash en 2027** | Hace falta combinarla con razonamiento bajo y con la mejora de calidad. Con las tres juntas —explícita por módulo, razonamiento de 300 tokens y mejora fuerte— el margen de Crecimiento vuelve al 37 % (§3.2) |

---

## 1. Las dos cachés

| | Implícita | Explícita |
|---|---|---|
| Cómo se activa | Sola, desde Gemini 2.5 | Se crea un objeto de caché con el prompt de sistema y las herramientas, y cada petición lo nombra |
| Cuándo acierta | Cuando llega otra petición con el **mismo prefijo** poco después. Google no dice cuánto dura | Siempre, mientras viva (TTL; 1 hora por defecto, sin tope) |
| Qué se paga | Los tokens que aciertan, a precio de caché (el 10 % de la entrada). Nada más | Lo mismo, **más el almacenamiento por hora**: 1,00 USD por millón de tokens y hora (Flash-Lite y 3.7 en 2027), 0,50 (3.7 en 2026) |
| Garantía | Ninguna («sin garantía de ahorro») | Total |
| Mínimo | 4.096 tokens en la familia Flash; Flash-Lite 3.x no figura en la tabla | El mismo |
| En n8n 2.36.5 | **Funciona**, sin tocar nada | **No se puede**: el sub-nodo no admite `cachedContent` |
| Cómo se mide | `usageMetadata.cachedContentTokenCount` de la respuesta de Google; **n8n no lo guarda** | Igual |

**El mínimo de 4.096 tokens deja afuera al Demo B con 3.7 Flash.** El prompt de
venta mide unos 3.500 tokens, así que con un modelo de la familia Flash no
tendría caché de ningún tipo. Reservas (~7.500) y captación (~8.400) sí llegan.

---

## 2. Cuánto acierta hoy la implícita (estimado)

Dentro de una misma respuesta, la segunda llamada al modelo y las siguientes
llegan segundos después con el mismo prefijo: casi siempre aciertan. **La
primera llamada de cada respuesta** depende de si el mismo comercio tuvo otra
petición hace poco. Un consultorio con 7 conversaciones al día tiene pausas
largas.

| Escenario | Primera llamada acierta | Aciertos totales, Flash-Lite (2,2 llamadas) | Aciertos totales, 3.7 (1,6 llamadas) |
|---|---|---|---|
| Pesimista | nunca | 49 % | 34 % |
| **Central** | **40 %** | **67 %** | **59 %** |
| Optimista | 80 % | 85 % | 84 % |

**Con un modelo mejor, la implícita acierta menos.** Si 3.7 hace menos llamadas
por respuesta, quedan menos llamadas «hermanas» que aprovechen la caché de la
primera. Es un efecto chico, pero va en contra.

---

## 3. Qué le hace al margen

### 3.1 Gemini por conversación de reservas (comercio de 220 conversaciones al mes)

| | Sin caché | Implícita central | Implícita optimista | Explícita por comercio | Implícita reordenada (§5) | **Explícita por módulo (§5)** |
|---|---|---|---|---|---|---|
| Hoy: 3.5 Flash-Lite | 0,051 | 0,029 | 0,023 | 0,039 | 0,024 | **0,021** |
| 3.7 en 2026, mejora media | 0,110 | 0,078 | 0,065 | 0,067 | 0,067 | **0,061** |
| 3.7 en 2027, mejora media | 0,219 | 0,157 | 0,130 | 0,134 | 0,134 | **0,121** |

Con Flash-Lite, **la explícita por comercio sale más cara que la implícita**:
con 220 conversaciones, el almacenamiento pesa más que lo que ahorra.

### 3.2 Margen de contribución al 100 % del cupo: 3.7 Flash en 2027

Razonamiento «medium» (800 tokens por llamada) contra «low» (300, supuesto), y
mejora media contra fuerte (`44` §2):

| Escenario | Caché | Impulso | Crecimiento | Pro | Platinum |
|---|---|---|---|---|---|
| Hoy: 3.5 Flash-Lite, implícita central | | 56 % | 42 % | 21 % | 37 % |
| Mejora media, medium | implícita central | 5 % | **−9 %** | −44 % | −12 % |
| | explícita por módulo | 18 % | 7 % | −24 % | 3 % |
| Mejora media, low | implícita central | 23 % | 11 % | −19 % | 7 % |
| | explícita por módulo | 36 % | 27 % | 1 % | 22 % |
| Mejora fuerte, low | implícita central | 31 % | 23 % | −4 % | 18 % |
| | **explícita por módulo** | **43 %** | **37 %** | **14 %** | **31 %** |

**Cómo leerlo.** Cada palanca sola no alcanza. Las tres juntas —caché por
módulo, razonamiento bajo y menos reintentos— dejan a 3.7 Flash en 2027 **unos
5 puntos por debajo de hoy**. Ese es el precio de la calidad, y es razonable
pagarlo si la calidad sube de verdad. Pro sigue siendo el plan con menos
colchón: es donde Meta ya se lleva el 41 %.

---

## 4. Explícita por comercio: desde cuándo conviene

Conversaciones al mes de un comercio desde las cuales la explícita (24 h,
USD 2,40 a 4,75 al mes de almacenamiento) cuesta menos que la implícita:

| | contra implícita pesimista | central | optimista |
|---|---|---|---|
| Hoy: 3.5 Flash-Lite | 290 | 440 | 990 |
| 3.7 Flash (2026 o 2027) | 70 | 110 | 280 |

Si se sube a 3.7, casi todo cliente de pago la justifica (los planes son de
100, 220 y 500). Pero tiene un costo que no aparece en la tabla:
**el almacenamiento se vuelve un fijo por comercio.** Un demo, un comercio en
prueba o uno que no tuvo conversaciones pagan igual, salvo que el TTL siga su
horario de atención (14 h: USD 1,40 a 2,80 al mes). La explícita **por módulo**
(§5) no tiene ese problema.

---

## 5. La palanca que no cuesta: el orden del prompt

Lo que se midió en los tres prompts de reservas:

| | Demo A | Platinum | Bellido |
|---|---|---|---|
| Texto fijo de la plantilla (sin variables) | 90 % | 91 % | 95 % |
| Igual al del Demo A | — | 100 % (Platinum contiene la plantilla entera) | 86 % |
| **Prefijo común literal entre los tres** | **95 caracteres** | | |

El texto es casi todo común, pero la caché **solo reutiliza prefijos**, y el
prompt arranca con «Eres {asistente}, … de {negocio}». Desde el carácter 130 ya
es distinto en cada comercio, así que hoy cada comercio tiene su propia caché
implícita, alimentada solo por su propio tráfico.

**Si el prompt se ordena por capas** —primero el núcleo común (reglas, candado,
«solo lo que se cumple»), después el módulo (herramientas y reglas de reservas),
al final el comercio (nombre, catálogo, horarios, personal)—:

1. **La implícita acierta con el tráfico de todos los comercios del módulo.** Con
   diez clientes de reservas, el núcleo casi siempre está caliente. Solo con
   eso, Flash-Lite pasa de 0,029 a 0,024 USD por conversación, sin construir
   nada.
2. **La explícita pasa a ser una caché por módulo**, no por comercio: ~5.600
   tokens por módulo, unos USD 4 al mes **en total**, repartidos entre todos.
   Deja de ser un fijo por comercio.
3. **Es lo que el plano ya dice.** F3b incluye el «prompt por capas»
   (`Analisis/41`; `COORDINACION.md`, fila F3b). Lo que este análisis agrega es
   un **requisito comercial** para esa obra: la capa del comercio va **al
   final**, y nada que cambie por comercio ni por conversación va antes del
   núcleo. La fecha y la hora ya van en el mensaje del usuario, bien puestas.

Dos cuidados para que el prefijo siga siendo idéntico:
- **El orden del catálogo y de las listas tiene que ser determinista.** Si el
  catálogo sale en otro orden en dos consultas seguidas, la caché de esa capa
  falla.
- Un cambio de configuración del comercio invalida su capa. Con la explícita,
  hay que recrear el objeto; con la implícita, no pasa nada.

---

## 6. Lo que exige la explícita (para la Planificadora, cuando se decida)

Se dimensiona aquí para que la decisión se tome sabiendo qué compra:

| Exigencia | Por qué |
|---|---|
| **Un conector de modelo propio** (llamada directa a `generateContent`) en lugar del sub-nodo de n8n | El sub-nodo no admite `cachedContent` ni `thinking_level`. El mismo conector resuelve las dos cosas |
| El prompt de sistema **y las herramientas** van dentro del objeto de caché | Así lo pide la API cuando la petición usa `cachedContent`; la parte del comercio viaja como contenido. **Hay que probar que el modelo respete igual las instrucciones del comercio** |
| Un objeto por cada prompt distinto (agente principal, «Reintento tras cruce», seguimientos…) | Cada uno es un prefijo distinto |
| TTL y renovación; recrear cuando cambia el núcleo o el módulo (por versión) | Si no, se paga la entrada completa sin avisar |
| **Choca con una invariante de `CLAUDE.md`**: «Modelo como sub-nodo intercambiable» | Salir del sub-nodo es una decisión de diseño de Andres. Se puede conservar el espíritu si el conector es una pieza del core con interfaz fija, que cambie de proveedor sin tocar el flujo, como el conector de canal de F4 |

---

## 7. Recomendación, en orden

1. **Nada que activar hoy.** La implícita ya corre. **En la prueba de 3.7 Flash,
   medir los aciertos** con `cachedContentTokenCount` de la respuesta de Google
   (n8n no lo guarda). Es la cifra que decide entre las columnas de §3.
2. **Pedir a F3b el orden por capas con el comercio al final** como requisito
   comercial. No cuesta mensajes, mejora la caché con cualquier modelo, y
   convierte la futura explícita en una por módulo.
3. **Si se adopta 3.7 Flash**, construir el conector de modelo propio con caché
   explícita **por módulo** y razonamiento en «low». Sin las dos, 3.7 al precio
   de 2027 deja márgenes negativos en los planes grandes. Es una decisión de
   diseño (§6) y le corresponde a Andres.
4. **No construir la explícita por comercio.** Con Flash-Lite no conviene, y con
   3.7 la por módulo es mejor y no crea un fijo por cliente.
5. **Corrección a `43` y `44`:** su escenario «con caché» es el techo de la
   implícita, no su valor esperado. Las decisiones deberían usar la columna
   «central» hasta que la prueba mida el acierto real.

Fuentes de Google consultadas el 28/09/2026:
[precios](https://ai.google.dev/gemini-api/docs/pricing),
[caché](https://ai.google.dev/gemini-api/docs/caching),
[caché con generateContent](https://ai.google.dev/gemini-api/docs/generate-content/caching),
[razonamiento](https://ai.google.dev/gemini-api/docs/thinking).
