import type Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { llamarClaude, textoDeRespuesta, type MensajeClaude, type RespuestaClaude } from "../claude";
import { getEnv } from "../env";
import { clienteGhlReal, type ClienteGhl } from "../ghl";
import { costoEstimado } from "../precios";
import { resolverActivacion } from "./activation";
import { construirContexto } from "./context";
import { extraerDatos, tieneEtiquetaDeBloqueo, type DatosEntrantes } from "./payload";
import {
  asignarSesionAMensaje,
  cerrarWebhookLog,
  estadoSesion,
  existeMensaje,
  guardarMensaje,
  hayMensajeMasReciente,
  marcarSesionPrueba,
  registrarTurno,
  tocarSesion,
  upsertContacto,
  vincularWebhookLog,
  type Resultado,
} from "./repo";
import {
  HERRAMIENTAS,
  ejecutarHerramienta,
  escalarAHumano,
  type ContextoHerramientas,
  type UsoHerramienta,
} from "./tools";

/** Máximo de llamadas a Claude por turno (evita ciclos infinitos de herramientas). */
const MAX_ITERACIONES = 6;

export interface OpcionesProceso {
  ghl: ClienteGhl;
  /** Esperar DEBOUNCE_SECONDS para agrupar mensajes seguidos. */
  debounce: boolean;
  /** Modo prueba: si no hay etiquetas, no se consultan en GHL. */
  modoPrueba: boolean;
  /** Etiquetas simuladas (solo /api/test-chat). */
  tagsSimuladas?: string[] | null;
  /** Fila de webhook_logs de este mensaje (para enlazarla con la conversación y el turno). */
  logId?: number | null;
}

/** Tokens, costo y modelo acumulados en las llamadas a Claude de un turno. */
interface MedicionTurno {
  modelo: string | null;
  stopReason: string | null;
  llamadas: number;
  tokensEntrada: number;
  tokensCacheLectura: number;
  tokensCacheEscritura: number;
  tokensSalida: number;
  costoUsd: number;
  /** false si algún modelo no está en la tabla de precios (el costo queda sin estimar). */
  costoCompleto: boolean;
}

function nuevaMedicion(): MedicionTurno {
  return {
    modelo: null,
    stopReason: null,
    llamadas: 0,
    tokensEntrada: 0,
    tokensCacheLectura: 0,
    tokensCacheEscritura: 0,
    tokensSalida: 0,
    costoUsd: 0,
    costoCompleto: true,
  };
}

function acumularUso(m: MedicionTurno, respuesta: RespuestaClaude): void {
  const u = respuesta.usage;
  const uso = {
    entrada: u.input_tokens,
    cacheLectura: u.cache_read_input_tokens ?? 0,
    cacheEscritura: u.cache_creation_input_tokens ?? 0,
    salida: u.output_tokens,
  };
  m.llamadas++;
  m.modelo = respuesta.model;
  m.stopReason = respuesta.stop_reason ?? null;
  m.tokensEntrada += uso.entrada;
  m.tokensCacheLectura += uso.cacheLectura;
  m.tokensCacheEscritura += uso.cacheEscritura;
  m.tokensSalida += uso.salida;
  const costo = costoEstimado(respuesta.model, uso);
  if (costo === null) m.costoCompleto = false;
  else m.costoUsd += costo;
}

export interface ResultadoProceso {
  resultado: Resultado;
  detalle: string | null;
  sesionId: number | null;
  /** Texto final que generó Claude (o null si no respondió). */
  respuesta: string | null;
  /** Todo lo que se envió (o se habría enviado) al usuario. */
  mensajesEnviados: string[];
  herramientas: UsoHerramienta[];
  /** Consumo del turno (null si no se llegó a llamar a Claude). */
  consumo: { costoUsd: number | null; duracionMs: number; llamadas: number; modelo: string | null } | null;
  /** Problemas que no detuvieron el turno (p. ej. un paso de GHL que falló al escalar). */
  avisos: string[];
}

const esperar = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Id de idempotencia cuando GHL no manda message_id: hash de contacto + texto + minuto. */
function idDeRespaldo(contactId: string, texto: string): string {
  const minuto = Math.floor(Date.now() / 60_000);
  return `hash:${createHash("sha256").update(`${contactId}|${texto}|${minuto}`).digest("hex").slice(0, 40)}`;
}

