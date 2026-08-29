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
| Pruebas de reglas | **42 de 42 en verde**, ejecutadas contra el emulador |
| Recursos de nube | **ninguno creado.** Ver `DISENO.md` §11 |

## Cómo trabajar

Requiere Node 24, pnpm y un JDK (para el emulador de Firestore).

```bash
cd admin
pnpm install

pnpm pruebas:reglas     # emulador + 42 pruebas de aislamiento
pnpm web:build          # compila el frontend
pnpm functions:build    # compila las Cloud Functions
pnpm verificar          # las tres cosas
```

**Antes de dar por bueno cualquier cambio en `firestore.rules`, corra
`pnpm pruebas:reglas`.** Es el único control automático que impide que una
edición bienintencionada abra el paso entre negocios.

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
- **Mover el workflow** de `admin/ci/` a `.github/workflows/`. Donde está ahora,
  GitHub no lo ejecuta.
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
6. Se respeta `CONVENCIONES-REPO-PUBLICO.md`: ningún valor real de
   infraestructura en un archivo versionado.
