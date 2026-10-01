# -*- coding: utf-8 -*-
"""Costos fijos y variables de NovuChat, en % del precio, con Gemini medido.

Acompana a `Analisis/43-costos-fijos-y-variables.md` (28/09/2026).

Que cambia contra `14-modelo-costos.py`:
  - Tarifa de Gemini 3.5 Flash-Lite leida el 28/09 en la pagina oficial de
    precios: entrada 0,30, salida 2,50 (incluye el razonamiento), cache 0,03
    por millon (el 14 suponia 0,075: el 10 % y no el 25 % de la entrada).
  - Tokens MEDIDOS en 119 respuestas reales de n8n (22 al 28/09), no
    supuestos. n8n guarda un ESTIMADO (`tokenUsageEstimate`), no la cifra que
    factura Google: por eso hay tres escenarios.
  - Los fijos de plataforma, con lo que esta documentado en el repositorio.

Correr: python3 Analisis/43-modelo-fijos-variables.py
"""

# --- Meta (hoja del 01/10/2026, Resto de Latinoamerica) ---
SERVICIO = 0.0113          # cada respuesta del asistente
UTILIDAD = 0.0113          # recordatorio de cita
GRATIS = 1000              # mensajes de servicio gratis por numero y mes
RECORDATORIO = 0.40        # fraccion de conversaciones de reservas con cita

# --- Gemini 3.5 Flash-Lite, nivel pago estandar (USD por millon) ---
G_ENTRADA, G_SALIDA, G_CACHE = 0.30, 2.50, 0.03

IMPUESTOS = 0.16           # IVA 13 % + IT 3 % sobre el precio bruto

# --- Tokens medidos por RESPUESTA del asistente (n8n, estimado) ---
# llamadas: veces que el agente llama al modelo para dar UNA respuesta (cada
# herramienta reenvia todo el prompt). sistema: tokens del prompt de sistema
# ya armado, la parte estable que la cache implicita puede reutilizar.
FLUJOS = {
    #                entrada  salida llamadas sistema
    'Reservas':     (16_400,   58,    2.2,    6_000),   # Demo A, Platinum, Bellido
    'Captacion':    ( 8_440,   64,    1.0,    6_500),
    'Venta (B)':    ( 3_500,   66,    1.0,    2_500),
}
HERRAMIENTAS = 600         # tokens de definicion de herramientas por llamada (reservas)
RAZONAMIENTO = 100         # tokens de razonamiento por llamada ('minimal' por defecto; A MEDIR)

# Mezcla de conversaciones de 14/27: 60 % de 5 respuestas, 30 % de 10, 10 % de 25
MEZCLA = [(0.6, 5), (0.3, 10), (0.1, 25)]
RESP_POR_CONV = sum(p * r for p, r in MEZCLA)          # 8,5


def gemini_resp(flujo, escenario):
    """USD de Gemini por UNA respuesta del asistente."""
    ent, sal, ll, sist = FLUJOS[flujo]
    herr = HERRAMIENTAS * ll if flujo == 'Reservas' else 0
    if escenario == 'sept':          # supuesto de Analisis/14, para comparar
        return 0.0081 / 10
    ent_total = ent + herr
    sal_total = sal + RAZONAMIENTO * ll
    if escenario == 'sin_cache':
        return (ent_total * G_ENTRADA + sal_total * G_SALIDA) / 1e6
    if escenario == 'con_cache':     # el prompt de sistema se lee de la cache
        cache = sist * ll
        return ((ent_total - cache) * G_ENTRADA + cache * G_CACHE
                + sal_total * G_SALIDA) / 1e6
    if escenario == 'peor':          # +25 % de tokens sobre el estimado, sin cache
        return (ent_total * 1.25 * G_ENTRADA + sal_total * 2 * G_SALIDA) / 1e6
    raise ValueError(escenario)


ESCENARIOS = ['sept', 'con_cache', 'sin_cache', 'peor']
NOMBRE = {'sept': 'Supuesto de sept.', 'con_cache': 'Medido, con cache',
          'sin_cache': 'Medido, sin cache', 'peor': 'Medido, pesimista'}

# --- Planes (precio USD, conversaciones incluidas, quien paga Meta) ---
PLANES = [
    ('Impulso 25/100',          25, 100,  True),
    ('Crecimiento 50/220',   50, 220,  True),
    ('Pro 90/500',   90, 500,  True),
    ('Platinum 120/500',    120, 500,  True),
    ('BYOC 50/2.000',        50, 2000, False),
]

