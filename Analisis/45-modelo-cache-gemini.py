# -*- coding: utf-8 -*-
"""Cache de Gemini: implicita (la que ya corre) contra explicita (la que habria
que construir), con Flash-Lite y con 3.7 Flash.

Acompana a `Analisis/45-cache-de-gemini.md` (28/09/2026). Reutiliza 43 y 44.

Implicita: automatica, sin almacenamiento, sin garantia. Acierta cuando llega
  otra peticion con el mismo prefijo poco despues. Se modela como la fraccion
  de los tokens del prompt de sistema que se cobran a precio de cache.
Explicita: se crea un objeto de cache por comercio (prompt de sistema +
  herramientas) con un TTL; acierta siempre mientras vive, y se paga el
  almacenamiento por hora. El sub-nodo de Gemini de n8n 2.36.5 NO la admite.

Almacenamiento (USD por millon de tokens por hora, pagina de precios 28/09):
  3.5 Flash-Lite 1,00 · 3.7 Flash 0,50 hasta el 31/12/2026 y 1,00 desde 2027.

Correr: python3 Analisis/45-modelo-cache-gemini.py
"""
import importlib.util
import os


def _cargar(nombre, archivo):
    r = os.path.join(os.path.dirname(os.path.abspath(__file__)), archivo)
    s = importlib.util.spec_from_file_location(nombre, r)
    m = importlib.util.module_from_spec(s)
    s.loader.exec_module(m)
    return m


m43 = _cargar('m43', '43-modelo-fijos-variables.py')
m44 = _cargar('m44', '44-modelo-gemini-37-flash.py')

ALMACEN = {'3.5 Flash-Lite': 1.00, '3.7 Flash (2026)': 0.50, '3.7 Flash (2027)': 1.00}
CACHEABLE = m44.SISTEMA + m44.HERR     # lo que va al objeto de cache: 6.600 tokens

# El 90 % de la plantilla del prompt de reservas es texto fijo, igual para todos
# los comercios (Demo A y Platinum: 100 % igual), pero hoy empieza con el nombre
# del asistente y del negocio: el prefijo literal comun es de 95 caracteres. Si
# el prompt se ordena por capas (core -> modulo -> comercio), el nucleo comun
# (~5.000 tokens) mas las herramientas del modulo es un prefijo COMPARTIDO por
# todos los comercios del modulo.
NUCLEO = 5_000 + m44.HERR             # 5.600 tokens comunes a todo el modulo
COMERCIOS_POR_MODULO = 10

# Aciertos de la cache implicita, como fraccion de las llamadas. La llamada
# 2..n de una misma respuesta llega segundos despues: casi siempre acierta.
# La primera llamada de cada respuesta depende del trafico del comercio.
def aciertos_implicita(llamadas, primera):
    """`primera`: probabilidad de que la primera llamada de una respuesta acierte."""
    dentro = (llamadas - 1) / llamadas * 0.9
    return dentro + primera / llamadas


IMPLICITA = [('Implicita, pesimista', 0.0), ('Implicita, central', 0.4),
             ('Implicita, optimista', 0.8)]

MODELOS = [
    ('Hoy: 3.5 Flash-Lite',      '3.5 Flash-Lite',   2.2, 100, 8.5),
    ('3.7 2026, mejora media',   '3.7 Flash (2026)', 1.6, 800, 7.5),
    ('3.7 2027, mejora media',   '3.7 Flash (2027)', 1.6, 800, 7.5),
]


def costo_llamada(modelo, razon, fraccion_cache):
    ent, sal, cac = m44.TARIFAS[modelo]
    entrada = m44.ENT_LLAMADA + m44.HERR
    cache = CACHEABLE * fraccion_cache
    salida = m44.SAL_LLAMADA + razon
    return ((entrada - cache) * ent + cache * cac + salida * sal) / 1e6


