import { z } from "zod";
import type { HerramientaClaude } from "../claude";
import type { ClienteGhl } from "../ghl";
import { MENSAJE_TRANSICION_HUMANO } from "../prompts/system";
import {
  cambiarEstadoSesion,
  guardarDatoMemoria,
  guardarMensaje,
  obtenerContacto,
  registrarEscalado,
  registrarVerificacionCorreo,
} from "./repo";
import { correoValido, normalizarCorreo, verificarAcceso } from "./vocabulario";

/** Definición de las herramientas (orden fijo: forma parte del prefijo cacheado). */
export const HERRAMIENTAS: HerramientaClaude[] = [
  {
    name: "escalar_a_humano",
    description:
      "Pasa la conversación a una persona del equipo de Speak Easy. Úsala cuando el usuario pida una persona, " +
      "muestre molestia o repita un problema sin solución, el tema sea de pagos/reembolsos/cobros/tarjetas, " +
      "el caso requiera revisar su cuenta manualmente o la pregunta no esté en la base de conocimiento. " +
      "El sistema envía al usuario el mensaje de transición: no escribas uno tú. Después de escalar, el bot deja de responder.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        motivo: {
          type: "string",
          description:
            "Etiqueta corta del motivo, ej. correo_no_autorizado, acceso_plataforma, pago, reembolso, solicita_persona, molestia, fuera_de_alcance.",
        },
        resumen: {
          type: "string",
          description: "Resumen del caso para el equipo: qué compró, qué problema tiene, qué se intentó y datos que dio el usuario.",
        },
      },
      required: ["motivo", "resumen"],
      additionalProperties: false,
    },
  },
  {
    name: "guardar_dato_contacto",
    description:
      "Guarda un dato útil del usuario para este y futuros casos (profesión del vocabulario comprado, correo de compra, " +
      "problema reportado, dispositivo, etc.). Nunca guardes contraseñas, códigos ni datos de tarjeta.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        clave: { type: "string", description: "Nombre corto en snake_case, ej. profesion, correo_compra, problema." },
        valor: { type: "string", description: "Valor a guardar." },
      },
      required: ["clave", "valor"],
      additionalProperties: false,
    },
  },
  {
    name: "cerrar_caso",
    description:
      "Marca el caso como resuelto cuando el usuario confirma que ya quedó solucionado. Después de llamarla, " +
      "despídete con un mensaje breve. El bot queda inactivo hasta que el usuario vuelva a escribir un disparador.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        resumen: { type: "string", description: "Resumen breve de cómo se resolvió el caso." },
      },
      required: ["resumen"],
      additionalProperties: false,
    },
  },
  {
    name: "verificar_acceso_vocabulario",
    description:
      "Consulta, con el correo de compra, si el usuario tiene acceso al vocabulario (lista de correos autorizados) y, " +
      "si lo tiene, qué profesión eligió y si su vocabulario está \"lista\" o \"en_preparacion\". Devuelve " +
      "profesiones_elegidas vacío si todavía no eligió profesión. Úsala solo con el correo que el usuario dice que es " +
      "suyo. Hay un límite de consultas por conversación.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        correo: { type: "string", description: "Correo con el que el usuario compró, tal como lo escribió." },
      },
      required: ["correo"],
      additionalProperties: false,
    },
  },
];

/** Máximo de correos que se pueden verificar por sesión. */
export const MAX_VERIFICACIONES_CORREO = 3;

const EntradaEscalar = z.object({ motivo: z.string().trim().min(1).max(200), resumen: z.string().trim().min(1).max(4000) });
const EntradaGuardar = z.object({ clave: z.string().trim().min(1).max(60), valor: z.string().trim().min(1).max(1000) });
const EntradaCerrar = z.object({ resumen: z.string().trim().min(1).max(2000) });
const EntradaVerificar = z.object({ correo: z.string().trim().min(3).max(254) });

const CLAVES_SENSIBLES = /contrase|password|passwd|clave_acceso|pin\b|tarjeta|card|cvv|cvc|codigo_verificacion|otp/i;

export interface ContextoHerramientas {
  contactId: string;
  sesionId: number;
  ghl: ClienteGhl;
  motivoFieldId: string | undefined;
  /** Mensajes que se enviaron al usuario durante el turno. */
  mensajesEnviados: string[];
  estado: { escalado: boolean; cerrado: boolean };
  /** Problemas que no detienen el turno (se guardan en turnos_bot y se ven en el panel). */
  avisos: string[];
}

export interface UsoHerramienta {
  nombre: string;
  entrada: unknown;
  resultado: unknown;
  error: boolean;
}

/**
 * Escala el caso a una persona:
 * 1) mensaje de transición al usuario, 2) etiqueta requiere_humano, 3) campo motivo_escalado,
 * 4) nota con el resumen, 5) sesión "escalada" + registro en escalados.
 * La sesión se marca primero en la BD para que ningún otro webhook en curso responda mientras tanto.
 * Cada paso de GHL es independiente: si uno falla, se registra y se siguen intentando los demás.
 */
