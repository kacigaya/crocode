"use server";

import { setupAvailable, setupToken } from "@/lib/config";
import {
  buildManifest,
  manifestTarget,
  parseOrigin,
  safeEqual,
  signState,
  validOwner,
} from "@/lib/setup";

export type SetupState =
  | { status: "idle" }
  | { status: "error"; message: string; field?: "token" | "url" | "name" | "owner" }
  | { status: "ready"; action: string; manifest: string };

export async function prepareManifest(
  _previous: SetupState,
  form: FormData,
): Promise<SetupState> {
  if (!setupAvailable())
    return { status: "error", message: "This instance is already set up." };
  const field = (name: string) => String(form.get(name) ?? "").trim();
  const token = setupToken();
  if (!safeEqual(field("token"), token))
    return {
      status: "error",
      field: "token",
      message: "The setup token is wrong. Copy it from the dashboard logs.",
    };
  const origin = parseOrigin(field("url"));
  if (!origin)
    return {
      status: "error",
      field: "url",
      message: "Enter the public HTTPS address with no path, for example https://crocode.example.com.",
    };
  const name = field("name");
  if (!name || name.length > 34)
    return { status: "error", field: "name", message: "Enter an app name of 1 to 34 characters." };
  const owner = field("owner");
  if (owner && !validOwner(owner))
    return { status: "error", field: "owner", message: "Enter a valid organization name, or leave it empty." };
  const webUrl = (process.env.GITHUB_WEB_URL?.trim() || "https://github.com").replace(/\/$/, "");
  return {
    status: "ready",
    action: manifestTarget(webUrl, owner, signState(token, origin, owner)),
    manifest: JSON.stringify(buildManifest(origin, name)),
  };
}
