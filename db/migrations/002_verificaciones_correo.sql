-- Cuántos correos se han verificado en la sesión (herramienta verificar_acceso_vocabulario).
-- Sirve de límite para que nadie use el bot para probar correos ajenos.
ALTER TABLE sesiones ADD COLUMN IF NOT EXISTS verificaciones_correo INTEGER NOT NULL DEFAULT 0;
