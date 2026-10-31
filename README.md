# Lab. María Eugenia Tamayo Giraldo

Prototipo local para gestionar las colas de **Recepción**, **Toma de muestras** y **Rayos X**. Está diseñado para reducir al mínimo el trabajo de recepción y mantener sincronizados operadores y pantallas públicas en tiempo real.

## Incluye

- Registro guiado en tres pasos y creación de turnos dobles.
- Prioridad de atención y orden automático de cada cola.
- Los turnos dobles siguen la secuencia Toma de muestras → Rayos X para evitar llamados simultáneos.
- Flujo operativo: llamar, repetir, iniciar, finalizar o marcar ausente.
- Dos módulos iniciales para Toma de muestras, con atención simultánea sobre una cola compartida.
- Configuración para agregar, renombrar, activar o desactivar puestos sin cambiar código.
- Pantalla pública con el nombre del paciente, el puesto de destino y anuncio de voz.
- Sincronización SSE entre pestañas sin recargar la página.
- PostgreSQL en producción y SQLite local en `data/turnos.db` para desarrollo.
- HTMX y su extensión SSE guardados localmente; el prototipo no necesita un CDN al ejecutarse.
- Diseño responsive y accesible para escritorio, tableta y móvil.

## Ejecutar

Requiere Node.js 22.5 o posterior y pnpm 11.9 o posterior.

```bash
pnpm install
pnpm start
```

Abre [http://127.0.0.1:3000/recepcion](http://127.0.0.1:3000/recepcion).

Rutas principales:

- `http://127.0.0.1:3000/recepcion`
- `http://127.0.0.1:3000/atencion`
- `http://127.0.0.1:3000/pantalla`
- `http://127.0.0.1:3000/configuracion`
- `http://127.0.0.1:3000/admin`
- `http://127.0.0.1:3000/salud`

El panel de administración pide contraseña antes de mostrar métricas de volumen, espera, duración de atención, ausencias y desempeño por servicio y puesto. En desarrollo la contraseña predeterminada es `admin`. Para definir una contraseña propia al iniciar:

```bash
ADMIN_PASSWORD="una-contraseña-segura" pnpm start
```

Las sesiones administrativas se guardan solamente en memoria, usan una cookie `HttpOnly` y caducan después de 8 horas. Al reiniciar el servidor se cierran todas las sesiones activas.

Para permitir acceso desde otros equipos de la misma red:

```bash
HOST=0.0.0.0 PORT=3000 pnpm start
```

En ese caso, abre la dirección IP local del equipo servidor desde las otras estaciones. En un despliegue real se debe añadir HTTPS, autenticación y reglas de firewall.

## Pruebas

```bash
pnpm test
```

## Puestos de atención

Toma de muestras comienza con **Módulo 1** y **Módulo 2**. Ambos llaman pacientes distintos desde una única cola, respetando prioridad y orden de llegada. Cada navegador de Atención selecciona el puesto desde el que está trabajando. Los servicios y módulos se eligen con botones táctiles; el puesto seleccionado queda visible y se recuerda durante un año en ese navegador. Los enlaces con servicio y puesto explícitos tienen prioridad. Si el puesto guardado se desactiva, se selecciona uno activo. Cambiar de puesto con un paciente activo pide confirmación y conserva la atención en el puesto original.

En **Configuración** se pueden agregar nuevos módulos. Los puestos se desactivan en lugar de eliminarse para conservar el historial; no es posible desactivar un puesto con un turno activo ni dejar un servicio sin puestos activos.

## Datos del prototipo

La primera ejecución crea datos de ejemplo. Las nuevas llegadas y atenciones quedan guardadas en `data/turnos.db`. Para empezar de cero, detén la aplicación y elimina únicamente ese archivo; al volver a iniciar se generará una base nueva con los datos demostrativos.

## Decisiones técnicas

- **Servidor:** Fastify 5 sobre Node.js, ejecutado como un único servicio.
- **Base de datos:** PostgreSQL mediante `pg` en producción; SQLite mediante `node:sqlite` en desarrollo.
- **Interfaz:** HTML renderizado en el servidor, HTMX y CSS propio.
- **Tiempo real:** SSE. Los comandos siguen usando solicitudes HTTP normales.
- **Concurrencia:** transacciones con exclusión entre escrituras asignan cada paciente a un solo puesto; varios puestos pueden atender la misma cola en paralelo.
- **Pantalla pública:** muestra el nombre del paciente, el servicio y el puesto de destino.

Los conceptos visuales que guiaron la implementación están en [`docs/design`](./docs/design).

## Producción: surf-apps

Dominio: https://turnero.surfingbird.space. Proyecto en el servidor: `/data/sites/turnero`.

Los archivos de Docker están en `docke/`; `docker-compose.prod.yml` está en la raíz. El servicio se conecta a la red externa `service_network` de Traefik, usa los puntos de entrada `web`/`websecure` y el resolver `letsencrypt`. El puerto 3000 no se publica en el host.

1. Copia `docke/.env.prod.example` a `docke/.env.prod`.
2. Completa `DB_PASSWORD` y `ADMIN_PASSWORD` con las credenciales reales. Protege el archivo con `chmod 600 docke/.env.prod`; está excluido de Git y de la imagen.
3. Ejecuta desde la raíz:

```bash
docker compose -f docker-compose.prod.yml up -d --build --wait
docker compose -f docker-compose.prod.yml ps
curl --fail https://turnero.surfingbird.space/salud
```

El inicio crea las tablas e índices necesarios en PostgreSQL, sin cargar pacientes demostrativos. La base SQLite local no se copia al servidor. Los datos persisten en la base externa `turnero`, incluso al reconstruir o eliminar el contenedor. La zona horaria es `America/Bogota` y `/salud` verifica también la conexión a la base de datos. Las cookies administrativas usan `Secure` detrás de Traefik.

Para consultar el funcionamiento:

```bash
docker compose -f docker-compose.prod.yml logs --tail=100 app
```

Para ejecutar la prueba de PostgreSQL en un esquema temporal, que se elimina al finalizar:

```bash
docker run --rm --network service_network \
  --env-file docke/.env.prod -e TEST_POSTGRES=1 -e TRUST_PROXY=true \
  -v "$PWD/test:/app/test:ro" turnero:latest \
  node --test test/postgres.test.mjs
```

Se verifica el orden prioritario, llamados concurrentes, turnos dobles, rollback, métricas, páginas, acceso administrativo y persistencia al reabrir. El usuario PostgreSQL necesita permiso para crear el esquema temporal de prueba. La aplicación se despliega como una sola instancia porque las sesiones administrativas y conexiones SSE viven en memoria.
