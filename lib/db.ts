import postgres from "postgres";

type Sql = ReturnType<typeof crearCliente>;

function tamanoPool(): number {
  const valor = Number(process.env.DATABASE_POOL_MAX);
  return Number.isInteger(valor) && valor > 0 ? valor : 5;
}

function crearCliente(url: string) {
  return postgres(url, {
    // En serverless conviene un pool pequeño y usar el pooler de tu proveedor (Neon, Supabase, etc.).
    max: tamanoPool(),
    idle_timeout: 20,
    connect_timeout: 10,
    // Compatible con poolers en modo transacción (PgBouncer / Supabase pooler).
    prepare: false,
    onnotice: () => {},
    types: {
      // BIGINT (oid 20) como number en vez de string. Seguro mientras los ids sean < 2^53.
      bigint: {
        to: 20,
        from: [20],
        serialize: (valor: number) => valor.toString(),
        parse: (valor: string) => Number(valor),
      },
    },
  });
}

const globalParaSql = globalThis as unknown as { __sqlVocabulario?: Sql };

/** Cliente de Postgres compartido (se reutiliza entre invocaciones y entre recargas en desarrollo). */
export function getSql(): Sql {
  if (!globalParaSql.__sqlVocabulario) {
    const url = process.env.DATABASE_URL;
    if (!url || url.trim() === "") {
      throw new Error("DATABASE_URL no está configurada. Revisa tu .env.local o las variables de Vercel.");
    }
    globalParaSql.__sqlVocabulario = crearCliente(url);
  }
  return globalParaSql.__sqlVocabulario;
}
