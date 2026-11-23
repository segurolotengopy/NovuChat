#!/usr/bin/env python3
"""Toma del flujo VIVO el valor de los marcadores REEMPLAZAR_* que la tabla local no resuelve.

Uso:  valores-del-vivo.py --flujo <versionado.json> --marcadores A,B,C --salida <valores.json> (--vivo <vivo.json> | --n8n)
        --n8n  lee el flujo de N8N_BASE_URL / N8N_WORKFLOW_ID con N8N_API_KEY (del entorno del proceso;
               la clave viaja por la entrada estándar de curl con `-H @-`, nunca en la línea de comandos).

Para cada marcador pedido: busca el MISMO nodo (por nombre, debe ser único en el vivo) y la MISMA ruta de
parámetro donde el versionado lleva el marcador; si el marcador va incrustado en un texto (jsCode, jsonBody,
una URL) alinea el texto que lo rodea para extraer el valor. Valida la forma según el sufijo del marcador.

FALLA CERRADO, nombrando el marcador, si: el nodo no existe o está repetido, la ruta no existe, el texto no
se alinea, hay dos valores distintos, o la forma no valida. Nunca adivina.

Escribe SOLO `--salida` (un JSON {marcador: valor}, que el llamador deja en el `.local.json` ignorado por git).
Por pantalla imprime nombres de marcador y «resuelto del vivo» o el motivo: NUNCA un valor.
Código de salida 1 si algún marcador pedido no se resolvió (la salida lleva los que sí).
"""
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile

# Mismo criterio que preparar-import.sh para nombrar un marcador, pero sin tragarse lo que sigue
# («REEMPLAZAR_URL_CATALOGO/api/...» es el marcador REEMPLAZAR_URL_CATALOGO).
MARCADOR_RE = re.compile(r'REEMPLAZAR_[A-Z][A-Z0-9_]*')
CONTEXTO = 80
SIN_CONTROL = r'[^\x00-\x1f"\\]'

# Marcadores en los que el VIVO GANA siempre, aunque esté vacío y aunque la tabla tenga valor (decisión del 22/11/2026): así
# nunca se publican teléfonos de prueba ni la etapa de prueba en producción. preparar-import.sh los pide siempre.
VIVO_GANA = ("REEMPLAZAR_TELEFONOS_DE_PRUEBA", "REEMPLAZAR_ETAPA_PRUEBA")

# patrón del NOMBRE del marcador (en orden: el primero que coincide) -> (captura, forma válida de lo capturado).
# Los patrones están anclados al nombre completo: un «_HOJA» no recibe la forma de un id de planilla.
FORMAS = [
    (r'REEMPLAZAR_PHONE_NUMBER_ID(_[A-Z0-9_]+)?', r'\d+', re.compile(r'\d{6,25}')),
    (r'REEMPLAZAR_WABA_ID(_[A-Z0-9_]+)?', r'\d+', re.compile(r'\d{6,25}')),
    (r'REEMPLAZAR_MEDIA_ID(_[A-Z0-9_]+)?', r'\d+', re.compile(r'\d{6,25}')),
    (r'REEMPLAZAR_NUMERO_RECEPCION(_[A-Z0-9_]+)?', r'\d+', re.compile(r'\d{6,25}')),
    (r'REEMPLAZAR_PLANILLA_[A-Z0-9_]*_ID(_[A-Z0-9_]+)?', r'[A-Za-z0-9_-]+', re.compile(r'[A-Za-z0-9_-]{20,}')),
    # La ruta de webhook de n8n es un tramo único (UUID o token); el repo no fija otro patrón.
    (r'REEMPLAZAR_RUTA_RECEPTOR(_[A-Z0-9_]+)?', r'[A-Za-z0-9_-]+', re.compile(r'[A-Za-z0-9_-]{16,128}')),
    (r'REEMPLAZAR_URL_CATALOGO', r'https?://[A-Za-z0-9.:-]+', re.compile(r'https?://[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?(?::\d{1,5})?')),
    (r'REEMPLAZAR_CREDENCIAL_[A-Z0-9_]+', SIN_CONTROL + r'+?', re.compile(SIN_CONTROL + r'{1,100}')),
    (r'REEMPLAZAR_TRATAMIENTO', SIN_CONTROL + r'+?', re.compile(SIN_CONTROL + r'{1,60}')),
    (r'REEMPLAZAR_MODOS_DE_ENTREGA', SIN_CONTROL + r'+?', re.compile(SIN_CONTROL + r'{1,300}')),
    (r'REEMPLAZAR_HOSTS_FOTO', SIN_CONTROL + r'+?', re.compile(SIN_CONTROL + r'{1,300}')),
    # Pueden estar vacíos en el vivo (es lo que se quiere): la forma admite la cadena vacía.
    (r'REEMPLAZAR_TELEFONOS_DE_PRUEBA', SIN_CONTROL + r'*?', re.compile(r'[0-9+, ]{0,300}')),
    (r'REEMPLAZAR_ETAPA_PRUEBA', SIN_CONTROL + r'*?', re.compile(r'[A-Za-z0-9_ -]{0,20}')),
]


