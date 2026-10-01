# -*- coding: utf-8 -*-
"""Que le hace al margen subir de Gemini 3.5 Flash-Lite a Gemini 3.7 Flash.

Acompana a `Analisis/44-gemini-37-flash-costo-de-la-calidad.md` (28/09/2026).
Reutiliza los tokens medidos y los planes de `43-modelo-fijos-variables.py`.

Tarifas leidas el 28/09 en la pagina oficial de Google (USD por millon):
  3.5 Flash-Lite:          entrada 0,30  salida 2,50  cache 0,03
  3.7 Flash hasta 31/12:   entrada 0,75  salida 3,75  cache 0,075
  3.7 Flash desde 01/01/27 entrada 1,50  salida 7,50  cache 0,15   <- el doble
La salida incluye el razonamiento. 3.7 Flash razona en «medium» por defecto y
admite low/medium/high; el sub-nodo de chat de Gemini de n8n 2.36.5 NO expone
ni el nivel ni el presupuesto de razonamiento (supportsThinkingBudget: false).

Lo que se supone que mejora con el modelo mejor (lo que Andres observo:
confusiones y reintentos): menos llamadas por respuesta y menos respuestas
por conversacion. Las dos cosas se escriben como escenarios, no como hechos.

Correr: python3 Analisis/44-modelo-gemini-37-flash.py
"""
import importlib.util
import os

_r = os.path.join(os.path.dirname(os.path.abspath(__file__)), '43-modelo-fijos-variables.py')
_s = importlib.util.spec_from_file_location('m43', _r)
m43 = importlib.util.module_from_spec(_s)
_s.loader.exec_module(m43)

TARIFAS = {
    '3.5 Flash-Lite':      (0.30, 2.50, 0.03),
    '3.7 Flash (2026)':    (0.75, 3.75, 0.075),
    '3.7 Flash (2027)':    (1.50, 7.50, 0.15),
}

# Reservas, medido en n8n (43 §2.2): entrada por llamada, salida visible por
# llamada, prompt de sistema cacheable por llamada, herramientas por llamada.
ENT_LLAMADA, SAL_LLAMADA, SISTEMA, HERR = 7_455, 26, 6_000, 600

# (nombre, modelo, llamadas por respuesta, razonamiento por llamada,
#  respuestas por conversacion)
ESCENARIOS = [
    ('Hoy: 3.5 Flash-Lite',            '3.5 Flash-Lite',   2.2,  100, 8.5),
    ('3.7 2026, sin mejora',           '3.7 Flash (2026)', 2.2,  800, 8.5),
    ('3.7 2026, mejora media',         '3.7 Flash (2026)', 1.6,  800, 7.5),
    ('3.7 2026, mejora fuerte',        '3.7 Flash (2026)', 1.3,  300, 7.0),
    ('3.7 2027, sin mejora',           '3.7 Flash (2027)', 2.2,  800, 8.5),
    ('3.7 2027, mejora media',         '3.7 Flash (2027)', 1.6,  800, 7.5),
    ('3.7 2027, mejora fuerte',        '3.7 Flash (2027)', 1.3,  300, 7.0),
]


def gemini_resp(modelo, llamadas, razon, cache=True):
    ent, sal, cac = TARIFAS[modelo]
    entrada = (ENT_LLAMADA + HERR) * llamadas
    salida = (SAL_LLAMADA + razon) * llamadas
    en_cache = SISTEMA * llamadas if cache else 0
    return ((entrada - en_cache) * ent + en_cache * cac + salida * sal) / 1e6


def mes(plan, uso, esc, clientes=10):
    nombre, precio, incluidas, paga_meta = plan
    _, modelo, ll, razon, rpc = esc
    conv = incluidas * uso
    msj = conv * rpc
    d = {
        'Impuestos': precio * m43.IMPUESTOS,
        'Meta': ((max(0, msj - m43.GRATIS) * m43.SERVICIO
                  + conv * m43.RECORDATORIO * m43.UTILIDAD) if paga_meta else 0),
        'Gemini': msj * gemini_resp(modelo, ll, razon),
        'Chip y fijo': (m43.CHIP_POR_NUMERO if paga_meta else 0) + m43.FIJO_PLATAFORMA / clientes,
    }
    return precio, d


