import { getSql } from "../db";

/**
 * Consultas del panel /admin (solo lectura, salvo la revisión manual de conversaciones).
 * Llamar únicamente después de exigirSesionPanel().
 */

export const RANGOS_DIAS = [7, 30, 90] as const;
export type RangoDias = (typeof RANGOS_DIAS)[number];
export const POR_PAGINA = 50;

export function zonaHoraria(): string {
  const zona = process.env.PANEL_ZONA_HORARIA?.trim() || "America/Bogota";
  try {
    new Intl.DateTimeFormat("es", { timeZone: zona });
    return zona;
  } catch {
    return "America/Bogota";
  }
}

interface Filtro {
  dias: RangoDias;
  /** Incluir conversaciones de /api/test-chat. */
  pruebas: boolean;
}

const aNumero = (valor: unknown): number => (valor === null || valor === undefined ? 0 : Number(valor));
const aNumeroONulo = (valor: unknown): number | null =>
  valor === null || valor === undefined ? null : Number(valor);

/** Inicio del rango: medianoche (hora local) de hace dias-1 días. */
function inicioRango(dias: number, zona: string) {
  const sql = getSql();
  return sql`((date_trunc('day', now() AT TIME ZONE ${zona}) - make_interval(days => ${dias - 1}::int)) AT TIME ZONE ${zona})`;
}

// ---------- Resumen ----------

export interface Resumen {
  conversaciones: { total: number; activas: number; cerradas: number; escaladas: number; expiradas: number };
  mensajes: {
    recibidos: number;
    respondidos: number;
    escalados: number;
    errores: number;
    sinTerminar: number;
    ignorados: number;
  };
  costo: { total: number; turnos: number; turnosSinPrecio: number; porConversacion: number | null };
  tokens: { entrada: number; cacheLectura: number; cacheEscritura: number; salida: number };
  tiempo: { p50: number | null; p95: number | null };
  revision: { bien: number; mal: number; sinRevisar: number };
  /** Segundos desde el último webhook recibido (de cualquier tipo), o null si nunca llegó uno. */
  segundosDesdeUltimoWebhook: number | null;
  /** Modelo de la respuesta más reciente. */
  ultimoModelo: string | null;
}

