# Bot de soporte "Vocabulario" — Speak Easy

Bot de soporte por WhatsApp para las personas que compraron el **Vocabulario de Profesiones** (vocabulario en inglés por profesión).
GoHighLevel (GHL) envía cada mensaje entrante a un webhook. El bot responde con Claude (API de Anthropic) y envía la respuesta de vuelta por la API de GHL. Se despliega en Vercel.

```
WhatsApp → GHL (flujo "BOT VOCABULARIO") → POST /api/webhook/ghl → 200 inmediato
                                                 │ (waitUntil)
                                                 ▼
             idempotencia → etiquetas → activación → debounce → Claude + herramientas → GHL (WhatsApp)
```

## Cómo funciona

1. **Seguridad**: el webhook exige el header `x-webhook-secret` igual a `GHL_WEBHOOK_SECRET`.
2. **Respuesta inmediata**: guarda el payload en `webhook_logs`, responde `200` y procesa el resto en segundo plano con `waitUntil`, así GHL no reintenta.
3. **Idempotencia**: si el `message_id` ya existe, no hace nada. Si GHL no lo envía, usa un hash de contacto + texto + minuto.
4. **Etiquetas**: si el contacto tiene `humano` o `requiere_humano`, el bot nunca responde. Si el payload no trae etiquetas, las consulta en GHL.
5. **Activación**: el bot solo habla cuando el mensaje coincide con un **disparador** (tabla `disparadores`) o cuando ya hay una **sesión activa** sin vencer (`SESSION_TTL_HOURS`, contado desde que se activó o reactivó con un disparador).
   - `mensaje_exacto`: se compara normalizado (minúsculas, sin tildes, sin signos ni emojis, sin espacios extra).
   - `palabra_clave`: debe aparecer en el mensaje como palabra o frase completa ("soporte vocabulario" activa con "Hola, soporte vocabulario por favor", pero no con "soporte vocabularios").
