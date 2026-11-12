import { randomUUID } from "node:crypto";
import { crearClienteGhlSimulado, type AccionGhlSimulada } from "../ghl";
import { procesarMensaje, type ResultadoProceso } from "./handler";
import { cerrarWebhookLog, registrarWebhook } from "./repo";

/**
 * Simulador del bot: ejecuta el mismo flujo del webhook pero SIN llamar a GHL.
 * Usa Claude y la base de datos reales; todo queda marcado como prueba.
 * Lo usan /api/test-chat y el chat de prueba del panel (/admin/probar).
 */

export interface EntradaPrueba {
  contactId: string;
  texto: string;
  nombre?: string | null;
  telefono?: string | null;
  /** Por defecto cada prueba usa un id único; uno fijo sirve para probar la idempotencia. */
  messageId?: string | null;
  /** Esperar DEBOUNCE_SECONDS como en producción (por defecto no). */
  debounce?: boolean;
  /** Etiquetas simuladas del contacto. */
  tags?: string[] | null;
  /** De dónde viene la prueba (queda en el payload de webhook_logs). */
  origen: "test-chat" | "panel";
}

export interface ResultadoPrueba extends ResultadoProceso {
  /** Lo que se habría hecho en GHL (mensajes, etiquetas, campo y nota). */
  accionesGhl: AccionGhlSimulada[];
}

export async function probarMensaje(entrada: EntradaPrueba): Promise<ResultadoPrueba> {
  const ghl = crearClienteGhlSimulado();
  const logId = await registrarWebhook(
    {
      _origen: entrada.origen,
      contact_id: entrada.contactId,
      message: entrada.texto,
      nombre: entrada.nombre ?? undefined,
      telefono: entrada.telefono ?? undefined,
      message_id: entrada.messageId ?? undefined,
      simulate_tags: entrada.tags ?? undefined,
    },
    true,
  );

  try {
    const r = await procesarMensaje(
      {
        contactId: entrada.contactId,
        texto: entrada.texto,
        messageId: entrada.messageId ?? `test:${randomUUID()}`,
        nombre: entrada.nombre ?? null,
        telefono: entrada.telefono ?? null,
        tags: null,
      },
      { ghl, debounce: entrada.debounce ?? false, modoPrueba: true, tagsSimuladas: entrada.tags ?? null, logId },
    );
    await cerrarWebhookLog(logId, r.resultado, r.detalle, entrada.contactId);
    return { ...r, accionesGhl: ghl.acciones };
  } catch (error) {
    const detalle = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    await cerrarWebhookLog(logId, "error", detalle, entrada.contactId).catch(() => {});
    throw error;
  }
}

/** ¿El resultado significa que el bot no atendió el mensaje? */
export function fueIgnorado(resultado: string): boolean {
  return resultado.startsWith("ignorado") || resultado === "duplicado" || resultado === "debounce";
}
