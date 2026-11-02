"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth, requireSameOrigin } from "@/lib/auth";

export async function signIn() {
  await requireSameOrigin();
  const { url } = await getAuth().api.signInSocial({
    body: {
      provider: "github",
      callbackURL: "/installations",
      errorCallbackURL: "/",
    },
    headers: await headers(),
  });
  if (!url) redirect("/?auth=failed");
  redirect(url);
}

export async function signOut() {
  await requireSameOrigin();
  await getAuth().api.signOut({ headers: await headers() });
  redirect("/");
}
