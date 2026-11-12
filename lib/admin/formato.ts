/** Formatos de fechas, números y dinero del panel (español, hora local configurable). */

export function fechaHora(fecha: Date, zona: string): string {
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: zona,
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(fecha);
}

export function fechaHoraCompleta(fecha: Date, zona: string): string {
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: zona,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(fecha);
}

export function hora(fecha: Date, zona: string): string {
  return new Intl.DateTimeFormat("es-CO", { timeZone: zona, hour: "numeric", minute: "2-digit" }).format(fecha);
}

/** "2026-11-10" → "10 nov" (el día ya viene en hora local desde la consulta). */
export function diaCorto(dia: string): string {
  const [a, m, d] = dia.split("-").map(Number);
  return new Intl.DateTimeFormat("es-CO", { timeZone: "UTC", day: "numeric", month: "short" })
    .format(new Date(Date.UTC(a, m - 1, d)))
    .replace(".", "");
}

export function numero(valor: number): string {
  return new Intl.NumberFormat("es-CO").format(valor);
}

/** 1.284 · 12,9 mil · 1,3 M */
export function numeroCompacto(valor: number): string {
  return new Intl.NumberFormat("es-CO", { notation: "compact", maximumFractionDigits: 1 }).format(valor);
}

export function porcentaje(parte: number, total: number): string {
  if (total <= 0) return "—";
  return new Intl.NumberFormat("es-CO", { style: "percent", maximumFractionDigits: 0 }).format(parte / total);
}

/** Dólares con más decimales cuando el valor es pequeño (los turnos cuestan centavos). */
export function dolares(valor: number | null): string {
  if (valor === null) return "—";
  const decimales = valor === 0 ? 2 : valor < 0.01 ? 4 : valor < 1 ? 3 : 2;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  }).format(valor);
}

export function duracion(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1).replace(".", ",")} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}

export function haceCuanto(segundos: number | null): string {
  if (segundos === null) return "nunca";
  if (segundos < 60) return "hace menos de un minuto";
  const min = Math.floor(segundos / 60);
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} días`;
}

export const NOMBRE_HERRAMIENTA: Record<string, string> = {
  verificar_acceso_vocabulario: "Verificar acceso por correo",
  escalar_a_humano: "Escalar a una persona",
  guardar_dato_contacto: "Guardar dato del contacto",
  cerrar_caso: "Cerrar caso",
};

export const ETIQUETA_ESTADO: Record<string, string> = {
  activa: "Activa",
  cerrada: "Resuelta por el bot",
  escalada: "Escalada a persona",
  expirada: "Expirada",
};

export const ETIQUETA_MOTIVO: Record<string, string> = {
  correo_no_autorizado: "Correo no autorizado",
  acceso_plataforma: "Acceso a la plataforma",
  pago: "Pago",
  reembolso: "Reembolso",
  solicita_persona: "Pidió una persona",
  molestia: "Molestia",
  fuera_de_alcance: "Fuera de alcance",
  otro_programa: "Otro programa",
  rechazo_modelo: "El modelo no respondió",
  limite_iteraciones: "Demasiados pasos",
};

export function etiquetaMotivo(motivo: string): string {
  return ETIQUETA_MOTIVO[motivo] ?? motivo.replace(/_/g, " ");
}

/** Una línea legible con el resultado de una herramienta que usó el bot. */
export function resumenHerramienta(h: { nombre: string; entrada: unknown; resultado: unknown; error: boolean }): string {
  const entrada = (h.entrada ?? {}) as Record<string, unknown>;
  const resultado = typeof h.resultado === "string" ? h.resultado : JSON.stringify(h.resultado);
  if (h.error) return resultado;

  switch (h.nombre) {
    case "verificar_acceso_vocabulario": {
      try {
        const r = JSON.parse(resultado) as {
          autorizado?: boolean;
          profesiones_elegidas?: { profesion: string; estado: string }[];
        };
        if (!r.autorizado) return "correo no autorizado";
        const profesiones = r.profesiones_elegidas ?? [];
        if (profesiones.length === 0) return "autorizado, todavía no eligió profesión";
        const lista = profesiones
          .map((p) => `${p.profesion} (${p.estado === "lista" ? "lista" : "en preparación"})`)
          .join(", ");
        return `autorizado · ${lista}`;
      } catch {
        return resultado;
      }
    }
    case "escalar_a_humano":
      return etiquetaMotivo(String(entrada.motivo ?? ""));
    case "guardar_dato_contacto":
      return `${String(entrada.clave ?? "")} = ${String(entrada.valor ?? "")}`;
    case "cerrar_caso":
      return String(entrada.resumen ?? "caso cerrado");
    default:
      return resultado;
  }
}
