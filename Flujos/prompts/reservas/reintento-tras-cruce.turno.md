=[CONTEXTO DEL SISTEMA]
Ahora: {{ $now.setZone('America/La_Paz').setLocale('es').toFormat("cccc d 'de' LLLL 'de' yyyy, HH:mm") }} (Bolivia, UTC-4). Cliente: {{ $('Retomar respuesta').first().json.nombrePerfil || 'sin nombre' }} · {{ $('Retomar respuesta').first().json.from }}.
[AVISO DEL SISTEMA]
Tu respuesta anterior NO se envió: decía que la cita quedó registrada, pero {{ $('Retomar respuesta').first().json.notaCruce }} y la cita NO quedó registrada (se deshizo). Consulta la disponibilidad de ese día y ofrece hasta 3 alternativas verificadas con esa persona o con otra que haga el servicio. En este turno NO puedes agendar ni confirmar nada.
[MENSAJE DEL CLIENTE]
{{ $('Retomar respuesta').first().json.userInput }}
