/**
 * Precios de la API de Claude en USD por millón de tokens (tarifa estándar de Anthropic, noviembre de 2026).
 * Se usan solo para estimar el costo en el panel: la factura real está en la consola de Anthropic.
 *
 * - escrituraCache: escritura de caché de 5 minutos (la que usa el bot) = 1.25 × entrada.
 * - lecturaCache: depende del modelo (0.025× en Fable 5.1/5.2, 0.05× en Opus 5.5 y Sonnet 5.5, 0.1× en el resto).
 * Claude Haiku 5.5 cobra más por encima de 100K tokens de entrada; las conversaciones del bot quedan muy por debajo.
 * Si cambias de modelo o Anthropic cambia los precios, actualiza esta tabla.
 */
interface Precio {
  entrada: number;
  salida: number;
  escrituraCache: number;
  lecturaCache: number;
}

const PRECIOS: Record<string, Precio> = {
  "claude-fable-5-2": { entrada: 8, salida: 40, escrituraCache: 10, lecturaCache: 0.2 },
  "claude-fable-5-1": { entrada: 10, salida: 50, escrituraCache: 12.5, lecturaCache: 0.25 },
  "claude-fable-5": { entrada: 10, salida: 50, escrituraCache: 12.5, lecturaCache: 1 },
  "claude-opus-5-5": { entrada: 4, salida: 20, escrituraCache: 5, lecturaCache: 0.2 },
  "claude-opus-5": { entrada: 5, salida: 25, escrituraCache: 6.25, lecturaCache: 0.5 },
  "claude-opus-4-8": { entrada: 5, salida: 25, escrituraCache: 6.25, lecturaCache: 0.5 },
  "claude-opus-4-7": { entrada: 5, salida: 25, escrituraCache: 6.25, lecturaCache: 0.5 },
  "claude-opus-4-6": { entrada: 5, salida: 25, escrituraCache: 6.25, lecturaCache: 0.5 },
  "claude-sonnet-5-5": { entrada: 2, salida: 10, escrituraCache: 2.5, lecturaCache: 0.1 },
  "claude-sonnet-5": { entrada: 2, salida: 10, escrituraCache: 2.5, lecturaCache: 0.2 },
  "claude-sonnet-4-6": { entrada: 3, salida: 15, escrituraCache: 3.75, lecturaCache: 0.3 },
  "claude-haiku-5-5": { entrada: 0.1, salida: 0.5, escrituraCache: 0.125, lecturaCache: 0.01 },
  "claude-haiku-4-5": { entrada: 1, salida: 5, escrituraCache: 1.25, lecturaCache: 0.1 },
};

// Del id más largo al más corto, para que "claude-opus-5-5" no se confunda con "claude-opus-5".
const IDS = Object.keys(PRECIOS).sort((a, b) => b.length - a.length);

function precioDe(modelo: string): Precio | null {
  const id = IDS.find((k) => modelo === k || modelo.startsWith(`${k}-`) || modelo.startsWith(`${k}@`));
  return id ? PRECIOS[id] : null;
}

export interface UsoTokens {
  entrada: number;
  cacheLectura: number;
  cacheEscritura: number;
  salida: number;
}

/** Costo estimado en USD de una llamada, o null si el modelo no está en la tabla. */
export function costoEstimado(modelo: string, uso: UsoTokens): number | null {
  const p = precioDe(modelo);
  if (!p) return null;
  return (
    (uso.entrada * p.entrada +
      uso.cacheLectura * p.lecturaCache +
      uso.cacheEscritura * p.escrituraCache +
      uso.salida * p.salida) /
    1_000_000
  );
}
