# -*- coding: utf-8 -*-
"""BYOC: el comercio pone su portafolio, su numero y su tarjeta en Meta.

QUE DECIDE ESTE MODELO. No el margen: el TECHO. El modelo con Meta incluido
(planes 25/50/90) no se queda sin rentabilidad, se queda sin cupo — Meta limita
a 2 portafolios por cuenta personal sin verificar, 2 numeros por portafolio y 1
usuario de sistema administrador (GUIA-META-NOVUCHAT.md:158, Analisis/13 §30).
Con varios clientes en cola, la cola no entra. Un comercio que trae su
portafolio YA VERIFICADO no consume ninguno de esos cupos, y ademas se lleva por
delante el tope de 250 conversaciones iniciadas por dia.

Lo que este modelo calcula es lo OTRO: cuanto cuesta atender a un comercio BYOC
(solo el modelo de IA, porque Meta va a su tarjeta), a partir de que volumen el
plan con Meta incluido empieza a perder, y cuanto paga el comercio en cada
modalidad segun cuanto de su trafico nazca de un anuncio.

Decision de Andres (23/09/2026): LAS DOS MODALIDADES CONVIVEN. Los planes
25/50/90 con Meta incluido siguen para el comercio chico; BYOC es una modalidad
aparte para quien trae su portafolio o proyecta volumen.

Tarifas de Meta desde el 01/10/2026 (14-modelo-costos.py). Impuestos 16 %.
Correr: python3 Analisis/39-byoc-modelo.py
"""
import importlib.util, math, os

_AQUI = os.path.dirname(os.path.abspath(__file__))


def _carga(archivo, nombre):
    ruta = os.path.join(_AQUI, archivo)
    spec = importlib.util.spec_from_file_location(nombre, ruta)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


m38 = _carga('38-dhermacore-modelo.py', 'm38')   # el caso Dhermacore, 22/09
m14 = m38.m14                                     # tarifas y tokens, 08/09

IMP = 0.16

# --- LA MODALIDAD BYOC, tal como se propone ---
BYOC_PRECIO = 50.0
BYOC_INCLUIDAS = 2000
BYOC_SETUP = 175.0
BYOC_NETO = BYOC_PRECIO * (1 - IMP)

# --- La oferta con Meta incluido, para comparar (Analisis/38) ---
INCL_PRECIO, INCL_INCLUIDAS = m38.PRECIO, m38.INCLUIDAS   # 99 por 800
INCL_NETO = m38.NETO


# -----------------------------------------------------------------------------
# EL RENGLON QUE QUEDA DEL LADO DE NOVUCHAT: EL MODELO DE IA
# -----------------------------------------------------------------------------
# Con BYOC, Meta va a la tarjeta del comercio. A NovuChat le queda el modelo (y
# unos centavos de OCR). POR ESO EL TOPE DE CONVERSACIONES SE FIJA CONTRA EL
# MODELO QUE CORRE, y no al reves: el mismo contrato deja +20 con Gemini y -12
# con Haiku. Hoy los cinco JSON de Flujos/ corren gemini-3.5-flash-lite.

def _modelo_usd(turnos, entrada, salida, cache_lectura, cache_escritura):
    """Costo de una conversacion con el prefijo cacheado, a tarifas dadas."""
    ent, sal, llamadas = m14.tokens(turnos)
    resto = ent - m14.PREFIJO_A * llamadas
    return (resto * entrada
            + m14.PREFIJO_A * cache_escritura
            + m14.PREFIJO_A * (llamadas - 1) * cache_lectura
            + sal * salida) / 1e6


MODELOS = {
    'Gemini 3.5 Flash-Lite': lambda t: m14.modelo_usd(t),          # el que corre hoy
    'Claude Haiku 4.5': lambda t: _modelo_usd(t, 1.00, 5.00, 0.10, 1.25),
    'Claude Sonnet 5': lambda t: _modelo_usd(t, 2.00, 10.00, 0.20, 2.50),
}


def costo_novuchat(n, msj, modelo):
    """Lo que le cuesta a NovuChat un mes BYOC: el modelo, y la lectura de
    comprobantes de las conversaciones que terminan en compra. Meta no entra."""
    ia = n * modelo(min(msj, 30))
    ocr = n * m38.REPARTO[1] * m38.COMPRAS * m38.OCR
    return ia + ocr


def equilibrio_byoc(msj, modelo, tope=60000):
    """Conversaciones a las que el margen de la modalidad BYOC se hace cero."""
    n = 0
    while costo_novuchat(n + 1, msj, modelo) < BYOC_NETO and n < tope:
        n += 1
    return n


# -----------------------------------------------------------------------------
# LO QUE LE LLEGA AL COMERCIO DESDE META
# -----------------------------------------------------------------------------
# Con BYOC esta factura deja de ser costo de NovuChat y pasa a ser costo del
# comercio. NO ES «unos centavos»: depende enteramente de cuanto de su trafico
# nazca de un anuncio de clic a WhatsApp (ventana de punto de entrada gratuito).

