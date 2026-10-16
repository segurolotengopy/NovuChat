# El coordinador de turno

> Pieza con nombre propio de la arquitectura por capas
> (`Analisis/41-arquitectura-por-capas.md` §1.1 y §2). Destino de las secciones
> de `admin/DISENO.md` que describen el turno (cómo n8n consulta la
> configuración y cómo escribe la ingesta). Sin secretos ni identificadores.

## Definición

**Recibe un mensaje normalizado, le pide a Central el contexto de la cuenta,
llama a los ganchos de los módulos encendidos, y devuelve el reporte de turno.**
Es el único código que conoce a todas las zonas. Hoy son `configuracionFlujo` e
`ingesta` más los nodos comunes de n8n.

**Dependencias permitidas:** el coordinador depende de todo, **pero solo a
través del registro de módulos** (`registro.md`). El core no nombra a ningún
módulo: el coordinador recorre los módulos encendidos para ese tenant en el
orden del registro.

## Dónde vive

El coordinador de turno es `admin/functions/src/ingesta.ts`, en la raíz de
Functions hasta F3b: tiene su línea de coordinador en `ZONA_POR_ARCHIVO`
(`admin/pruebas/frontera/frontera.ts`) y la lista de lo que se parte en
`SE_PARTE` (seña, inventario, captación, campañas y cobro de venta).
`admin/functions/src/ganchos.ts` (F3b-1b) es el segundo archivo coordinador de
la raíz: une el contrato de `registrarCierre` (Core) con los ganchos de Cobros
y de Agenda (ver «El cierre» abajo). `index.ts` también es coordinador y solo
reexporta. `fronteras.test.ts` toma
de `index.ts` el archivo que reexporta la Function `ingesta` y exige que sea
coordinador: no lo fija como una constante de ruta, porque F3b lo mueve.

## Las dos llamadas por turno (`Analisis/41` §2.2 y §2.3)

No se agregan llamadas: las dos por turno ya existen.

1. **Contexto de turno** (`configuracionFlujo`): lo que el core pide a Central
   antes de responder. Se conserva la llamada y se ordena su contenido en tres
   bloques, que son los tres ejes de la cuenta:

   ```
   { operativo: true | { motivo, mensajeCortesia },           ← modalidad
     modulos: { agenda: { limites, config }, cobros: {...} }, ← plan + config del tenant
     negocio: { identidad, horarios, voz, instruccionesVigentes, fecha y hora },
     atencion: { estado, mensajesVentana } }                    ← core, conteo
   ```

2. **Reporte de turno** (`ingesta`): lo que el core hace después de responder.
   Se conserva la llamada y se parte por dentro en el coordinador más los
   ganchos (`antesDelTurno`, `despuesDelTurno`, `alCierre`, `alCambiarConfig`,
   `programado`; tabla en `modulos.md`).

`ingesta.ts` (2.130 líneas) va a `functions/src/core/turno/` y **se parte**:
coordinador más los ganchos de seña, inventario, captación, campañas y cobro de
venta, que vuelven a sus módulos.

## El cierre (`registrarCierre`): ganchos inyectados (F3b-1b, 05/10/2026)

`registrarCierre` es Core (`core/turno/cierres.ts`) y **ya no importa nada de
arriba**: exporta el contrato y una fábrica, `crearRegistrarCierre(ganchos)`, y
recibe sus ganchos ya armados. Quien los arma es `admin/functions/src/ganchos.ts`
(coordinador), que exporta `GANCHOS_DEL_CIERRE = { cobro: COBRO_AL_CIERRE,
solicitud: SOLICITUD_AL_CIERRE } satisfies GanchosDelCierre` y
`registrarCierre = crearRegistrarCierre(GANCHOS_DEL_CIERRE)`; `index.ts`
reexporta ese `registrarCierre` (mismo nombre, mismas opciones y secretos).

- **Dos puertos con nombre fijo y obligatorios**, no una lista genérica de
  módulos: `cobro` (`modulos/cobros/alCierre.ts`: `cobroRealActivo(leer)` y
  `cierreDeVentaLoHaceElCotejo(previa, ahoraMs)`) y `solicitud`
  (`modulos/agenda/alCierre.ts`: `solicitudTrasElCierre(previa, ahoraMs,
  { cobroReal })`). Recorrer los módulos encendidos del tenant en el orden del
  registro es F3b-2 y exige `tenants.modulos`.
