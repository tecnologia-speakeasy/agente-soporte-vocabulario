"use server";

import { z } from "zod";
import { NOMBRE_HERRAMIENTA, etiquetaMotivo, resumenHerramienta } from "@/lib/admin/formato";
import { haySesionPanel } from "@/lib/admin/sesion";
import { fueIgnorado, probarMensaje } from "@/lib/bot/prueba";

/** Prefijo de los contactos del chat de prueba: así nunca se toca un contacto real de GHL. */
const CONTACTO_PRUEBA = /^panel-[a-z0-9]{8,32}$/;

const Entrada = z.object({
  contacto: z.string().regex(CONTACTO_PRUEBA, "Contacto de prueba inválido"),
  mensaje: z.string().trim().min(1, "Escribe un mensaje").max(2000, "El mensaje es demasiado largo"),
  nombre: z.string().trim().max(80).optional(),
});

export interface HerramientaChat {
  etiqueta: string;
  resumen: string;
  error: boolean;
}

export type RespuestaChat =
  | {
      ok: true;
      /** Resultado del flujo (respondido, escalado, ignorado_sin_sesion…), como en webhook_logs. */
      resultado: string;
      /** El bot no atendió el mensaje (sin disparador ni conversación abierta, etc.). */
      ignorado: boolean;
      /** Explicación cuando se ignoró o algo no salió como se esperaba. */
      detalle: string | null;
      /** Lo que el usuario habría recibido por WhatsApp, en orden. */
      mensajes: string[];
      herramientas: HerramientaChat[];
      /** Lo que se habría hecho en GHL además de enviar mensajes. */
      ghl: string[];
      avisos: string[];
      sesionId: number | null;
      estado: "activa" | "escalada" | "cerrada" | null;
      costoUsd: number | null;
      duracionMs: number | null;
    }
  | { ok: false; error: string; sesionVencida?: boolean };

/** Envía un mensaje al bot como si viniera de WhatsApp, sin tocar GHL (todo queda marcado como prueba). */
export async function enviarMensajePrueba(entrada: {
  contacto: string;
  mensaje: string;
  nombre?: string;
}): Promise<RespuestaChat> {
  if (!(await haySesionPanel())) {
    return { ok: false, error: "Tu sesión del panel venció. Vuelve a entrar para seguir probando.", sesionVencida: true };
  }
  const datos = Entrada.safeParse(entrada);
  if (!datos.success) return { ok: false, error: datos.error.issues.map((i) => i.message).join(". ") };
  const { contacto, mensaje, nombre } = datos.data;

  try {
    const r = await probarMensaje({ origen: "panel", contactId: contacto, texto: mensaje, nombre: nombre || "Prueba" });

    const cerro = r.herramientas.some((h) => h.nombre === "cerrar_caso" && !h.error);
    const estado = r.resultado === "escalado" ? "escalada" : cerro ? "cerrada" : r.sesionId !== null ? "activa" : null;

    return {
      ok: true,
      resultado: r.resultado,
      ignorado: fueIgnorado(r.resultado),
      detalle: r.detalle,
      mensajes: r.mensajesEnviados,
      herramientas: r.herramientas.map((h) => ({
        etiqueta: NOMBRE_HERRAMIENTA[h.nombre] ?? h.nombre,
        resumen: resumenHerramienta(h),
        error: h.error,
      })),
      ghl: r.accionesGhl.flatMap((a) => {
        const d = a.datos;
        switch (a.accion) {
          case "addTags":
            return [`Etiqueta: ${(d.tags as string[]).join(", ")}`];
          case "updateCustomField":
            return [`Campo motivo_escalado: ${etiquetaMotivo(String(d.value))}`];
          case "addNote":
            return ["Nota con el resumen del caso"];
          default:
            return []; // sendWhatsApp ya se muestra como mensaje y getContact no aplica en pruebas.
        }
      }),
      avisos: r.avisos,
      sesionId: r.sesionId,
      estado,
      costoUsd: r.consumo?.costoUsd ?? null,
      duracionMs: r.consumo?.duracionMs ?? null,
    };
  } catch (error) {
    console.error("[panel/probar] Error:", error);
    const detalle = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return { ok: false, error: `No se pudo procesar el mensaje. ${detalle}` };
  }
}
