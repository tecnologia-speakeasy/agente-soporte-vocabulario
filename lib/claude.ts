import Anthropic from "@anthropic-ai/sdk";
import { getEnv } from "./env";

export type MensajeClaude = Anthropic.Beta.BetaMessageParam;
export type BloqueSistema = Anthropic.Beta.BetaTextBlockParam;
export type HerramientaClaude = Anthropic.Beta.BetaTool;
export type RespuestaClaude = Anthropic.Beta.BetaMessage;

/**
 * Modelos con respaldo en el servidor ante rechazos (fallbacks). Claude Haiku 5.5 no lo tiene:
 * con él no se envía el parámetro y, si rechaza, el bot escala el caso (ver handler.ts).
 */
const MODELOS_CON_FALLBACK = new Set([
  "claude-opus-5-5",
  "claude-opus-5",
  "claude-sonnet-5-5",
  "claude-fable-5-2",
  "claude-fable-5-1",
]);

let cliente: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (!cliente) {
    cliente = new Anthropic({
      apiKey: getEnv().ANTHROPIC_API_KEY,
      // La ruta del webhook tiene maxDuration = 60 s: mejor fallar rápido que quedar colgado.
      timeout: 25_000,
      maxRetries: 1,
    });
  }
  return cliente;
}

/**
 * Una llamada a la API de Messages con la configuración del bot:
 * - prompt caching: el primer bloque del system (prompt + conocimiento) lleva cache_control,
 *   y el cache_control de nivel superior cachea el historial durante el ciclo de herramientas;
 * - fallbacks "default" (solo en los modelos que lo soportan): si el modelo rechaza el mensaje
 *   por políticas, la API reintenta con el modelo de respaldo que define Anthropic;
 * - effort configurable (ANTHROPIC_EFFORT, por defecto "low": respuestas cortas de chat).
 */
export async function llamarClaude(params: {
  system: BloqueSistema[];
  messages: MensajeClaude[];
  tools: HerramientaClaude[];
}): Promise<RespuestaClaude> {
  const env = getEnv();
  const conFallback = MODELOS_CON_FALLBACK.has(env.ANTHROPIC_MODEL);
  const respuesta = await getAnthropic().beta.messages.create({
    model: env.ANTHROPIC_MODEL,
    max_tokens: 16000,
    ...(conFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    cache_control: { type: "ephemeral" },
    ...(env.ANTHROPIC_EFFORT !== "none" ? { output_config: { effort: env.ANTHROPIC_EFFORT } } : {}),
    system: params.system,
    tools: params.tools,
    messages: params.messages,
  });

  const u = respuesta.usage;
  console.log(
    `[claude] modelo=${respuesta.model} stop=${respuesta.stop_reason} entrada=${u.input_tokens} ` +
      `cache_lectura=${u.cache_read_input_tokens ?? 0} cache_escritura=${u.cache_creation_input_tokens ?? 0} ` +
      `salida=${u.output_tokens}`,
  );
  return respuesta;
}

/** Une los bloques de texto de la respuesta. */
export function textoDeRespuesta(respuesta: RespuestaClaude): string {
  return respuesta.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n\n")
    .trim();
}
