-- Datos de ejemplo. Es seguro ejecutarlo varias veces (no duplica filas).
-- Reemplaza los disparadores y el conocimiento por los reales cuando los tengas.

-- Disparadores de ejemplo (uno de cada tipo).
INSERT INTO disparadores (tipo, texto, activo) VALUES
  ('mensaje_exacto', 'Hola, necesito ayuda con mi vocabulario', TRUE),
  ('palabra_clave',  'soporte vocabulario', TRUE)
ON CONFLICT (tipo, texto) DO NOTHING;

-- Conocimiento de ejemplo (PLACEHOLDER).
-- Mientras no se reemplace, el contenido le indica al bot que escale, para que no
-- invente información si esto llega a producción por error.
INSERT INTO conocimiento (categoria, titulo, contenido, activo, orden)
SELECT v.categoria, v.titulo, v.contenido, TRUE, v.orden
FROM (VALUES
  ('acceso',
   '[PLACEHOLDER] Cómo acceder al vocabulario después de la compra',
   'PLACEHOLDER: aquí va el paso a paso real para acceder al material (a qué correo llega, desde qué plataforma se abre, cuánto tarda en llegar el acceso, qué hacer si no llegó). Mientras este texto no se reemplace, si el usuario pregunta por este tema, escala el caso.',
   10),
  ('descarga',
   '[PLACEHOLDER] Cómo descargar el material',
   'PLACEHOLDER: aquí van las instrucciones reales de descarga (formato del archivo, dispositivos compatibles, qué hacer si el enlace no abre o expiró). Mientras este texto no se reemplace, si el usuario pregunta por este tema, escala el caso.',
   20),
  ('contenido',
   '[PLACEHOLDER] Qué incluye el vocabulario por profesión',
   'PLACEHOLDER: aquí va la descripción real del material (profesiones disponibles, número de palabras, si incluye audios o ejemplos, cómo se recomienda estudiarlo). Mientras este texto no se reemplace, si el usuario pregunta por este tema, escala el caso.',
   30)
) AS v (categoria, titulo, contenido, orden)
WHERE NOT EXISTS (SELECT 1 FROM conocimiento c WHERE c.titulo = v.titulo);
