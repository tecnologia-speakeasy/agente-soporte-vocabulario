import { z } from "zod";

/** Trata los valores vacíos ("" o solo espacios) como si la variable no existiera. */
const vacioAUndefined = (valor: unknown) =>
  typeof valor === "string" && valor.trim() === "" ? undefined : valor;

const requerida = (minimo = 1) =>
  z.preprocess(
    vacioAUndefined,
    z
      .string({ error: "falta o está vacía" })
      .min(minimo, `debe tener al menos ${minimo} caracteres`),
  );

const opcional = () => z.preprocess(vacioAUndefined, z.string().optional());

const entero = (porDefecto: number, minimo: number) =>
  z.preprocess(
    vacioAUndefined,
    z.coerce
      .number({ error: "debe ser un número" })
      .int("debe ser un número entero")
      .min(minimo, `debe ser mayor o igual a ${minimo}`)
      .default(porDefecto),
  );

const esquema = z.object({
  DATABASE_URL: requerida(),
  ANTHROPIC_API_KEY: requerida(),
  ANTHROPIC_MODEL: z.preprocess(vacioAUndefined, z.string().default("claude-opus-5-5")),
  /** Esfuerzo de razonamiento. "none" = no enviar el parámetro (para modelos que no lo soportan). */
  ANTHROPIC_EFFORT: z.preprocess(
    vacioAUndefined,
    z
      .enum(["low", "medium", "high", "xhigh", "max", "none"], {
        error: "debe ser low, medium, high, xhigh, max o none",
      })
      .default("low"),
  ),
  GHL_API_TOKEN: requerida(),
  GHL_LOCATION_ID: requerida(),
  GHL_WEBHOOK_SECRET: requerida(16),
  GHL_MOTIVO_ESCALADO_FIELD_ID: opcional(),
  SESSION_TTL_HOURS: entero(24, 1),
  DEBOUNCE_SECONDS: entero(8, 0),
  HISTORY_LIMIT: entero(20, 2),
  ADMIN_TOKEN: requerida(16),
});

export type Env = z.infer<typeof esquema>;

export class EnvError extends Error {
  constructor(public readonly problemas: string[]) {
    super(
      `Variables de entorno inválidas:\n${problemas.map((p) => `  - ${p}`).join("\n")}\n` +
        "Revisa tu .env.local (local) o Settings → Environment Variables (Vercel). " +
        "Usa .env.example como referencia.",
    );
    this.name = "EnvError";
  }
}

function describirProblemas(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join(".") || "(raíz)"}: ${issue.message}`);
}

let cache: Env | null = null;

/** Devuelve las variables validadas. Lanza EnvError con un mensaje claro si algo falta o es inválido. */
export function getEnv(): Env {
  if (cache) return cache;
  const resultado = esquema.safeParse(process.env);
  if (!resultado.success) throw new EnvError(describirProblemas(resultado.error));
  cache = resultado.data;
  return cache;
}

/** Igual que getEnv pero sin lanzar: útil para /api/health. */
export function revisarEnv(): { ok: boolean; problemas: string[] } {
  const resultado = esquema.safeParse(process.env);
  const problemas = resultado.success ? [] : describirProblemas(resultado.error);
  if (resultado.success && !resultado.data.GHL_MOTIVO_ESCALADO_FIELD_ID) {
    problemas.push(
      "GHL_MOTIVO_ESCALADO_FIELD_ID: vacía (aviso) — al escalar no se actualizará el campo motivo_escalado",
    );
  }
  return { ok: resultado.success, problemas };
}

/** Se llama desde instrumentation.ts al arrancar el servidor. */
export function validarEnvAlArrancar(): void {
  try {
    getEnv();
    console.log("[env] Variables de entorno validadas correctamente.");
  } catch (error) {
    if (error instanceof EnvError) {
      // No tumbamos el servidor para que /api/health pueda reportar el problema,
      // pero cualquier endpoint que dependa de la configuración fallará con este mismo mensaje.
      console.error(`[env] ❌ ${error.message}`);
    } else {
      throw error;
    }
  }
}