export async function resumen({ dias, pruebas }: Filtro): Promise<Resumen> {
  const sql = getSql();
  const zona = zonaHoraria();
  const desde = inicioRango(dias, zona);

  const [[ses], [msj], [tur], [ult]] = await Promise.all([
    sql`
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE estado = 'activa')::int AS activas,
        count(*) FILTER (WHERE estado = 'cerrada')::int AS cerradas,
        count(*) FILTER (WHERE estado = 'escalada')::int AS escaladas,
        count(*) FILTER (WHERE estado = 'expirada')::int AS expiradas,
        count(*) FILTER (WHERE revision = 'bien')::int AS bien,
        count(*) FILTER (WHERE revision = 'mal')::int AS mal,
        count(*) FILTER (WHERE revision IS NULL)::int AS sin_revisar
      FROM sesiones
      WHERE iniciada_en >= ${desde} AND (${pruebas} OR NOT es_prueba)
    `,
    sql`
      SELECT
        count(*)::int AS recibidos,
        count(*) FILTER (WHERE resultado = 'respondido')::int AS respondidos,
        count(*) FILTER (WHERE resultado = 'escalado')::int AS escalados,
        count(*) FILTER (WHERE resultado = 'error')::int AS errores,
        count(*) FILTER (WHERE resultado IS NULL AND created_at < now() - interval '5 minutes')::int AS sin_terminar,
        count(*) FILTER (WHERE resultado IN ('ignorado_sin_sesion', 'ignorado_etiqueta'))::int AS ignorados
      FROM webhook_logs
      WHERE created_at >= ${desde} AND (${pruebas} OR NOT es_prueba)
    `,
    sql`
      SELECT
        count(*)::int AS turnos,
        count(*) FILTER (WHERE costo_usd IS NULL AND llamadas > 0)::int AS sin_precio,
        COALESCE(sum(costo_usd), 0) AS costo,
        count(DISTINCT sesion_id)::int AS sesiones,
        COALESCE(sum(tokens_entrada), 0)::bigint AS entrada,
        COALESCE(sum(tokens_cache_lectura), 0)::bigint AS cache_lectura,
        COALESCE(sum(tokens_cache_escritura), 0)::bigint AS cache_escritura,
        COALESCE(sum(tokens_salida), 0)::bigint AS salida,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY duracion_ms) FILTER (WHERE resultado <> 'error') AS p50,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY duracion_ms) FILTER (WHERE resultado <> 'error') AS p95
      FROM turnos_bot
      WHERE created_at >= ${desde} AND (${pruebas} OR NOT es_prueba)
    `,
    sql`
      SELECT
        (SELECT extract(epoch FROM now() - max(created_at)) FROM webhook_logs) AS segundos,
        (SELECT modelo FROM turnos_bot WHERE modelo IS NOT NULL ORDER BY id DESC LIMIT 1) AS modelo
    `,
  ]);

  const costoTotal = aNumero(tur.costo);
  const sesionesConCosto = aNumero(tur.sesiones);
  return {
    conversaciones: {
      total: ses.total,
      activas: ses.activas,
      cerradas: ses.cerradas,
      escaladas: ses.escaladas,
      expiradas: ses.expiradas,
    },
    mensajes: {
      recibidos: msj.recibidos,
      respondidos: msj.respondidos,
      escalados: msj.escalados,
      errores: msj.errores,
      sinTerminar: msj.sin_terminar,
      ignorados: msj.ignorados,
    },
    costo: {
      total: costoTotal,
      turnos: tur.turnos,
      turnosSinPrecio: tur.sin_precio,
      porConversacion: sesionesConCosto > 0 ? costoTotal / sesionesConCosto : null,
    },
    tokens: {
      entrada: aNumero(tur.entrada),
      cacheLectura: aNumero(tur.cache_lectura),
      cacheEscritura: aNumero(tur.cache_escritura),
      salida: aNumero(tur.salida),
    },
    tiempo: { p50: aNumeroONulo(tur.p50), p95: aNumeroONulo(tur.p95) },
    revision: { bien: ses.bien, mal: ses.mal, sinRevisar: ses.sin_revisar },
    segundosDesdeUltimoWebhook: aNumeroONulo(ult.segundos),
    ultimoModelo: ult.modelo ?? null,
  };
}

export interface PuntoDiario {
  dia: string; // YYYY-MM-DD (hora local)
  respondido: number;
  escalado: number;
  error: number;
}

/** Mensajes procesados por el bot por día (los ignorados no cuentan). */
export async function serieDiaria({ dias, pruebas }: Filtro): Promise<PuntoDiario[]> {
  const sql = getSql();
  const zona = zonaHoraria();
  const desde = inicioRango(dias, zona);
  return sql<PuntoDiario[]>`
    WITH dias AS (
      SELECT generate_series(
        date_trunc('day', now() AT TIME ZONE ${zona}) - make_interval(days => ${dias - 1}::int),
        date_trunc('day', now() AT TIME ZONE ${zona}),
        interval '1 day'
      ) AS dia
    ),
    conteos AS (
      SELECT
        date_trunc('day', created_at AT TIME ZONE ${zona}) AS dia,
        count(*) FILTER (WHERE resultado = 'respondido')::int AS respondido,
        count(*) FILTER (WHERE resultado = 'escalado')::int AS escalado,
        count(*) FILTER (WHERE resultado = 'error'
                           OR (resultado IS NULL AND created_at < now() - interval '5 minutes'))::int AS error
      FROM webhook_logs
      WHERE created_at >= ${desde} AND (${pruebas} OR NOT es_prueba)
      GROUP BY 1
    )
    SELECT to_char(d.dia, 'YYYY-MM-DD') AS dia,
           COALESCE(c.respondido, 0) AS respondido,
           COALESCE(c.escalado, 0) AS escalado,
           COALESCE(c.error, 0) AS error
    FROM dias d LEFT JOIN conteos c ON c.dia = d.dia
    ORDER BY d.dia
  `;
}