# --- Fijos de plataforma, USD al mes (fuente entre parentesis) ---
FIJOS = [
    ('Instancia minima de ingesta y configuracion (bitacora 09, ~16)', 16.00),
    ('Staging: Secret Manager y Scheduler (docs/staging/DISENO.md)',  2.00),
    ('Secret Manager de produccion (Analisis/14 §8)',                 1.32),
    ('Dominio novuchat.site (supuesto, renovacion anual / 12)',       2.50),
    ('VM de OCI (Always Free, compartida con WhatsApp-Modular)',      0.00),
    ('Firebase, Hosting, reCAPTCHA (dentro de la capa gratuita)',     0.00),
]
FIJO_PLATAFORMA = sum(v for _, v in FIJOS)
CHIP_POR_NUMERO = 1.50     # supuesto: recarga minima para mantener la linea


def mes(plan, uso, escenario, flujo='Reservas', clientes=10):
    """Desglose de un comercio en un mes, en USD. `uso`: fraccion del cupo."""
    nombre, precio, incluidas, paga_meta = plan
    conv = incluidas * uso
    msj = conv * RESP_POR_CONV
    d = {}
    d['Impuestos (IVA+IT)'] = precio * IMPUESTOS
    d['Meta, servicio'] = max(0, msj - GRATIS) * SERVICIO if paga_meta else 0
    d['Meta, recordatorio'] = (conv * RECORDATORIO * UTILIDAD
                               if paga_meta and flujo == 'Reservas' else 0)
    d['Gemini'] = msj * gemini_resp(flujo, escenario)
    d['Chip del numero'] = CHIP_POR_NUMERO if paga_meta else 0
    d['Fijo de plataforma prorrateado'] = FIJO_PLATAFORMA / clientes
    return precio, d


def pct(x, precio):
    return f'{100 * x / precio:5.1f} %'


if __name__ == '__main__':
    print('=' * 96)
    print('1. GEMINI POR RESPUESTA Y POR CONVERSACION (USD), por flujo y escenario')
    print('=' * 96)
    print(f'   {"":12}' + ''.join(f'{NOMBRE[e]:>21}' for e in ESCENARIOS))
    for f in FLUJOS:
        print(f'   {f:12}' + ''.join(
            f'{gemini_resp(f, e):>10.5f} {gemini_resp(f, e)*RESP_POR_CONV:>9.4f}' +
            ' ' for e in ESCENARIOS))
    print(f'   (columnas: por respuesta · por conversacion de {RESP_POR_CONV:.1f} respuestas)')
    meta_conv = RESP_POR_CONV * SERVICIO
    print(f'\n   Meta por conversacion fuera de la franquicia: {meta_conv:.4f} USD')
    for e in ESCENARIOS:
        g = gemini_resp('Reservas', e) * RESP_POR_CONV
        print(f'   Reservas, {NOMBRE[e]:20} Gemini = {100*g/(g+meta_conv):4.1f} % '
              f'del costo variable (fuera de franquicia)')

    for uso in (1.0, 0.6):
        print('\n' + '=' * 96)
        print(f'2. DESGLOSE POR PLAN EN % DEL PRECIO — reservas, uso {int(uso*100)} % del cupo, '
              f'10 clientes, escenario «Medido, con cache»')
        print('=' * 96)
        filas = None
        cols = []
        for p in PLANES:
            precio, d = mes(p, uso, 'con_cache')
            cols.append((p[0], precio, d))
        print(f'   {"":34}' + ''.join(f'{c[0]:>19}' for c in cols))
        for k in cols[0][2]:
            print(f'   {k:34}' + ''.join(f'{pct(c[2][k], c[1]):>19}' for c in cols))
        print(f'   {"-- Variable total":34}' + ''.join(
            f'{pct(sum(v for kk, v in c[2].items() if kk not in ("Fijo de plataforma prorrateado",)), c[1]):>19}'
            for c in cols))
        print(f'   {"-- Margen de contribucion":34}' + ''.join(
            f'{pct(c[1] - sum(c[2].values()), c[1]):>19}' for c in cols))

    print('\n' + '=' * 96)
    print('3. SENSIBILIDAD A GEMINI: margen de contribucion (% del precio), uso 100 %')
    print('=' * 96)
    print(f'   {"":22}' + ''.join(f'{NOMBRE[e]:>20}' for e in ESCENARIOS))
    for p in PLANES:
        fila = ''
        for e in ESCENARIOS:
            precio, d = mes(p, 1.0, e)
            fila += f'{pct(precio - sum(d.values()), precio):>20}'
        print(f'   {p[0]:22}' + fila)

    print('\n' + '=' * 96)
    print('4. BYOC: equilibrio (conversaciones al mes en que Gemini se come el precio neto)')
    print('=' * 96)
    neto = 50 * (1 - IMPUESTOS) - FIJO_PLATAFORMA / 10
    for e in ESCENARIOS:
        g = gemini_resp('Reservas', e) * RESP_POR_CONV
        print(f'   {NOMBRE[e]:22} {neto / g:7.0f} conversaciones (reservas)')
    for e in ESCENARIOS:
        g = gemini_resp('Venta (B)', e) * RESP_POR_CONV
        print(f'   {NOMBRE[e]:22} {neto / g:7.0f} conversaciones (venta, prompt del Demo B)')

    print('\n' + '=' * 96)
    print('5. FIJOS DE PLATAFORMA (USD al mes)')
    print('=' * 96)
    for n, v in FIJOS:
        print(f'   {v:7.2f}  {n}')
    print(f'   {FIJO_PLATAFORMA:7.2f}  TOTAL   (+ {CHIP_POR_NUMERO:.2f} por numero, supuesto)')


