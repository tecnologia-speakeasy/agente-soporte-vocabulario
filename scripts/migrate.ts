/**
 * Aplica las migraciones de /db/migrations en orden (npm run db:migrate)
 * o ejecuta /db/seed.sql (npm run db:seed).
 *
 * Lee DATABASE_URL de .env, .env.local, etc. con el mismo orden de prioridad que Next.js.
 */
import { loadEnvConfig } from "@next/env";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

loadEnvConfig(process.cwd());

const url = process.env.DATABASE_URL;
if (!url || url.trim() === "") {
  console.error("❌ Falta DATABASE_URL. Configúrala en .env.local (copia .env.example).");
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
const raiz = process.cwd();

async function migrar() {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      nombre       TEXT PRIMARY KEY,
      aplicada_en  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  const carpeta = path.join(raiz, "db", "migrations");
  const archivos = (await readdir(carpeta)).filter((f) => f.endsWith(".sql")).sort();
  const filas = await sql<{ nombre: string }[]>`SELECT nombre FROM schema_migrations`;
  const aplicadas = new Set(filas.map((f) => f.nombre));

  let nuevas = 0;
  for (const archivo of archivos) {
    if (aplicadas.has(archivo)) {
      console.log(`· ${archivo} (ya aplicada)`);
      continue;
    }
    const contenido = await readFile(path.join(carpeta, archivo), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(contenido);
      await tx`INSERT INTO schema_migrations (nombre) VALUES (${archivo})`;
    });
    nuevas++;
    console.log(`✔ ${archivo} aplicada`);
  }
  console.log(nuevas === 0 ? "La base de datos ya estaba al día." : `Listo: ${nuevas} migración(es) aplicada(s).`);
}

async function sembrar() {
  const contenido = await readFile(path.join(raiz, "db", "seed.sql"), "utf8");
  await sql.begin(async (tx) => {
    await tx.unsafe(contenido);
  });
  const [conteo] = await sql<{ disparadores: number; conocimiento: number }[]>`
    SELECT
      (SELECT count(*)::int FROM disparadores) AS disparadores,
      (SELECT count(*)::int FROM conocimiento) AS conocimiento
  `;
  console.log(`✔ Seed aplicado. Disparadores: ${conteo.disparadores}, conocimiento: ${conteo.conocimiento}.`);
}

const tarea = process.argv.includes("--seed") ? sembrar : migrar;

tarea()
  .then(() => sql.end())
  .catch(async (error) => {
    console.error("❌ Error:", error instanceof Error ? error.message : error);
    await sql.end({ timeout: 5 });
    process.exit(1);
  });