def pct(x, p):
    return f'{100 * x / p:6.1f} %'


if __name__ == '__main__':
    print('=' * 100)
    print('1. GEMINI POR CONVERSACION DE RESERVAS (USD), con cache, contra Meta (0,096 fuera de franquicia)')
    print('=' * 100)
    for esc in ESCENARIOS:
        g = gemini_resp(esc[1], esc[2], esc[3]) * esc[4]
        meta = esc[4] * m43.SERVICIO
        print(f'   {esc[0]:28} Gemini {g:.4f}  Meta {meta:.4f}  '
              f'Gemini = {100 * g / (g + meta):4.1f} % del variable   '
              f'(x{g / (gemini_resp("3.5 Flash-Lite", 2.2, 100) * 8.5):.1f} de hoy)')

    print('\n   Sensibilidad al razonamiento (3.7 2027, 1,6 llamadas, 7,5 respuestas):')
    for r in (0, 300, 800, 1500, 3000):
        g = gemini_resp('3.7 Flash (2027)', 1.6, r) * 7.5
        print(f'     {r:5d} tokens de razonamiento por llamada -> {g:.4f} USD por conversacion')

    for uso in (1.0, 0.6):
        print('\n' + '=' * 100)
        print(f'2. MARGEN DE CONTRIBUCION (% del precio), reservas, uso {int(uso * 100)} %, 10 clientes')
        print('=' * 100)
        print(f'   {"":28}' + ''.join(f'{p[0][:17]:>18}' for p in m43.PLANES))
        for esc in ESCENARIOS:
            fila = ''
            for p in m43.PLANES:
                precio, d = mes(p, uso, esc)
                fila += f'{pct(precio - sum(d.values()), precio):>18}'
            print(f'   {esc[0]:28}' + fila)

    print('\n' + '=' * 100)
    print('3. DESGLOSE EN % DEL PRECIO: plan Crecimiento 50/220 y Platinum 120/500, uso 100 %')
    print('=' * 100)
    for idx in (1, 3):
        p = m43.PLANES[idx]
        print(f'   {p[0]}')
        for esc in (ESCENARIOS[0], ESCENARIOS[2], ESCENARIOS[5]):
            precio, d = mes(p, 1.0, esc)
            partes = '  '.join(f'{k} {pct(v, precio)}' for k, v in d.items())
            print(f'     {esc[0]:26} {partes}  | margen {pct(precio - sum(d.values()), precio)}')

    print('\n' + '=' * 100)
    print('4. BYOC 50: conversaciones de reservas al mes en que Gemini se come el precio neto')
    print('=' * 100)
    neto = 50 * (1 - m43.IMPUESTOS) - m43.FIJO_PLATAFORMA / 10
    for esc in ESCENARIOS:
        g = gemini_resp(esc[1], esc[2], esc[3]) * esc[4]
        print(f'   {esc[0]:28} {neto / g:6.0f}')

    print('\n' + '=' * 100)
    print('5. QUE PRECIO DEJA EL MISMO MARGEN QUE HOY (uso 100 %), con 3.7 2027 mejora media')
    print('=' * 100)
    for p in m43.PLANES:
        precio, d = mes(p, 1.0, ESCENARIOS[0])
        margen_hoy = (precio - sum(d.values())) / precio
        _, d2 = mes(p, 1.0, ESCENARIOS[5])
        costo_sin_imp = sum(v for k, v in d2.items() if k != 'Impuestos')
        nuevo = costo_sin_imp / (1 - m43.IMPUESTOS - margen_hoy)
        print(f'   {p[0]:22} hoy USD {precio:4.0f} con {100 * margen_hoy:4.1f} %  ->  USD {nuevo:6.1f}')