/** Ajusta el texto al formato de WhatsApp por si el modelo usa markdown. */
function formatoWhatsApp(texto: string): string {
  return texto
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1: $2")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Ciclo de tool use: llama a Claude, ejecuta herramientas y repite hasta obtener el texto final. */
async function conversar(
  contexto: { system: Parameters<typeof llamarClaude>[0]["system"]; messages: MensajeClaude[] },
  ctx: ContextoHerramientas,
  herramientasUsadas: UsoHerramienta[],
  medicion: MedicionTurno,
): Promise<{ texto: string | null; detalle: string | null }> {
  const messages = [...contexto.messages];
  let textoPrevio = "";

  for (let i = 0; i < MAX_ITERACIONES; i++) {
    const respuesta = await llamarClaude({ system: contexto.system, messages, tools: HERRAMIENTAS });
    acumularUso(medicion, respuesta);

    if (respuesta.stop_reason === "refusal") {
      // Ni el modelo ni su respaldo pudieron responder: que lo atienda una persona.
      await escalarAHumano(ctx, {
        motivo: "rechazo_modelo",
        resumen: "El asistente automático no pudo responder el último mensaje del usuario. Revisar la conversación.",
      });
      return { texto: null, detalle: "Claude rechazó responder; se escaló automáticamente" };
    }

    const texto = textoDeRespuesta(respuesta);
    const usosHerramienta = respuesta.content.filter(
      (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use",
    );

    if (respuesta.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: respuesta.content });
      continue;
    }

    if (respuesta.stop_reason !== "tool_use" || usosHerramienta.length === 0) {
      // Fin del turno (end_turn, max_tokens o stop_sequence).
      return { texto: texto || textoPrevio || null, detalle: null };
    }

    if (texto) textoPrevio = texto;
    // Se reenvía el contenido completo (incluidos los bloques de thinking) tal como llegó.
    messages.push({ role: "assistant", content: respuesta.content });

    const resultados: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const uso of usosHerramienta) {
      const { contenido, esError } = await ejecutarHerramienta(uso.name, uso.input, ctx);
      herramientasUsadas.push({ nombre: uso.name, entrada: uso.input, resultado: contenido, error: esError });
      resultados.push({ type: "tool_result", tool_use_id: uso.id, content: contenido, is_error: esError });
    }

    // Tras escalar, el bot no vuelve a hablar: el mensaje de transición ya se envió.
    if (ctx.estado.escalado) return { texto: null, detalle: null };

    messages.push({ role: "user", content: resultados });
  }

  await escalarAHumano(ctx, {
    motivo: "limite_iteraciones",
    resumen: "El asistente automático no logró completar la respuesta (demasiados pasos). Revisar la conversación.",
  });
  return { texto: null, detalle: `Se alcanzó el límite de ${MAX_ITERACIONES} iteraciones; se escaló automáticamente` };
}

