import Image from "next/image";
import Link from "next/link";

export function Brand({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2.5 rounded-md text-[0.9375rem] font-semibold"
    >
      <Image src="/logo.svg" alt="" width={28} height={20} priority />
      CroCode
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
