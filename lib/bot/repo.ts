import { getSql } from "../db";

/** Acceso a datos del bot. Todas las consultas SQL viven aquí. */

export type Resultado =
  | "ignorado_etiqueta"
  | "ignorado_sin_sesion"
  | "respondido"
  | "escalado"
  | "error"
  | "duplicado"
  | "debounce";

export type EstadoSesion = "activa" | "cerrada" | "escalada" | "expirada";

export interface Disparador {
  id: number;
  tipo: "mensaje_exacto" | "palabra_clave";
  texto: string;
}

export interface Sesion {
  id: number;
  contact_id: string;
  estado: EstadoSesion;
  disparador_id: number | null;
  iniciada_en: Date;
  ultima_actividad: Date;
  expira_en: Date;
}

export interface EntradaConocimiento {
  categoria: string;
  titulo: string;
  contenido: string;
}

export interface Contacto {
  contact_id: string;
  nombre: string | null;
  telefono: string | null;
  memoria: Record<string, unknown>;
}

// ---------- webhook_logs ----------

export async function registrarWebhook(payload: unknown): Promise<number> {
  const sql = getSql();
  const [fila] = await sql<{ id: number }[]>`
    INSERT INTO webhook_logs (payload) VALUES (${JSON.stringify(payload ?? null)}::jsonb)
    RETURNING id
  `;
  return fila.id;
}

export async function cerrarWebhookLog(id: number, resultado: Resultado, detalle: string | null): Promise<void> {
  const sql = getSql();
  await sql`
    UPDATE webhook_logs SET resultado = ${resultado}, detalle = ${detalle?.slice(0, 4000) ?? null}
    WHERE id = ${id}
  `;
}

// ---------- mensajes ----------

export async function existeMensaje(ghlMessageId: string): Promise<boolean> {
  const sql = getSql();
  const filas = await sql`SELECT 1 FROM mensajes WHERE ghl_message_id = ${ghlMessageId} LIMIT 1`;
  return filas.length > 0;
}

/** Inserta un mensaje. Devuelve null si el ghl_message_id ya existía (duplicado). */
export async function guardarMensaje(datos: {
  contactId: string;
  sesionId: number | null;
  rol: "user" | "assistant";
  contenido: string;
  ghlMessageId: string | null;
}): Promise<number | null> {
  const sql = getSql();
  const filas = await sql<{ id: number }[]>`
    INSERT INTO mensajes (contact_id, sesion_id, rol, contenido, ghl_message_id)
    VALUES (${datos.contactId}, ${datos.sesionId}, ${datos.rol}, ${datos.contenido}, ${datos.ghlMessageId})
    ON CONFLICT (ghl_message_id) DO NOTHING
    RETURNING id
  `;
  return filas[0]?.id ?? null;
}

export async function asignarSesionAMensaje(mensajeId: number, sesionId: number): Promise<void> {
  const sql = getSql();
  await sql`UPDATE mensajes SET sesion_id = ${sesionId} WHERE id = ${mensajeId}`;
}

/** ¿Llegó otro mensaje del usuario después de este? (para el debounce) */
export async function hayMensajeMasReciente(contactId: string, mensajeId: number): Promise<boolean> {
  const sql = getSql();
  const filas = await sql`
    SELECT 1 FROM mensajes WHERE contact_id = ${contactId} AND rol = 'user' AND id > ${mensajeId} LIMIT 1
  `;
  return filas.length > 0;
}

/** Últimos `limite` mensajes de la sesión, en orden cronológico. */
export async function historialSesion(
  sesionId: number,
  limite: number,
): Promise<{ rol: "user" | "assistant"; contenido: string }[]> {
  const sql = getSql();
  return sql<{ rol: "user" | "assistant"; contenido: string }[]>`
    SELECT rol, contenido FROM (
      SELECT id, rol, contenido FROM mensajes
      WHERE sesion_id = ${sesionId}
      ORDER BY id DESC
      LIMIT ${limite}
    ) t
    ORDER BY id ASC
  `;
}

// ---------- contactos ----------

