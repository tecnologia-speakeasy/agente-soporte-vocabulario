-- Migración inicial del bot de soporte "Vocabulario" (Speak Easy)

-- Mensajes o palabras clave que activan el bot.
CREATE TABLE IF NOT EXISTS disparadores (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tipo        TEXT NOT NULL CHECK (tipo IN ('mensaje_exacto', 'palabra_clave')),
  texto       TEXT NOT NULL,
  activo      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tipo, texto)
);

-- Base de conocimiento que se inyecta en el prompt.
CREATE TABLE IF NOT EXISTS conocimiento (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  categoria   TEXT NOT NULL,
  titulo      TEXT NOT NULL,
  contenido   TEXT NOT NULL,
  activo      BOOLEAN NOT NULL DEFAULT TRUE,
  orden       INTEGER NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS conocimiento_activo_orden_idx ON conocimiento (activo, orden, id);

-- Contactos de GHL y lo que el bot aprende de ellos.
CREATE TABLE IF NOT EXISTS contactos (
  contact_id  TEXT PRIMARY KEY,
  nombre      TEXT,
  telefono    TEXT,
  memoria     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sesiones de conversación (el bot solo responde con una sesión activa).
CREATE TABLE IF NOT EXISTS sesiones (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  contact_id        TEXT NOT NULL REFERENCES contactos (contact_id) ON DELETE CASCADE,
  estado            TEXT NOT NULL CHECK (estado IN ('activa', 'cerrada', 'escalada', 'expirada')),
  disparador_id     BIGINT REFERENCES disparadores (id) ON DELETE SET NULL,
  iniciada_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
  ultima_actividad  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expira_en         TIMESTAMPTZ NOT NULL,
  -- Resumen que deja la herramienta cerrar_caso (opcional).
  resumen           TEXT
);
CREATE INDEX IF NOT EXISTS sesiones_contacto_estado_idx ON sesiones (contact_id, estado);
-- Como máximo una sesión activa por contacto (evita carreras entre webhooks simultáneos).
CREATE UNIQUE INDEX IF NOT EXISTS sesiones_una_activa_por_contacto
  ON sesiones (contact_id) WHERE estado = 'activa';

-- Historial de mensajes.
CREATE TABLE IF NOT EXISTS mensajes (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  contact_id      TEXT NOT NULL REFERENCES contactos (contact_id) ON DELETE CASCADE,
  sesion_id       BIGINT REFERENCES sesiones (id) ON DELETE SET NULL,
  rol             TEXT NOT NULL CHECK (rol IN ('user', 'assistant')),
  contenido       TEXT NOT NULL,
  ghl_message_id  TEXT UNIQUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mensajes_sesion_idx ON mensajes (sesion_id, id);
CREATE INDEX IF NOT EXISTS mensajes_contacto_idx ON mensajes (contact_id, id);

-- Casos escalados a una persona.
CREATE TABLE IF NOT EXISTS escalados (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  contact_id  TEXT NOT NULL REFERENCES contactos (contact_id) ON DELETE CASCADE,
  sesion_id   BIGINT REFERENCES sesiones (id) ON DELETE SET NULL,
  motivo      TEXT NOT NULL,
  resumen     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS escalados_contacto_idx ON escalados (contact_id, created_at);

-- Registro de cada webhook recibido y de cómo terminó.
CREATE TABLE IF NOT EXISTS webhook_logs (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payload     JSONB NOT NULL,
  -- NULL mientras se procesa.
  resultado   TEXT CHECK (resultado IN (
                'ignorado_etiqueta', 'ignorado_sin_sesion', 'respondido',
                'escalado', 'error', 'duplicado', 'debounce')),
  detalle     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS webhook_logs_created_idx ON webhook_logs (created_at DESC);