def forma_de(marcador):
    for patron, captura, valida in FORMAS:
        if re.fullmatch(patron, marcador):
            return captura, valida
    return None


def recorrer(x, ruta=()):
    """Todos los textos de un objeto con su ruta."""
    if isinstance(x, str):
        yield ruta, x
    elif isinstance(x, dict):
        for k, v in x.items():
            yield from recorrer(v, ruta + (k,))
    elif isinstance(x, list):
        for i, v in enumerate(x):
            yield from recorrer(v, ruta + (i,))


def en_ruta(x, ruta, ref=None):
    """Valor de `x` en `ruta`. Si `ref` (el versionado) trae una lista de elementos con «name» (los campos de un nodo Set),
    el elemento del vivo se busca POR NOMBRE y no por posicion: el orden de los campos puede diferir."""
    for k in ruta:
        try:
            if isinstance(k, int) and isinstance(x, list) and isinstance(ref, list) and k < len(ref) \
                    and isinstance(ref[k], dict) and ref[k].get("name") is not None:
                coinc = [e for e in x if isinstance(e, dict) and e.get("name") == ref[k]["name"]]
                if len(coinc) != 1:
                    return None
                ref, x = ref[k], coinc[0]
                continue
            x = x[k]
            ref = ref[k] if ref is not None else None
        except (KeyError, IndexError, TypeError):
            return None
    return x


def extraer(texto_ver, marcador, texto_vivo, captura=None):
    """Valores que el vivo tiene donde el versionado tiene `marcador` (una de sus apariciones por texto)."""
    captura = captura or forma_de(marcador)[0]
    valores = []
    for m in MARCADOR_RE.finditer(texto_ver):
        if m.group(0) != marcador:
            continue
        izq, der = texto_ver[:m.start()], texto_ver[m.end():]
        ancla_i, ancla_d = True, True
        otras = list(MARCADOR_RE.finditer(izq))
        if otras:
            izq, ancla_i = izq[otras[-1].end():], False
        sig = MARCADOR_RE.search(der)
        if sig:
            der, ancla_d = der[:sig.start()], False
        # Solo un texto que ES el marcador (con a lo sumo un «=» delante) se ancla; en un codigo largo el vivo puede traer mas alrededor.
        if len(izq) + len(der) > 2:
            ancla_i = ancla_d = False
        if len(izq) > CONTEXTO:
            izq, ancla_i = izq[-CONTEXTO:], False
        if len(der) > CONTEXTO:
            der, ancla_d = der[:CONTEXTO], False
        patron = ('^' if ancla_i else '') + re.escape(izq) + '(' + captura + ')' + re.escape(der) + ('$' if ancla_d else '')
        valores.append([g.group(1) for g in re.finditer(patron, texto_vivo, re.DOTALL)])
    return valores


