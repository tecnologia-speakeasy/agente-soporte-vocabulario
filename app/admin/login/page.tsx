import type { Metadata } from "next";
import Image from "next/image";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { destinoSeguro, problemaContrasena } from "@/lib/admin/firma";
import { haySesionPanel } from "@/lib/admin/sesion";
import { FormularioLogin } from "./formulario";

export const metadata: Metadata = { title: "Entrar · Panel del bot" };

export default function PaginaLogin(props: PageProps<"/admin/login">) {
  return (
    <main className="flex flex-1 items-center justify-center bg-morado px-4 py-12">
      <div className="flex w-full max-w-sm flex-col items-center gap-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <Image src="/marca/logo-speak-easy.webp" alt="Speak Easy" width={118} height={60} priority />
          <h1 className="text-xl font-bold text-white">Panel del bot de soporte</h1>
          <p className="text-sm text-white/80">Vocabulario de Profesiones</p>
        </div>
        <div className="w-full rounded-2xl bg-superficie px-6 py-6 shadow-xl">
          <Suspense fallback={<div className="h-36" aria-hidden />}>
            <Contenido searchParams={props.searchParams} />
          </Suspense>
        </div>
      </div>
    </main>
  );
}

async function Contenido({ searchParams }: { searchParams: PageProps<"/admin/login">["searchParams"] }) {
  const parametros = await searchParams;
  const siguiente = destinoSeguro(parametros.siguiente);

  // Si ya hay una sesión válida, no tiene sentido volver a pedir la contraseña.
  if (await haySesionPanel()) redirect(siguiente);

  const problema = problemaContrasena();
  if (problema) {
    return (
      <p role="alert" className="rounded-lg bg-aviso-fondo px-3 py-2 text-sm text-aviso">
        El panel todavía no tiene contraseña. {problema}
      </p>
    );
  }
  return <FormularioLogin siguiente={siguiente} />;
}