def factura_meta(n, msj, ctwa):
    """Servicio + avisos al equipo + seguimiento de rescate, con UNA franquicia
    de 1.000 mensajes por numero de empresa."""
    servicio = m38.costo_meta_mes(n, msj, ctwa)
    avisos = n * m38.AVISO_A_PERSONA * m14.UTILIDAD
    rescate = n * m38.RESCATE * (1 - ctwa) * m14.UTILIDAD
    return servicio + avisos + rescate


def paga_el_comercio_byoc(n, msj, ctwa):
    return BYOC_PRECIO + factura_meta(n, msj, ctwa)


def paga_el_comercio_incluido(n):
    """La oferta de 99 por 800, mas bolsas de 30 conversaciones por USD 10."""
    return INCL_PRECIO + math.ceil(max(0, n - INCL_INCLUIDAS) / 30) * 10


def margen_incluido(n, msj, ctwa=m38.CTWA):
    """Margen de NovuChat con Meta incluido: el ingreso menos TODO el costo."""
    return INCL_NETO - m38.mes(n, msj, False, ctwa)


def margen_byoc(n, msj, modelo):
    return BYOC_NETO - costo_novuchat(n, msj, modelo)


def cruce(msj, modelo, tope=5000):
    """Volumen a partir del cual BYOC deja mas margen que el plan con Meta."""
    for n in range(1, tope + 1):
        if margen_byoc(n, msj, modelo) > margen_incluido(n, msj):
            return n
    return None


if __name__ == '__main__':
    MSJ = 14   # la conversacion tipica de las dos lineas de Dhermacore
    gemini = MODELOS['Gemini 3.5 Flash-Lite']

    print('=' * 78)
    print('BYOC: USD %.0f por %d conversaciones. Neto de impuestos: %.2f'
          % (BYOC_PRECIO, BYOC_INCLUIDAS, BYOC_NETO))
    print('Comparado con la oferta con Meta incluido: USD %.0f por %d (neto %.2f)'
          % (INCL_PRECIO, INCL_INCLUIDAS, INCL_NETO))
    print('=' * 78)

    print('\n1. EL TOPE HAY QUE FIJARLO CONTRA EL MODELO QUE CORRE')
    print('   %-24s %10s %12s %14s' % ('modelo', 'USD/conv', 'margen a 2.000', 'equilibrio'))
    for nombre, f in MODELOS.items():
        m = margen_byoc(BYOC_INCLUIDAS, MSJ, f)
        eq = equilibrio_byoc(MSJ, f)
        alerta = '  <-- POR DEBAJO DEL TOPE' if eq < BYOC_INCLUIDAS else ''
        print('   %-24s %10.4f %+12.1f %14d%s' % (nombre, f(MSJ), m, eq, alerta))
    print('   (a %d mensajes por conversacion; hoy corre Gemini en los cinco flujos)' % MSJ)

    print('\n2. MARGEN DE NOVUCHAT, POR MODALIDAD (Gemini, %d msj)' % MSJ)
    print('   %6s %20s %12s %12s' % ('conv', 'Meta incluido (99)', 'BYOC (50)', 'diferencia'))
    for n in (300, 500, 800, 1200, 1500, 2000):
        a, b = margen_incluido(n, MSJ), margen_byoc(n, MSJ, gemini)
        print('   %6d %+20.1f %+12.1f %+12.1f' % (n, a, b, b - a))
    c = cruce(MSJ, gemini)
    print('   BYOC deja mas margen desde las %d conversaciones al mes.' % c)

    print('\n3. LO QUE PAGA EL COMERCIO, SEGUN CUANTO ENTRE POR ANUNCIO')
    for ctwa in (0.70, 0.40, 0.0):
        print('\n   -- %.0f %% del trafico nace de un anuncio --' % (100 * ctwa))
        print('   %6s %14s %12s %14s %10s'
              % ('conv', 'Meta le cobra', 'total BYOC', 'con Meta incl.', 'conviene'))
        for n in (500, 800, 1200, 2000):
            f = factura_meta(n, MSJ, ctwa)
            total = BYOC_PRECIO + f
            incl = paga_el_comercio_incluido(n)
            print('   %6d %14.1f %12.1f %14.0f %10s'
                  % (n, f, total, incl, 'BYOC' if total < incl else 'incluido'))

    print('\n4. LOS TECHOS DE META QUE BYOC LEVANTA (no son economicos)')
    for fila in (
        ('Portafolios por cuenta personal sin verificar', '2', 'GUIA-META-NOVUCHAT.md:158'),
        ('Numeros por portafolio sin verificar', '2', 'Analisis/13 §30'),
        ('Usuarios de sistema ADMINISTRADOR por portafolio', '1', 'memoria del alta, punto 2'),
        ('Conversaciones iniciadas por el negocio, por dia', '250', 'Analisis/13 §30'),
        ('Chip y telefono libres de cuenta previa, por alta', '1', 'memoria del alta, punto 4'),
    ):
        print('   %-48s %6s   %s' % fila)
    print('   Un comercio con portafolio verificado no consume NINGUNO de estos.')
    print('   Lo que BYOC NO levanta: un webhook por app => un flujo de n8n por')
    print('   cliente (Analisis/20 §2). Eso solo lo cierra Tech Provider.')