- **Los ganchos nunca reciben la `Transaction` ni `db`.** Reciben un lector de
  solo lectura anclado al tenant de la firma (`LeerDelTenant`, con
  `rutaDelTenant`: solo `<colección>/<documento>` con `[A-Za-z0-9_-]`) y
  devuelven decisiones; **Core escribe todo** (cierre, `privado`, `metricas`,
  `cierres` y la `solicitud`). Son puros: Firestore reintenta la transacción
  entera y un gancho con efectos se ejecutaría dos veces. El conteo no cambia, y
  tampoco las lecturas por cierre (la de `config/venta`, solo si la solicitud
  lo pide).
- **Tres capas contra el gancho olvidado:** de tipos (interfaz sin campos
  opcionales y `satisfies`), de carga (`crearRegistrarCierre` lanza `registrarCierre:
  falta el gancho <puerto>.<función>`) y de captura (las funciones se capturan al
  crear el endpoint: mutar el objeto después no cambia nada). Un registro global
  mutable se descartó: si un módulo no se importa, el cierre deja de cerrar la
  solicitud en silencio y el barrido de seguimientos le escribe a quien ya agendó.
- **Pruebas:** `pruebas/core/cierres-contrato.test.ts` (compila programas
  virtuales: sin gancho no compila), `pruebas/core/cierres-ganchos.test.ts`
  (emulador, ganchos falsos, atomicidad), `pruebas/modulos/cobros/al-cierre.test.ts`,
  `pruebas/modulos/agenda/al-cierre.test.ts` y `pruebas/ganchos-del-cierre.test.ts`
  (que cada puerto sea la función correcta). La equivalencia con el código
  anterior la fija `pruebas/modulos/agenda/solicitud-equivalencia.test.ts`, con
  un golden generado antes de mover nada.

## Pendiente F3b

- **El corte de `ingesta.ts`** (coordinador más ganchos). La deuda de
  `deuda.json` es **0 cruces** desde F3b-1b: ya ningún archivo de Core ni de un
  módulo importa de `ingesta.ts`. Lo que falta del corte es mover los ganchos
  de seña, inventario, captación, campañas y cobro de venta que siguen dentro de
  `ingesta.ts`, y recorrer los módulos encendidos por el registro (F3b-2).
- **De la solicitud, no del registro de eventos:** `solicitudTras`,
  `ETAPAS_PENDIENTES` y el tipo `Solicitud` viven desde F3b-1a en
  `modulos/agenda/solicitud.ts`, `MINUTOS_RETENCION_POR_DEFECTO` en
  `modulos/agenda/retencion.ts` y `milisegundosDe` en `core/turno/tiempo.ts`;
  `ingesta.ts` los reexporta. Los predicados de la regla 2 y la ventana de 24 h
  (`MS_VENTANA_DEL_CASO`) viven desde F3b-1b en `modulos/cobros/`.
- **La separación seña/prepago:** `sena.ts` ya no importa `ingesta.ts`, así que
  el camino `sena.ts → ingesta.ts → prepago.ts` ya no existe.
- **§5.1 de `Analisis/41`** manda `ingesta.ts` (coordinador) a `core/turno/`,
  contra «carpeta = zona»: se resuelve en F3b, al partirla.

## Flujo delgado, gradual (`Analisis/41` §6.1.3)

Lo determinista de un módulo vive en el servidor bajo los ganchos; en n8n queda
lo que necesita credenciales de n8n (disparador, agente, memoria, Calendar,
envío hasta F4).

## Secciones movidas desde `admin/DISENO.md`

Texto original, sin cambios. Cada bloque dice de qué sección viene.


<!-- movido de admin/DISENO.md §4bis.4 (25/09/2026, líneas 549-625) -->

### 4bis.4 Varios flujos y varios números

Habrá **al menos tres flujos** —Demo A (agendamiento), Demo B (venta y cobro) y
uno interno de NovuChat— y **cada comercio necesita su propio número**.

**El camino de resolución.** El webhook de Meta no trae el identificador del
comercio: trae `entry[0].changes[0].value.metadata.phone_number_id`.

```
Meta ──► n8n
          │  phone_number_id del payload
          ▼
        elige el secreto HMAC de ESE número, firma
          │
          ▼
   Cloud Function ──► /rutasWhatsApp/{phoneNumberId}
                        └─► { tenantId, flujo, wabaId, estado }
                              │
                              ▼
                        /tenants/{tenantId}/...
```

