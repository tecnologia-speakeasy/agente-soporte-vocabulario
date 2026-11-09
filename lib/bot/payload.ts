/**
 * Extracción tolerante de los datos del webhook de GHL.
 *
 * El flujo envía "datos personalizados" (contact_id, message_body, nombre, telefono, tags),
 * que GHL puede poner en la raíz o dentro de `customData`. También se aceptan los campos
 * estándar del contacto/mensaje (contactId, message.body, full_name, phone, tags...).
 */

export interface DatosEntrantes {
  contactId: string;
  texto: string;
  messageId: string | null;
  nombre: string | null;
  telefono: string | null;
  /** null = el payload no trajo etiquetas. */
  tags: string[] | null;
}

type Registro = Record<string, unknown>;

const esRegistro = (v: unknown): v is Registro => typeof v === "object" && v !== null && !Array.isArray(v);

/** GHL deja el texto del merge field tal cual si no lo pudo resolver (ej. "{{contact.tags}}"). */
const esMarcadorSinResolver = (v: string) => /^\{\{.*\}\}$/.test(v.trim());

function leerRuta(origen: Registro, ruta: string): unknown {
  let actual: unknown = origen;
  for (const parte of ruta.split(".")) {
    if (!esRegistro(actual)) return undefined;
    actual = actual[parte];
  }
  return actual;
}

function fuentes(payload: Registro): Registro[] {
  const lista: Registro[] = [];
  for (const clave of ["customData", "custom_data", "customdata", "data"]) {
    const valor = payload[clave];
    if (esRegistro(valor)) lista.push(valor);
  }
  lista.push(payload);
  return lista;
}

function primerTexto(origenes: Registro[], rutas: string[]): string | null {
  for (const origen of origenes) {
    for (const ruta of rutas) {
      const valor = leerRuta(origen, ruta);
      if (typeof valor === "number") return String(valor);
      if (typeof valor === "string" && valor.trim() !== "" && !esMarcadorSinResolver(valor)) {
        return valor.trim();
      }
    }
  }
  return null;
}

function primerasEtiquetas(origenes: Registro[], rutas: string[]): string[] | null {
  for (const origen of origenes) {
    for (const ruta of rutas) {
      const valor = leerRuta(origen, ruta);
      if (Array.isArray(valor)) {
        return valor.filter((t): t is string => typeof t === "string").map((t) => t.trim()).filter(Boolean);
      }
      if (typeof valor === "string" && !esMarcadorSinResolver(valor)) {
        return valor.split(",").map((t) => t.trim()).filter(Boolean);
      }
    }
  }
  return null;
}

export function extraerDatos(payload: unknown): DatosEntrantes | { error: string } {
  if (!esRegistro(payload)) return { error: "El payload no es un objeto JSON" };
  const origenes = fuentes(payload);

  const contactId = primerTexto(origenes, ["contact_id", "contactId", "contact.id", "contact.contact_id"]);
  const texto = primerTexto(origenes, [
    "message_body",
    "messageBody",
    "message.body",
    "message.text",
    "body",
    "message",
    "text",
  ]);

  if (!contactId) return { error: "El payload no trae contact_id" };
  if (!texto) return { error: "El payload no trae el texto del mensaje (message_body)" };

  const nombreSeparado = [
    primerTexto(origenes, ["first_name", "firstName", "contact.first_name", "contact.firstName"]),
    primerTexto(origenes, ["last_name", "lastName", "contact.last_name", "contact.lastName"]),
  ]
    .filter(Boolean)
    .join(" ");

  return {
    contactId,
    texto,
    messageId: primerTexto(origenes, ["message_id", "messageId", "message.id", "message.messageId"]),
    nombre:
      primerTexto(origenes, ["nombre", "full_name", "fullName", "contact_name", "contact.name", "name"]) ??
      (nombreSeparado || null),
    telefono: primerTexto(origenes, ["telefono", "phone", "contact.phone", "phone_number"]),
    tags: primerasEtiquetas(origenes, ["tags", "contact.tags"]),
  };
}

/** Normaliza etiquetas para compararlas (minúsculas, sin espacios extra). */
export function normalizarEtiquetas(tags: string[]): string[] {
  return tags.map((t) => t.trim().toLowerCase()).filter(Boolean);
}

export const ETIQUETAS_BLOQUEO = ["humano", "requiere_humano"] as const;

export function tieneEtiquetaDeBloqueo(tags: string[]): boolean {
  const normalizadas = normalizarEtiquetas(tags);
  return ETIQUETAS_BLOQUEO.some((e) => normalizadas.includes(e));
}
