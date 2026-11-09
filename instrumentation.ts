/** Next.js ejecuta register() una vez al arrancar el servidor. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validarEnvAlArrancar } = await import("./lib/env");
    validarEnvAlArrancar();
  }
}
