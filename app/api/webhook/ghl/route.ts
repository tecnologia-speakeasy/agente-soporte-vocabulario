import { waitUntil } from "@vercel/functions";
import { compararSeguro } from "@/lib/auth";
import { EnvError, getEnv } from "@/lib/env";
import { procesarWebhook } from "@/lib/bot/handler";
import { registrarWebhook } from "@/lib/bot/repo";

/**
 * Tiempo máximo de la función, incluido el trabajo en segundo plano de waitUntil
 * (debounce de DEBOUNCE_SECONDS + llamadas a Claude + llamadas a GHL).
 * 60 s funciona en todos los planes de Vercel; con Fluid Compute puedes subirlo (hasta 300 s en Hobby).
 */
export const maxDuration = 60;

async function leerPayload(request: Request): Promise<unknown> {
  const tipo = request.headers.get("content-type") ?? "";
  const texto = await request.text();
  if (tipo.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(texto));
  }
  try {
    return JSON.parse(texto);
  } catch {
    return { raw: texto };
  }
}

export async function POST(request: Request) {
  let secreto: string;
  try {
    secreto = getEnv().GHL_WEBHOOK_SECRET;
  } catch (error) {
    console.error("[webhook] Configuración inválida:", error instanceof EnvError ? error.message : error);
    return Response.json({ ok: false, error: "Configuración del servidor incompleta" }, { status: 500 });
  }

  // 1. Secreto compartido con el flujo de GHL.
  if (!compararSeguro(request.headers.get("x-webhook-secret"), secreto)) {
    return Response.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  // 2. Guardar el payload crudo.
  const payload = await leerPayload(request);
  let logId: number | null = null;
  try {
    logId = await registrarWebhook(payload);
  } catch (error) {
    console.error("[webhook] No se pudo guardar en webhook_logs:", error);
  }

  // 3-13. Se procesa en segundo plano; GHL recibe 200 de inmediato y no reintenta.
  waitUntil(procesarWebhook(payload, logId));
  return Response.json({ ok: true, log_id: logId });
}
