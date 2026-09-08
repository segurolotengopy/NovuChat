# -*- coding: utf-8 -*-
"""Modelo de costos de NovuChat DESDE EL 1 DE OCTUBRE DE 2026.

Fuentes:
  - Hojas de tarifas oficiales de Meta en USD, vigentes desde el 01/10/2026
    (tarifas y niveles de volumen), fila "Rest of Latin America" (+591).
  - Parametros de conversacion de Analisis/06-costo-por-atencion.xlsx.

Supuestos fijados por Andres el 08/09/2026:
  - Solo precios de octubre. No hay clientes que paguen antes de esa fecha.
  - Cache del prefijo del prompt implementada (lectura al 25 % de la entrada:
    supuesto A VERIFICAR para Flash-Lite; pesa poco porque el modelo ya no
    domina el costo).
  - Cache de 60 s en `Traer configuracion` (la nube vuelve a ser despreciable).
  - Tope de mensajes del asistente por ventana de 24 h, por plan.
  - 12 Bs por USD.

Correr: python3 Analisis/14-modelo-costos.py
"""

BS = 12.0

# --- Meta, hoja del 01/10/2026, Resto de Latinoamerica (USD por mensaje) ---
SERVICIO = 0.0113        # cada respuesta del asistente dentro de la ventana
UTILIDAD = 0.0113        # el recordatorio (desde octubre se cobra siempre)
MARKETING = 0.0740       # difusion
GRATIS_SERVICIO = 1000   # por numero de empresa por mes; no acumula
# Los niveles de volumen aplican SOLO a utilidad y autenticacion, desde
# 100.001 mensajes/mes por portafolio. No alcanzan a servicio.

# --- Modelo: Gemini 3.5 Flash-Lite con cache del prefijo (USD por M tokens) ---
ENTRADA, SALIDA = 0.30, 2.50
CACHE_LECTURA = 0.075    # 25 % de la entrada: A VERIFICAR
CACHE_ESCRITURA = 0.30

# --- Conversacion (hoja Supuestos del modelo de septiembre) ---
TOK_PREG, TOK_RESP = 49, 75
PAR = TOK_PREG + TOK_RESP
PREFIJO_A = 2150
VENTANA_A = 8
SAL_HERRAM = 60
RES = [500, 500, 350]    # 2 consultas de agenda + 1 creacion de cita
RECORDATORIO_POR_CONV = 0.40   # solo las que terminan en cita


def tokens(turnos, tool_turns=None):
    """(entrada, salida, llamadas) de una conversacion del Flujo A."""
    if tool_turns is None:
        tool_turns = min(3, turnos)
    ent = sal = 0
    llamadas = 0
    for t in range(1, turnos + 1):
        hist = min(t - 1, VENTANA_A) * PAR
        ent += PREFIJO_A + hist + TOK_PREG
        llamadas += 1
        if t > turnos - tool_turns:
            r = RES[min(tool_turns - (turnos - t) - 1, len(RES) - 1)]
            sal += SAL_HERRAM
            ent += PREFIJO_A + hist + TOK_PREG + SAL_HERRAM + r
            sal += TOK_RESP + 10
            llamadas += 1
        else:
            sal += TOK_RESP
    return ent, sal, llamadas


def modelo_usd(turnos):
    """Costo del modelo con el prefijo cacheado."""
    ent, sal, ll = tokens(turnos)
    resto = ent - PREFIJO_A * ll
    return (resto * ENTRADA + PREFIJO_A * CACHE_ESCRITURA
            + PREFIJO_A * (ll - 1) * CACHE_LECTURA + sal * SALIDA) / 1e6


def conversacion_usd(turnos, con_franquicia=False):
    """Costo marginal de UNA conversacion. Con franquicia = mensajes gratis."""
    servicio = 0.0 if con_franquicia else turnos * SERVICIO
    return modelo_usd(turnos) + servicio + RECORDATORIO_POR_CONV * UTILIDAD


def mes_bs(conversaciones, turnos):
    """Costo mensual de UN comercio, en Bs, con la franquicia de 1.000."""
    mensajes = conversaciones * turnos
    servicio = max(0, mensajes - GRATIS_SERVICIO) * SERVICIO
    modelo = conversaciones * modelo_usd(turnos)
    record = conversaciones * RECORDATORIO_POR_CONV * UTILIDAD
    return (modelo + servicio + record) * BS


def mes_mezcla_bs(conversaciones, tope):
    """60 % cortas (5), 30 % tipicas (10), 10 % en el tope del plan."""
    partes = [(0.6, 5), (0.3, 10), (0.1, tope)]
    mensajes = sum(conversaciones * p * t for p, t in partes)
    servicio = max(0, mensajes - GRATIS_SERVICIO) * SERVICIO
    modelo = sum(conversaciones * p * modelo_usd(t) for p, t in partes)
    record = conversaciones * RECORDATORIO_POR_CONV * UTILIDAD
    return (modelo + servicio + record) * BS


