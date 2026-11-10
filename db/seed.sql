-- Datos iniciales (disparadores y conocimiento). Es seguro ejecutarlo varias veces (no duplica filas).

-- Disparadores.
-- Las palabras clave coinciden como palabra completa y sin importar tildes ni mayúsculas:
-- "vocabulario" ya cubre "soporte vocabulario", "no sé cómo acceder a mi vocabulario", etc.,
-- pero no cubre el plural ni errores de ortografía; por eso van aparte.
INSERT INTO disparadores (tipo, texto, activo) VALUES
  ('mensaje_exacto', 'Hola!, tengo una duda sobre mi vocabulario de profesiones', TRUE),
  ('mensaje_exacto', 'Hola!, tengo un problema con mi correo', TRUE),
  ('palabra_clave',  'vocabulario', TRUE),
  ('palabra_clave',  'vocabularios', TRUE),
  ('palabra_clave',  'bocabulario', TRUE),
  ('palabra_clave',  'bocabularios', TRUE),
  ('palabra_clave',  'vocabulary', TRUE)
ON CONFLICT (tipo, texto) DO NOTHING;

-- Conocimiento.
-- El seed es para la carga inicial: después, edita las filas directamente en la tabla
-- (si cambias un título y vuelves a correr el seed, se insertaría de nuevo la versión de aquí).

-- Quita las entradas de ejemplo de versiones anteriores del seed.
DELETE FROM conocimiento WHERE titulo LIKE '[PLACEHOLDER]%';

INSERT INTO conocimiento (categoria, titulo, contenido, activo, orden)
SELECT v.categoria, v.titulo, v.contenido, TRUE, v.orden
FROM (VALUES
  ('acceso',
   'Cómo obtener el vocabulario después de la compra',
   'Proceso después de comprar:
1. Entrar a https://busquedavocabulario.speakeasyacademia.com/ y escribir el correo con el que compró. La página verifica que el correo esté autorizado.
2. Buscar y elegir su profesión. Si su profesión todavía no existe, puede solicitarla ahí mismo y el equipo la prepara.
3. Después de elegir, se le envía un mensaje de confirmación por WhatsApp y se le da acceso automáticamente al programa en la plataforma de Speak Easy (https://www.speakeasyacademia.com/), donde está su vocabulario.',
   10),
  ('acceso',
   'Dónde encontrar el PDF del vocabulario',
   'El PDF del vocabulario se consulta en la plataforma de Speak Easy:
1. Entrar a https://www.speakeasyacademia.com/
2. Iniciar sesión con sus credenciales (correo y contraseña).
3. Entrar al curso VOCABULARIO DE PROFESIONES.
4. Ahí encuentra el vocabulario de la profesión que eligió.',
   20),
  ('acceso',
   'La página de búsqueda no acepta mi correo',
   'La página https://busquedavocabulario.speakeasyacademia.com/ solo deja continuar con un correo autorizado (el de la compra). Si al verificarlo el correo sí está autorizado, pídele que lo escriba de nuevo en la página exactamente igual, sin espacios y revisando que no tenga errores. Si no está autorizado, pregúntale si pudo comprar con otro correo; si tampoco aparece, escala el caso para que el equipo revise la compra.',
   30),
  ('contenido',
   'Profesión nueva o PDF en preparación',
   'Si la profesión que eligió no existía en el catálogo, o existe pero su PDF todavía no está listo, el equipo de Speak Easy lo está preparando. Cuando esté listo se le avisará por WhatsApp y lo encontrará en el curso VOCABULARIO DE PROFESIONES de la plataforma. No hay una fecha exacta: dile que pronto estará listo.',
   40),
  ('plataforma',
   'Problemas para entrar a la plataforma de Speak Easy',
   'Los problemas con la plataforma de Speak Easy (https://www.speakeasyacademia.com/) los resuelve una persona del equipo: no recuerda su contraseña, no puede iniciar sesión, no le aparece el curso VOCABULARIO DE PROFESIONES o no le llegó el acceso. En esos casos escala (motivo: acceso_plataforma).',
   50)
) AS v (categoria, titulo, contenido, orden)
WHERE NOT EXISTS (SELECT 1 FROM conocimiento c WHERE c.titulo = v.titulo);
