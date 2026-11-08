"use client";

import { useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Power, RefreshCw } from "lucide-react";
import { DataContext } from "~/store/GlobalState";
import OfficeDemo from "~/app/office/_components/OfficeDemo";
import { LiveOfficeSource, OfficeDisabledError } from "./live-office-source";
import { exitToDesktop, isDesktopEmbed } from "./desktop-bridge";
import { cn } from "~/lib/utils";
import { useOfficeStatus } from "~/hooks/use-office-status";
import { showError, showInfo, showSuccess } from "~/components/toast/sonner";
import { RequirePermission } from "~/components/rbac/RequirePermission";
import { PutRequest } from "~/utils/new-request";
import { clearOfficeStatusCache } from "~/lib/office/status";

/**
 * The live office. Rooms come from the organisation's real channels, direct
 * messages and people, so the building is whatever the organisation already
 * has. Nothing here is seeded.
 */
export default function LiveOfficePage() {
  const { state } = useContext(DataContext);
  const router = useRouter();
  const orgId = state?.orgId ?? "";
  const orgSlug = state?.orgSlug ?? "";
  // Presence and room ownership are keyed by the account id. The session's
  // `id` can be a profile id, so prefer `user_id`, the same field the 2D client
  // sends with every message.
  const userId = state?.user?.user_id ?? state?.user?.id ?? "";
  const officeEnabled = useOfficeStatus(orgSlug);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const source = useMemo(() => new LiveOfficeSource(), []);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!orgId || !userId || officeEnabled !== true) return;

    let cancelled = false;
    setReady(false);
    setError(null);

    source
      .init(orgId, userId, state?.user?.username)
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;

        // An administrator switched the office off while the user was in it.
        // Re-reading the setting shows the switched-off card, with its way
        // back, instead of dropping them somewhere else.
        if (cause instanceof OfficeDisabledError) {
          showInfo("The office was switched off for your organisation.");
          clearOfficeStatusCache();
          return;
        }

        setError(
          cause instanceof Error
            ? cause.message
            : "The office could not be loaded right now."
        );
      });

    return () => {
      cancelled = true;
    };
  }, [source, orgId, userId, reloadKey, officeEnabled]);

  if (!orgId || !userId || !orgSlug) {
    return (
      <StatusCard
        title="Pick an organisation first"
        body="The office belongs to an organisation. Choose one from the sidebar and the building will open."
      />
    );
  }

  if (officeEnabled === false) {
    return (
      <StatusCard
        title="The office is switched off"
        body="This organisation has not switched The Office on. An owner or administrator can turn it on for everyone."
        action={<OfficeOffActions orgSlug={orgSlug} />}
      />
    );
  }

  if (officeEnabled === null) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="office-glass flex items-center gap-3 rounded-2xl px-5 py-4">
          <Loader2 className="h-4 w-4 animate-spin text-[#a78bfa]" />
          <p className="text-[0.82rem] font-bold text-[#d6dcf0]">
            Checking the office for{" "}
            {state?.orgData?.name ?? "your organisation"}…
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <StatusCard
        title="The office could not open"
        body={error}
        action={
          <button
            type="button"
            onClick={() => setReloadKey((value) => value + 1)}
            className="flex items-center gap-2 rounded-xl bg-[#8b5cf6] px-4 py-2.5 text-[0.78rem] font-extrabold text-white transition-colors hover:bg-[#7c4df0]"
          >
            <RefreshCw className="h-4 w-4" />
            Try again
          </button>
        }
      />
    );
  }

  if (!ready) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="office-glass flex items-center gap-3 rounded-2xl px-5 py-4">
          <Loader2 className="h-4 w-4 animate-spin text-[#a78bfa]" />
          <p className="text-[0.82rem] font-bold text-[#d6dcf0]">
            Opening the office for {state?.orgData?.name ?? "your organisation"}
            …
          </p>
        </div>
      </div>
    );
  }

  return (
    <OfficeDemo
      source={source}
      self={{
        id: userId,
        name: state?.user?.username ?? "You",
        role: state?.user?.title || state?.orgData?.user_role?.role_name || "",
      }}
      onExit={async () => {
        // Inside Zedu Desktop, leaving closes the office and returns to the
        // desktop app; in a browser it returns to the organisation's chat.
        if (await exitToDesktop()) return;
        router.push(`/${orgSlug}`);
      }}
    />
  );
}

/**
 * What someone can do in an organisation whose office is off: go back, and,
 * for owners and administrators, switch it on without leaving for the
 * settings. The switch is shown on the same permission as the settings page.
 */
function OfficeOffActions({ orgSlug }: { orgSlug: string }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  // Read after mounting: the server render cannot see the desktop app.
  const [embedded, setEmbedded] = useState(false);

  useEffect(() => {
    setEmbedded(isDesktopEmbed());
  }, []);

  async function goBack() {
    // Inside Zedu Desktop this closes the office and returns to the app; in a
    // browser it returns to the organisation's chat.
    if (await exitToDesktop()) return;
    router.push(`/${orgSlug}`);
  }

  async function turnOn() {
    setSaving(true);
    let response: any;
    try {
      response = await PutRequest("/office/settings", { enabled: true });
    } catch {
      // The request can throw before it is sent, e.g. when storage is blocked;
      // the button must come back with an error rather than stay disabled.
      response = null;
    } finally {
      setSaving(false);
    }

    const status = response?.status ?? response?.response?.status;
    if (typeof status !== "number" || status >= 400) {
      showError("The office could not be switched on.");
      return;
    }

    showSuccess("The office is on for your organisation.");
    // The page and the rail both read the cached setting; this reloads it and
    // opens the building.
    clearOfficeStatusCache();
  }

  return (
    <div className="flex flex-wrap items-center justify-center gap-3">
      <button
        type="button"
        onClick={goBack}
        className="rounded-xl border border-white/15 px-4 py-2.5 text-[0.78rem] font-extrabold text-[#d6dcf0] transition-colors hover:bg-white/10"
      >
        {embedded ? "Back to Zedu" : "Back to chat"}
      </button>
      <RequirePermission permission="manage:organization">
        <button
          type="button"
          onClick={turnOn}
          disabled={saving}
          className="flex items-center gap-2 rounded-xl bg-[#8b5cf6] px-4 py-2.5 text-[0.78rem] font-extrabold text-white transition-colors hover:bg-[#7c4df0] disabled:opacity-60"
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Power className="h-4 w-4" />
          )}
          Turn the office on
        </button>
      </RequirePermission>
    </div>
  );
}

function StatusCard({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="office-glass-strong w-full max-w-md rounded-3xl p-6 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#f43f5e]/15 text-[#fb7185]">
          <AlertTriangle className="h-6 w-6" />
        </span>
        <h1 className="mt-4 text-xl font-black tracking-tight text-white">
          {title}
        </h1>
        <p className="mt-2 text-[0.82rem] leading-relaxed text-[#8f98b2]">
          {body}
        </p>
        <div className={cn("mt-5 flex justify-center")}>{action}</div>
      </div>
    </div>
  );
}
