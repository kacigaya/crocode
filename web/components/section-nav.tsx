"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@/components/ui/segmented-control";

/** Links to the pages of one section, styled as a segmented control. */
export function SectionNav({
  label,
  links,
}: {
  label: string;
  links: { href: string; label: string }[];
}) {
  const pathname = usePathname().replace(/\/$/, "");
  return (
    <SegmentedControl aria-label={label} render={<nav />}>
      {links.map((link) => (
        <SegmentedControlItem
          key={link.href}
          render={
            <Link
              href={link.href}
              aria-current={pathname === link.href ? "page" : undefined}
            />
          }
        >
          {link.label}
        </SegmentedControlItem>
      ))}
    </SegmentedControl>
  );
}