# =============================================================================
# 6. AGENDA MINIMA (01/10/2026): «el codigo calcula, el modelo conversa»
# =============================================================================
# El flujo de Bellido desde el 01/10 (Flujos/experimental/agenda-minima) llama
# a Gemini por HTTP y guarda el usageMetadata REAL de Google. Medido el 01/10
# en 72 ejecuciones (pruebas de Andres; muestra chica): 63 sin modelo, 9 con
# UNA llamada; Extraer ~792 tokens de entrada y ~100 de salida; Redactar ~1.072
# y ~64; razonamiento 0 y cache 0 (gemini-3.5-flash-lite).
LLAMADAS_AM = {'Extraer': (792, 100), 'Redactar': (1072, 64)}
# Por conversacion: supuesto conservador de 2 extracciones y 1 redaccion (las
# preguntas sencillas y los botones no llaman al modelo). DISENO.md: 5 mensajes
# por cita tipica.
LLAMADAS_POR_CONV_AM = {'Extraer': 2, 'Redactar': 1}
RESP_POR_CONV_AM = 5

TARIFAS_AM = {   # entrada, salida (incluye razonamiento), USD por millon
    '3.5 Flash-Lite': (0.30, 2.50),
    '3.8 Flash 2026': (0.75, 3.75),
    '3.8 Flash 2027': (1.50, 7.50),
}


def gemini_conv_am(modelo, razon_por_llamada=0):
    ent, sal = TARIFAS_AM[modelo]
    return sum(n * (LLAMADAS_AM[k][0] * ent + (LLAMADAS_AM[k][1] + razon_por_llamada) * sal) / 1e6
               for k, n in LLAMADAS_POR_CONV_AM.items())


def mes_am(plan, uso, modelo, razon=0, rpc=RESP_POR_CONV_AM, clientes=10):
    nombre, precio, incluidas, paga_meta = plan
    conv = incluidas * uso
    msj = conv * rpc
    d = {
        'Impuestos': precio * IMPUESTOS,
        'Meta': ((max(0, msj - GRATIS) * SERVICIO + conv * RECORDATORIO * UTILIDAD)
                 if paga_meta else 0),
        'Gemini': conv * gemini_conv_am(modelo, razon),
        'Chip y fijo': (CHIP_POR_NUMERO if paga_meta else 0) + FIJO_PLATAFORMA / clientes,
    }
    return precio, d


if __name__ == '__main__':
    print('\n' + '=' * 96)
    print('6. AGENDA MINIMA: Gemini por conversacion (USD) y margen por plan al 100 % del cupo')
    print('=' * 96)
    casos = [('3.5 Flash-Lite', 0), ('3.8 Flash 2026', 150), ('3.8 Flash 2027', 150)]
    for mod, r in casos:
        g = gemini_conv_am(mod, r)
        print(f'   {mod:16} razonamiento {r:4d}/llamada: {g:.4f} USD por conversacion; '
              f'Meta {RESP_POR_CONV_AM * SERVICIO:.4f} fuera de franquicia '
              f'-> Gemini = {100 * g / (g + RESP_POR_CONV_AM * SERVICIO):4.1f} % del variable')
    print(f'   {"":34}' + ''.join(f'{p[0][:17]:>18}' for p in PLANES))
    for rpc in (RESP_POR_CONV_AM, RESP_POR_CONV):
        for mod, r in casos:
            fila = ''
            for p in PLANES:
                precio, d = mes_am(p, 1.0, mod, r, rpc)
                fila += f'{pct(precio - sum(d.values()), precio):>18}'
            print(f'   {mod + f", {rpc:.1f} resp":34}' + fila)
    neto = 50 * (1 - IMPUESTOS) - FIJO_PLATAFORMA / 10
    for mod, r in casos:
        print(f'   BYOC 50, {mod:16}: equilibrio en {neto / gemini_conv_am(mod, r):8.0f} conversaciones')
