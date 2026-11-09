import { createHash, timingSafeEqual } from "node:crypto";

/** Compara dos secretos en tiempo constante (sin filtrar la longitud). */
export function compararSeguro(recibido: string | null | undefined, esperado: string | null | undefined): boolean {
  if (!recibido || !esperado) return false;
  const a = createHash("sha256").update(recibido).digest();
  const b = createHash("sha256").update(esperado).digest();
  return timingSafeEqual(a, b);
}

/**
 * Valida `Authorization: Bearer <ADMIN_TOKEN>`.
 * Lee ADMIN_TOKEN directamente para que /api/health funcione aunque falten otras variables.
 * Devuelve una Response de error, o null si está autorizado.
 */
export function exigirAdmin(request: Request): Response | null {
  const esperado = process.env.ADMIN_TOKEN?.trim();
  if (!esperado) {
    return Response.json({ ok: false, error: "ADMIN_TOKEN no está configurado en el servidor" }, { status: 503 });
  }
  const encabezado = request.headers.get("authorization") ?? "";
  const token = encabezado.replace(/^Bearer\s+/i, "").trim();
  if (!compararSeguro(token, esperado)) {
    return Response.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  return null;
}
