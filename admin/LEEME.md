# admin/ — Panel administrativo de NovuChat

Pista **paralela** a los demos del 9 y 10 de septiembre. No los bloquea y no toca
nada de `Flujos/`.

- **`DISENO.md`** — arquitectura, modelo de datos, matriz de roles, la decisión
  sobre el proyecto Firebase y la integración con n8n.
- **`SEGURIDAD.md`** — cada regla de seguridad mapeada al diseño, más el modelo
  de amenazas del aislamiento multi-tenant.
- **`firestore.rules`** — el corazón del aislamiento. Está comentado de punta a
  punta: si va a tocar una sola cosa de este directorio, lea eso.

## Estado

| | |
|---|---|
| Andamiaje | escrito y compilando |
| Pruebas de reglas | **99 de 99 en verde**, ejecutadas contra el emulador |
| Pruebas puras del saneo | **13 de 13 en verde**, sin emulador ni red |
| Recursos de nube | **ninguno creado.** Ver `DISENO.md` §11 |

## Cómo trabajar

Requiere Node 24, pnpm y un JDK (para el emulador de Firestore).

```bash
cd admin
pnpm install

pnpm pruebas:reglas     # emulador + 112 pruebas (99 de reglas, 13 puras)
pnpm web:build          # compila el frontend
pnpm functions:build    # compila las Cloud Functions
pnpm verificar          # las tres cosas
```

**Antes de dar por bueno cualquier cambio en `firestore.rules`, corra
`pnpm pruebas:reglas`.** Es el único control automático que impide que una
edición bienintencionada abra el paso entre negocios.

⚠️ **Y si agrega pruebas, agregue también el documento a la semilla.** Casi todas
las pruebas son `assertFails`, y una prueba así pasa igual de bien cuando la
regla deniega que cuando el documento **no existe**: el error es
`permission-denied` en los dos casos. Ya pasó una vez —ocho pruebas de contactos
en verde sin que existiera un solo contacto—. El bloque *Control de la semilla*
está justamente para detectarlo: verifica que cada documento que las demás
pruebas dan por sentado exista de verdad.

### Dos rarezas del entorno, ya documentadas

1. `firebase emulators:exec` falla en la máquina de desarrollo (reporta "port
   taken" en cualquier puerto y deja el proceso Java huérfano). Por eso
   `pnpm pruebas:reglas` llama a `pruebas/correr.sh`, que invoca el jar del
   emulador directamente. En GitHub Actions el CLI funciona normalmente.
2. Los `evaluation error` en el log del emulador son **benignos**: los produce la
   doble evaluación de las escrituras con `serverTimestamp()`. Explicado en la
   cabecera de `pruebas/reglas.test.ts` y en `SEGURIDAD.md`.

## Antes del primer despliegue

Lea `DISENO.md` §11: hay 16 pasos que requieren una persona con acceso a Google
Cloud y a GitHub. Los tres que más fácil se hacen mal:

- **La condición de atributos de Workload Identity Federation.** El repositorio
  es público; una condición laxa deja que un fork obtenga credenciales.
  `SEGURIDAD.md` §4 tiene la expresión concreta.
- **El workflow ya está en `.github/workflows/despliegue-admin.yml`** y convive
  con el pipeline del estándar DevSecOps. Revise que los dos no se pisen: ambos
  disparan sobre `admin/**`.
- **Presupuesto con alerta en el plan Blaze.** No tiene tope duro.

## Prohibiciones propias de este directorio

1. **Ninguna clave JSON de cuenta de servicio.** Ni en el repositorio, ni en n8n,
   ni en los secretos de GitHub. El despliegue usa OIDC; la ingesta usa HMAC por
   negocio.
2. **Nunca `dangerouslySetInnerHTML`, `innerHTML`, `eval` ni `new Function`.** El
   panel muestra texto escrito por desconocidos. El CI rompe la compilación si
   aparecen.
3. **Nunca borrar la negación final de `firestore.rules`.** El CI también la
   verifica.
4. **El rol nunca sale de un documento de Firestore**, siempre de los custom
   claims. `/tenants/{t}/miembros` es un espejo para pintar la interfaz.
5. **Los identificadores de negocio no se reutilizan**, ni los dados de baja.
   Tampoco los `phone_number_id`: un número asignado a un comercio no se
   reasigna a otro sin liberarlo primero.
6. **Nunca revelarle al cliente final el motivo comercial de una suspensión.** El
   mensaje de cortesía es neutro y está fijo en el código.
7. **Una identidad, un proveedor.** Superadministradores solo con Google;
   comercios solo con contraseña; ingesta solo con token personalizado. El
   vínculo vive dentro de los predicados base de `firestore.rules` y en
   `claims.ts`. **No lo saque de los predicados** para "simplificar": ahí es
   donde lo heredan todas las reglas, incluidas las que se escriban mañana.
8. **El texto de un reclamo sale ESCAPADO desde `saneo.ts`, y el destino del
   correo nunca sale del reclamo.** Las dos cosas son controles, no detalles.
   El proveedor es **FormSubmit** (sin credencial) y compone el correo en HTML:
   por eso el escapado se hace en origen. Si algún día se vuelve a Resend, el
   escapado se puede aflojar pero conviene no hacerlo (DISENO.md §4ter.4).
   **Nunca vuelque los campos del reclamo al cuerpo de la petición con un
   spread:** `_cc`, `_replyto` y compañía son instrucciones de FormSubmit.
9. **Datos de prueba:** teléfonos con seis o más ceros seguidos
   (`59170000001`) y correos `@ejemplo.com`. Es lo que acepta la lista de
   admitidos de `scripts/verificar-saneo.sh`.
10. Se respeta `CONVENCIONES-REPO-PUBLICO.md`: ningún valor real de
    infraestructura en un archivo versionado.
