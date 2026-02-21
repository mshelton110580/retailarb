"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

/**
 * A Link component that preserves date range search params (range, from, to)
 * when navigating to a new filter URL.
 */
export default function FilterLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  const searchParams = useSearchParams();

  // Parse the base href to extract existing params
  const [basePath, existingQuery] = href.split("?");
  const newParams = new URLSearchParams(existingQuery ?? "");

  // Carry forward date range params and other active filters
  const range = searchParams.get("range");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const checkin = searchParams.get("checkin");

  if (range) newParams.set("range", range);
  if (from) newParams.set("from", from);
  if (to) newParams.set("to", to);
  if (checkin && !newParams.has("checkin")) newParams.set("checkin", checkin);

  const queryString = newParams.toString();
  const fullHref = queryString ? `${basePath}?${queryString}` : basePath;

  return (
    <Link href={fullHref} className={className}>
      {children}
    </Link>
  );
}
