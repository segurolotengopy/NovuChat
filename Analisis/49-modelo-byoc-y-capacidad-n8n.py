# -*- coding: utf-8 -*-
"""BYOC: escalones de precio, modelos de IA y bolsas; y capacidad de n8n.

Acompana a `Analisis/49-byoc-precios-y-capacidad-n8n.md` (05/10/2026).
Autocontenido. Tarifas y fijos: los de `Analisis/47` y `48`.

Correr: python3 Analisis/49-modelo-byoc-y-capacidad-n8n.py
"""

IMPUESTOS = 0.16               # IVA 13 % + IT 3 %, sobre el precio cobrado
FIJO = 21.82 / 10              # fijo de plataforma (43 §5) entre 10 comercios
META = 0.0113                  # USD por mensaje (lo paga el comercio en BYOC)
GRATIS = 1000                  # mensajes de servicio gratis por numero y mes

# Perfil de tokens de una conversacion en un flujo de diseno minimo («el codigo
# calcula»): da 0,004 USD con Flash-Lite, la cifra usada en `Analisis/48`.
ENTRADA, SALIDA, LLAMADAS, RAZONAMIENTO = 6600, 800, 6, 150

# (USD por millon de entrada, de salida, tokens de razonamiento por llamada)
MODELOS = {
    'Gemini 3.5 Flash-Lite (hoy)': (0.30, 2.50, 0),
    'Claude Haiku 4.5': (1.00, 5.00, 0),
    'Gemini 3.8 Flash (2027)': (1.50, 7.50, RAZONAMIENTO),
    'Claude Sonnet 5.5': (2.00, 10.00, RAZONAMIENTO),
}


def ia_por_conv(modelo):
    e, s, r = MODELOS[modelo]
    return (ENTRADA * e + (SALIDA + LLAMADAS * r) * s) / 1e6


def margen(precio, conv, ia, uso=1.0):
    return precio * (1 - IMPUESTOS) - FIJO - conv * uso * ia


def meta_del_comercio(conv, respuestas=5.0, avisos=1.0):
    return max(0.0, conv * respuestas - GRATIS) * META + conv * avisos * META


def pct(m, precio):
    return f'{m:6.1f} ({100 * m / precio:3.0f} %)'


if __name__ == '__main__':
    HOY, HAIKU = 'Gemini 3.5 Flash-Lite (hoy)', 'Claude Haiku 4.5'

    print('1. IA por conversacion, por modelo')
    for m in MODELOS:
        print(f'   {m:30} {ia_por_conv(m):.4f} USD  x{ia_por_conv(m) / ia_por_conv(HOY):.1f}')

    print('\n2. Escalones BYOC con Flash-Lite (base 35 por 1.000)')
    BASE = [(1000, 35), (2000, 50), (5000, 90), (10000, 150)]
    for conv, p in BASE:
        g = ia_por_conv(HOY)
        print(f'   {conv:6d} por {p:3d}: al 50 % {pct(margen(p, conv, g, .5), p)}  al 100 % '
              f'{pct(margen(p, conv, g), p)}  Meta del comercio al 100 % {meta_del_comercio(conv):6.1f}')

    print('   Contra los planes con Meta incluido (flujo minimo, 5 respuestas y 1 aviso; chip 1,50):')
    for nombre, p, inc in (('Crecimiento', 50, 220), ('Pro', 90, 500)):
        g = ia_por_conv(HOY)
        hoy = margen(p, inc, g) - meta_del_comercio(inc) - 1.50
        print(f'   {nombre:11} {inc} conv: paga hoy {p}, en BYOC 35 pagaria {35 + meta_del_comercio(inc):5.1f};'
              f' nos queda hoy {hoy:5.1f}, nos quedaria {margen(35, inc, g):5.1f}')

    print('\n3. Los mismos escalones con otros modelos (margen al 50 % / al 100 %; precio que iguala el margen de hoy)')
    for conv, p in BASE:
        for m in MODELOS:
            g = ia_por_conv(m)
            igual = p + conv * (g - ia_por_conv(HOY)) / (1 - IMPUESTOS)
            print(f'   {conv:6d} por {p:3d}  {m:30} {margen(p, conv, g, .5):7.1f} / {margen(p, conv, g):7.1f}'
                  f'   precio equivalente {igual:5.0f}')

    print('\n4. Escalones con Haiku 4.5 (uso al 100 %)')
    gh = ia_por_conv(HAIKU)
    for conv, p in [(200, 25), (500, 50), (1000, 90)]:
        print(f'   {p:3d} por {conv:5d}: impuestos {p * IMPUESTOS:5.2f}  IA {conv * gh:5.2f}  infraestructura {FIJO:4.2f}'
              f'  margen {pct(margen(p, conv, gh), p)}  al 50 % {pct(margen(p, conv, gh, .5), p)}')
    print('   Conversaciones que caben con 70 % de margen:')
    for p in (25, 50, 90):
        neto = p * (1 - IMPUESTOS) - FIJO
        print(f'   {p:3d} USD: sobre el precio {(neto - .70 * p) / gh:5.0f}   sobre lo neto de impuestos '
              f'{(neto - .70 * p * (1 - IMPUESTOS)) / gh:5.0f}   equilibrio {neto / gh:5.0f}')

    print('\n5. Bolsas BYOC con Haiku 4.5 (no cargan infraestructura)')
    for conv, p in [(50, 8), (100, 15), (300, 40)]:
        m = p * (1 - IMPUESTOS) - conv * gh
        print(f'   {conv:3d} por {p:2d}: {p / conv:.3f} por conversacion  impuestos {p * IMPUESTOS:4.2f}  IA {conv * gh:4.2f}'
              f'  margen {pct(m, p)}')

    print('\n6. Capacidad de n8n en la VM actual (estimacion; la CPU no esta medida)')
    CONV_CLIENTE = 300          # conversaciones al mes de un cliente tipo
    EJEC_CONV, PESADAS_CONV = 30, 5   # ejecuciones por conversacion; las que llaman al modelo
    REFERENCIA = 220            # ejecuciones/s de n8n en 2 nucleos con un flujo de 2 nodos
    NODOS_PESADA = 40           # nodos que recorre una ejecucion con modelo en nuestros flujos
    cota = REFERENCIA * 2 / NODOS_PESADA          # ~11 pesadas/s en maquina dedicada
    sostenido = round(cota) * 0.25                # maquina compartida: un cuarto
    HORA_PICO, RAFAGA = 0.20, 3                   # 20 % del dia en la hora pico; rafagas de 3x
    por_cliente = CONV_CLIENTE * PESADAS_CONV / 30 * HORA_PICO * RAFAGA / 3600
    techo = sostenido / por_cliente
    print(f'   cota dedicada {cota:.0f} pesadas/s; sostenido en la VM compartida {sostenido:.1f}/s')
    for nombre, clientes in (('holgado', techo / 3), ('techo', techo)):
        ejec_dia = clientes * CONV_CLIENTE * EJEC_CONV / 30
        print(f'   {nombre:8} {clientes:4.0f} clientes  {clientes * CONV_CLIENTE:7.0f} conversaciones/mes'
              f'  {ejec_dia:7.0f} ejecuciones/dia  historial con tope 20.000: {20000 / ejec_dia:4.1f} dias')
    print(f'   un flujo de barrido cada 5 minutos: {12 * 24 * 30} ejecuciones al mes por cliente'
          f' (el trafico de conversaciones de un cliente tipo: {CONV_CLIENTE * EJEC_CONV})')
