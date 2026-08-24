# RicMor Soccers

Videojuego web de futbol 1 vs 1 multijugador en tiempo real con Node.js, Express, Socket.IO y Phaser 3.

Tambien incluye modo contra computadora con dificultad ajustable: `Facil`, `Normal` y `Dificil`.

## Ejecutar localmente

```bash
npm install
npm start
```

Luego abre:

```text
http://localhost:3000
```

Para probar en la misma computadora, abre dos pestanas del navegador. En una crea una sala, copia el codigo y en la otra entra con ese codigo.

Para jugar solo, escribe tu nombre, elige el nivel de la computadora y presiona `JUGAR VS CPU`.

## Jugar desde celulares en la misma red

1. Ejecuta el servidor con `npm start`.
2. Busca la IP local de tu computadora.
3. Desde otro dispositivo conectado al mismo Wi-Fi abre `http://TU-IP:3000`.

## Ponerlo online

El proyecto no usa base de datos; las salas viven en memoria del servidor. Para jugar con alguien desde otra ciudad puedes desplegarlo en un servicio que soporte Node.js y WebSockets, por ejemplo Render, Railway, Fly.io, DigitalOcean o un VPS.

Pasos generales:

1. Sube la carpeta a un repositorio.
2. Crea un servicio web Node.js.
3. Usa `npm install` como comando de instalacion.
4. Usa `npm start` como comando de arranque.
5. Expone el puerto que el proveedor indique mediante la variable `PORT`.

Cuando este desplegado, ambos jugadores entran a la URL publica, uno crea la sala y el otro se une con el codigo.

## Controles

Computadora:

- `W`, `A`, `S`, `D`
- Flechas del teclado

Celular:

- Botones tactiles en pantalla

## Reglas

- Partidos de 2 minutos.
- Goles detectados por el servidor.
- Revancha cuando ambos jugadores la aceptan.
- Si un jugador abandona, el rival recibe aviso y puede volver al inicio.

## Ajustar niveles de CPU

Los niveles estan en `server.js`, dentro del objeto `AI_LEVELS`.

- `speed`: velocidad de la CPU.
- `reactionMs`: tiempo de reaccion; menos es mas dificil.
- `aimError`: error al perseguir o defender la pelota; menos es mas preciso.
- `attackLine`: desde que zona empieza a presionar.
- `homeX`: posicion defensiva base.
- `chaseBias`: agresividad para ir por la pelota.
