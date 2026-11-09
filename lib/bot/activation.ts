import {
  abrirOReactivarSesion,
  disparadoresActivos,
  expirarSesionesVencidas,
  sesionActiva,
  type Disparador,
  type Sesion,
} from "./repo";

/**
 * Normaliza un texto para comparar disparadores:
 * minúsculas, sin tildes, sin signos/emojis y sin espacios extra.
 * "¡Hola!  Necesito AYUDA 🙏" → "hola necesito ayuda"
 */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{M}+/gu, "") // tildes y diacríticos
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ") // signos de puntuación, símbolos y emojis
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Busca el disparador que coincide con el mensaje.
 * - mensaje_exacto: el mensaje normalizado es igual al disparador normalizado.
 * - palabra_clave: la palabra/frase clave aparece en el mensaje como palabra completa
 *   ("soporte vocabulario" coincide con "hola, soporte vocabulario por favor",
 *   pero "ayuda" no coincide con "ayudante").
 */
export function buscarDisparador(mensaje: string, disparadores: Disparador[]): Disparador | null {
  const normalizado = normalizar(mensaje);
  if (!normalizado) return null;

  const exacto = disparadores.find((d) => d.tipo === "mensaje_exacto" && normalizar(d.texto) === normalizado);
  if (exacto) return exacto;

  const conEspacios = ` ${normalizado} `;
  return (
    disparadores.find((d) => {
      if (d.tipo !== "palabra_clave") return false;
      const clave = normalizar(d.texto);
      return clave !== "" && conEspacios.includes(` ${clave} `);
    }) ?? null
  );
}

export type Activacion =
  | { activa: true; sesion: Sesion; motivo: "disparador" | "sesion_activa"; disparador: Disparador | null }
  | { activa: false };

/**
 * Decide si el bot debe atender este mensaje:
 * 1. Si coincide con un disparador → abre una sesión nueva (o reactiva la actual).
 * 2. Si no, pero hay una sesión activa sin vencer → continúa.
 * 3. En otro caso → el bot no responde.
 */
export async function resolverActivacion(
  contactId: string,
  texto: string,
  ttlHoras: number,
): Promise<Activacion> {
  await expirarSesionesVencidas(contactId);

  const disparador = buscarDisparador(texto, await disparadoresActivos());
  if (disparador) {
    const sesion = await abrirOReactivarSesion(contactId, disparador.id, ttlHoras);
    return { activa: true, sesion, motivo: "disparador", disparador };
  }

  const sesion = await sesionActiva(contactId);
  if (sesion) return { activa: true, sesion, motivo: "sesion_activa", disparador: null };

  return { activa: false };
}
