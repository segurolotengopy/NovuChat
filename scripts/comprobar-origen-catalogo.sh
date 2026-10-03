#!/usr/bin/env bash
# =============================================================================
# comprobar-origen-catalogo.sh — la dirección del catálogo NO es la de la consola
# =============================================================================
# T-37 (admin/SEGURIDAD.md): el enlace que reciben los clientes (SITIO_PUBLICO)
# tiene que apuntar al SEGUNDO sitio de Hosting, nunca a un origen donde también
# responda la consola. Es la compuerta que usan `desplegar-staging` y
# `desplegar-produccion` antes de publicar. Sin red y sin credenciales: compara
# nombres de host.
#
# Por qué se compara el HOST y no la cadena entera, y por qué no basta con
# `PROD_URL`: la consola responde en su dominio propio (PROD_URL) Y TAMBIÉN en
# `<sitio>.web.app` y `<sitio>.firebaseapp.com` (y en los del proyecto). Una
# SITIO_PUBLICO con mayúsculas, ruta, puerto, usuario@ o punto final seguiría
# siendo el mismo origen que una comparación literal no vería.
#
# Entradas (variables de entorno):
#   SITIO_PUBLICO       obligatoria: la dirección que se da a los clientes (https://)
#   SITIO_CATALOGO      obligatoria: el id del segundo sitio (HOSTING_SITIO_CATALOGO)
#   SITIO_CONSOLA       el id del sitio de la consola (FIREBASE_SITE_ID o el del proyecto)
#   PROYECTO            el id del proyecto de Firebase de este ambiente
#   URL_CONSOLA         la dirección de la consola (PROD_URL / STAGING_URL)
#   DOMINIOS_CATALOGO   opcional: dominios propios del sitio público (HOSTING_DOMINIO_CATALOGO),
#                       solo el nombre de host, separados por comas
#
# Acepta SOLO: `<SITIO_CATALOGO>.web.app`, `<SITIO_CATALOGO>.firebaseapp.com` o un
# host de DOMINIOS_CATALOGO. Y rechaza siempre —aunque estuviera en la lista— el
# host de la consola: `<SITIO_CONSOLA>` y `<PROYECTO>` en .web.app y
# .firebaseapp.com, y el host de URL_CONSOLA.
#
# Salida: 0 en orden · 1 rechazada (con ::error::) · 2 faltan datos.
# =============================================================================
set -uo pipefail

# Host normalizado de una dirección: minúsculas, sin esquema, usuario, ruta,
# consulta, fragmento, puerto ni punto final.
host_de() {
  local h="${1,,}"
  h="${h#http://}"; h="${h#https://}"
  h="${h%%[/?#]*}"
  h="${h##*@}"
  h="${h%%:*}"
  h="${h%.}"
  printf '%s' "$h"
}

PUBLICO="${SITIO_PUBLICO:-}"
CATALOGO="${SITIO_CATALOGO:-}"
CONSOLA_ID="${SITIO_CONSOLA:-}"
PROYECTO="${PROYECTO:-}"
URL_CONSOLA="${URL_CONSOLA:-}"
DOMINIOS="${DOMINIOS_CATALOGO:-}"

[[ -n "$PUBLICO" ]] || { echo "::error::Falta SITIO_PUBLICO: sin ella no hay dirección que dar a los clientes (T-37)."; exit 1; }
[[ -n "$CATALOGO" ]] || { echo "::error::Falta SITIO_CATALOGO (HOSTING_SITIO_CATALOGO)." >&2; exit 2; }
shopt -s nocasematch
[[ "$PUBLICO" == https://* ]] || { echo "::error::SITIO_PUBLICO tiene que empezar por https://."; exit 1; }
# LA FORMA COMPLETA SE VALIDA ANTES DE NORMALIZAR. `host_de` solo mira el host y
# un valor torcido lo confundiría: con `\`, un navegador trata `https://a.web.app\@b.web.app`
# como una dirección a `a.web.app` (la consola, si es ese), y con un salto de
# línea el valor escrito con printf en functions/.env sería OTRA línea, o sea
# otro parámetro. Se acepta solo esquema + host + puerto opcional + ruta sin
# espacios, sin `\` y sin `@` en ninguna parte (ni como usuario ni en la ruta: un
# enlace de catálogo no lo necesita, y rechazarlo del todo no deja ambigüedad).
forma='^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[^[:space:]\\@]*)?$'
[[ "$PUBLICO" =~ $forma ]] \
  || { echo "::error::SITIO_PUBLICO no tiene la forma https://<host>[:<puerto>][/<ruta>]: sin usuario@, sin barra invertida, sin espacios ni saltos de línea."; exit 1; }
shopt -u nocasematch

H="$(host_de "$PUBLICO")"
[[ -n "$H" && "$H" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]] \
  || { echo "::error::SITIO_PUBLICO no tiene un nombre de host válido."; exit 1; }

# 1. El host de la consola, siempre rechazado.
prohibidos=()
for id in "$CONSOLA_ID" "$PROYECTO"; do
  [[ -n "$id" ]] && prohibidos+=("${id,,}.web.app" "${id,,}.firebaseapp.com")
done
[[ -n "$URL_CONSOLA" ]] && prohibidos+=("$(host_de "$URL_CONSOLA")")
for p in "${prohibidos[@]}"; do
  if [[ "$H" == "$p" ]]; then
    echo "::error::SITIO_PUBLICO es un origen donde responde la consola (un host de la consola): el enlace del catálogo tiene que apuntar al segundo sitio (T-37)."
    exit 1
  fi
done

# 2. Solo el sitio público declarado, o un dominio propio declarado aparte.
permitidos=("${CATALOGO,,}.web.app" "${CATALOGO,,}.firebaseapp.com")
IFS=',' read -r -a extra <<< "${DOMINIOS,,}"
for d in "${extra[@]}"; do
  d="${d//[[:space:]]/}"
  [[ -n "$d" ]] && permitidos+=("$d")
done
for p in "${permitidos[@]}"; do
  [[ "$H" == "$p" ]] && { echo "SITIO_PUBLICO apunta al sitio público del catálogo."; exit 0; }
done
echo "::error::SITIO_PUBLICO no es el sitio público declarado: tiene que ser <HOSTING_SITIO_CATALOGO>.web.app, <HOSTING_SITIO_CATALOGO>.firebaseapp.com o un dominio listado en HOSTING_DOMINIO_CATALOGO (T-37)."
exit 1