export async function escalarAHumano(
  ctx: ContextoHerramientas,
  datos: { motivo: string; resumen: string },
): Promise<{ ok: boolean; errores: string[] }> {
  if (ctx.estado.escalado) return { ok: true, errores: [] };
  ctx.estado.escalado = true;
  const errores: string[] = [];
  const intentar = async (paso: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (error) {
      const detalle = error instanceof Error ? error.message : String(error);
      console.error(`[escalado] Falló "${paso}" para ${ctx.contactId}: ${detalle}`);
      errores.push(`${paso}: ${detalle}`);
      ctx.avisos.push(`Al escalar falló "${paso}": ${detalle}`);
    }
  };

  await cambiarEstadoSesion(ctx.sesionId, "escalada");
  await registrarEscalado({ contactId: ctx.contactId, sesionId: ctx.sesionId, motivo: datos.motivo, resumen: datos.resumen });

  await intentar("mensaje de transición", async () => {
    const { messageId } = await ctx.ghl.sendWhatsApp(ctx.contactId, MENSAJE_TRANSICION_HUMANO);
    ctx.mensajesEnviados.push(MENSAJE_TRANSICION_HUMANO);
    await guardarMensaje({
      contactId: ctx.contactId,
      sesionId: ctx.sesionId,
      rol: "assistant",
      contenido: MENSAJE_TRANSICION_HUMANO,
      ghlMessageId: messageId,
    });
  });

  await intentar("etiqueta requiere_humano", () => ctx.ghl.addTags(ctx.contactId, ["requiere_humano"]));

  if (ctx.motivoFieldId) {
    const fieldId = ctx.motivoFieldId;
    await intentar("campo motivo_escalado", () => ctx.ghl.updateCustomField(ctx.contactId, fieldId, datos.motivo));
  } else {
    console.warn("[escalado] GHL_MOTIVO_ESCALADO_FIELD_ID no configurado: no se actualiza motivo_escalado.");
  }

  await intentar("nota", async () => {
    const contacto = await obtenerContacto(ctx.contactId);
    const memoria = Object.entries(contacto?.memoria ?? {})
      .map(([clave, valor]) => `- ${clave}: ${String(valor)}`)
      .join("\n");
    const nota =
      "🤖 Caso escalado por el bot de soporte (Vocabulario)\n\n" +
      `Motivo: ${datos.motivo}\n\nResumen:\n${datos.resumen}` +
      (memoria ? `\n\nDatos que dio el usuario:\n${memoria}` : "");
    await ctx.ghl.addNote(ctx.contactId, nota);
  });

  return { ok: errores.length === 0, errores };
}

/** Ejecuta una herramienta pedida por Claude. Nunca lanza: los errores vuelven como tool_result con is_error. */
export async function ejecutarHerramienta(
  nombre: string,
  entrada: unknown,
  ctx: ContextoHerramientas,
): Promise<{ contenido: string; esError: boolean }> {
  try {
    switch (nombre) {
      case "escalar_a_humano": {
        const datos = EntradaEscalar.parse(entrada);
        const r = await escalarAHumano(ctx, datos);
        return {
          contenido: r.ok
            ? "Caso escalado. Una persona continuará la conversación."
            : `Caso escalado con avisos: ${r.errores.join("; ")}`,
          esError: false,
        };
      }
      case "guardar_dato_contacto": {
        const datos = EntradaGuardar.parse(entrada);
        const clave = datos.clave
          .normalize("NFD")
          .replace(/\p{M}+/gu, "")
          .toLowerCase()
          .replace(/[^a-z0-9_]+/g, "_")
          .replace(/^_+|_+$/g, "");
        if (!clave) return { contenido: "Clave inválida.", esError: true };
        if (CLAVES_SENSIBLES.test(clave)) {
          return { contenido: "No se guardan contraseñas, códigos ni datos de tarjeta.", esError: true };
        }
        await guardarDatoMemoria(ctx.contactId, clave, datos.valor);
        return { contenido: `Dato guardado (${clave}).`, esError: false };
      }
      case "cerrar_caso": {
        const datos = EntradaCerrar.parse(entrada);
        await cambiarEstadoSesion(ctx.sesionId, "cerrada", datos.resumen);
        ctx.estado.cerrado = true;
        return { contenido: "Caso cerrado. Despídete brevemente del usuario.", esError: false };
      }
      case "verificar_acceso_vocabulario": {
        const correo = normalizarCorreo(EntradaVerificar.parse(entrada).correo);
        if (!correoValido(correo)) {
          return {
            contenido: "Ese correo no parece válido. Pídele al usuario que lo revise y lo escriba completo.",
            esError: true,
          };
        }
        if (!(await registrarVerificacionCorreo(ctx.sesionId, MAX_VERIFICACIONES_CORREO))) {
          return {
            contenido:
              `Se alcanzó el límite de ${MAX_VERIFICACIONES_CORREO} correos verificados en esta conversación. ` +
              "No verifiques más correos: si el caso no se resolvió, escala a una persona.",
            esError: true,
          };
        }
        const resultado = await verificarAcceso(correo);
        if (resultado.autorizado) await guardarDatoMemoria(ctx.contactId, "correo_compra", resultado.correo);
        return { contenido: JSON.stringify(resultado), esError: false };
      }
      default:
        return { contenido: `Herramienta desconocida: ${nombre}`, esError: true };
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { contenido: `Entrada inválida: ${error.issues.map((i) => i.message).join("; ")}`, esError: true };
    }
    console.error(`[herramientas] Error ejecutando ${nombre}:`, error);
    ctx.avisos.push(`Error en la herramienta ${nombre}: ${error instanceof Error ? error.message : String(error)}`);
    return { contenido: "Error interno al ejecutar la herramienta.", esError: true };
  }
}
