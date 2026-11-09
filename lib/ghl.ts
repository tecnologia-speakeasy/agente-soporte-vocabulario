import { getEnv } from "./env";

const BASE_URL = "https://services.leadconnectorhq.com";
/** Versión de la API para contactos (tags, notas, campos personalizados). */
const VERSION_CONTACTOS = "2021-07-28";
/**
 * La especificación oficial de GHL exige esta versión para /conversations/*.
 * Si en tu subcuenta funciona con 2021-07-28, puedes unificarla.
 */
const VERSION_CONVERSACIONES = "2021-04-15";

const MAX_INTENTOS = 3;
const TIMEOUT_MS = 15_000;

export class GhlError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly cuerpo: string,
  ) {
    super(message);
    this.name = "GhlError";
  }
}

export interface GhlContacto {
  id: string;
  nombre: string | null;
  telefono: string | null;
  tags: string[];
}

const esperar = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function esperaPorRetryAfter(res: Response): number | null {
  const valor = res.headers.get("retry-after");
  if (!valor) return null;
  const segundos = Number(valor);
  if (Number.isFinite(segundos)) return Math.min(segundos * 1000, 10_000);
  const fecha = Date.parse(valor);
  return Number.isNaN(fecha) ? null : Math.min(Math.max(fecha - Date.now(), 0), 10_000);
}

async function solicitud<T>(
  metodo: "GET" | "POST" | "PUT",
  ruta: string,
  opciones: { body?: unknown; version?: string } = {},
): Promise<T> {
  const { GHL_API_TOKEN } = getEnv();
  const version = opciones.version ?? VERSION_CONTACTOS;

  for (let intento = 1; ; intento++) {
    const inicio = Date.now();
    let res: Response;
    try {
      res = await fetch(`${BASE_URL}${ruta}`, {
        method: metodo,
        headers: {
          Authorization: `Bearer ${GHL_API_TOKEN}`,
          Version: version,
          Accept: "application/json",
          ...(opciones.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: opciones.body !== undefined ? JSON.stringify(opciones.body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      const detalle = error instanceof Error ? error.message : String(error);
      // Solo reintentamos errores de red en lecturas, para no duplicar mensajes enviados.
      if (metodo === "GET" && intento < MAX_INTENTOS) {
        console.warn(`[ghl] ${metodo} ${ruta} → error de red (${detalle}), reintento ${intento}/${MAX_INTENTOS - 1}`);
        await esperar(500 * 3 ** (intento - 1));
        continue;
      }
      console.error(`[ghl] ${metodo} ${ruta} → error de red: ${detalle}`);
      throw new GhlError(`Error de red llamando a GHL (${metodo} ${ruta}): ${detalle}`, 0, "");
    }

    const ms = Date.now() - inicio;
    const texto = await res.text();

    if (res.ok) {
      console.log(`[ghl] ${metodo} ${ruta} → ${res.status} (${ms} ms)`);
      if (!texto) return {} as T;
      try {
        return JSON.parse(texto) as T;
      } catch {
        return {} as T;
      }
    }

    const reintentable = res.status === 429 || res.status >= 500;
    if (reintentable && intento < MAX_INTENTOS) {
      const espera = esperaPorRetryAfter(res) ?? 500 * 3 ** (intento - 1);
      console.warn(
        `[ghl] ${metodo} ${ruta} → ${res.status} (${ms} ms), reintento ${intento}/${MAX_INTENTOS - 1} en ${espera} ms`,
      );
      await esperar(espera);
      continue;
    }

    console.error(`[ghl] ${metodo} ${ruta} → ${res.status} (${ms} ms): ${texto.slice(0, 500)}`);
    throw new GhlError(`GHL respondió ${res.status} en ${metodo} ${ruta}`, res.status, texto);
  }
}

const idContacto = (contactId: string) => encodeURIComponent(contactId);

function textoONulo(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() !== "" ? valor.trim() : null;
}

/** Envía un mensaje de WhatsApp al contacto. */
export async function sendWhatsApp(contactId: string, message: string): Promise<{ messageId: string | null }> {
  const data = await solicitud<{ messageId?: string }>("POST", "/conversations/messages", {
    version: VERSION_CONVERSACIONES,
    body: { type: "WhatsApp", contactId, message },
  });
  return { messageId: textoONulo(data.messageId) };
}

/** Obtiene el contacto (nombre, teléfono y etiquetas). */
export async function getContact(contactId: string): Promise<GhlContacto> {
  const data = await solicitud<{ contact?: Record<string, unknown> }>("GET", `/contacts/${idContacto(contactId)}`);
  const c = data.contact ?? {};
  const nombreCompleto = [textoONulo(c.firstName), textoONulo(c.lastName)].filter(Boolean).join(" ");
  return {
    id: textoONulo(c.id) ?? contactId,
    nombre: textoONulo(c.contactName) ?? textoONulo(c.name) ?? (nombreCompleto || null),
    telefono: textoONulo(c.phone),
    tags: Array.isArray(c.tags) ? c.tags.filter((t): t is string => typeof t === "string") : [],
  };
}

/** Agrega etiquetas al contacto (no borra las existentes). */
export async function addTags(contactId: string, tags: string[]): Promise<void> {
  await solicitud("POST", `/contacts/${idContacto(contactId)}/tags`, { body: { tags } });
}

/** Actualiza un campo personalizado del contacto. */
export async function updateCustomField(contactId: string, fieldId: string, value: string): Promise<void> {
  await solicitud("PUT", `/contacts/${idContacto(contactId)}`, {
    body: { customFields: [{ id: fieldId, field_value: value }] },
  });
}

/** Crea una nota en el contacto. */
export async function addNote(contactId: string, body: string): Promise<void> {
  await solicitud("POST", `/contacts/${idContacto(contactId)}/notes`, { body: { body } });
}

/** Interfaz que usa el bot; permite cambiar GHL real por uno simulado en /api/test-chat. */
export interface ClienteGhl {
  sendWhatsApp(contactId: string, message: string): Promise<{ messageId: string | null }>;
  getContact(contactId: string): Promise<GhlContacto>;
  addTags(contactId: string, tags: string[]): Promise<void>;
  updateCustomField(contactId: string, fieldId: string, value: string): Promise<void>;
  addNote(contactId: string, body: string): Promise<void>;
}

export const clienteGhlReal: ClienteGhl = { sendWhatsApp, getContact, addTags, updateCustomField, addNote };

export interface AccionGhlSimulada {
  accion: keyof ClienteGhl;
  datos: Record<string, unknown>;
}

/** Cliente que no llama a GHL: registra lo que se habría hecho. */
export function crearClienteGhlSimulado(): ClienteGhl & { acciones: AccionGhlSimulada[] } {
  const acciones: AccionGhlSimulada[] = [];
  return {
    acciones,
    async sendWhatsApp(contactId, message) {
      acciones.push({ accion: "sendWhatsApp", datos: { contactId, message } });
      return { messageId: null };
    },
    async getContact(contactId) {
      acciones.push({ accion: "getContact", datos: { contactId } });
      return { id: contactId, nombre: null, telefono: null, tags: [] };
    },
    async addTags(contactId, tags) {
      acciones.push({ accion: "addTags", datos: { contactId, tags } });
    },
    async updateCustomField(contactId, fieldId, value) {
      acciones.push({ accion: "updateCustomField", datos: { contactId, fieldId, value } });
    },
    async addNote(contactId, body) {
      acciones.push({ accion: "addNote", datos: { contactId, body } });
    },
  };
}
