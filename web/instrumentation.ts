/** Prints the first-run setup link once, when the server starts. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { setupAvailable, setupToken } = await import("./lib/config-store");
  if (!setupAvailable()) return;
  console.log(
    `CroCode is not set up. Open /setup?token=${setupToken()} on the dashboard address.`,
  );
}
