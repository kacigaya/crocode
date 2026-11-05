import Image from "next/image";
import Link from "next/link";
import { AVATAR_PREFIX } from "@/lib/avatar";
import { asset } from "@/lib/docs-site";

/** Logo and product name. `compact` keeps the name for screen readers only. */
export function Brand({ href, compact }: { href: string; compact?: boolean }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2.5 rounded-md text-[0.9375rem] font-extrabold"
    >
      <Image src={asset("/logo.svg")} alt="" width={28} height={20} priority />
      <span className={compact ? "sr-only" : undefined}>CroCode</span>
    </Link>
  );
}

/** Square with the first letter of an account name. */
export function Monogram({
  name,
  size = "sm",
}: {
  name: string;
  size?: "sm" | "lg";
}) {
  return (
    <span
      aria-hidden="true"
      className={
        size === "lg"
          ? "grid size-10 shrink-0 place-items-center rounded-lg border bg-card font-mono text-base font-semibold uppercase"
          : "grid size-6 shrink-0 place-items-center rounded-md border bg-card font-mono text-xs font-semibold uppercase"
      }
    >
      {name.slice(0, 1)}
    </span>
  );
}

/** GitHub account picture, or the monogram when no picture is available. */
export function Avatar({
  name,
  image,
  size = "sm",
}: {
  name: string;
  image?: string | null;
  size?: "sm" | "lg";
}) {
  if (!image?.startsWith(AVATAR_PREFIX)) return <Monogram name={name} size={size} />;
  const px = size === "lg" ? 40 : 24;
  return (
    <Image
      src={image}
      alt=""
      width={px}
      height={px}
      className={
        size === "lg"
          ? "size-10 shrink-0 rounded-lg border bg-card"
          : "size-6 shrink-0 rounded-md border bg-card"
      }
    />
  );
}
