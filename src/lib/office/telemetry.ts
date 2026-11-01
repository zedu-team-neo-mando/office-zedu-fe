/**
 * Office telemetry tracker — pure module, no React.
 *
 * Records visits and events in The Office (3D virtual workspace) and ships
 * them to POST /office/telemetry in batches. Everything is behind the
 * NEXT_PUBLIC_FF_OFFICE_ANALYTICS feature flag, which defaults OFF.
 *
 * The tracker owns the session id (sessionStorage, per tab), the event queue,
 * the flush timer and the pagehide beacon. It never touches React state — the
 * hook layer calls its methods and keeps any UI state.
 */

const FLAG = "NEXT_PUBLIC_FF_OFFICE_ANALYTICS";

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

function flagOn(): boolean {
  return typeof process !== "undefined" && process.env[FLAG] === "true";
}

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

function writeStartMarker(ms: number): void {
  try {
    localStorage.setItem(LOCAL_STORAGE_START_KEY, String(ms));
  } catch {
    // Storage unavailable in restricted contexts; session still works.
  }
}

function clearStartMarker(): void {
  try {
    localStorage.removeItem(LOCAL_STORAGE_START_KEY);
  } catch {
    // Ignore.
  }
}

function readSessionId(): string | null {
  try {
    return sessionStorage.getItem(SESSION_STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

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
 * The tracker. One instance per tab per live session.
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

  // Portal suppression — a portal crossing emits two room changes
  // (departure + arrival). The second one must not generate a dwell pair.
  private suppressNextDwellPair = false;

  constructor(opts: TrackerOptions = {}) {
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

  /** Call once when entering a live office session. */
  start(session: TelemetrySession): void {
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

  /** Call when the scene reports a room change. `room` is null for corridor. */
  roomChanged(
    roomId: string | null,
    roomKind: string,
    roomRef: string,
    floorIndex: number,
    via: string
  ): void {
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

  /** Call when a portal crossing happens. Emits portal.cross only, no dwell. */
  portalCross(via: string): void {
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

  /** Call when the floor changes. */
  floorChanged(floorIndex: number): void {
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

  /** Call when the tower opens — close the current room dwell. */
  towerOpened(): void {
    this.inTower = true;
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

  /** Call when the tower closes — the floor view resumes room detection. */
  towerClosed(): void {
    this.inTower = false;
  }

  /** Teleport entry points tag their own arrival via (directory / tower). */
  teleportArrive(
    roomId: string,
    roomKind: string,
    roomRef: string,
    floorIndex: number,
    via: string
  ): void {
    this.roomChanged(roomId, roomKind, roomRef, floorIndex, via);
  }

  private record(event: Omit<TelemetryEvent, "eventId">): void {
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

  private async sendBatch(events: TelemetryEvent[]): Promise<boolean> {
    if (!flagOn()) return false;

    const payload = {
      session: {
        sessionId: this.sessionId,
        mode: "live",
        entryPoint: this.entryPoint,
        startedAt: new Date(this.startedAt).toISOString(),
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

  /** Pagehide: flush the last room.leave + session.end via sendBeacon. */
  private onPagehide(): void {
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

    const payload = {
      session: {
        sessionId: this.sessionId,
        mode: "live",
        entryPoint: this.entryPoint,
        startedAt: new Date(this.startedAt).toISOString(),
      },
      events: remaining.map((e) => ({
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

    try {
      navigator.sendBeacon(TELEMETRY_URL, JSON.stringify(payload));
    } catch {
      // Beacon unavailable — the batch is dropped.
    }
  }

  /** Stop the tracker and clear the pagehide listener. */
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
    clearStartMarker();
  }

  queueLength(): number {
    return this.queue.length;
  }
}

let trackerInstance: TelemetryTracker | null = null;

export function getTracker(opts?: TrackerOptions): TelemetryTracker {
  if (!trackerInstance) {
    trackerInstance = new TelemetryTracker(opts);
  }
  return trackerInstance;
}

export function resetTrackerForTests(): void {
  if (trackerInstance) {
    trackerInstance.stop();
  }
  trackerInstance = null;
}

export { TelemetryTracker };
export type { TelemetryEvent, TelemetrySession, TrackerOptions };
