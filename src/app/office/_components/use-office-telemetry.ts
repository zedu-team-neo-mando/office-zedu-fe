"use client";

import { useCallback, useEffect, useRef } from "react";
import type { OfficeSource } from "~/types/office";
import { getTracker, type TelemetrySession } from "~/lib/office/telemetry";

/**
 * Wires the office telemetry tracker into the live office scene.
 *
 * The tracker is a pure module (no React state). This hook owns the React
 * side: it starts the tracker when the live office is on screen, wraps the
 * engine's room/tower/floor callbacks so they emit telemetry events, and
 * stops the tracker on unmount. Nothing is sent unless
 * NEXT_PUBLIC_FF_OFFICE_ANALYTICS is "true" at build time, and demo mode is
 * always excluded.
 */
export function useOfficeTelemetry({
  source,
  active,
}: {
  source: OfficeSource;
  /** The scene is the live office and it is on screen. */
  active: boolean;
}) {
  const trackerRef = useRef<ReturnType<typeof getTracker> | null>(null);
  const startedRef = useRef(false);

  // The clock lives in a ref — the tracker never calls setState.
  const startedAtRef = useRef(Date.now());

  useEffect(() => {
    if (!active || source.mode !== "live") return;
    if (startedRef.current) return;

    const tracker = getTracker();
    trackerRef.current = tracker;

    const session: TelemetrySession = {
      sessionId: trackerInstanceSessionId(tracker),
      mode: "live",
      entryPoint: "lobby",
      startedAt: startedAtRef.current,
    };
    tracker.start(session);
    startedRef.current = true;

    return () => {
      // Finalize the session and deliver queued events before stopping,
      // so client-side unmounts emit room.leave and session.end without
      // relying on pagehide.
      if (trackerRef.current) {
        void trackerRef.current.flush();
      }
      tracker.stop();
      trackerRef.current = null;
      startedRef.current = false;
    };
  }, [source, active]);

  const roomChanged = useCallback(
    (
      roomId: string | null,
      roomKind: string,
      roomRef: string,
      floorIndex: number,
      via: string
    ) => {
      const tracker = trackerRef.current;
      if (!tracker) return;
      tracker.roomChanged(roomId, roomKind, roomRef, floorIndex, via);
    },
    []
  );

  const portalCross = useCallback((via: string) => {
    const tracker = trackerRef.current;
    if (!tracker) return;
    tracker.portalCross(via);
  }, []);

  const floorChanged = useCallback((floorIndex: number) => {
    const tracker = trackerRef.current;
    if (!tracker) return;
    tracker.floorChanged(floorIndex);
  }, []);

  const towerOpened = useCallback(() => {
    const tracker = trackerRef.current;
    if (!tracker) return;
    tracker.towerOpened();
  }, []);

  const towerClosed = useCallback((restoreRoom = true) => {
    const tracker = trackerRef.current;
    if (!tracker) return;
    tracker.towerClosed(restoreRoom);
  }, []);

  const teleportArrive = useCallback(
    (
      roomId: string,
      roomKind: string,
      roomRef: string,
      floorIndex: number,
      via: string
    ) => {
      const tracker = trackerRef.current;
      if (!tracker) return;
      tracker.teleportArrive(roomId, roomKind, roomRef, floorIndex, via);
    },
    []
  );

  return {
    roomChanged,
    portalCross,
    floorChanged,
    towerOpened,
    towerClosed,
    teleportArrive,
  };
}

/**
 * Reads the session id the tracker already persisted to sessionStorage,
 * falling back to a generated id when storage is unavailable. Storage
 * failures do not propagate into the live-office effect.
 */
function trackerInstanceSessionId(
  tracker: ReturnType<typeof getTracker>
): string {
  if (typeof sessionStorage === "undefined") return trackerSessionIdFallback();
  try {
    const existing = sessionStorage.getItem("office_telemetry_session_id");
    if (existing) return existing;
  } catch {
    // Storage unavailable — fall through to generated id.
  }
  return trackerSessionIdFallback();
}

/**
 * Generates a fallback session id when sessionStorage is unavailable.
 */
function trackerSessionIdFallback(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random()}`;
}
