/**
 * Office telemetry tracker — pure module, no React.
 *
 * Records visits and events in The Office (3D virtual workspace) and ships
 * them to POST /office/telemetry in batches. Everything is behind the
 * NEXT_PUBLIC_FF_OFFICE_ANALYTICS feature flag, which defaults OFF.
 *
 * When the flag is false the tracker is inert: it creates no session identity,
 * registers no pagehide listener, records no events, and sends nothing. When
 * the flag is true the tracker owns the session id (sessionStorage, per tab),
 * the event queue, the flush timer and the pagehide flush. It never touches
 * React state — the hook layer calls its methods and keeps any UI state.
 */

const SESSION_STORAGE_KEY = "office_telemetry_session_id";
const LOCAL_STORAGE_START_KEY = "office_telemetry_session_start";
const SESSION_TTL_MS = 30 * 60 * 1000;

const FLUSH_INTERVAL_MS = 10_000;
const FLUSH_BATCH_SIZE = 25;
const QUEUE_CAP = 100;
const MAX_FAILED_FLUSHES = 3;

const TELEMETRY_URL =
  typeof process !== "undefined" && process.env.NEXT_PUBLIC_BASE_URL
    ? `${process.env.NEXT_PUBLIC_BASE_URL}/office/telemetry`
    : "/api/v1/office/telemetry";

const KNOWN_KINDS = new Set([
  "session.start",
  "session.end",
  "room.enter",
  "room.leave",
  "floor.enter",
  "portal.cross",
]);

/**
 * Reads the NEXT_PUBLIC_FF_OFFICE_ANALYTICS feature flag at build time.
 * Next.js inlines this static expression into browser bundles so the flag
 * is truly compile-time, not a runtime lookup.
 */
function flagOn(): boolean {
  return (
    typeof process !== "undefined" &&
    process.env.NEXT_PUBLIC_FF_OFFICE_ANALYTICS === "true"
  );
}

/**
 * Generates a stable UUID per event so retries dedupe correctly on the
 * backend via ON CONFLICT (event_id).
 */
function generateEventId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function nowMs(): number {
  return Date.now();
}

/**
 * Reads the persisted session start marker from localStorage. Returns null
 * when storage is unavailable or the marker is missing or malformed.
 */
function readStartMarker(): number | null {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_START_KEY);
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Persists the session start marker to localStorage. Storage failures are
 * swallowed so the tracker keeps working in restricted contexts.
 */
function writeStartMarker(ms: number): void {
  try {
    localStorage.setItem(LOCAL_STORAGE_START_KEY, String(ms));
  } catch {
    // Storage unavailable in restricted contexts; session still works.
  }
}

/**
 * Clears the persisted session start marker from localStorage.
 */
function clearStartMarker(): void {
  try {
    localStorage.removeItem(LOCAL_STORAGE_START_KEY);
  } catch {
    // Ignore.
  }
}

/**
 * Reads the persisted session id from sessionStorage. Returns null when
 * storage is unavailable or no id exists yet.
 */