PLANES_HOY = [("Impulso", 250, 300, 20), ("Crecimiento", 450, 1000, 25), ("Pro", 850, 2500, 30)]


def volumen_para_margen(precio, turnos, margen):
    n = 10
    while n < 5000 and mes_bs(n + 10, turnos) <= precio * (1 - margen):
        n += 10
    return n


if __name__ == "__main__":
    print("=" * 90)
    print("1. COSTO MARGINAL POR CONVERSACION (Bs), agotada la franquicia, con cache")
    print("=" * 90)
    print(f"{'turnos':>7}{'modelo':>9}{'servicio':>10}{'record.':>9}{'TOTAL':>9}   {'% Meta':>7}")
    for t in (4, 6, 8, 10, 15, 20, 25, 30):
        m = modelo_usd(t) * BS
        s = t * SERVICIO * BS
        r = RECORDATORIO_POR_CONV * UTILIDAD * BS
        tot = m + s + r
        print(f"{t:7}{m:9.3f}{s:10.3f}{r:9.3f}{tot:9.3f}   {100*(s+r)/tot:6.0f}%")

    print()
    print("=" * 90)
    print("2. COSTO MENSUAL POR COMERCIO (Bs) segun conversaciones, tipica de 10 turnos")
    print("=" * 90)
    print(f"{'conv/mes':>9}{'mensajes':>10}{'gratis':>8}{'pagados':>9}{'costo Bs':>10}{'Bs/conv':>9}")
    for n in (50, 100, 150, 200, 250, 300, 400, 500, 750, 1000):
        msj = n * 10
        print(f"{n:9}{msj:10,}{min(msj, GRATIS_SERVICIO):8}{max(0, msj-GRATIS_SERVICIO):9,}"
              f"{mes_bs(n, 10):10.0f}{mes_bs(n, 10)/n:9.3f}")

    print()
    print("=" * 90)
    print("3. LOS PLANES ACTUALES, en octubre (tipica de 10 turnos)")
    print("=" * 90)
    for nom, precio, conv, tope in PLANES_HOY:
        c = mes_bs(conv, 10)
        print(f"   {nom:13} {precio:4} Bs · {conv:5} conv · tope {tope} → costo {c:7.0f} → margen {precio-c:8.0f} Bs")

    print()
    print("=" * 90)
    print("4. CUANTAS CONVERSACIONES SOPORTA CADA PRECIO")
    print("=" * 90)
    print(f"{'precio':>7}  {'70% · 10 turnos':>16}  {'60% · 10 turnos':>16}  {'70% · 6 turnos':>15}  {'60% · 6 turnos':>15}")
    for p in (250, 450, 850):
        print(f"{p:7}  {volumen_para_margen(p,10,.70):16}  {volumen_para_margen(p,10,.60):16}"
              f"  {volumen_para_margen(p,6,.70):15}  {volumen_para_margen(p,6,.60):15}")

    print()
    print("=" * 90)
    print("5. PROPUESTA DE PLANES y su margen")
    print("=" * 90)
    PROPUESTA = [("Impulso", 250, 120, 20), ("Crecimiento", 450, 220, 25), ("Pro", 850, 420, 30)]
    print(f"{'Plan':13}{'Bs':>5}{'conv':>6}{'tope':>6}  {'mezcla':>8}{'margen':>8}  {'todas 10t':>10}{'margen':>8}  {'todas al tope':>14}{'margen':>8}")
    for nom, p, n, tope in PROPUESTA:
        cm = mes_mezcla_bs(n, tope); c10 = mes_bs(n, 10); ct = mes_bs(n, tope)
        print(f"{nom:13}{p:5}{n:6}{tope:6}  {cm:8.0f}{100*(p-cm)/p:7.0f}%  {c10:10.0f}{100*(p-c10)/p:7.0f}%  {ct:14.0f}{100*(p-ct)/p:7.0f}%")

    print()
    print("6. EXCEDENTE: costo marginal de una conversacion fuera de franquicia")
    for t in (6, 10, 20):
        print(f"   {t:2} turnos: {conversacion_usd(t)*BS:.3f} Bs")

    print()
    print("7. DIFUSION (marketing) a 0,074 USD:", f"{MARKETING*BS:.3f} Bs por mensaje;",
          f"1.000 contactos = {MARKETING*BS*1000:.0f} Bs")

    print()
    print("8. VENTANA DE PUNTO DE ENTRADA GRATUITO (72 h todo gratis):",
          f"conversacion de 10 turnos = {modelo_usd(10)*BS:.3f} Bs (solo modelo)")

    print()
    print("=" * 90)
    print("9. ESCALA, plan Impulso propuesto (120 conv, 10 turnos)")
    print("=" * 90)
    for comercios in (100, 300):
        var = comercios * mes_bs(120, 10)
        fijos = (2.82 if comercios == 100 else 60.82) * BS
        ing = comercios * 250
        print(f"   {comercios} comercios: ingreso {ing:,} Bs · variable {var:,.0f} · fijos {fijos:,.0f}"
              f" · costo {100*(var+fijos)/ing:.0f}% del ingreso")
