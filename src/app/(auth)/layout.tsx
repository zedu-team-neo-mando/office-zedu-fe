"use client";
import { GoogleOAuthProvider } from "@react-oauth/google";
import { useRouter } from "next/navigation";
import React, { useContext, useEffect, useState } from "react";
import { DataContext, DataProvider } from "~/store/GlobalState";

function getLoggedInRedirectPath(orgSlugFromState?: string) {
  const storedOrgSlug = localStorage.getItem("orgSlug") || "";
  let user: {
    current_organisation_slug?: string;
    is_onboarded?: boolean;
  } | null = null;

  try {
    user = JSON.parse(localStorage.getItem("user") || "null");
  } catch {
    user = null;
  }

  const orgSlug =
    orgSlugFromState || storedOrgSlug || user?.current_organisation_slug || "";

  if (!orgSlug) return null;

  return user?.is_onboarded === false ? `/${orgSlug}/welcome` : `/${orgSlug}`;
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const { state } = useContext(DataContext);
  const { orgSlug } = state;

  useEffect(() => {
    const token = localStorage.getItem("token");
    // The desktop sign-in replaces whatever office session the WebView holds,
    // since the person signed in to desktop may have changed.
    const isDesktopSignIn = window.location.pathname.endsWith("/auth/desktop");
    if (token && !isDesktopSignIn) {
      const redirectPath = getLoggedInRedirectPath(orgSlug);
      if (redirectPath) {
        router.replace(redirectPath);
        return;
      }
    }
    setLoading(false);
  }, [orgSlug, router]);

  if (loading) return;

  return (
    <GoogleOAuthProvider clientId={process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!}>
      <DataProvider>{children}</DataProvider>
    </GoogleOAuthProvider>
  );
}