function readSessionId(): string | null {
  try {
    return sessionStorage.getItem(SESSION_STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

/**
 * Persists the session id to sessionStorage. Storage failures are swallowed.
 */
function writeSessionId(id: string): void {
  try {
    sessionStorage.setItem(SESSION_STORAGE_KEY, id);
  } catch {
    // Ignore.
  }
}

interface TelemetryEvent {
  eventId: string;
  kind: string;
  offsetMs: number;
  floorIndex: number;
  roomKind: string;
  roomRef: string;
  dwellMs: number;
  via: string;
}

interface TelemetrySession {
  sessionId: string;
  mode: string;
  entryPoint: string;
  startedAt: number;
}

interface TrackerOptions {
  onFlush?: (accepted: number, duplicated: number, ignored: number) => void;
  onError?: (message: string) => void;
}

/**
 * Builds the JSON request payload for a batch of telemetry events. Shared by
 * the periodic flush and the pagehide flush so both paths send identical
 * shapes.
 */
function buildPayload(
  sessionId: string,
  startedAt: number,
  entryPoint: string,
  events: TelemetryEvent[]
) {
  return {
    session: {
      sessionId,
      mode: "live",
      entryPoint,
      startedAt: new Date(startedAt).toISOString(),
    },
    events: events.map((e) => ({
      eventId: e.eventId,
      kind: e.kind,
      offsetMs: e.offsetMs,
      floorIndex: e.floorIndex,
      roomKind: e.roomKind,
      roomRef: e.roomRef,
      dwellMs: e.dwellMs,
      via: e.via,
    })),
  };
}

/**
 * The tracker. One instance per tab per live session. When the analytics
 * flag is off the constructor performs no work — no storage access, no
 * listener registration, no timer — so the tracker is fully inert.
 */
class TelemetryTracker {
  private sessionId: string;
  private startedAt: number;
  private entryPoint: string;
  private queue: TelemetryEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private failedFlushes = 0;
  private stopped = false;
  private pagehideBound: () => void;

  // Dwell state — the tracker owns the current room and when it was entered,
  // so it can compute dwell_ms on room.leave without the hook holding state.
  private currentRoomId: string | null = null;
  private currentRoomKind: string = "";
  private currentRoomRef: string = "";
  private currentFloorIndex: number = 0;
  private dwellStartMs: number = 0;
  private inTower: boolean = false;

  // The room that was active when the tower opened, so towerClosed can
  // re-enter it and resume dwell tracking without a new room-entry callback.
  private towerPrecedingRoom: {
    id: string | null;
    kind: string;
    ref: string;
    floor: number;
  } | null = null;

  // Portal suppression — a portal crossing emits two room changes
  // (departure + arrival). The second one must not generate a dwell pair.
  private suppressNextDwellPair = false;

  constructor(opts: TrackerOptions = {}) {
    this.pagehideBound = this.onPagehide.bind(this);

    if (!flagOn()) {
      // Inert when analytics is disabled: no storage, no listener, no timer.
      this.sessionId = "";
      this.startedAt = 0;
      this.entryPoint = "";
      return;
    }

    this.sessionId = readSessionId() ?? generateEventId();
    writeSessionId(this.sessionId);

    const marker = readStartMarker();
    const now = nowMs();
    if (marker && now - marker < SESSION_TTL_MS) {
      this.startedAt = marker;
    } else {
      this.startedAt = now;
      writeStartMarker(now);
    }
    this.entryPoint = "lobby";

    this.pagehideBound = this.onPagehide.bind(this);
    if (typeof window !== "undefined") {
      window.addEventListener("pagehide", this.pagehideBound);
    }

    this.scheduleFlush();
  }

  /**
   * Call once when entering a live office session. No-op when analytics is
   * disabled.
   */
  start(session: TelemetrySession): void {
    if (!flagOn()) return;
    this.sessionId = session.sessionId;
    writeSessionId(this.sessionId);
    this.startedAt = session.startedAt;
    writeStartMarker(session.startedAt);
    this.entryPoint = session.entryPoint;
    this.record({
      kind: "session.start",
      offsetMs: 0,
      floorIndex: 0,
      roomKind: "",
      roomRef: "",
      dwellMs: 0,
      via: "",
    });
  }

  /**
   * Call when the scene reports a room change. `room` is null for corridor.
   * No-op when analytics is disabled.
   */
  roomChanged(
    roomId: string | null,
    roomKind: string,
    roomRef: string,
    floorIndex: number,
    via: string
  ): void {
    if (!flagOn()) return;
    // If the tower is open, room detection from the engine does not run — the
    // tower is the active place and we already closed the dwell on tower.open.
    if (this.inTower) return;

    // A portal crossing suppresses the dwell pair it would otherwise produce.
    if (this.suppressNextDwellPair) {
      this.suppressNextDwellPair = false;
      this.currentRoomId = roomId;
      this.currentRoomKind = roomKind;
      this.currentRoomRef = roomRef;
      this.currentFloorIndex = floorIndex;
      this.dwellStartMs = nowMs();
      this.record({
        kind: "room.enter",
        offsetMs: nowMs() - this.startedAt,
        floorIndex,
        roomKind,
        roomRef,
        dwellMs: 0,
        via,
      });
      return;
    }

    // Close the dwell on the room we are leaving (never a fake room for corridor).
    if (this.currentRoomId !== null) {
      const dwellMs = Math.max(0, nowMs() - this.dwellStartMs);
      this.record({
        kind: "room.leave",
        offsetMs: nowMs() - this.startedAt,
        floorIndex: this.currentFloorIndex,
        roomKind: this.currentRoomKind,
        roomRef: this.currentRoomRef,
        dwellMs,
        via: "",
      });
    }

    // Enter the new room (null = corridor, never a room.enter for corridor).
    if (roomId !== null && roomId !== "") {
      this.currentRoomId = roomId;
      this.currentRoomKind = roomKind;
      this.currentRoomRef = roomRef;
      this.currentFloorIndex = floorIndex;
      this.dwellStartMs = nowMs();
      this.record({
        kind: "room.enter",
        offsetMs: nowMs() - this.startedAt,
        floorIndex,
        roomKind,
        roomRef,
        dwellMs: 0,
        via,
      });
    } else {
      // Corridor — accumulate between_ms on the next entry, no fake room.
      this.currentRoomId = null;
      this.currentRoomKind = "";
      this.currentRoomRef = "";
      this.currentFloorIndex = floorIndex;
      this.dwellStartMs = nowMs();
    }
  }

  /**
   * Call when a portal crossing happens. Emits portal.cross only, no dwell.
   * No-op when analytics is disabled.
   */
  portalCross(via: string): void {
    if (!flagOn()) return;
    this.record({
      kind: "portal.cross",
      offsetMs: nowMs() - this.startedAt,
      floorIndex: this.currentFloorIndex,
      roomKind: "",
      roomRef: "",
      dwellMs: 0,
      via,
    });
    // The next room change pair (departure + arrival) is part of this crossing.
    this.suppressNextDwellPair = true;
  }

  /**
   * Call when the floor changes. No-op when analytics is disabled.
   */
  floorChanged(floorIndex: number): void {
    if (!flagOn()) return;
    this.record({
      kind: "floor.enter",
      offsetMs: nowMs() - this.startedAt,
      floorIndex,
      roomKind: "",
      roomRef: "",
      dwellMs: 0,
      via: "",
    });
    this.currentFloorIndex = floorIndex;
  }

  /**
   * Call when the tower opens — close the current room dwell. No-op when
   * analytics is disabled.
   */
  towerOpened(): void {
    if (!flagOn()) return;
    this.inTower = true;
    // Remember the room that was active before the tower opened so we can
    // re-enter it when the tower closes, without needing a new callback.
    this.towerPrecedingRoom = {
      id: this.currentRoomId,
      kind: this.currentRoomKind,
      ref: this.currentRoomRef,
      floor: this.currentFloorIndex,
    };
    if (this.currentRoomId !== null) {
      const dwellMs = Math.max(0, nowMs() - this.dwellStartMs);
      this.record({
        kind: "room.leave",
        offsetMs: nowMs() - this.startedAt,
        floorIndex: this.currentFloorIndex,
        roomKind: this.currentRoomKind,
        roomRef: this.currentRoomRef,
        dwellMs,
        via: "",
      });
      this.currentRoomId = null;
      this.currentRoomKind = "";
      this.currentRoomRef = "";
      this.dwellStartMs = nowMs();
    }
  }

  /**
   * Call when the tower closes — the floor view resumes room detection.
   * No-op when analytics is disabled.
   */
  towerClosed(): void {
    if (!flagOn()) return;
    this.inTower = false;
    // Resume dwell tracking for the room that was active before the tower
    // opened, so tracking restarts even when the player closes the tower
    // without changing rooms — no new room-entry callback required.
    const preceding = this.towerPrecedingRoom;
    this.towerPrecedingRoom = null;
    if (preceding) {
      this.currentRoomId = preceding.id;
      this.currentRoomKind = preceding.kind;
      this.currentRoomRef = preceding.ref;
      this.currentFloorIndex = preceding.floor;
      this.dwellStartMs = nowMs();
      if (preceding.id !== null && preceding.id !== "") {
        this.record({
          kind: "room.enter",
          offsetMs: nowMs() - this.startedAt,
          floorIndex: preceding.floor,
          roomKind: preceding.kind,
          roomRef: preceding.ref,
          dwellMs: 0,
          via: "",
        });
      }
    }
  }

  /**
   * Teleport entry points tag their own arrival via (directory / tower).
   * No-op when analytics is disabled.
   */
  teleportArrive(
    roomId: string,
    roomKind: string,
    roomRef: string,
    floorIndex: number,
    via: string
  ): void {
    if (!flagOn()) return;
    this.roomChanged(roomId, roomKind, roomRef, floorIndex, via);
  }

  private record(event: Omit<TelemetryEvent, "eventId">): void {
    if (!flagOn()) return;
    if (this.stopped) return;
    if (!KNOWN_KINDS.has(event.kind)) return;

    this.queue.push({
      eventId: generateEventId(),
      ...event,
    });

    if (this.queue.length >= QUEUE_CAP) {
      this.queue = this.queue.slice(-QUEUE_CAP);
    }

    if (this.queue.length >= FLUSH_BATCH_SIZE) {
      this.flush();
    }
  }

  private scheduleFlush(): void {
    if (!flagOn()) return;
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
      this.scheduleFlush();
    }, FLUSH_INTERVAL_MS);
  }

  /** Flush the queue now — public for tests and for pagehide. */
  public async flush(): Promise<void> {
    if (!flagOn()) return;
    if (this.stopped || this.queue.length === 0) return;
    if (this.failedFlushes >= MAX_FAILED_FLUSHES) return;

    const batch = this.queue.splice(0, this.queue.length);
    const sent = await this.sendBatch(batch);

    if (sent) {
      this.failedFlushes = 0;
    } else {
      this.failedFlushes += 1;
      // Put the events back at the front so they are retried next flush.
      this.queue.unshift(...batch);
      if (this.queue.length > QUEUE_CAP) {
        this.queue = this.queue.slice(0, QUEUE_CAP);
      }
    }
  }

  /**
   * Sends a batch of events to the telemetry endpoint. Returns true when the
   * server accepted the batch. No-op when analytics is disabled.
   */
  private async sendBatch(events: TelemetryEvent[]): Promise<boolean> {
    if (!flagOn()) return false;

    const payload = buildPayload(
      this.sessionId,
      this.startedAt,
      this.entryPoint,
      events
    );

    try {
      const res = await fetch(TELEMETRY_URL, {
        method: "POST",
        keepalive: true,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${typeof localStorage !== "undefined" ? localStorage.getItem("token") || "" : ""}`,
        },
        body: JSON.stringify(payload),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Pagehide: flush the last room.leave + session.end via fetch with
   * keepalive, reusing the same request builder as sendBatch. No-op when
   * analytics is disabled.
   */
  private onPagehide(): void {
    if (!flagOn()) return;
    if (this.stopped) return;

    // Close the current room dwell.
    if (this.currentRoomId !== null) {
      const dwellMs = Math.max(0, nowMs() - this.dwellStartMs);
      this.record({
        kind: "room.leave",
        offsetMs: nowMs() - this.startedAt,
        floorIndex: this.currentFloorIndex,
        roomKind: this.currentRoomKind,
        roomRef: this.currentRoomRef,
        dwellMs,
        via: "",
      });
      this.currentRoomId = null;
    }

    this.record({
      kind: "session.end",
      offsetMs: nowMs() - this.startedAt,
      floorIndex: this.currentFloorIndex,
      roomKind: "",
      roomRef: "",
      dwellMs: 0,
      via: "",
    });

    this.stopped = true;
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    const remaining = this.queue.splice(0, this.queue.length);
    if (remaining.length === 0) return;

    const payload = buildPayload(
      this.sessionId,
      this.startedAt,
      this.entryPoint,
      remaining
    );

    try {
      void fetch(TELEMETRY_URL, {
        method: "POST",
        keepalive: true,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${typeof localStorage !== "undefined" ? localStorage.getItem("token") || "" : ""}`,
        },
        body: JSON.stringify(payload),
      });
    } catch {
      // Fetch unavailable — the batch is dropped.
    }
  }

  /**
   * Stop the tracker and clear the pagehide listener. Clears the shared
   * trackerInstance so the next getTracker() call creates a fresh tracker.
   */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("pagehide", this.pagehideBound);
    }
    if (trackerInstance === this) {
      trackerInstance = null;
    }
    clearStartMarker();
  }

  queueLength(): number {
    return this.queue.length;
  }
}

let trackerInstance: TelemetryTracker | null = null;

/**
 * Returns the singleton tracker, creating it on first call. When analytics
 * is disabled the returned tracker is inert — all methods are no-ops.
 */
export function getTracker(opts?: TrackerOptions): TelemetryTracker {
  if (!trackerInstance) {
    trackerInstance = new TelemetryTracker(opts);
  }
  return trackerInstance;
}

/**
 * Stops the active tracker and clears the singleton so tests can create a
 * fresh tracker.
 */
export function resetTrackerForTests(): void {
  if (trackerInstance) {
    trackerInstance.stop();
  }
  trackerInstance = null;
}

export { TelemetryTracker };
export type { TelemetryEvent, TelemetrySession, TrackerOptions };
