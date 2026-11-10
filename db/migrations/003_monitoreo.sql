-- Monitoreo del bot: registro de cada respuesta (turno) y revisión manual de conversaciones.
-- Lo usa el panel /admin.

-- Cada vez que el bot procesa un mensaje con Claude.
CREATE TABLE IF NOT EXISTS turnos_bot (
  id                      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  contact_id              TEXT NOT NULL REFERENCES contactos (contact_id) ON DELETE CASCADE,
  sesion_id               BIGINT REFERENCES sesiones (id) ON DELETE SET NULL,
  webhook_log_id          BIGINT REFERENCES webhook_logs (id) ON DELETE SET NULL,
  es_prueba               BOOLEAN NOT NULL DEFAULT FALSE,
  -- respondido | escalado | error | ignorado_sin_sesion (la sesión cambió mientras respondía)
  resultado               TEXT NOT NULL,
  detalle                 TEXT,
  error                   TEXT,
  -- Modelo que respondió la última llamada (puede ser el de respaldo si hubo un rechazo).
  modelo                  TEXT,
  stop_reason             TEXT,
  llamadas                INTEGER NOT NULL DEFAULT 0,
  tokens_entrada          INTEGER NOT NULL DEFAULT 0,
  tokens_cache_lectura    INTEGER NOT NULL DEFAULT 0,
  tokens_cache_escritura  INTEGER NOT NULL DEFAULT 0,
  tokens_salida           INTEGER NOT NULL DEFAULT 0,
  -- Costo estimado con la tabla de precios de lib/precios.ts (NULL si el modelo no está en la tabla).
  costo_usd               NUMERIC(12, 6),
  -- Tiempo desde que se arma el contexto hasta que se envía la respuesta (sin contar el debounce).
  duracion_ms             INTEGER,
  -- [{ nombre, entrada, resultado, error }]
  herramientas            JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Problemas que no detuvieron el turno (p. ej. falló poner la etiqueta en GHL al escalar).
  avisos                  JSONB NOT NULL DEFAULT '[]'::jsonb,
  iniciado_en             TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS turnos_bot_created_idx ON turnos_bot (created_at DESC);
CREATE INDEX IF NOT EXISTS turnos_bot_sesion_idx ON turnos_bot (sesion_id, id);

-- Enlace de cada webhook con el contacto y la conversación.
ALTER TABLE webhook_logs ADD COLUMN IF NOT EXISTS contact_id TEXT;
ALTER TABLE webhook_logs ADD COLUMN IF NOT EXISTS sesion_id BIGINT;
ALTER TABLE webhook_logs ADD COLUMN IF NOT EXISTS es_prueba BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE webhook_logs ADD COLUMN IF NOT EXISTS terminado_en TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS webhook_logs_resultado_idx ON webhook_logs (resultado, created_at DESC);
CREATE INDEX IF NOT EXISTS webhook_logs_sesion_idx ON webhook_logs (sesion_id);

-- Conversaciones de /api/test-chat (se excluyen de las métricas por defecto).
ALTER TABLE sesiones ADD COLUMN IF NOT EXISTS es_prueba BOOLEAN NOT NULL DEFAULT FALSE;
-- Revisión manual desde el panel.
ALTER TABLE sesiones ADD COLUMN IF NOT EXISTS revision TEXT CHECK (revision IN ('bien', 'mal'));
ALTER TABLE sesiones ADD COLUMN IF NOT EXISTS revision_nota TEXT;
ALTER TABLE sesiones ADD COLUMN IF NOT EXISTS revisada_en TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS sesiones_iniciada_idx ON sesiones (iniciada_en DESC);

-- Las versiones anteriores guardaban el payload como un string JSON (doble codificación) en vez del objeto.
-- Se convierte al objeto; si alguno no es JSON válido, se deja como está.
DO $$
DECLARE fila RECORD;
BEGIN
  FOR fila IN SELECT id, payload #>> '{}' AS texto FROM webhook_logs WHERE jsonb_typeof(payload) = 'string' LOOP
    BEGIN
      UPDATE webhook_logs SET payload = fila.texto::jsonb WHERE id = fila.id;
    EXCEPTION WHEN others THEN
      NULL;
    END;
  END LOOP;
END $$;

-- Marca lo que ya existía de /api/test-chat (sus mensajes usan ids "test:..." por defecto).
UPDATE webhook_logs SET es_prueba = TRUE WHERE payload->>'_origen' = 'test-chat' AND NOT es_prueba;
UPDATE sesiones SET es_prueba = TRUE
WHERE NOT es_prueba
  AND id IN (SELECT sesion_id FROM mensajes WHERE ghl_message_id LIKE 'test:%' AND sesion_id IS NOT NULL);