**Por qué una colección de índice inverso y no una consulta sobre `/tenants`.**
Un `where('waPhoneNumberId','==',id)` exigiría permiso de listado sobre la
cartera entera de clientes —justo lo que la amenaza T-12 prohíbe— y además un
índice compuesto. Acá el `phone_number_id` **es la clave del documento**: la
resolución es una lectura directa, sin índice y sin abrir ningún listado. Nadie
la lee desde el navegador salvo el propietario; n8n no la toca, la consulta la
Function con el SDK Admin **después** de validar la firma.

**El secreto HMAC pasó a indexarse por número, no por comercio.** Si se indexara
por comercio, n8n tendría que resolver número → comercio *antes* de poder firmar,
y para resolverlo necesitaría una credencial: un círculo. Indexando por número,
n8n toma el `phone_number_id` que ya viene en el payload, elige el secreto y
firma. **La propiedad que importa se conserva intacta: el comercio se deriva de
la clave que valida la firma, jamás del cuerpo de la petición.** Solo cambió el
paso intermedio.

**Unicidad.** `asignarNumero` corre en una transacción y rechaza asignar un
`phone_number_id` que ya apunta a otro comercio. Si un número pudiera apuntar a
dos, las conversaciones de uno se escribirían en el otro: una fuga de datos
provocada por un error de dedo, no por un atacante.

**Un comercio puede tener varios números**, uno por vertical: dos documentos en
`/rutasWhatsApp` con el mismo `tenantId` y distinto `flujo`. Y dos secretos HMAC
distintos, así que comprometer uno no alcanza al otro.

#### El techo de crecimiento del producto

Esto no es un detalle de implementación: es un límite comercial que conviene
tener escrito antes de prometerle plazos a un cliente.

| Límite | Valor | Consecuencia |
|---|---|---|
| Números por WABA, por defecto | **2** | alcanza para dos comercios, o para un comercio con dos verticales |
| Números por WABA, ampliado | **hasta 20** | requiere trámite y verificación de negocio ante Meta |
| Más de 20 | hacen falta **más WABA** | y cada WABA cuelga de un portafolio comercial |
| Portafolios por cuenta personal sin verificar | **2** | ya anotado como riesgo vivo en `ESTADO.md` |

Lecturas de producto:

- **Con una WABA verificada, el techo son 20 comercios** (un número cada uno). No
  es poco para empezar, pero se toca antes de lo que parece si algún comercio
  usa dos verticales.
- **El comercio número 21 no obliga a cambiar código: obliga a un trámite de
  Meta.** Los trámites de Meta se miden en días o semanas, no en horas, y no
  dependen de NovuChat. Hay que iniciar la verificación de negocio y la
  ampliación de números **mucho antes** de necesitarlas, no cuando ya hay un
  contrato firmado.
- Guardar `waWabaId` en la ficha del comercio permite contar cuántos cuelgan de
  cada WABA y ver venir el techo. Conviene una métrica de plataforma que lo
  muestre.
- Esto convive con la restricción ya conocida del número de prueba: hasta 5
  destinatarios registrados, que aplica a los demos y no a producción.

---


<!-- movido de admin/DISENO.md §5 (25/09/2026, líneas 3005-3006) -->

## 5. Integración con n8n


<!-- movido de admin/DISENO.md §5.1 (25/09/2026, líneas 3007-3013) -->

### 5.1 Lo que va en cada sentido

```
n8n ──► panel :  cada mensaje entrante y saliente, más los contadores.
panel ──► n8n :  la configuración del negocio (horarios, catálogo, mensajes).
```


<!-- movido de admin/DISENO.md §5.2 (25/09/2026, líneas 3014-3055) -->

### 5.2 Cómo escribe n8n sin una credencial compartida entre todos

**Lo que está prohibido:** una clave JSON de cuenta de servicio guardada en n8n.
Es de larga duración, no caduca sola y tiene alcance de **proyecto entero**, o
sea de todos los negocios a la vez. Si la VM de OCI se compromete, se van todos
los clientes juntos. Es exactamente la credencial que el encargo pide evitar.

**Lo que se hace:**