def gemini_mes(conv, esc, modo, horas=720):
    """USD de Gemini de UN comercio en un mes. modo: 'sin', ('imp', p) o 'exp'."""
    _, modelo, ll, razon, rpc = esc
    llamadas = conv * rpc * ll
    if modo == 'sin':
        return llamadas * costo_llamada(modelo, razon, 0.0)
    if modo == 'exp':
        almacen = CACHEABLE / 1e6 * ALMACEN[modelo] * horas
        return llamadas * costo_llamada(modelo, razon, 1.0) + almacen
    if modo in ('reord', 'expc'):
        # Nucleo comun: con 'reord' lo acierta la implicita con el trafico de
        # TODOS los comercios (primera llamada 0,8); con 'expc' es una cache
        # explicita por modulo, cuyo almacenamiento se reparte entre comercios.
        # La parte del comercio (1.000 tokens) queda en la implicita central.
        ent, sal, cac = m44.TARIFAS[modelo]
        f_nucleo = 1.0 if modo == 'expc' else aciertos_implicita(ll, 0.8)
        f_comercio = aciertos_implicita(ll, 0.4)
        comercio = CACHEABLE - NUCLEO
        entrada = m44.ENT_LLAMADA + m44.HERR
        cache = NUCLEO * f_nucleo + comercio * f_comercio
        por_llamada = ((entrada - cache) * ent + cache * cac
                       + (m44.SAL_LLAMADA + razon) * sal) / 1e6
        almacen = (NUCLEO / 1e6 * ALMACEN[modelo] * horas / COMERCIOS_POR_MODULO
                   if modo == 'expc' else 0)
        return llamadas * por_llamada + almacen
    return llamadas * costo_llamada(modelo, razon, aciertos_implicita(ll, modo[1]))


def equilibrio_explicita(esc, primera, horas=720):
    """Conversaciones al mes desde las que la explicita cuesta menos que la implicita."""
    for conv in range(10, 20001, 10):
        if gemini_mes(conv, esc, 'exp', horas) <= gemini_mes(conv, esc, ('imp', primera), horas):
            return conv
    return None


if __name__ == '__main__':
    print('=' * 100)
    print('1. ACIERTOS DE LA IMPLICITA (fraccion de llamadas que leen el prompt de la cache)')
    print('=' * 100)
    for n, p in IMPLICITA:
        print(f'   {n:22}' + ''.join(
            f'   {e[0][:22]:>22}: {100 * aciertos_implicita(e[2], p):4.0f} %' for e in MODELOS[:2]))

    print('\n' + '=' * 100)
    print('2. GEMINI POR CONVERSACION DE RESERVAS (USD), comercio de 220 conversaciones al mes')
    print('=' * 100)
    modos = [('Sin cache', 'sin')] + [(n, ('imp', p)) for n, p in IMPLICITA] + \
            [('Explicita x comercio', 'exp'), ('Implicita reordenada', 'reord'),
             ('Explicita x modulo', 'expc')]
    print(f'   {"":26}' + ''.join(f'{n:>21}' for n, _ in modos))
    for esc in MODELOS:
        print(f'   {esc[0]:26}' + ''.join(
            f'{gemini_mes(220, esc, mo) / 220:>21.4f}' for _, mo in modos))

    print('\n' + '=' * 100)
    print('3. MARGEN DE CONTRIBUCION DEL PLAN CRECIMIENTO 50/220 AL 100 % (y Platinum 120/500)')
    print('=' * 100)
    for idx in (1, 3):
        nombre, precio, incl, _ = m43.PLANES[idx]
        print(f'   {nombre}')
        for esc in MODELOS:
            fila = ''
            for _, mo in modos:
                _, d = m44.mes(m43.PLANES[idx], 1.0, esc)
                d['Gemini'] = gemini_mes(incl, esc, mo)
                fila += f'{100 * (precio - sum(d.values())) / precio:>21.1f}%'
            print(f'     {esc[0]:24}' + fila)

    print('\n' + '=' * 100)
    print('4. ALMACENAMIENTO DE LA EXPLICITA por comercio y por prompt distinto (USD al mes)')
    print('=' * 100)
    for mod, precio in ALMACEN.items():
        print(f'   {mod:18} 24 h: {CACHEABLE / 1e6 * precio * 720:5.2f}   '
              f'14 h (horario de atencion): {CACHEABLE / 1e6 * precio * 420:5.2f}')

    print('\n' + '=' * 100)
    print('5. DESDE CUANTAS CONVERSACIONES AL MES CONVIENE LA EXPLICITA (contra la implicita)')
    print('=' * 100)
    for esc in MODELOS:
        fila = ''.join(f'   {n.split(", ")[1]}: {equilibrio_explicita(esc, p) or "nunca":>6}'
                       for n, p in IMPLICITA)
        print(f'   {esc[0]:26}' + fila)
    print('   (contra «sin cache», que es el caso si la implicita no acertara nunca:)')
    for esc in MODELOS:
        for conv in range(10, 20001, 10):
            if gemini_mes(conv, esc, 'exp') <= gemini_mes(conv, esc, 'sin'):
                print(f'   {esc[0]:26}   {conv}')
                break
