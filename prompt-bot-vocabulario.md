# Prompt para Claude Code — Bot de soporte "Vocabulario" (Speak Easy)

Copia todo lo que está debajo de la línea y pégalo en Claude Code dentro de tu proyecto Next.js limpio.

---

Construye en este proyecto Next.js (App Router, TypeScript) un **bot de soporte por WhatsApp** para Speak Easy. El bot recibe mensajes desde GoHighLevel (GHL) por webhook, responde con Claude (API de Anthropic) y envía la respuesta de vuelta por la API de GHL. Se desplegará en **Vercel**.

## Contexto del negocio

- Atiende a personas que **compraron el vocabulario en inglés por profesión** de Speak Easy y tienen casos puntuales (acceso, descarga, dudas sobre el material, etc.).
- El bot **no responde siempre**: solo se activa cuando el contacto envía uno de dos mensajes específicos o una palabra clave (te los daré después; deben quedar configurables en la base de datos).
- Si el caso necesita a una persona, o el usuario se molesta, insiste o pide hablar con alguien, el bot **escala a un humano** y deja de responder.
- Si el contacto tiene la etiqueta `humano` o `requiere_humano` en GHL, el bot **nunca responde**.
- La información de entrenamiento (conocimiento del producto) se cargará después en la base de datos. Deja la estructura lista y datos de ejemplo.

## Stack y variables de entorno

- Next.js App Router + TypeScript, compatible con Vercel (runtime Node).
- Postgres mediante `DATABASE_URL` (usa el paquete `postgres` o `pg`, sin ORM pesado). Migraciones en archivos `.sql` dentro de `/db/migrations` y un script `npm run db:migrate`.
- SDK oficial `@anthropic-ai/sdk`, con tool use y prompt caching para el system prompt.
- `@vercel/functions` para `waitUntil`.
- Crea un `.env.example` con:
  ```
  DATABASE_URL=
  ANTHROPIC_API_KEY=
  ANTHROPIC_MODEL=            # id del modelo de Claude a usar
  GHL_API_TOKEN=              # Private Integration Token de la subcuenta
  GHL_LOCATION_ID=
  GHL_WEBHOOK_SECRET=         # debe coincidir con el header x-webhook-secret del flujo
  GHL_MOTIVO_ESCALADO_FIELD_ID=   # id del campo personalizado motivo_escalado
  SESSION_TTL_HOURS=24
  DEBOUNCE_SECONDS=8
  HISTORY_LIMIT=20
  ADMIN_TOKEN=                # para endpoints de prueba/admin
  ```
- Valida las variables al arrancar (zod) con errores claros.

## Base de datos (crear migración inicial)

- `disparadores`: id, tipo (`mensaje_exacto` | `palabra_clave`), texto, activo, created_at. Los mensajes exactos se comparan normalizados (minúsculas, sin tildes, sin signos ni espacios extra); la palabra clave se busca contenida en el mensaje.
- `conocimiento`: id, categoria, titulo, contenido (text), activo, orden, updated_at. Es la base de conocimiento que se inyecta en el prompt.
- `contactos`: contact_id (PK, id de GHL), nombre, telefono, memoria (jsonb: datos que el bot aprende del usuario), created_at, updated_at.
- `sesiones`: id, contact_id, estado (`activa` | `cerrada` | `escalada` | `expirada`), disparador_id, iniciada_en, ultima_actividad, expira_en.
- `mensajes`: id, contact_id, sesion_id, rol (`user` | `assistant`), contenido, ghl_message_id (unique, nullable), created_at.
- `escalados`: id, contact_id, sesion_id, motivo, resumen, created_at.
- `webhook_logs`: id, payload (jsonb), resultado (text: `ignorado_etiqueta`, `ignorado_sin_sesion`, `respondido`, `escalado`, `error`, `duplicado`, `debounce`), detalle, created_at.

Incluye un seed (`npm run db:seed`) con un disparador de ejemplo de cada tipo y 3 entradas de conocimiento de ejemplo marcadas como placeholder.

## Endpoint principal: `POST /api/webhook/ghl`

1. Verifica el header `x-webhook-secret` contra `GHL_WEBHOOK_SECRET` (comparación segura). Si no coincide, responde 401.
2. Guarda el payload crudo en `webhook_logs`.
3. Extrae del payload `contact_id`, `message_body`, `message_id` (si viene), nombre, teléfono y etiquetas. El flujo de GHL enviará datos personalizados con estas claves, pero haz la extracción tolerante (también busca en `contact_id`/`contactId`, `message.body`, `tags`, etc.).
4. **Responde 200 de inmediato** y procesa el resto con `waitUntil`, para que GHL no reintente. Configura `maxDuration` adecuado en la ruta.
5. Idempotencia: si `ghl_message_id` ya existe, termina (`duplicado`). Si no viene id, usa un hash de contact_id + texto + minuto.
6. Si las etiquetas incluyen `humano` o `requiere_humano` → termina (`ignorado_etiqueta`). Si el payload no trae etiquetas, consúltalas con la API de GHL.
7. Upsert del contacto y guarda el mensaje entrante.
8. **Activación:**
   - Si el mensaje coincide con un disparador activo → crea una sesión nueva (o reactiva la actual) con `expira_en = ahora + SESSION_TTL_HOURS`.
   - Si no coincide y el contacto tiene una sesión `activa` no expirada → continúa.
   - En cualquier otro caso → termina (`ignorado_sin_sesion`). El bot no responde.
