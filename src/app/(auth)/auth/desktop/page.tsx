"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import Loading from "~/components/ui/loading";
import {
  exitToDesktop,
  markDesktopEmbed,
  requestZeduSession,
  storeZeduSession,
} from "~/app/(client)/[org]/_components/office/desktop-bridge";
import { Button } from "~/components/ui/button";

/**
 * Zedu Desktop opens the office here. The desktop is already signed in to
 * zedu, so its session is exchanged for an office session and the person goes
 * straight to the tower, with no second login. The zedu session is kept too:
 * channel rooms read and send their messages through zedu-be.
 */
export default function DesktopSignIn() {
  const router = useRouter();
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const signIn = async () => {
      const zeduSession = await requestZeduSession();
      if (cancelled) return;
      if (!zeduSession) {
        setFailure("Open the office from Zedu Desktop to sign in.");
        return;
      }
      markDesktopEmbed();

      // Plain fetch, not the shared axios helpers: their 401 handling clears
      // the session and opens the login page, and here a 401 only means the
      // desktop's zedu session has expired.
      let body: any = null;
      try {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_BASE_URL}/auth/zedu`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: zeduSession.token }),
          }
        );
        body = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(
            response.status === 401
              ? "Your Zedu session has expired. Sign in to Zedu Desktop again."
              : body?.message || "The office could not sign you in."
          );
        }
      } catch (error) {
        if (!cancelled) {
          setFailure(
            error instanceof Error
              ? error.message
              : "The office could not sign you in."
          );
        }
        return;
      }
      if (cancelled) return;

      const data = body?.data;
      const user = data?.user;
      const orgSlug = user?.current_organisation_slug;
      // Everything stored below is checked first, as a non-empty string, so a
      // short or odd answer never leaves a half-written session or an
      // organisation of "undefined" or "[object Object]".
      const isText = (value: unknown): value is string =>
        typeof value === "string" && value.length > 0;
      if (
        !isText(data?.access_token) ||
        !isText(orgSlug) ||
        !isText(user?.email) ||
        !isText(user?.current_org)
      ) {
        setFailure("The office could not sign you in.");
        return;
      }

      localStorage.setItem("token", data.access_token);
      localStorage.setItem("useremail", user.email);
      localStorage.setItem("user", JSON.stringify(user));
      localStorage.setItem("orgId", user.current_org);
      localStorage.setItem("orgSlug", orgSlug);
      storeZeduSession({
        ...zeduSession,
        connectUrl:
          typeof data.zedu_connect_url === "string"
            ? data.zedu_connect_url
            : "",
      });
      router.replace(`/${orgSlug}/office`);
    };

    signIn();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (failure) {
    return (
      <section className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 px-4 text-center">
        <div className="flex flex-col gap-2">
          <h1 className="text-[18px] font-[600] leading-[30px] md:text-[22px]">
            Could not open the office
          </h1>
          <p className="text-[14px] leading-[21px] text-[#344054] md:text-[16px]">
            {failure}
          </p>
        </div>
        <Button
          type="button"
          variant="default"
          className="bg-[#7141F8] py-6 text-white hover:bg-[#8760f8]"
          onClick={() => exitToDesktop()}
        >
          Back to Zedu
        </Button>
      </section>
    );
  }

  return (
    <section className="flex min-h-screen items-center justify-center">
      <Loading height="60" width="60" color="#7141F8" />
    </section>
  );
}
