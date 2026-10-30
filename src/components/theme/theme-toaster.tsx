"use client";

import { useTheme } from "next-themes";
import { usePathname } from "next/navigation";
import { Toaster } from "sonner";

export function ThemeToaster() {
  const { resolvedTheme } = useTheme();
  const pathname = usePathname();
  const isOffice = Boolean(pathname?.includes("/office"));

  return (
    <Toaster
      position={isOffice ? "top-center" : "top-right"}
      offset={isOffice ? { top: "24px" } : { top: "80px", right: "24px" }}
      richColors
      closeButton
      theme={resolvedTheme === "dark" ? "dark" : "light"}
    />
  );
}