9. **Debounce:** espera `DEBOUNCE_SECONDS`; si llegó otro mensaje del mismo contacto después de este, termina (`debounce`), porque el mensaje más reciente se encargará de responder. Así se agrupan varios mensajes seguidos en una sola respuesta.
10. Arma el contexto: system prompt + conocimiento activo de la BD + memoria del contacto + últimos `HISTORY_LIMIT` mensajes de la sesión.
11. Llama a Claude con las herramientas definidas abajo y resuelve el ciclo de tool use hasta obtener texto final.
12. Envía la respuesta por la API de GHL, guarda el mensaje del asistente y actualiza `ultima_actividad`.
13. Maneja errores: registra en `webhook_logs` y nunca envíes al usuario mensajes de error técnicos.

## Herramientas del agente (tool use)

- `escalar_a_humano({ motivo, resumen })`:
  1. Envía al usuario un mensaje tranquilizador confirmando que ya se está revisando su caso, sin mencionar que pasa de un bot a una persona (el equipo continúa por este mismo chat).
  2. Agrega la etiqueta `requiere_humano` al contacto en GHL.
  3. Actualiza el campo personalizado `motivo_escalado` con el motivo.
  4. Crea una nota en el contacto con el resumen del caso.
  5. Marca la sesión como `escalada` y registra en `escalados`.

  Después de escalar, el bot no debe volver a responder (la etiqueta lo bloquea).
- `guardar_dato_contacto({ clave, valor })`: guarda en `contactos.memoria` datos útiles (profesión del vocabulario comprado, correo de compra, problema reportado, etc.).
- `cerrar_caso({ resumen })`: cuando el usuario confirma que quedó resuelto, marca la sesión como `cerrada`. El bot vuelve a estar inactivo hasta un nuevo disparador.

## System prompt (`/lib/prompts/system.ts`)

Escríbelo en español, con estas reglas (deja marcadores `{{...}}` donde yo completaré):

- Eres el asistente de soporte de Speak Easy para personas que compraron el vocabulario por profesión. Tono cálido, cercano, breve, formato WhatsApp (mensajes cortos, emojis con moderación como 🙌🏻 💜 😄, nada de markdown con `#` ni tablas).
- Responde **solo** con base en la información de conocimiento proporcionada. Si no está ahí, no inventes: escala.
- Escala con `escalar_a_humano` cuando: el usuario pida una persona; muestre molestia o frustración, o repita el mismo problema 2 veces sin solución; haya temas de pagos, reembolsos, cobros o datos de tarjeta; el caso requiera revisar su cuenta manualmente; o la pregunta esté fuera de lo que sabes.
- Nunca pidas contraseñas ni datos de tarjeta.
- Usa `guardar_dato_contacto` cuando el usuario dé información relevante del caso.
- Usa `cerrar_caso` cuando el usuario confirme que está resuelto.
- Marcadores: `{{NOMBRE_PRODUCTO}}`, `{{REGLAS_ADICIONALES}}`.

## Cliente de GHL (`/lib/ghl.ts`)

- Base URL `https://services.leadconnectorhq.com`, headers `Authorization: Bearer GHL_API_TOKEN` y `Version: 2021-07-28`.
- Funciones: `sendWhatsApp(contactId, message)` (POST `/conversations/messages` con `type: "WhatsApp"`), `getContact(contactId)`, `addTags(contactId, tags)`, `updateCustomField(contactId, fieldId, value)` y `addNote(contactId, body)`.
- Reintento simple ante 429/5xx y logs claros.

## Endpoints de apoyo (protegidos con `Authorization: Bearer ADMIN_TOKEN`)

- `GET /api/health`: estado de la BD y de las variables de entorno.
- `POST /api/test-chat` con `{ contact_id, message, simulate_tags? }`: ejecuta el mismo flujo pero **sin enviar a GHL** y devuelve la respuesta, las herramientas usadas y el motivo si se ignoró. Sirve para probar los disparadores y el escalado localmente.

## Estructura sugerida

```
/app/api/webhook/ghl/route.ts
/app/api/test-chat/route.ts
/app/api/health/route.ts
/lib/env.ts
/lib/db.ts
/lib/ghl.ts
/lib/claude.ts
/lib/bot/activation.ts
/lib/bot/handler.ts
/lib/bot/tools.ts
/lib/bot/context.ts
/lib/prompts/system.ts
/db/migrations/001_init.sql
/db/seed.sql
/scripts/migrate.ts
```

## README

Incluye:

- Cómo instalar, migrar, sembrar y probar con `/api/test-chat`.
- Cómo desplegar en Vercel y configurar las variables.
- **Configuración en GHL:**
  1. Flujo **"BOT VOCABULARIO"**: activador "El cliente ha respondido" con canal WhatsApp y reingreso permitido; condición "si las etiquetas incluyen `humano` o `requiere_humano` → fin"; si no, acción Webhook POST a `https://<dominio-vercel>/api/webhook/ghl` con el header `x-webhook-secret` y datos personalizados `contact_id={{contact.id}}`, `message_body={{message.body}}`, `nombre={{contact.name}}`, `telefono={{contact.phone}}`, `tags={{contact.tags}}`.
  2. Flujo **"Escalar a humano – Vocabulario"**: activador "Etiqueta de contacto agregada = `requiere_humano`" → asignar a un usuario, agregar seguidores, notificación interna al equipo y, opcionalmente, agregar la etiqueta `humano`.
  3. Para reactivar el bot con un contacto: quitar las etiquetas `humano` y `requiere_humano`.

Al terminar, muéstrame un resumen de los archivos creados y los pasos para probarlo localmente.