1. **Un secreto HMAC por número de WhatsApp**, en Secret Manager y en las
   credenciales de n8n. Uno por número, no uno para todos. Un comercio con dos
   verticales tiene dos secretos. El secreto **no se nombra por el número**: se
   nombra por un **alias** (`demoA`, `demoB`) y quién es cada alias vive en
   `/rutasWhatsApp/{numero}`. El motivo es que `defineSecret` exige un nombre
   fijo escrito en el código y este repositorio es público, así que el nombre no
   puede contener un `phone_number_id`. La verificación vive en
   `functions/src/core/seguridad/firma.ts` y la usan **los tres endpoints** de n8n: ingesta,
   configuración y cierres.
2. n8n firma cada petición: `HMAC-SHA256(secreto, timestamp + "." + cuerpo)`.
   **El secreto no viaja**; viaja una firma. Un `Authorization: Bearer` queda
   escrito en los logs de cualquier proxy intermedio; una firma no sirve de nada
   una vez usada.
3. Ventana de 5 minutos sobre el timestamp: acota la reproducción de una petición
   capturada.
4. **El comercio se deriva de la clave que valida la firma, nunca del cuerpo.**
   Este es el control central contra el *diputado confundido*: aunque n8n mande
   `{"tenantId": "otro-negocio"}`, ese campo se ignora por completo — el comercio
   sale del índice `/rutasWhatsApp`, resuelto desde el número que la firma
   acredita. Ver §4bis.4 para por qué el índice del secreto es el número.
5. Comparación de firmas en tiempo constante (`timingSafeEqual`).
6. **El estado del comercio se comprueba en cada petición.** Si no está activo,
   409 y n8n manda el mensaje de cortesía neutro.

**Fase 2, ya prevista en el código.** La función emite además un token de Firebase
Auth efímero (1 h) para el principal `svc_<tenantId>`, con el claim
`{ nc: { t: { "<tenantId>": "ingesta" } } }`. Cuando la escritura pase a hacerse
con ese token contra la API REST de Firestore en vez de con el SDK Admin, la
ingesta quedará sujeta a `firestore.rules` igual que el navegador: un error de
programación en la función dejará de poder cruzar negocios, porque el token no
alcanzaría. Las reglas y las pruebas de aislamiento del rol `ingesta` **ya están
escritas y pasan**; falta solo cambiar el cliente de escritura.


<!-- movido de admin/DISENO.md §5.3 (25/09/2026, líneas 3056-3065) -->

### 5.3 Alternativas descartadas para la ingesta

| Alternativa | Por qué no |
|---|---|
| Clave JSON de cuenta de servicio en n8n | larga duración, alcance de proyecto, compartida entre todos los negocios. Prohibida. |
| Secreto HMAC indexado por comercio | n8n tendría que resolver número → comercio *antes* de poder firmar, y para eso necesitaría una credencial: un círculo. Ver §4bis.4. |
| Workload Identity Federation desde OCI | WIF necesita que el emisor tenga identidad OIDC propia. GitHub Actions la tiene (y por eso el **despliegue sí usa OIDC**); una VM de OCI corriendo n8n no la tiene sin montar un emisor adicional que habría que operar y proteger. |
| `Bearer` con clave por tenant | mejor que una clave única, pero la clave viaja en cada petición y termina en logs de proxy. HMAC cuesta lo mismo y no expone el secreto. |
| Escribir Firestore desde n8n con el SDK cliente | requeriría un usuario de Auth con contraseña guardada en n8n: otra credencial de larga duración. |


<!-- movido de admin/DISENO.md §5.4 (25/09/2026, líneas 3066-3083) -->

### 5.4 Cómo consume n8n la configuración

El nodo `Config del negocio` deja de tener los valores escritos a mano y pasa a
consultar `configuracionFlujo` con el `phone_number_id` del webhook. La función
resuelve el comercio, comprueba su estado y devuelve la configuración con los
campos **separados y rotulados**:
`instruccionesExtra` viene en su propia clave para que el flujo la inserte en una
sección delimitada del prompt, marcada como *dato del negocio*, **nunca
concatenada por delante de las reglas de comportamiento del agente**. Esto es lo
que impide que el texto que un cliente escribe en el panel se convierta en una
instrucción para el modelo (ver `SEGURIDAD.md`, inyección de segundo orden).

Se mantienen intactas las reglas de diseño de flujos de `CLAUDE.md`: clave de
sesión por número de origen, filtro de eventos, normalización de entrada, fecha y
zona inyectadas, modelo como sub-nodo intercambiable.

---