export async function motivosEscalado({ dias, pruebas }: Filtro): Promise<{ motivo: string; total: number }[]> {
  const sql = getSql();
  const desde = inicioRango(dias, zonaHoraria());
  return sql<{ motivo: string; total: number }[]>`
    SELECT e.motivo, count(*)::int AS total
    FROM escalados e
    LEFT JOIN sesiones s ON s.id = e.sesion_id
    WHERE e.created_at >= ${desde} AND (${pruebas} OR NOT COALESCE(s.es_prueba, FALSE))
    GROUP BY e.motivo
    ORDER BY total DESC, e.motivo
  `;
}

export interface UsoHerramientaResumen {
  nombre: string;
  total: number;
  errores: number;
  autorizados: number;
  noAutorizados: number;
}

export async function usoHerramientas({ dias, pruebas }: Filtro): Promise<UsoHerramientaResumen[]> {
  const sql = getSql();
  const desde = inicioRango(dias, zonaHoraria());
  const filas = await sql`
    SELECT
      h->>'nombre' AS nombre,
      count(*)::int AS total,
      count(*) FILTER (WHERE (h->>'error')::boolean)::int AS errores,
      count(*) FILTER (WHERE h->>'resultado' LIKE '%"autorizado":true%')::int AS autorizados,
      count(*) FILTER (WHERE h->>'resultado' LIKE '%"autorizado":false%')::int AS no_autorizados
    FROM turnos_bot t CROSS JOIN LATERAL jsonb_array_elements(t.herramientas) h
    WHERE t.created_at >= ${desde} AND (${pruebas} OR NOT t.es_prueba)
    GROUP BY 1
    ORDER BY total DESC
  `;
  return filas.map((f) => ({
    nombre: f.nombre,
    total: f.total,
    errores: f.errores,
    autorizados: f.autorizados,
    noAutorizados: f.no_autorizados,
  }));
}

// ---------- Errores ----------

export type TipoProblema = "error" | "sin_terminar" | "aviso";

export interface Problema {
  tipo: TipoProblema;
  id: number;
  fecha: Date;
  contactId: string | null;
  nombre: string | null;
  sesionId: number | null;
  mensaje: string;
  esPrueba: boolean;
}

/**
 * Errores del webhook, procesos que no terminaron (p. ej. la función llegó a su tiempo límite)
 * y avisos de los turnos (p. ej. falló un paso de GHL al escalar).
 */
export async function problemas(opciones: {
  pruebas: boolean;
  tipo?: TipoProblema | null;
  limite: number;
  desplazamiento?: number;
}): Promise<{ filas: Problema[]; total: number }> {
  const sql = getSql();
  const tipo = opciones.tipo ?? null;
  const filas = await sql`
    WITH todos AS (
      SELECT 'error' AS tipo, w.id, w.created_at AS fecha, w.contact_id, w.sesion_id,
             COALESCE(w.detalle, 'Error sin detalle') AS mensaje, w.es_prueba
      FROM webhook_logs w
      WHERE w.resultado = 'error'
      UNION ALL
      SELECT 'sin_terminar', w.id, w.created_at, w.contact_id, w.sesion_id,
             'El procesamiento no terminó: la función pudo llegar a su tiempo límite o fallar antes de registrar el resultado.',
             w.es_prueba
      FROM webhook_logs w
      WHERE w.resultado IS NULL AND w.created_at < now() - interval '5 minutes'
      UNION ALL
      SELECT 'aviso', t.id, t.created_at, t.contact_id, t.sesion_id, a.value, t.es_prueba
      FROM turnos_bot t CROSS JOIN LATERAL jsonb_array_elements_text(t.avisos) a
    )
    SELECT x.*, c.nombre, count(*) OVER () AS total
    FROM todos x
    LEFT JOIN contactos c ON c.contact_id = x.contact_id
    WHERE (${opciones.pruebas} OR NOT x.es_prueba)
      AND (${tipo}::text IS NULL OR x.tipo = ${tipo})
    ORDER BY x.fecha DESC, x.id DESC
    LIMIT ${opciones.limite} OFFSET ${opciones.desplazamiento ?? 0}
  `;
  return {
    total: filas.length > 0 ? aNumero(filas[0].total) : 0,
    filas: filas.map((f) => ({
      tipo: f.tipo as TipoProblema,
      id: f.id,
      fecha: f.fecha,
      contactId: f.contact_id,
      nombre: f.nombre,
      sesionId: f.sesion_id,
      mensaje: f.mensaje,
      esPrueba: f.es_prueba,
    })),
  };
}

