import { z } from "zod";
import { exigirAdmin } from "@/lib/auth";
import { fueIgnorado, probarMensaje } from "@/lib/bot/prueba";

export const maxDuration = 60;

const Cuerpo = z.object({
  contact_id: z.string().trim().min(1, "contact_id es obligatorio"),
  message: z.string().trim().min(1, "message es obligatorio"),
  /** Etiquetas simuladas del contacto, como arreglo o texto separado por comas. */
  simulate_tags: z
    .union([z.array(z.string()), z.string()])
    .optional()
    .transform((v) =>
      v === undefined ? undefined : (Array.isArray(v) ? v : v.split(",")).map((t) => t.trim()).filter(Boolean),
    ),
  nombre: z.string().trim().optional(),
  telefono: z.string().trim().optional(),
  /** Por defecto cada prueba usa un id único; envía uno fijo para probar la idempotencia. */
  message_id: z.string().trim().optional(),
  /** Por defecto no se espera el debounce en las pruebas. */
  debounce: z.boolean().optional().default(false),
});

/**
 * Ejecuta el mismo flujo del webhook pero SIN llamar a GHL: devuelve la respuesta,
 * las herramientas usadas, lo que se habría hecho en GHL y el motivo si se ignoró.
 * Usa la base de datos real (contactos, sesiones y mensajes quedan guardados).
 */
export async function POST(request: Request) {
  const noAutorizado = exigirAdmin(request);
  if (noAutorizado) return noAutorizado;

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ ok: false, error: "El cuerpo debe ser JSON" }, { status: 400 });
  }
  const parseado = Cuerpo.safeParse(json);
  if (!parseado.success) {
    return Response.json(
      { ok: false, error: parseado.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) },
      { status: 400 },
    );
  }
  const cuerpo = parseado.data;

  try {
    const r = await probarMensaje({
      origen: "test-chat",
      contactId: cuerpo.contact_id,
      texto: cuerpo.message,
      nombre: cuerpo.nombre,
      telefono: cuerpo.telefono,
      messageId: cuerpo.message_id,
      debounce: cuerpo.debounce,
      tags: cuerpo.simulate_tags,
    });
    const ignorado = fueIgnorado(r.resultado);
    return Response.json({
      ok: true,
      resultado: r.resultado,
      motivo_ignorado: ignorado ? r.detalle : null,
      detalle: ignorado ? null : r.detalle,
      respuesta: r.respuesta,
      mensajes_enviados: r.mensajesEnviados,
      herramientas: r.herramientas,
      acciones_ghl_simuladas: r.accionesGhl,
      sesion_id: r.sesionId,
    });
  } catch (error) {
    const detalle = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.error("[test-chat] Error:", error);
    return Response.json({ ok: false, resultado: "error", error: detalle }, { status: 500 });
  }
}
