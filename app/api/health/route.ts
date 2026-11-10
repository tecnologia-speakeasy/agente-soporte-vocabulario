import { exigirAdmin } from "@/lib/auth";
import { resumenVocabulario } from "@/lib/bot/vocabulario";
import { getSql } from "@/lib/db";
import { revisarEnv } from "@/lib/env";
import { marcadoresPendientes } from "@/lib/prompts/system";

/** Estado de la base de datos y de la configuración. Requiere Authorization: Bearer ADMIN_TOKEN. */
export async function GET(request: Request) {
  const noAutorizado = exigirAdmin(request);
  if (noAutorizado) return noAutorizado;

  const env = revisarEnv();

  const db: { ok: boolean; latencia_ms?: number; migraciones?: string[]; error?: string } = { ok: false };
  const inicio = Date.now();
  try {
    const sql = getSql();
    await sql`SELECT 1`;
    db.latencia_ms = Date.now() - inicio;
    const filas = await sql<{ nombre: string }[]>`
      SELECT nombre FROM schema_migrations ORDER BY nombre
    `.catch(() => [] as { nombre: string }[]);
    db.migraciones = filas.map((f) => f.nombre);
    db.ok = true;
    if (db.migraciones.length === 0) db.error = "Conecta, pero no hay migraciones aplicadas (npm run db:migrate)";
  } catch (error) {
    db.error = error instanceof Error ? error.message : String(error);
  }

  // Esquema "vocabulario" (correos autorizados, profesiones, catálogo): solo lectura.
  let vocabulario: { ok: boolean; error?: string } & Partial<Awaited<ReturnType<typeof resumenVocabulario>>> = {
    ok: false,
  };
  if (db.ok) {
    try {
      vocabulario = { ok: true, ...(await resumenVocabulario()) };
    } catch (error) {
      vocabulario.error = error instanceof Error ? error.message : String(error);
    }
  }

  const ok = env.ok && db.ok && (db.migraciones?.length ?? 0) > 0 && vocabulario.ok;
  return Response.json(
    {
      ok,
      db,
      vocabulario,
      env,
      modelo: process.env.ANTHROPIC_MODEL || "claude-opus-5-5",
      prompt_marcadores_pendientes: marcadoresPendientes(),
    },
    { status: ok ? 200 : 503 },
  );
}
