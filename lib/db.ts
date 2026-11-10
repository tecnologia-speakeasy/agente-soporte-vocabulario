import postgres from "postgres";

type Sql = ReturnType<typeof crearCliente>;

function tamanoPool(): number {
  const valor = Number(process.env.DATABASE_POOL_MAX);
  return Number.isInteger(valor) && valor > 0 ? valor : 5;
}

/**
 * Parámetros que agregan Prisma y otras herramientas a la URL y que Postgres no reconoce.
 * El paquete `postgres` reenvía al servidor cualquier parámetro desconocido, y el servidor
 * responde "unrecognized configuration parameter".
 */
const PARAMETROS_NO_POSTGRES = [
  "schema",
  "pgbouncer",
  "connection_limit",
  "pool_timeout",
  "socket_timeout",
  "statement_cache_size",
  "sslaccept",
];

/**
 * Limpia la URL de conexión. Si trae `?schema=...` (formato de Prisma), lo quita de la URL
 * y lo devuelve para usarlo como search_path, que es lo que significa en Prisma.
 */
export function prepararConexion(url: string): { url: string; esquema: string | null } {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { url, esquema: null }; // formatos que URL no entiende (p. ej. varios hosts): se usan tal cual
  }
  const esquema = u.searchParams.get("schema")?.trim() || null;
  if (esquema && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(esquema)) {
    throw new Error(`El parámetro schema de DATABASE_URL no es un nombre de esquema válido: "${esquema}"`);
  }
  for (const parametro of PARAMETROS_NO_POSTGRES) u.searchParams.delete(parametro);
  return { url: u.toString(), esquema };
}

function crearCliente(urlOriginal: string) {
  const { url, esquema } = prepararConexion(urlOriginal);
  return postgres(url, {
    ...(esquema ? { connection: { search_path: esquema } } : {}),
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