export async function upsertContacto(datos: {
  contactId: string;
  nombre: string | null;
  telefono: string | null;
}): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO contactos (contact_id, nombre, telefono)
    VALUES (${datos.contactId}, ${datos.nombre}, ${datos.telefono})
    ON CONFLICT (contact_id) DO UPDATE SET
      nombre = COALESCE(EXCLUDED.nombre, contactos.nombre),
      telefono = COALESCE(EXCLUDED.telefono, contactos.telefono),
      updated_at = now()
  `;
}

export async function obtenerContacto(contactId: string): Promise<Contacto | null> {
  const sql = getSql();
  const [fila] = await sql<Contacto[]>`
    SELECT contact_id, nombre, telefono, memoria FROM contactos WHERE contact_id = ${contactId}
  `;
  return fila ?? null;
}

export async function guardarDatoMemoria(contactId: string, clave: string, valor: string): Promise<void> {
  const sql = getSql();
  await sql`
    UPDATE contactos
    SET memoria = memoria || jsonb_build_object(${clave}::text, ${valor}::text), updated_at = now()
    WHERE contact_id = ${contactId}
  `;
}

// ---------- disparadores y conocimiento ----------

export async function disparadoresActivos(): Promise<Disparador[]> {
  const sql = getSql();
  return sql<Disparador[]>`SELECT id, tipo, texto FROM disparadores WHERE activo ORDER BY id`;
}

export async function conocimientoActivo(): Promise<EntradaConocimiento[]> {
  const sql = getSql();
  // Orden determinista: así el prompt no cambia entre llamadas y el caché se aprovecha.
  return sql<EntradaConocimiento[]>`
    SELECT categoria, titulo, contenido FROM conocimiento WHERE activo ORDER BY orden, id
  `;
}

// ---------- sesiones ----------

/** Marca como expiradas las sesiones activas vencidas del contacto. */
export async function expirarSesionesVencidas(contactId: string): Promise<void> {
  const sql = getSql();
  await sql`
    UPDATE sesiones SET estado = 'expirada'
    WHERE contact_id = ${contactId} AND estado = 'activa' AND expira_en <= now()
  `;
}

export async function sesionActiva(contactId: string): Promise<Sesion | null> {
  const sql = getSql();
  const [fila] = await sql<Sesion[]>`
    SELECT * FROM sesiones
    WHERE contact_id = ${contactId} AND estado = 'activa' AND expira_en > now()
    LIMIT 1
  `;
  return fila ?? null;
}

/** Crea una sesión activa nueva o, si ya hay una, la reactiva (renueva su vencimiento). */
export async function abrirOReactivarSesion(
  contactId: string,
  disparadorId: number,
  ttlHoras: number,
): Promise<Sesion> {
  const sql = getSql();
  const [fila] = await sql<Sesion[]>`
    INSERT INTO sesiones (contact_id, estado, disparador_id, expira_en)
    VALUES (${contactId}, 'activa', ${disparadorId}, now() + make_interval(hours => ${ttlHoras}::int))
    ON CONFLICT (contact_id) WHERE estado = 'activa' DO UPDATE SET
      disparador_id = EXCLUDED.disparador_id,
      expira_en = EXCLUDED.expira_en,
      ultima_actividad = now()
    RETURNING *
  `;
  return fila;
}

export async function estadoSesion(sesionId: number): Promise<EstadoSesion | null> {
  const sql = getSql();
  const [fila] = await sql<{ estado: EstadoSesion }[]>`SELECT estado FROM sesiones WHERE id = ${sesionId}`;
  return fila?.estado ?? null;
}

export async function tocarSesion(sesionId: number): Promise<void> {
  const sql = getSql();
  await sql`UPDATE sesiones SET ultima_actividad = now() WHERE id = ${sesionId}`;
}

export async function cambiarEstadoSesion(
  sesionId: number,
  estado: EstadoSesion,
  resumen: string | null = null,
): Promise<void> {
  const sql = getSql();
  await sql`
    UPDATE sesiones
    SET estado = ${estado}, ultima_actividad = now(), resumen = COALESCE(${resumen}, resumen)
    WHERE id = ${sesionId}
  `;
}

/**
 * Suma una verificación de correo a la sesión si no se ha llegado al máximo.
 * Devuelve false si ya se alcanzó el límite (en ese caso no suma).
 */
export async function registrarVerificacionCorreo(sesionId: number, maximo: number): Promise<boolean> {
  const sql = getSql();
  const filas = await sql`
    UPDATE sesiones SET verificaciones_correo = verificaciones_correo + 1
    WHERE id = ${sesionId} AND verificaciones_correo < ${maximo}
    RETURNING id
  `;
  return filas.length > 0;
}

export async function registrarEscalado(datos: {
  contactId: string;
  sesionId: number;
  motivo: string;
  resumen: string;
}): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO escalados (contact_id, sesion_id, motivo, resumen)
    VALUES (${datos.contactId}, ${datos.sesionId}, ${datos.motivo}, ${datos.resumen})
  `;
}
