import type { PuntoDiario } from "@/lib/admin/datos";
import { diaCorto, numero } from "@/lib/admin/formato";
import { SinDatos } from "./ui";

/**
 * Barras apiladas por día: respondidos (abajo), escalados y errores.
 * SVG generado en el servidor; cada columna tiene su detalle al pasar el cursor o enfocarla con el teclado,
 * y los mismos datos están en la vista de tabla.
 */

const SERIES = [
  {
    clave: "respondido",
    etiqueta: "Respondidos",
    color: "var(--serie-respondido)",
  },
  { clave: "escalado", etiqueta: "Escalados", color: "var(--serie-escalado)" },
  { clave: "error", etiqueta: "Errores", color: "var(--serie-error)" },
] as const;

const ANCHO = 720;
const ALTO = 240;
const MARGEN = { arriba: 12, derecha: 8, abajo: 26, izquierda: 40 };
const GAP = 2; // espacio entre segmentos, del color de la superficie
const RADIO = 4;

/** Paso "limpio" (1, 2, 5 × 10^k) para unas 4 divisiones del eje. */
function pasoLimpio(maximo: number): number {
  const bruto = Math.max(1, maximo / 4);
  const potencia = 10 ** Math.floor(Math.log10(bruto));
  const base = bruto / potencia;
  const factor = base <= 1 ? 1 : base <= 2 ? 2 : base <= 5 ? 5 : 10;
  return Math.max(1, factor * potencia);
}

/** Rectángulo con las esquinas superiores redondeadas (el extremo de la barra) y la base recta. */
function rectanguloRedondeado(x: number, y: number, ancho: number, alto: number, radio: number): string {
  const r = Math.min(radio, alto, ancho / 2);
  return [
    `M${x},${y + alto}`,
    `L${x},${y + r}`,
    `Q${x},${y} ${x + r},${y}`,
    `L${x + ancho - r},${y}`,
    `Q${x + ancho},${y} ${x + ancho},${y + r}`,
    `L${x + ancho},${y + alto}`,
    "Z",
  ].join(" ");
}

export function GraficaDiaria({ datos }: { datos: PuntoDiario[] }) {
  const totales = SERIES.map((s) => datos.reduce((suma, d) => suma + d[s.clave], 0));
  const maximoDia = Math.max(0, ...datos.map((d) => d.respondido + d.escalado + d.error));

  const leyenda = (
    <ul className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-tinta-2">
      {SERIES.map((s, i) => (
        <li key={s.clave} className="flex items-center gap-2">
          <span aria-hidden className="inline-block size-3 rounded-sm" style={{ background: s.color }} />
          {s.etiqueta}
          <span className="font-semibold text-tinta tabular">{numero(totales[i])}</span>
        </li>
      ))}
    </ul>
  );

  if (maximoDia === 0) {
    return (
      <div>
        {leyenda}
        <SinDatos>El bot no procesó mensajes en este periodo.</SinDatos>
      </div>
    );
  }

  const paso = pasoLimpio(maximoDia);
  const tope = Math.ceil(maximoDia / paso) * paso;
  const marcas = Array.from({ length: Math.round(tope / paso) + 1 }, (_, i) => i * paso);

  const anchoGrafica = ANCHO - MARGEN.izquierda - MARGEN.derecha;
  const altoGrafica = ALTO - MARGEN.arriba - MARGEN.abajo;
  const base = MARGEN.arriba + altoGrafica;
  const banda = anchoGrafica / datos.length;
  const anchoBarra = Math.min(24, Math.max(2, banda * 0.62));
  const y = (valor: number) => base - (valor / tope) * altoGrafica;

  // Etiquetas del eje X: todas si caben, si no unas 7 contando desde el último día.
  const cadaCuantos = datos.length <= 10 ? 1 : Math.ceil(datos.length / 7);
  const mostrarEtiqueta = (i: number) => (datos.length - 1 - i) % cadaCuantos === 0;

  return (
    <div>
      {leyenda}
      <div className="-mx-1 overflow-x-auto px-1">
        <svg
          viewBox={`0 0 ${ANCHO} ${ALTO}`}
          className="h-auto w-full min-w-[600px]"
          role="img"
          aria-label={`Mensajes procesados por día. Total: ${numero(totales[0])} respondidos, ${numero(totales[1])} escalados y ${numero(totales[2])} errores.`}
        >
          {marcas.map((m) => (
            <g key={m}>
              <line
                x1={MARGEN.izquierda}
                x2={ANCHO - MARGEN.derecha}
                y1={y(m)}
                y2={y(m)}
                stroke={m === 0 ? "var(--eje)" : "var(--linea)"}
                strokeWidth={1}
                shapeRendering="crispEdges"
              />
              <text
                x={MARGEN.izquierda - 8}
                y={y(m)}
                dy="0.32em"
                textAnchor="end"
                fontSize={12}
                fill="var(--tinta-3)"
                className="tabular"
              >
                {numero(m)}
              </text>
            </g>
          ))}

          {datos.map((d, i) => {
            const x0 = MARGEN.izquierda + i * banda;
            const xBarra = x0 + (banda - anchoBarra) / 2;
            const descripcion =
              `${diaCorto(d.dia)}: ${numero(d.respondido)} respondidos, ` +
              `${numero(d.escalado)} escalados, ${numero(d.error)} errores`;

            const visibles = SERIES.filter((s) => d[s.clave] > 0);
            let acumulado = 0;
            const segmentos = visibles.map((s, j) => {
              const alto = (d[s.clave] / tope) * altoGrafica;
              const arriba = base - acumulado - alto;
              acumulado += alto;
              // El espacio va debajo de cada segmento que se apoya sobre otro.
              const altoVisible = j > 0 && alto > GAP + 1 ? alto - GAP : alto;
              const esUltimo = j === visibles.length - 1;
              return esUltimo ? (
                <path
                  key={s.clave}
                  d={rectanguloRedondeado(xBarra, arriba, anchoBarra, altoVisible, RADIO)}
                  fill={s.color}
                />
              ) : (
                <rect key={s.clave} x={xBarra} y={arriba} width={anchoBarra} height={altoVisible} fill={s.color} />
              );
            });

            return (
              <g key={d.dia} className="columna-dia" tabIndex={0} aria-label={descripcion}>
                <title>{descripcion}</title>
                <rect className="fondo-columna" x={x0} y={MARGEN.arriba} width={banda} height={altoGrafica} rx={4} />
                {segmentos}
                {mostrarEtiqueta(i) && (
                  <text x={x0 + banda / 2} y={ALTO - 8} textAnchor="middle" fontSize={12} fill="var(--tinta-3)">
                    {diaCorto(d.dia)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-tinta-2 hover:text-tinta">Ver como tabla</summary>
        <div className="mt-2 max-h-72 overflow-auto">
          <table className="w-full text-left tabular">
            <thead className="sticky top-0 bg-superficie text-tinta-2">
              <tr>
                <th className="py-1 pr-4 font-semibold">Día</th>
                {SERIES.map((s) => (
                  <th key={s.clave} className="py-1 pr-4 text-right font-semibold">
                    {s.etiqueta}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {datos.map((d) => (
                <tr key={d.dia} className="border-t border-linea">
                  <td className="py-1 pr-4">{diaCorto(d.dia)}</td>
                  {SERIES.map((s) => (
                    <td key={s.clave} className="py-1 pr-4 text-right">
                      {numero(d[s.clave])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
