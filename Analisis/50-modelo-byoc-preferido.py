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

    print('\n2. Las dos bolsas BYOC (decididas el 09/10; sin infraestructura)')
    c, p = 300, 15
    print(f'   conversaciones extra {c} por {p}: {p / c:.3f}/conv  Flash-Lite {pct(p * (1 - IMPUESTOS) - c * IA["Flash-Lite"], p)}'
          f'  Haiku {pct(p * (1 - IMPUESTOS) - c * IA["Haiku 4.5"], p)}')
    c, p = 300, 10
    print(f'   mensajes salientes fuera de 48 h {c} por {p}: {p / c:.3f}/msj  sin IA {pct(p * (1 - IMPUESTOS), p)}'
          f'  Meta del comercio por esos {c} (marketing): {c * MARKETING:5.1f}')
    print('   Impulso + 1 bolsa de conversaciones = 500 por 40; Crecimiento da 500 por 50.')

    print("\n3. Q'Taco (decidido 07/10): 35 por 400, BYOC, instalacion 0")
    for c in (220, 400):
        print(f'   {c} conv: Flash-Lite {pct(margen(35, c, IA["Flash-Lite"]), 35)}  Haiku {pct(margen(35, c, IA["Haiku 4.5"]), 35)}'
              f'  Meta de Q\'Taco (5,3 resp + 4,2 avisos) {max(0, c * 5.33 - GRATIS) * SERVICIO + c * 4.22 * UTILIDAD:5.1f}')

    print('\n4. Ruben (Dhermacore + productos digitales): 60 por 1.500 en 4 numeros, instalacion 200')
    for m, g in IA.items():
        print(f'   {m:15} al 50 % {pct(margen(60, 1500, g, .5), 60)}  al 100 % {pct(margen(60, 1500, g), 60)}'
              f'  equilibrio {(60 * (1 - IMPUESTOS) - FIJO) / g:6.0f} conv')
    print('   Meta de Ruben (4 franquicias = 4.000 msj; 70 % de leads por anuncio; lo del anuncio gratis 72 h;')
    print('   seguimiento 48 h incluido en la conversacion: gratis si vino de anuncio, marketing si no;')
    print('   seguimiento a la semana: bolsa de mensajes salientes, marketing para todos):')
    ADS, L = 0.70, 1500
    no_ads = L * (1 - ADS)
    servicio = max(0, no_ads * 6 - 4 * GRATIS) * SERVICIO
    for nombre, s48, sem in (('1.500 leads sin seguimientos', 0, 0), ('1.500 leads con el de 48 h (incluido)', 1, 0),
                             ('1.500 leads, 48 h y semana al 60 % (900 msj, 3 bolsas de 10)', 1, 0.6)):
        meta = servicio + s48 * no_ads * MARKETING + sem * L * MARKETING
        bolsas = 10 * (sem * L / 300)
        print(f'   {nombre:62} Meta {meta:6.1f}  paga en total {60 + bolsas + meta:6.1f}  (NovuChat {60 + bolsas:4.0f})')
    print('   Mismo caso si Meta no diera la ventana gratuita de 72 h (todo el trafico cobrado):')
    meta = max(0, L * 6 - 4 * GRATIS) * SERVICIO + L * MARKETING + 0.6 * L * MARKETING
    print(f'   {"1.500 leads, 48 h y semana al 60 %":62} Meta {meta:6.1f}  paga en total {60 + 30 + meta:6.1f}')
