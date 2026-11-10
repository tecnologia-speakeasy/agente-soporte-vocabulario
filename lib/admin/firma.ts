import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Sesión del panel /admin: una cookie firmada con HMAC que solo guarda la fecha de vencimiento.
 * La clave se deriva de la contraseña, así que cambiar la contraseña cierra todas las sesiones.
 * Sin dependencias de Next para poder usarla también en proxy.ts.
 */

export const COOKIE_PANEL = "panel_sesion";
export const DURACION_SESION_S = 7 * 24 * 60 * 60;
const LARGO_MINIMO = 10;

/**
 * Contraseña del panel: PANEL_PASSWORD o, si no está, ADMIN_TOKEN.
 * Devuelve null si no hay ninguna o si PANEL_PASSWORD es demasiado corta.
 */
export function contrasenaPanel(): string | null {
  const panel = process.env.PANEL_PASSWORD?.trim();
  if (panel) return panel.length >= LARGO_MINIMO ? panel : null;
  return process.env.ADMIN_TOKEN?.trim() || null;
}

/** Explica por qué no hay contraseña configurada (para mostrarlo en el login). */
export function problemaContrasena(): string | null {
  const panel = process.env.PANEL_PASSWORD?.trim();
  if (panel && panel.length < LARGO_MINIMO) {
    return `PANEL_PASSWORD debe tener al menos ${LARGO_MINIMO} caracteres.`;
  }
  if (!panel && !process.env.ADMIN_TOKEN?.trim()) {
    return "Configura PANEL_PASSWORD (o ADMIN_TOKEN) en las variables de entorno.";
  }
  return null;
}

function clave(contrasena: string): Buffer {
  return createHash("sha256").update(`panel-sesion:${contrasena}`).digest();
}

function firmar(contrasena: string, texto: string): Buffer {
  return createHmac("sha256", clave(contrasena)).update(texto).digest();
}

export function crearValorSesion(contrasena: string, ahoraMs: number): string {
  const vence = String(Math.floor(ahoraMs / 1000) + DURACION_SESION_S);
  return `${vence}.${firmar(contrasena, vence).toString("base64url")}`;
}

export function sesionValida(valor: string | undefined, contrasena: string | null, ahoraMs: number): boolean {
  if (!valor || !contrasena) return false;
  const [vence, firma] = valor.split(".");
  const venceS = Number(vence);
  if (!Number.isInteger(venceS) || !firma || venceS * 1000 <= ahoraMs) return false;
  const esperada = firmar(contrasena, vence);
  const recibida = Buffer.from(firma, "base64url");
  return recibida.length === esperada.length && timingSafeEqual(recibida, esperada);
}

/** Compara la contraseña escrita con la configurada en tiempo constante. */
export function contrasenaCorrecta(escrita: string, contrasena: string): boolean {
  const a = createHash("sha256").update(escrita).digest();
  const b = createHash("sha256").update(contrasena).digest();
  return timingSafeEqual(a, b);
}

/** Solo rutas internas del panel (evita redirecciones a otros sitios después del login). */
export function destinoSeguro(destino: unknown): string {
  if (typeof destino !== "string") return "/admin";
  if (!/^\/admin(\/|\?|$)/.test(destino) || destino.startsWith("/admin/login")) return "/admin";
  return destino;
}
