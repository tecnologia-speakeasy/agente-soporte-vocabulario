import { getSql } from "../db";
import { normalizar } from "./activation";

/**
 * Lectura del esquema "vocabulario", que administra la página de búsqueda de vocabulario
 * (busquedavocabulario.speakeasyacademia.com). El bot solo lee:
 * - vocab_correos_autorizados: quién compró (fuente de verdad del acceso);
 * - vocab_profesiones_estudiante: qué profesión eligió cada correo ("existente" o "nuevo");
 * - vocab_vocabularios: el catálogo (si un vocabulario no tiene PDF, está en preparación).
 * Las tablas rutina_* son de otro programa y no se usan.
 */

export interface VocabularioCatalogo {
  nombre: string;
  categoria: string;
  tienePdf: boolean;
}

export type EstadoProfesion = "lista" | "en_preparacion";

export interface ProfesionElegida {
  profesion: string;
  estado: EstadoProfesion;
  elegida_el: string;
}

export type ResultadoVerificacion =
  | { correo: string; autorizado: false }
  | { correo: string; autorizado: true; profesiones_elegidas: ProfesionElegida[] };

/** Quita espacios (incluidos tabuladores y saltos) y pasa a minúsculas. */
export function normalizarCorreo(correo: string): string {
  return correo.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
}

export function correoValido(correo: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s.]{2,}$/.test(correo);
}

/** Catálogo activo, ordenado de forma estable (forma parte del prompt cacheado). */
export async function catalogoVocabularios(): Promise<VocabularioCatalogo[]> {
  const sql = getSql();
  const filas = await sql<{ nombre: string; categoria: string; tiene_pdf: boolean }[]>`
    SELECT nombre, categoria, COALESCE(btrim(pdf_url), '') <> '' AS tiene_pdf
    FROM vocabulario.vocab_vocabularios
    WHERE activo
  `;
  return filas
    .map((f) => ({ nombre: f.nombre.trim(), categoria: f.categoria.trim(), tienePdf: f.tiene_pdf }))
    .sort((a, b) => a.categoria.localeCompare(b.categoria, "es") || a.nombre.localeCompare(b.nombre, "es"));
}

/**
 * Estado del vocabulario que eligió el estudiante. Los nombres se comparan normalizados porque
 * el texto guardado no siempre coincide letra por letra con el catálogo
 * (p. ej. "Sistemas Computacionales/TI" frente a "sistemas computacionales / TI").
 * - Está en el catálogo con PDF → lista. Sin PDF → en preparación.
 * - No está en el catálogo: si la página la marcó "existente", existía al elegirla → lista;
 *   si la marcó "nuevo", la están preparando → en preparación.
 */
export function estadoProfesion(
  fila: { categoria: string; vocabulario: string },
  catalogo: VocabularioCatalogo[],
): { estado: EstadoProfesion; nombre: string } {
  const buscado = normalizar(fila.vocabulario);
  const enCatalogo = catalogo.find((v) => normalizar(v.nombre) === buscado);
  if (enCatalogo) return { estado: enCatalogo.tienePdf ? "lista" : "en_preparacion", nombre: enCatalogo.nombre };
  return { estado: fila.categoria === "existente" ? "lista" : "en_preparacion", nombre: fila.vocabulario.trim() };
}

/**
 * Verifica un correo. Si no está autorizado no devuelve nada más, aunque haya datos en otras tablas.
 * Nunca devuelve nombres, enlaces a PDF ni datos de otras personas.
 */
export async function verificarAcceso(correoEntrada: string): Promise<ResultadoVerificacion> {
  const correo = normalizarCorreo(correoEntrada);
  const sql = getSql();
  const [{ autorizado }] = await sql<{ autorizado: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM vocabulario.vocab_correos_autorizados
      WHERE lower(regexp_replace(correo, '[[:space:]]', '', 'g')) = ${correo}
    ) AS autorizado
  `;
  if (!autorizado) return { correo, autorizado: false };

  const elegidas = await sql<{ categoria: string; vocabulario: string; creado_en: Date }[]>`
    SELECT categoria, vocabulario, creado_en
    FROM vocabulario.vocab_profesiones_estudiante
    WHERE lower(regexp_replace(correo, '[[:space:]]', '', 'g')) = ${correo}
    ORDER BY creado_en DESC
    LIMIT 5
  `;
  const catalogo = elegidas.length > 0 ? await catalogoVocabularios() : [];
  return {
    correo,
    autorizado: true,
    profesiones_elegidas: elegidas.map((f) => {
      const { estado, nombre } = estadoProfesion(f, catalogo);
      return { profesion: nombre, estado, elegida_el: f.creado_en.toISOString().slice(0, 10) };
    }),
  };
}

/** Conteos para /api/health (comprueba que el usuario de la BD puede leer las 3 tablas). */
export async function resumenVocabulario(): Promise<{
  vocabularios: number;
  correos_autorizados: number;
  profesiones_elegidas: number;
}> {
  const sql = getSql();
  const [fila] = await sql<{ vocabularios: number; correos_autorizados: number; profesiones_elegidas: number }[]>`
    SELECT
      (SELECT count(*)::int FROM vocabulario.vocab_vocabularios WHERE activo) AS vocabularios,
      (SELECT count(*)::int FROM vocabulario.vocab_correos_autorizados) AS correos_autorizados,
      (SELECT count(*)::int FROM vocabulario.vocab_profesiones_estudiante) AS profesiones_elegidas
  `;
  return fila;
}
