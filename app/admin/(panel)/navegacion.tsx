"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";

const ENLACES = [
  { href: "/admin", segmento: null, texto: "Resumen", corto: null },
  { href: "/admin/conversaciones", segmento: "conversaciones", texto: "Conversaciones", corto: null },
  { href: "/admin/errores", segmento: "errores", texto: "Errores", corto: null },
  { href: "/admin/probar", segmento: "probar", texto: "Probar el bot", corto: "Probar" },
] as const;

/** Menú con la sección actual resaltada (lee la URL: va dentro de <Suspense>). */
export function Navegacion() {
  const segmento = useSelectedLayoutSegment();
  return <Enlaces segmento={segmento} />;
}

/** El mismo menú sin resaltar, para mostrar mientras se resuelve la URL. */
export function NavegacionSinSeleccion() {
  return <Enlaces segmento={undefined} />;
}

function Enlaces({ segmento }: { segmento: string | null | undefined }) {
  return (
    // En pantallas angostas ocupa su propia fila (debajo del logo y "Cerrar sesión"); desde lg va en la misma línea.
    <nav
      aria-label="Secciones del panel"
      className="order-last -mx-2 flex w-[calc(100%+1rem)] gap-0.5 overflow-x-auto lg:order-none lg:mx-0 lg:w-auto lg:gap-1"
    >
      {ENLACES.map((enlace) => {
        const activo = segmento !== undefined && segmento === enlace.segmento;
        return (
          <Link
            key={enlace.href}
            href={enlace.href}
            aria-current={activo ? "page" : undefined}
            className={`border-b-2 px-2 py-2 text-[13px] font-semibold whitespace-nowrap transition-colors sm:px-3 sm:text-sm ${
              activo ? "border-fucsia text-white" : "border-transparent text-white/75 hover:text-white"
            }`}
          >
            {enlace.corto ? (
              <>
                <span className="sm:hidden">{enlace.corto}</span>
                <span className="hidden sm:inline">{enlace.texto}</span>
              </>
            ) : (
              enlace.texto
            )}
          </Link>
        );
      })}
    </nav>
  );
}