/** Flujo completo para un mensaje entrante (pasos 5 a 12 del webhook). */
export async function procesarMensaje(datos: DatosEntrantes, opciones: OpcionesProceso): Promise<ResultadoProceso> {
  const env = getEnv();
  const salida: ResultadoProceso = {
    resultado: "error",
    detalle: null,
    sesionId: null,
    respuesta: null,
    mensajesEnviados: [],
    herramientas: [],
    consumo: null,
    avisos: [],
  };
  const fin =(resultado: Resultado, detalle: string | null = null): ResultadoProceso => {
    salida.resultado = resultado;
    salida.detalle = detalle;
    return salida;
  };
  const { contactId, texto } = datos;

  // 5. Idempotencia.
  const ghlMessageId = datos.messageId ?? idDeRespaldo(contactId, texto);
  if (await existeMensaje(ghlMessageId)) return fin("duplicado", `Mensaje ${ghlMessageId} ya procesado`);

  // 6. Etiquetas de bloqueo (humano / requiere_humano).
  let { nombre, telefono } = datos;
  let tags: string[];
  if (opciones.tagsSimuladas) {
    tags = opciones.tagsSimuladas;
  } else if (datos.tags && datos.tags.length > 0) {
    tags = datos.tags;
  } else if (opciones.modoPrueba) {
    tags = [];
  } else {
    const contacto = await opciones.ghl.getContact(contactId);
    tags = contacto.tags;
    nombre ??= contacto.nombre;
    telefono ??= contacto.telefono;
  }
  if (tieneEtiquetaDeBloqueo(tags)) return fin("ignorado_etiqueta", `Etiquetas: ${tags.join(", ")}`);

  // 7. Contacto y mensaje entrante.
  await upsertContacto({ contactId, nombre, telefono });
  const mensajeId = await guardarMensaje({ contactId, sesionId: null, rol: "user", contenido: texto, ghlMessageId });
  if (mensajeId === null) return fin("duplicado", `Mensaje ${ghlMessageId} ya procesado`);

  // 8. Activación.
  const activacion = await resolverActivacion(contactId, texto, env.SESSION_TTL_HOURS);
  if (!activacion.activa) return fin("ignorado_sin_sesion", "Sin disparador y sin sesión activa");
  const sesionId = activacion.sesion.id;
  salida.sesionId = sesionId;
  await asignarSesionAMensaje(mensajeId, sesionId);
  if (opciones.logId != null) await vincularWebhookLog(opciones.logId, contactId, sesionId);
  if (opciones.modoPrueba) await marcarSesionPrueba(sesionId);

  // 9. Debounce: si llega otro mensaje del mismo contacto, ese se encarga de responder.
  if (opciones.debounce && env.DEBOUNCE_SECONDS > 0) {
    await esperar(env.DEBOUNCE_SECONDS * 1000);
    if (await hayMensajeMasReciente(contactId, mensajeId)) {
      return fin("debounce", "Llegó un mensaje más reciente; ese responderá");
    }
  }
  if ((await estadoSesion(sesionId)) !== "activa") {
    return fin("ignorado_sin_sesion", "La sesión dejó de estar activa antes de responder");
  }

  const ctx: ContextoHerramientas = {
    contactId,
    sesionId,
    ghl: opciones.ghl,
    motivoFieldId: env.GHL_MOTIVO_ESCALADO_FIELD_ID,
    mensajesEnviados: salida.mensajesEnviados,
    estado: { escalado: false, cerrado: false },
    avisos: salida.avisos,
  };
  const medicion = nuevaMedicion();

  const responder = async (): Promise<ResultadoProceso> => {
    // 10. Contexto.
    const contexto = await construirContexto({ contactId, sesionId, historyLimit: env.HISTORY_LIMIT });
    if (!contexto) return fin("debounce", "No hay mensajes nuevos del usuario para responder");

    // 11. Claude + herramientas.
    const { texto: textoClaude, detalle } = await conversar(contexto, ctx, salida.herramientas, medicion);

    if (ctx.estado.escalado) return fin("escalado", detalle);

    const respuesta = textoClaude ? formatoWhatsApp(textoClaude) : null;
    salida.respuesta = respuesta;
    if (!respuesta) return fin("respondido", "Claude no devolvió texto; no se envió nada");

    // Otro webhook pudo escalar la sesión mientras respondíamos.
    const estadoActual = await estadoSesion(sesionId);
    if (!(estadoActual === "activa" || (estadoActual === "cerrada" && ctx.estado.cerrado))) {
      return fin("ignorado_sin_sesion", `La sesión pasó a "${estadoActual}" antes de enviar la respuesta`);
    }

    // 12. Enviar, guardar y actualizar la sesión.
    const { messageId } = await opciones.ghl.sendWhatsApp(contactId, respuesta);
    salida.mensajesEnviados.push(respuesta);
    await guardarMensaje({ contactId, sesionId, rol: "assistant", contenido: respuesta, ghlMessageId: messageId });
    await tocarSesion(sesionId);

    return fin("respondido", ctx.estado.cerrado ? "Caso cerrado por el bot" : null);
  };

  // El turno queda registrado en turnos_bot (herramientas, tokens, costo, tiempo y errores) para el panel.
  const iniciadoEn = new Date();
  const inicio = performance.now();
  let errorTurno: unknown = null;
  try {
    return await responder();
  } catch (error) {
    errorTurno = error;
    throw error;
  } finally {
    const duracionMs = performance.now() - inicio;
    const costoUsd = medicion.costoCompleto ? medicion.costoUsd : null;
    if (medicion.llamadas > 0) {
      salida.consumo = { costoUsd, duracionMs, llamadas: medicion.llamadas, modelo: medicion.modelo };
    }
    if (medicion.llamadas > 0 || errorTurno !== null || ctx.avisos.length > 0) {
      await registrarTurno({
        contactId,
        sesionId,
        webhookLogId: opciones.logId ?? null,
        esPrueba: opciones.modoPrueba,
        resultado: errorTurno !== null ? "error" : salida.resultado,
        detalle: errorTurno !== null ? null : salida.detalle,
        error: errorTurno !== null ? describirError(errorTurno) : null,
        modelo: medicion.modelo,
        stopReason: medicion.stopReason,
        llamadas: medicion.llamadas,
        tokensEntrada: medicion.tokensEntrada,
        tokensCacheLectura: medicion.tokensCacheLectura,
        tokensCacheEscritura: medicion.tokensCacheEscritura,
        tokensSalida: medicion.tokensSalida,
        costoUsd,
        duracionMs,
        herramientas: salida.herramientas,
        avisos: ctx.avisos,
        iniciadoEn,
      }).catch((e) => console.error("[bot] No se pudo registrar el turno en turnos_bot:", e));
    }
  }
}

function describirError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/** Procesa un webhook de GHL ya registrado en webhook_logs (se ejecuta dentro de waitUntil). */
export async function procesarWebhook(payload: unknown, logId: number | null): Promise<void> {
  let resultado: Resultado = "error";
  let detalle: string | null = null;
  let contactId: string | null = null;
  try {
    const datos = extraerDatos(payload);
    if ("error" in datos) {
      detalle = datos.error;
      console.warn(`[bot] Payload inválido (log ${logId ?? "sin id"}): ${datos.error}`);
    } else {
      contactId = datos.contactId;
      const r = await procesarMensaje(datos, { ghl: clienteGhlReal, debounce: true, modoPrueba: false, logId });
      resultado = r.resultado;
      detalle = r.detalle;
      console.log(`[bot] contacto=${datos.contactId} resultado=${resultado}${detalle ? ` detalle="${detalle}"` : ""}`);
    }
  } catch (error) {
    resultado = "error";
    detalle = describirError(error);
    console.error("[bot] Error procesando webhook:", error);
  }

  if (logId !== null) {
    try {
      await cerrarWebhookLog(logId, resultado, detalle, contactId);
    } catch (error) {
      console.error("[bot] No se pudo actualizar webhook_logs:", error);
    }
  }
}