6. **Debounce**: espera `DEBOUNCE_SECONDS`. Si en ese tiempo llega otro mensaje del mismo contacto, este termina y responde el más reciente. Así, varios mensajes seguidos reciben una sola respuesta.
7. **Claude**: recibe el system prompt, la base de conocimiento activa, el catálogo de vocabularios, la memoria del contacto y los últimos `HISTORY_LIMIT` mensajes de la sesión. Puede usar cuatro herramientas:
   - `verificar_acceso_vocabulario`: con el correo de compra, revisa si está autorizado y qué profesión eligió (ver [Datos del programa](#datos-del-programa-esquema-vocabulario)).
   - `escalar_a_humano`: envía un mensaje de transición, agrega la etiqueta `requiere_humano`, actualiza el campo `motivo_escalado`, crea una nota con el resumen y marca la sesión como `escalada`. Desde ahí el bot deja de responder.
   - `guardar_dato_contacto`: guarda datos del caso en `contactos.memoria` (profesión, problema...).
   - `cerrar_caso`: marca la sesión como `cerrada` y el bot queda inactivo hasta un nuevo disparador.
8. **Errores**: se registran en `webhook_logs` y en los logs de Vercel. El usuario nunca recibe mensajes de error técnicos. Si Claude rechaza responder o no termina en 6 pasos, el caso se escala automáticamente.
9. **Monitoreo**: cada respuesta queda en `turnos_bot` (herramientas usadas y su resultado, tokens, costo estimado, tiempo, errores y avisos) y se ve en el [panel `/admin`](#panel-de-monitoreo-admin).

## Panel de monitoreo (`/admin`)

Panel web protegido con contraseña (`PANEL_PASSWORD`, o `ADMIN_TOKEN` si no está). La raíz del sitio (`/`) lleva al panel.

- **Resumen**: conversaciones, mensajes atendidos, errores, costo estimado y tiempo de respuesta de los últimos 7, 30 o 90 días; gráfica diaria (respondidos, escalados, errores); cómo terminan las conversaciones; motivos de escalado; uso de herramientas (incluye correos autorizados y no autorizados); consumo de tokens y caché; últimos problemas. También avisa si falta configuración (por ejemplo `ANTHROPIC_API_KEY`) y cuándo llegó el último mensaje de GHL.
- **Conversaciones**: búsqueda por nombre, teléfono o correo guardado; filtros por estado, revisión, conversaciones largas (6+ mensajes del usuario) y con errores. Al abrir una se ve el chat completo con lo que hizo el bot en cada respuesta (herramientas con su entrada y resultado, costo, tiempo, errores y avisos), los datos que guardó del contacto y el resumen de cierre o escalado.
- **Revisión manual**: en cada conversación se puede marcar "respondió bien" o "respondió mal" con una nota. El resumen muestra cuántas van bien, mal y sin revisar: es la forma de medir la calidad de las respuestas.
- **Errores**: errores al procesar un mensaje (el usuario no recibió respuesta), procesos que no terminaron (p. ej. la función llegó a su tiempo límite) y avisos (p. ej. falló poner la etiqueta `requiere_humano` en GHL al escalar), con enlace a la conversación.

Las conversaciones de `/api/test-chat` se marcan como prueba y no se cuentan, salvo con el filtro "Incluir pruebas". El costo es una estimación con la tabla de precios de [lib/precios.ts](lib/precios.ts) (actualízala si cambias de modelo o cambian los precios); la factura real está en la consola de Anthropic. Las fechas se muestran en hora de Colombia (`PANEL_ZONA_HORARIA` para cambiarla).

La sesión del panel es una cookie firmada que dura 7 días; cambiar la contraseña cierra todas las sesiones.

## Datos del programa (esquema `vocabulario`)

El bot **solo lee** tres tablas del esquema `vocabulario`, que administra la página de búsqueda (https://busquedavocabulario.speakeasyacademia.com/):

| Tabla | Para qué la usa el bot |
|---|---|
| `vocab_correos_autorizados` | Saber si un correo compró (es la fuente de verdad del acceso). |
| `vocab_profesiones_estudiante` | Saber qué profesión eligió ese correo. |
| `vocab_vocabularios` | El catálogo: se inyecta en el prompt (parte cacheada) y sirve para saber si el PDF ya existe. |

`verificar_acceso_vocabulario` devuelve, para un correo:

- `autorizado: false` → no devuelve nada más. El bot pregunta si compró con otro correo y, si tampoco aparece, escala (`correo_no_autorizado`).
- `autorizado: true` con `profesiones_elegidas: []` → todavía no elige profesión: el bot le explica cómo hacerlo en la página de búsqueda.
- Profesión `lista` → el bot le explica que la encuentra en https://www.speakeasyacademia.com/, curso VOCABULARIO DE PROFESIONES.
- Profesión `en_preparacion` (la marcó como nueva, o existe pero sin PDF) → el bot le dice que pronto estará lista y que se le avisará por WhatsApp.

Los nombres de profesión y los correos se comparan normalizados (sin importar mayúsculas, tildes, espacios o tabuladores). El bot nunca devuelve nombres de personas ni enlaces a los PDF. Para que nadie lo use para probar correos ajenos, se pueden verificar como máximo 3 correos por sesión (`sesiones.verificaciones_correo`). Los problemas para iniciar sesión en la plataforma (contraseña, curso que no aparece) siempre se escalan (`acceso_plataforma`). Las tablas `rutina_*` son de otro programa y el bot no las usa.

## Requisitos

- Node.js 20 o superior
- Una base de datos Postgres (Neon, Supabase, Vercel Postgres/Neon, etc.). El usuario de `DATABASE_URL` necesita todos los permisos en el esquema del bot y `SELECT` en `vocabulario.vocab_correos_autorizados`, `vocabulario.vocab_profesiones_estudiante` y `vocabulario.vocab_vocabularios`.
- Una API key de Anthropic
- Un Private Integration Token de la subcuenta de GHL con, al menos, estos permisos: ver y editar contactos (`contacts.readonly`, `contacts.write`) y enviar mensajes de conversaciones (`conversations/message.write`)

## Instalación local

```bash
npm install
cp .env.example .env.local      # completa los valores
npm run db:migrate              # crea las tablas (se puede repetir sin problema)
npm run db:seed                 # disparadores y conocimiento iniciales (se puede repetir)
npm run dev
```

Variables de entorno (en `.env.example` hay una versión comentada):

| Variable | Descripción |
|---|---|
| `DATABASE_URL` | Conexión a Postgres. En Vercel usa la URL del *pooler* de tu proveedor. Acepta `?schema=nombre` (formato de Prisma): las tablas se crean y se leen en ese esquema. |
| `ANTHROPIC_API_KEY` | API key de Anthropic. |
| `ANTHROPIC_MODEL` | Modelo de Claude. Por defecto `claude-opus-5-5`. |
| `ANTHROPIC_EFFORT` | Opcional. Esfuerzo de razonamiento: `low` (por defecto, ideal para chat), `medium`, `high`, `xhigh`, `max`, o `none` para no enviarlo (modelos que no lo soportan). |
| `GHL_API_TOKEN` | Private Integration Token de la subcuenta. |
| `GHL_LOCATION_ID` | Id de la subcuenta (location). |
| `GHL_WEBHOOK_SECRET` | Secreto compartido con el flujo de GHL (mínimo 16 caracteres). |
| `GHL_MOTIVO_ESCALADO_FIELD_ID` | Id del campo personalizado `motivo_escalado`. Si está vacío, ese paso del escalado se omite. |
| `SESSION_TTL_HOURS` | Duración de una sesión (por defecto 24). |
| `DEBOUNCE_SECONDS` | Espera para agrupar mensajes (por defecto 8). |
| `HISTORY_LIMIT` | Mensajes de historial que ve Claude (por defecto 20). |
| `ADMIN_TOKEN` | Token para `/api/health` y `/api/test-chat` (mínimo 16 caracteres). |
| `PANEL_PASSWORD` | Contraseña del panel `/admin` (mínimo 10 caracteres). Si está vacía, se usa `ADMIN_TOKEN`. |
| `PANEL_ZONA_HORARIA` | Opcional. Zona horaria de las fechas del panel (por defecto `America/Bogota`). |
| `DATABASE_POOL_MAX` | Opcional. Conexiones máximas por instancia (por defecto 5). |

Las variables se validan con zod al arrancar el servidor (`instrumentation.ts`). Si falta alguna, el log lo indica con un mensaje claro y `/api/health` lo reporta.

## Probar localmente

### Estado del sistema

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/api/health
```

Devuelve el estado de la base de datos, las migraciones aplicadas, si se puede leer el esquema `vocabulario` (con conteos) y los problemas de configuración.

### Simular una conversación con `/api/test-chat`

Ejecuta **el mismo flujo** que el webhook, pero **sin llamar a GHL**. Devuelve la respuesta, las herramientas usadas, lo que se habría hecho en GHL y el motivo si el mensaje se ignoró. Sí usa la base de datos real y llama a Claude de verdad, así que usa ids de contacto de prueba (por ejemplo `test-1`).

```bash
# 1) Activar con un disparador (los del seed)
curl -X POST http://localhost:3000/api/test-chat \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"contact_id":"test-1","message":"Hola!, tengo una duda sobre mi vocabulario de profesiones","nombre":"Ana"}'

# 2) Continuar la conversación (hay sesión activa): el bot debería pedir el correo y verificarlo
curl -X POST http://localhost:3000/api/test-chat \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"contact_id":"test-1","message":"Ya elegí mi profesión pero no sé dónde me llega el PDF"}'

# 3) Probar el escalado
curl -X POST http://localhost:3000/api/test-chat \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"contact_id":"test-1","message":"Quiero hablar con una persona"}'

# 4) Probar el bloqueo por etiqueta
curl -X POST http://localhost:3000/api/test-chat \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"contact_id":"test-2","message":"soporte vocabulario","simulate_tags":["requiere_humano"]}'
```

Campos opcionales: `simulate_tags` (arreglo o texto separado por comas), `nombre`, `telefono`, `message_id` (envía el mismo dos veces para probar la idempotencia) y `debounce` (`true` para esperar `DEBOUNCE_SECONDS`, como en producción).

Respuesta de ejemplo:

```json
{
  "ok": true,
  "resultado": "respondido",
  "motivo_ignorado": null,
  "respuesta": "¡Hola, Ana! 😄 Cuéntame, ¿qué pasó con tu vocabulario?",
  "mensajes_enviados": ["..."],
  "herramientas": [],
  "acciones_ghl_simuladas": [{ "accion": "sendWhatsApp", "datos": { "contactId": "test-1", "message": "..." } }],
  "sesion_id": 1
}
```

> **Windows:** si los acentos o emojis llegan mal desde la terminal, guarda el JSON en un archivo UTF-8 y envíalo con `curl --data-binary @mensaje.json`.

### Revisar qué pasó con cada webhook

Lo más cómodo es el panel (`http://localhost:3000/admin`). Con SQL:

```sql
SELECT id, created_at, resultado, detalle, sesion_id FROM webhook_logs ORDER BY id DESC LIMIT 20;
SELECT id, created_at, resultado, herramientas, costo_usd, duracion_ms, error, avisos FROM turnos_bot ORDER BY id DESC LIMIT 20;
```

## Cargar disparadores y conocimiento

[db/seed.sql](db/seed.sql) trae los disparadores y el conocimiento reales (proceso de acceso, dónde está el PDF, profesiones en preparación y problemas con la plataforma). Después de la carga inicial, edítalos directamente en la base:

```sql
-- Disparadores
INSERT INTO disparadores (tipo, texto) VALUES ('palabra_clave', 'nueva palabra');
UPDATE disparadores SET activo = FALSE WHERE texto = 'vocabulario';

-- Conocimiento (se inyecta en el prompt en orden de "orden")
UPDATE conocimiento SET contenido = '...' WHERE titulo = 'Dónde encontrar el PDF del vocabulario';
INSERT INTO conocimiento (categoria, titulo, contenido, orden) VALUES ('acceso', 'Nuevo tema', '...', 60);
```

Los cambios aplican desde el siguiente mensaje, sin volver a desplegar. Las reglas de comportamiento (cuándo verificar, cuándo escalar) están en [lib/prompts/system.ts](lib/prompts/system.ts).

## Desplegar en Vercel

1. Sube el repositorio a GitHub e impórtalo en Vercel (framework: Next.js).
2. Crea la base de datos (por ejemplo, Neon desde el Marketplace de Vercel, o Supabase) y copia la URL del *pooler*.
3. En **Settings → Environment Variables**, agrega todas las variables de la tabla de arriba.
4. Aplica las migraciones en la base de producción desde tu máquina:
   ```bash
   DATABASE_URL="postgres://...produccion..." npm run db:migrate
   DATABASE_URL="postgres://...produccion..." npm run db:seed   # opcional
   ```
5. Despliega y verifica con `GET https://<dominio-vercel>/api/health` (con el `ADMIN_TOKEN`) y entrando a `https://<dominio-vercel>/admin`.

Las rutas del webhook y de pruebas tienen `maxDuration = 60` segundos, que cubre el debounce, las llamadas a Claude y las de GHL, y funciona en todos los planes. Con Fluid Compute puedes subirlo en [app/api/webhook/ghl/route.ts](app/api/webhook/ghl/route.ts).

## Configuración en GHL

Antes de empezar, crea el campo personalizado de contacto **`motivo_escalado`** (texto) y copia su id en `GHL_MOTIVO_ESCALADO_FIELD_ID`.

### 1. Flujo "BOT VOCABULARIO"

- **Activador**: "El cliente ha respondido" (Customer Replied), canal **WhatsApp**. Activa **permitir reingreso**.
- **Condición**: si las etiquetas del contacto incluyen `humano` o `requiere_humano` → **fin del flujo**.
- **Si no**, acción **Webhook**:
  - Método: `POST`
  - URL: `https://<dominio-vercel>/api/webhook/ghl`
  - Header: `x-webhook-secret: <el valor de GHL_WEBHOOK_SECRET>`
  - Datos personalizados:

    | Clave | Valor |
    |---|---|
    | `contact_id` | `{{contact.id}}` |
    | `message_body` | `{{message.body}}` |
    | `nombre` | `{{contact.name}}` |
    | `telefono` | `{{contact.phone}}` |
    | `tags` | `{{contact.tags}}` |

El webhook también entiende los datos dentro de `customData` y los nombres estándar de GHL (`contactId`, `message.body`, `full_name`, `phone`, `tags`...).

### 2. Flujo "Escalar a humano – Vocabulario"

- **Activador**: "Etiqueta de contacto agregada" = `requiere_humano`.
- **Acciones**: asignar a un usuario, agregar seguidores, enviar una notificación interna al equipo y, opcionalmente, agregar la etiqueta `humano`.

### 3. Reactivar el bot con un contacto

Quita las etiquetas `humano` y `requiere_humano` del contacto. El bot vuelve a responder cuando el contacto envíe un disparador.

## Detalles técnicos

- **Claude**: [lib/claude.ts](lib/claude.ts) usa el SDK oficial `@anthropic-ai/sdk` con:
  - **prompt caching**: el prompt, el conocimiento y el catálogo de vocabularios van primero y se cachean; los datos del contacto van después;
  - **`fallbacks: "default"`**: si el modelo rechaza un mensaje por políticas, la API reintenta con el modelo de respaldo que define Anthropic;
  - **`effort` configurable**.

  Para comprobar que el caché funciona, revisa el campo `cache_lectura` en los logs `[claude]`: desde el segundo mensaje debería ser mayor que 0. El caché se renueva solo cuando cambia el conocimiento o el catálogo.
- **GHL**: [lib/ghl.ts](lib/ghl.ts) usa `Version: 2021-07-28` para contactos y `2021-04-15` para `/conversations/messages`, como indica la especificación oficial de GHL. Reintenta ante 429 y 5xx. El campo personalizado se envía como `customFields: [{ id, field_value }]`.
- **Base de datos**: Postgres con el paquete `postgres`, sin ORM. Las migraciones están en [db/migrations](db/migrations) y se registran en la tabla `schema_migrations`.

## Estructura

```
app/api/webhook/ghl/route.ts   Webhook de GHL (200 inmediato + waitUntil)
app/api/test-chat/route.ts     Simulador sin GHL (admin)
app/api/health/route.ts        Estado de BD y configuración (admin)
app/admin/login/               Login del panel
app/admin/acciones.ts          Server Actions: login, cerrar sesión, revisión de conversaciones
app/admin/(panel)/             Panel: resumen, conversaciones (lista y detalle) y errores
proxy.ts                       Redirige al login si no hay sesión del panel
lib/admin/                     Sesión (cookie firmada), consultas y formatos del panel
lib/precios.ts                 Precios de Claude para estimar el costo
instrumentation.ts             Valida las variables al arrancar
lib/env.ts                     Validación de variables (zod)
lib/db.ts                      Cliente de Postgres
lib/auth.ts                    Comparación segura de secretos / ADMIN_TOKEN
lib/ghl.ts                     Cliente de la API de GHL (+ versión simulada)
lib/claude.ts                  Cliente de Anthropic
lib/prompts/system.ts          System prompt y mensaje de transición
lib/bot/handler.ts             Flujo completo y ciclo de herramientas
lib/bot/activation.ts          Normalización, disparadores y sesiones
lib/bot/tools.ts               Herramientas del agente
lib/bot/context.ts             Contexto para Claude
lib/bot/payload.ts             Extracción tolerante del payload
lib/bot/repo.ts                Consultas SQL del esquema del bot
lib/bot/vocabulario.ts         Lectura del esquema vocabulario (acceso, profesiones, catálogo)
db/migrations/001_init.sql     Esquema inicial
db/migrations/002_*.sql        Contador de correos verificados por sesión
db/migrations/003_*.sql        Monitoreo: turnos_bot, enlace webhook ↔ conversación, revisión manual
db/seed.sql                    Disparadores y conocimiento iniciales
scripts/migrate.ts             npm run db:migrate / db:seed
```
