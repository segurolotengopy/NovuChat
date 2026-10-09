# -*- coding: utf-8 -*-
"""BYOC como mecanismo preferido: tabla publica, bolsas y los casos Q'Taco y Ruben.

Acompana a `Analisis/50-byoc-mecanismo-preferido.md` (09/10/2026). Autocontenido;
tarifas, fijos y perfil de tokens de `Analisis/47` a `49`.

Correr: python3 Analisis/50-modelo-byoc-preferido.py
"""

IMPUESTOS = 0.16            # IVA 13 % + IT 3 %, sobre el precio cobrado
FIJO = 21.82 / 10           # fijo de plataforma entre 10 comercios
SERVICIO = UTILIDAD = 0.0113
MARKETING = 0.0740          # plantilla de marketing (seguimiento a la semana)
GRATIS = 1000               # mensajes de servicio gratis por numero y mes
IA = {'Flash-Lite': 0.004, 'Haiku 4.5': 0.0106, 'Agente c/cache': 0.021, 'Agente s/cache': 0.051}


def margen(precio, conv, ia, uso=1.0, fijo=FIJO):
    return precio * (1 - IMPUESTOS) - fijo - conv * uso * ia


def pct(m, p):
    return f'{m:6.1f} ({100 * m / p:3.0f} %)'


if __name__ == '__main__':
    print('1. Tabla publica BYOC (25/200, 50/500, 90/1.000): margen a uso pleno por modelo')
    for n, p, c in (('Impulso', 25, 200), ('Crecimiento', 50, 500), ('Pro', 90, 1000)):
        print(f'   {n:11} {p:3d}/{c:5d}  ' + '  '.join(f'{m} {pct(margen(p, c, g), p)}' for m, g in IA.items()))
        meta = max(0, c * 5 - GRATIS) * SERVICIO + c * UTILIDAD
        print(f'   {"":11} Meta del comercio a uso pleno (5 respuestas + 1 aviso): {meta:5.1f}; paga en total {p + meta:6.1f}')

    print('\n2. Bolsas BYOC (sin infraestructura): margen y precio por conversacion')
    for c, p in ((300, 10), (300, 15), (300, 40), (50, 8), (100, 15)):
        print(f'   {c:3d} por {p:2d}: {p / c:.3f}/conv  Flash-Lite {pct(p * (1 - IMPUESTOS) - c * IA["Flash-Lite"], p)}'
              f'  Haiku {pct(p * (1 - IMPUESTOS) - c * IA["Haiku 4.5"], p)}')
    print('   Impulso + 1 bolsa de 300 por 10 = 500 conversaciones por 35; Crecimiento da 500 por 50.')

    print("\n3. Q'Taco (decidido 07/10): 35 por 400, BYOC, instalacion 0")
    for c in (220, 400):
        print(f'   {c} conv: Flash-Lite {pct(margen(35, c, IA["Flash-Lite"]), 35)}  Haiku {pct(margen(35, c, IA["Haiku 4.5"]), 35)}'
              f'  Meta de Q\'Taco (5,3 resp + 4,2 avisos) {max(0, c * 5.33 - GRATIS) * SERVICIO + c * 4.22 * UTILIDAD:5.1f}')

    print('\n4. Ruben (Dhermacore + productos digitales): 60 por 1.500 en 4 numeros, instalacion 200')
    for m, g in IA.items():
        print(f'   {m:15} al 50 % {pct(margen(60, 1500, g, .5), 60)}  al 100 % {pct(margen(60, 1500, g), 60)}'
              f'  equilibrio {(60 * (1 - IMPUESTOS) - FIJO) / g:6.0f} conv')
    print('   Meta de Ruben (4 franquicias = 4.000 msj; 70 % de leads por anuncio; lo del anuncio gratis 72 h;')
    print('   seguimiento 48 h gratis si vino de anuncio, si no marketing; seguimiento a la semana siempre marketing):')
    ADS = 0.70
    for nombre, leads, s48, s7 in (('500 leads con los dos seguimientos (3 conv por lead)', 500, 1, 1),
                                   ('750 leads con el de 48 h (2 conv por lead)', 750, 1, 0),
                                   ('1.500 leads sin seguimientos', 1500, 0, 0)):
        no_ads = leads * (1 - ADS)
        servicio = max(0, no_ads * 6 - 4 * GRATIS) * SERVICIO
        meta = servicio + s48 * no_ads * MARKETING + s7 * leads * MARKETING
        print(f'   {nombre:52} Meta {meta:6.1f}  paga en total {60 + meta:6.1f}')
    print('   Mismo caso si Meta no diera la ventana gratuita de 72 h (todo el trafico cobrado):')
    for nombre, leads, s48, s7 in (('500 leads con los dos seguimientos', 500, 1, 1), ('1.500 leads sin seguimientos', 1500, 0, 0)):
        meta = max(0, leads * 6 - 4 * GRATIS) * SERVICIO + s48 * leads * MARKETING + s7 * leads * MARKETING
        print(f'   {nombre:52} Meta {meta:6.1f}  paga en total {60 + meta:6.1f}')
