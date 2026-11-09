import type { BloqueSistema, MensajeClaude } from "../claude";
import { SYSTEM_PROMPT } from "../prompts/system";
import { conocimientoActivo, historialSesion, obtenerContacto, type EntradaConocimiento } from "./repo";

function formatearConocimiento(entradas: EntradaConocimiento[]): string {
  if (entradas.length === 0) {
    return "Todavía no hay información cargada. Escala cualquier consulta a una persona.";
  }
  return entradas.map((e) => `## [${e.categoria}] ${e.titulo}\n${e.contenido.trim()}`).join("\n\n");
}

function formatearContacto(contacto: Awaited<ReturnType<typeof obtenerContacto>>): string {
  const lineas = ["# Datos del contacto"];
  lineas.push(`Nombre: ${contacto?.nombre ?? "desconocido"}`);
  const memoria = Object.entries(contacto?.memoria ?? {});
  if (memoria.length === 0) {
    lineas.push("Datos guardados: ninguno todavía.");
  } else {
    lineas.push("Datos guardados en conversaciones anteriores (guardar_dato_contacto):");
    for (const [clave, valor] of memoria) lineas.push(`- ${clave}: ${String(valor)}`);
  }
  return lineas.join("\n");
}

/**
 * Arma el contexto para Claude:
 * - system[0]: prompt + base de conocimiento (estable → se cachea);
 * - system[1]: datos del contacto (cambia por usuario → va después del punto de caché);
 * - messages: últimos HISTORY_LIMIT mensajes de la sesión.
 *
 * Devuelve null si el último mensaje no es del usuario (no hay nada nuevo que responder).
 */
export async function construirContexto(params: {
  contactId: string;
  sesionId: number;
  historyLimit: number;
}): Promise<{ system: BloqueSistema[]; messages: MensajeClaude[] } | null> {
  const [conocimiento, contacto, historial] = await Promise.all([
    conocimientoActivo(),
    obtenerContacto(params.contactId),
    historialSesion(params.sesionId, params.historyLimit),
  ]);

  // La API exige empezar con "user"; además unimos mensajes seguidos del mismo rol
  // (por ejemplo, varios mensajes cortos que el usuario mandó durante el debounce).
  const messages: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of historial) {
    if (messages.length === 0 && m.rol !== "user") continue;
    const ultimo = messages[messages.length - 1];
    if (ultimo && ultimo.role === m.rol) {
      ultimo.content += `\n${m.contenido}`;
    } else {
      messages.push({ role: m.rol, content: m.contenido });
    }
  }
  if (messages.length === 0 || messages[messages.length - 1].role !== "user") return null;

  const system: BloqueSistema[] = [
    {
      type: "text",
      text: `${SYSTEM_PROMPT}\n\n# Base de conocimiento\n${formatearConocimiento(conocimiento)}`,
      cache_control: { type: "ephemeral" },
    },
    { type: "text", text: formatearContacto(contacto) },
  ];

  return { system, messages };
}