def resolver(versionado, vivo, marcadores):
    """-> (valores {marcador: valor}, motivos {marcador: texto sin valores})."""
    valores, motivos = {}, {}
    # El .env equivocado apunta al flujo de OTRO comercio (Evy, Emma y Antonio comparten nombres de nodo): si el vivo no se
    # llama como el versionado, no se toma NADA.
    if not isinstance(vivo, dict) or vivo.get("name") != versionado.get("name"):
        return {}, {m: "el vivo no es este flujo (el nombre no coincide con el del versionado)" for m in marcadores}
    nodos_vivo = {}
    for n in vivo.get("nodes", []) if isinstance(vivo, dict) else []:
        nodos_vivo.setdefault(n.get("name"), []).append(n)
    apariciones = {m: [] for m in marcadores}
    for n in versionado.get("nodes", []):
        for ruta, texto in recorrer(n):
            for m in set(MARCADOR_RE.findall(texto)):
                if m in apariciones:
                    apariciones[m].append((n["name"], ruta, texto, n))
    for m in marcadores:
        forma = forma_de(m)
        # Sin forma propia, un marcador que es el valor ENTERO de un campo de la Config (nodo Set) admite texto sin control.
        if forma is None and apariciones[m] and all(
                "assignments" in a[1] and a[1][-1] == "value" and a[2] == m for a in apariciones[m]):
            forma = (SIN_CONTROL + r'+?', re.compile(SIN_CONTROL + r'{1,300}'))
        if forma is None:
            motivos[m] = "el sufijo del marcador no tiene una forma declarada para validarlo"
            continue
        if not apariciones[m]:
            motivos[m] = "no aparece en los nodos del versionado"
            continue
        hallados, error = set(), None
        for nodo, ruta, texto, nodo_ver in apariciones[m]:
            pares = nodos_vivo.get(nodo, [])
            if len(pares) != 1:
                error = f"el nodo «{nodo}» " + ("no existe en el vivo" if not pares else "está repetido en el vivo")
                break
            en_vivo = en_ruta(pares[0], ruta, nodo_ver)
            if not isinstance(en_vivo, str):
                error = f"el vivo no tiene un texto en la misma ruta del nodo «{nodo}»"
                break
            for lista in extraer(texto, m, en_vivo, forma[0]):
                if not lista:
                    error = f"el texto del nodo «{nodo}» no se alinea con el del vivo alrededor del marcador"
                    break
                hallados.update(lista)
            if error:
                break
        if error:
            motivos[m] = error
        elif len(hallados) != 1:
            motivos[m] = f"no hay una coincidencia única en el vivo ({len(hallados)} valores distintos)"
        else:
            valor = next(iter(hallados))
            if not forma[1].fullmatch(valor) or MARCADOR_RE.search(valor):
                motivos[m] = "el valor del vivo no tiene la forma que corresponde al marcador"
            else:
                valores[m] = valor
    return valores, motivos


def leer_vivo_n8n():
    base = (os.environ.get("N8N_BASE_URL") or "").rstrip("/")
    clave = os.environ.get("N8N_API_KEY") or ""
    wid = os.environ.get("N8N_WORKFLOW_ID") or ""
    if not (base and clave and wid) or not re.fullmatch(r'[A-Za-z0-9]+', wid):
        print("✗ ABORTADO: para leer el flujo vivo hacen falta N8N_BASE_URL, N8N_API_KEY y N8N_WORKFLOW_ID en el .env.", file=sys.stderr)
        sys.exit(1)
    with tempfile.TemporaryDirectory() as t:
        destino = os.path.join(t, "vivo.json")
        r = subprocess.run(["curl", "-s", "--max-time", "120", "-o", destino, "-w", "%{http_code}", "-H", "@-",
                            f"{base}/api/v1/workflows/{wid}"],
                           input=f"X-N8N-API-KEY: {clave}\n", capture_output=True, text=True)
        if r.stdout.strip() != "200":
            print(f"✗ ABORTADO: no se pudo leer el flujo vivo (HTTP {r.stdout.strip() or '000'}).", file=sys.stderr)
            sys.exit(1)
        return json.load(open(destino, encoding="utf-8"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--flujo", required=True)
    ap.add_argument("--marcadores", required=True)
    ap.add_argument("--salida", required=True)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--vivo")
    g.add_argument("--n8n", action="store_true")
    a = ap.parse_args()
    marcadores = [m for m in a.marcadores.split(",") if m]
    versionado = json.load(open(a.flujo, encoding="utf-8"))
    vivo = leer_vivo_n8n() if a.n8n else json.load(open(a.vivo, encoding="utf-8"))
    valores, motivos = resolver(versionado, vivo, marcadores)
    fd = os.open(a.salida, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(valores, f, ensure_ascii=False)
    for m in marcadores:
        print(f"{m}\tresuelto del vivo" if m in valores else f"{m}\tNO resuelto: {motivos[m]}")
    sys.exit(0 if not motivos else 1)


if __name__ == "__main__":
    main()