// ---------- Conversaciones ----------

export type EstadoConversacion = "activa" | "cerrada" | "escalada" | "expirada";
export type FiltroRevision = "sin" | "bien" | "mal";

export interface FilaConversacion {
  id: number;
  contactId: string;
  nombre: string | null;
  telefono: string | null;
  estado: EstadoConversacion;
  iniciadaEn: Date;
  ultimaActividad: Date;
  mensajesUsuario: number;
  mensajesBot: number;
  motivo: string | null;
  costo: number | null;
  problemas: number;
  revision: "bien" | "mal" | null;
  esPrueba: boolean;
}

/** Desde cuántos mensajes del usuario una conversación se marca como larga (posible señal de que no se resolvió). */
export const UMBRAL_CONVERSACION_LARGA = 6;

function escaparLike(texto: string): string {
  return texto.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function conversaciones(opciones: {
  pruebas: boolean;
  estado: EstadoConversacion | null;
  revision: FiltroRevision | null;
  largas: boolean;
  conProblemas: boolean;
  busqueda: string | null;
  pagina: number;
}): Promise<{ filas: FilaConversacion[]; total: number }> {
  const sql = getSql();
  const patron = opciones.busqueda ? `%${escaparLike(opciones.busqueda)}%` : null;
  const filtroRevision =
    opciones.revision === "sin"
      ? sql`AND s.revision IS NULL`
      : opciones.revision
        ? sql`AND s.revision = ${opciones.revision}`
        : sql``;

  const filas = await sql`
    WITH base AS (
      SELECT
        s.id, s.contact_id, s.estado, s.iniciada_en, s.ultima_actividad, s.revision, s.es_prueba,
        c.nombre, c.telefono,
        (SELECT count(*) FROM mensajes m WHERE m.sesion_id = s.id AND m.rol = 'user')::int AS mensajes_usuario,
        (SELECT count(*) FROM mensajes m WHERE m.sesion_id = s.id AND m.rol = 'assistant')::int AS mensajes_bot,
        (SELECT e.motivo FROM escalados e WHERE e.sesion_id = s.id ORDER BY e.id DESC LIMIT 1) AS motivo,
        (SELECT sum(t.costo_usd) FROM turnos_bot t WHERE t.sesion_id = s.id) AS costo,
        (
          (SELECT count(*) FROM turnos_bot t
             WHERE t.sesion_id = s.id AND (t.resultado = 'error' OR jsonb_array_length(t.avisos) > 0))
          -- Errores del webhook que no quedaron en un turno (p. ej. antes de llamar a Claude) y procesos sin terminar.
          + (SELECT count(*) FROM webhook_logs w
               WHERE w.sesion_id = s.id
                 AND (w.resultado = 'error' OR (w.resultado IS NULL AND w.created_at < now() - interval '5 minutes'))
                 AND NOT EXISTS (SELECT 1 FROM turnos_bot t WHERE t.webhook_log_id = w.id))
        )::int AS problemas
      FROM sesiones s
      JOIN contactos c ON c.contact_id = s.contact_id
      WHERE (${opciones.pruebas} OR NOT s.es_prueba)
        AND (${opciones.estado}::text IS NULL OR s.estado = ${opciones.estado})
        ${filtroRevision}
        AND (
          ${patron}::text IS NULL
          OR c.nombre ILIKE ${patron} OR c.telefono ILIKE ${patron}
          OR c.contact_id ILIKE ${patron} OR c.memoria::text ILIKE ${patron}
        )
    )
    SELECT *, count(*) OVER () AS total
    FROM base
    WHERE (NOT ${opciones.largas} OR mensajes_usuario >= ${UMBRAL_CONVERSACION_LARGA})
      AND (NOT ${opciones.conProblemas} OR problemas > 0)
    ORDER BY iniciada_en DESC, id DESC
    LIMIT ${POR_PAGINA} OFFSET ${(opciones.pagina - 1) * POR_PAGINA}
  `;

  return {
    total: filas.length > 0 ? aNumero(filas[0].total) : 0,
    filas: filas.map((f) => ({
      id: f.id,
      contactId: f.contact_id,
      nombre: f.nombre,
      telefono: f.telefono,
      estado: f.estado,
      iniciadaEn: f.iniciada_en,
      ultimaActividad: f.ultima_actividad,
      mensajesUsuario: f.mensajes_usuario,
      mensajesBot: f.mensajes_bot,
      motivo: f.motivo,
      costo: aNumeroONulo(f.costo),
      problemas: f.problemas,
      revision: f.revision,
      esPrueba: f.es_prueba,
    })),
  };
}

export interface HerramientaTurno {
  nombre: string;
  entrada: unknown;
  resultado: unknown;
  error: boolean;
}

export interface Turno {
  id: number;
  iniciadoEn: Date;
  resultado: string;
  detalle: string | null;
  error: string | null;
  modelo: string | null;
  stopReason: string | null;
  llamadas: number;
  tokensEntrada: number;
  tokensCacheLectura: number;
  tokensCacheEscritura: number;
  tokensSalida: number;
  costo: number | null;
  duracionMs: number | null;
  herramientas: HerramientaTurno[];
  avisos: string[];
}

export interface DetalleConversacion {
  sesion: {
    id: number;
    estado: EstadoConversacion;
    iniciadaEn: Date;
    ultimaActividad: Date;
    expiraEn: Date;
    resumen: string | null;
    verificacionesCorreo: number;
    revision: "bien" | "mal" | null;
    revisionNota: string | null;
    revisadaEn: Date | null;
    esPrueba: boolean;
    disparador: { tipo: string; texto: string } | null;
  };
  contacto: { contactId: string; nombre: string | null; telefono: string | null; memoria: Record<string, unknown> };
  mensajes: { id: number; rol: "user" | "assistant"; contenido: string; fecha: Date }[];
  turnos: Turno[];
  escalados: { motivo: string; resumen: string; fecha: Date }[];
  erroresWebhook: { id: number; fecha: Date; resultado: string | null; detalle: string | null }[];
  otras: { id: number; estado: EstadoConversacion; iniciadaEn: Date }[];
}

export async function detalleConversacion(id: number): Promise<DetalleConversacion | null> {
  const sql = getSql();
  const [s] = await sql`
    SELECT s.*, c.nombre, c.telefono, c.memoria, d.tipo AS disparador_tipo, d.texto AS disparador_texto
    FROM sesiones s
    JOIN contactos c ON c.contact_id = s.contact_id
    LEFT JOIN disparadores d ON d.id = s.disparador_id
    WHERE s.id = ${id}
  `;
  if (!s) return null;

  const [mensajes, turnos, escalados, erroresWebhook, otras] = await Promise.all([
    sql`SELECT id, rol, contenido, created_at FROM mensajes WHERE sesion_id = ${id} ORDER BY created_at, id`,
    sql`SELECT * FROM turnos_bot WHERE sesion_id = ${id} ORDER BY iniciado_en, id`,
    sql`SELECT motivo, resumen, created_at FROM escalados WHERE sesion_id = ${id} ORDER BY id`,
    sql`
      SELECT id, created_at, resultado, detalle FROM webhook_logs
      WHERE sesion_id = ${id}
        AND (resultado = 'error' OR (resultado IS NULL AND created_at < now() - interval '5 minutes'))
        AND NOT EXISTS (SELECT 1 FROM turnos_bot t WHERE t.webhook_log_id = webhook_logs.id)
      ORDER BY id
    `,
    sql`
      SELECT id, estado, iniciada_en FROM sesiones
      WHERE contact_id = ${s.contact_id} AND id <> ${id}
      ORDER BY iniciada_en DESC LIMIT 10
    `,
  ]);

  return {
    sesion: {
      id: s.id,
      estado: s.estado,
      iniciadaEn: s.iniciada_en,
      ultimaActividad: s.ultima_actividad,
      expiraEn: s.expira_en,
      resumen: s.resumen,
      verificacionesCorreo: s.verificaciones_correo ?? 0,
      revision: s.revision,
      revisionNota: s.revision_nota,
      revisadaEn: s.revisada_en,
      esPrueba: s.es_prueba,
      disparador: s.disparador_texto ? { tipo: s.disparador_tipo, texto: s.disparador_texto } : null,
    },
    contacto: { contactId: s.contact_id, nombre: s.nombre, telefono: s.telefono, memoria: s.memoria ?? {} },
    mensajes: mensajes.map((m) => ({ id: m.id, rol: m.rol, contenido: m.contenido, fecha: m.created_at })),
    turnos: turnos.map((t) => ({
      id: t.id,
      iniciadoEn: t.iniciado_en,
      resultado: t.resultado,
      detalle: t.detalle,
      error: t.error,
      modelo: t.modelo,
      stopReason: t.stop_reason,
      llamadas: t.llamadas,
      tokensEntrada: t.tokens_entrada,
      tokensCacheLectura: t.tokens_cache_lectura,
      tokensCacheEscritura: t.tokens_cache_escritura,
      tokensSalida: t.tokens_salida,
      costo: aNumeroONulo(t.costo_usd),
      duracionMs: t.duracion_ms,
      herramientas: Array.isArray(t.herramientas) ? t.herramientas : [],
      avisos: Array.isArray(t.avisos) ? t.avisos : [],
    })),
    escalados: escalados.map((e) => ({ motivo: e.motivo, resumen: e.resumen, fecha: e.created_at })),
    erroresWebhook: erroresWebhook.map((w) => ({
      id: w.id,
      fecha: w.created_at,
      resultado: w.resultado,
      detalle: w.detalle,
    })),
    otras: otras.map((o) => ({ id: o.id, estado: o.estado, iniciadaEn: o.iniciada_en })),
  };
}

export async function guardarRevisionSesion(
  sesionId: number,
  revision: "bien" | "mal" | null,
  nota: string | null,
): Promise<void> {
  const sql = getSql();
  await sql`
    UPDATE sesiones
    SET revision = ${revision},
        revision_nota = ${revision ? nota : null},
        revisada_en = CASE WHEN ${revision}::text IS NULL THEN NULL ELSE now() END
    WHERE id = ${sesionId}
  `;
}

/** Comprueba la conexión y que exista la migración del panel. */
export async function estadoBaseDatos(): Promise<{ ok: boolean; error: string | null; faltaMigracion: boolean }> {
  const sql = getSql();
  try {
    const [fila] = await sql`SELECT to_regclass('turnos_bot') IS NOT NULL AS existe`;
    return { ok: true, error: null, faltaMigracion: !fila.existe };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), faltaMigracion: false };
  }
}
