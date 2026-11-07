import { Metadata } from "next";
import { ReactNode } from "react";

// Reached only from inside Zedu Desktop: keep it out of search results.
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default function DesktopSignInLayout({
  children,
}: {
  children: ReactNode;
}) {
  return children;
}
