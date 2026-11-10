"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { guardarRevisionSesion } from "@/lib/admin/datos";
import { contrasenaCorrecta, contrasenaPanel, destinoSeguro, problemaContrasena } from "@/lib/admin/firma";
import { abrirSesionPanel, cerrarSesionPanel, exigirSesionPanel } from "@/lib/admin/sesion";

export interface EstadoLogin {
  error: string | null;
}

export async function iniciarSesion(_previo: EstadoLogin, formData: FormData): Promise<EstadoLogin> {
  const contrasena = contrasenaPanel();
  if (!contrasena) return { error: problemaContrasena() ?? "La contraseña del panel no está configurada." };

  const escrita = String(formData.get("contrasena") ?? "");
  if (!escrita || !contrasenaCorrecta(escrita, contrasena)) {
    // Una pequeña espera hace más lento probar contraseñas por fuerza bruta.
    await new Promise((resolve) => setTimeout(resolve, 800));
    return { error: "La contraseña no es correcta." };
  }

  await abrirSesionPanel(contrasena);
  redirect(destinoSeguro(formData.get("siguiente")));
}

export async function cerrarSesion(): Promise<void> {
  await cerrarSesionPanel();
  redirect("/admin/login");
}

/** Marca una conversación como bien o mal atendida por el bot (o quita la marca). */
export async function guardarRevision(sesionId: number, formData: FormData): Promise<void> {
  await exigirSesionPanel();
  if (!Number.isInteger(sesionId) || sesionId <= 0) return;

  const valor = formData.get("revision");
  const revision = valor === "bien" || valor === "mal" ? valor : null;
  const nota = String(formData.get("nota") ?? "").trim().slice(0, 2000) || null;
  await guardarRevisionSesion(sesionId, revision, nota);
  refresh();
}
