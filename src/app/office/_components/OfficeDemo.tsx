"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MonitorX, RefreshCw } from "lucide-react";
import { cn } from "~/lib/utils";
import { GetRequest } from "~/utils/new-request";
import { useRBAC } from "~/hooks/useRBAC";
import { showError, showInfo, showSuccess } from "~/components/toast/sonner";
import EntryScreen from "./EntryScreen";
import Hud, { type PresencePoint } from "./Hud";
import {
  AvatarDialog,
  ChatPanel,
  FurniturePanel,
  RoomDirectory,
} from "./Panels";
import ZoeDialog from "./ZoeDialog";
import { TowerView } from "./TowerView";
import type { TowerOffice, TowerOccupant } from "./engine/tower-scene";
import { normalizeOccupant } from "../../(client)/[org]/_components/office/live-office-source";
import { Onboarding, TourOverlay, type TourStep } from "./Onboarding";
import {
  CATALOG_BY_ID,
  DEFAULT_AVATAR,
  DEMO_USER_ID,
  DEMO_USERS,
  ROOM_BY_ID,
  type AvatarConfig,
  type ChatMessage,
  type FurnitureItem,
  type PresenceStatus,
  validatePlacement,
} from "./office-data";
import { demoAvatar, demoSource, demoTowerOffices } from "./demo-office-source";
import { useOfficePresence } from "./use-office-presence";
import { OfficeEntryError, isRoomFullError } from "./office-entry";
import { useOfficeTelemetry } from "./use-office-telemetry";
import type {
  OfficeOccupant,
  OfficeSource,
  OfficeZoeContext,
} from "~/types/office";
import {
  OfficeEngine,
  type EngineCallbacks,
  type EditState,
} from "./engine/OfficeEngine";

const initialPresence: PresencePoint[] = DEMO_USERS.filter(
  (user) => user.id !== "you" && !user.isZoe
).map((user) => ({
  id: user.id,
  x: user.position.x,
  z: user.position.z,
  roomId: user.roomId,
  status: user.status,
  tint: user.avatar.tint,
}));

/** How often the Focus pods on the floor are re-read for a free seat. */
const AVAILABILITY_POLL_MS = 15_000;

const TOUR_STEPS: TourStep[] = [
  {
    title: "Welcome to The Office",
    body: "A building for the conversations you already have. Channel rooms mirror your Zedu channels, private offices mirror DMs, and everyone keeps the same identity they use in the 2D app.",
    icon: "welcome",
    accent: "#a78bfa",
  },
  {
    title: "Move like you're there",
    body: "WASD or arrow keys to walk, Shift to run. You can also click any floor tile and the A* path will take you around walls and furniture. Drag to orbit, scroll to zoom.",
    icon: "move",
    accent: "#60a5fa",
  },
  {
    title: "Channel rooms are real rooms",
    body: "This is #design. Walk through the door and the existing channel messages travel with you — same channel, same people, now with a place. Speech bubbles show who's talking nearby.",
    icon: "chat",
    accent: "#f472b6",
  },
  {
    title: "Your office, your layout",
    body: "This one is yours. Press B to open the catalogue, pick a piece, hover the floor until the ghost turns green, then press P to place it. R rotates, Delete removes, and the layout autosaves in about half a second.",
    icon: "furnish",
    accent: "#34d399",
  },
  {
    title: "Zoe, in the room",
    body: "Zoe sits at reception. Walk up to the gold ring and press E. She can see your room and who's nearby — never the contents of private rooms — and answers with your Zedu context.",
    icon: "zoe",
    accent: "#f4c46a",
  },
  {
    title: "Make it yours",
    body: "Your avatar is part of your presence. Change your tint, body, outfit and accessory; everyone in the building sees the update immediately. That's the tour — explore anywhere with the map.",
    icon: "avatar",
    accent: "#22d3ee",
  },
];

const REPLIES: Record<string, string[]> = {
  "channel:design": [
    "That tracks. I'll add it to the critique board.",
    "Want me to mock the 3D and 2D versions side by side?",
    "The room labels are readable from the corridor now — nice.",
  ],
  "channel:dev": [
    "Pushed. The preview is on the branch.",
    "I'll check the collision edge case after standup.",
    "Presence is holding at 10Hz in the building.",
  ],
  "channel:general": [
    "Noted — I'll add it to the demo checklist.",
    "The pilot org gets the flag after the 5pm smoke.",
    "Can you drop that in the thread so Zoe can index it?",
  ],
  lounge: [
    "Coffee's ready by the plants.",
    "I'll bring the pastries.",
    "Five minutes, then back to the demo build.",
  ],
  "personal:you": [
    "Your office is looking good. The oak desk works.",
    "I'll stop by after the review.",
    "Want me to bring the new room labels?",
  ],
  "meeting:1": [
    "Buzz call in 2 — join when you're in the room.",
    "I'll share the standup notes.",
    "Can you hear me okay?",
  ],
  "meeting:2": [
    "Pairing after lunch?",
    "I left comments on the layout validator.",
    "The whiteboard is all yours.",
  ],
  reception: [
    "Welcome to Zedu HQ 👋",
    "Zoe's at the desk if you need anything.",
    "The demo starts at 4 — I'll grab you a seat.",
  ],
  default: [
    "Sounds good.",
    "I'll take a look.",
    "Let's sync in the channel.",
    "Nice — adding it to the list.",
  ],
};

const AMBIENT: Record<string, string[]> = {
  reception: [
    "Welcome to Zedu HQ 👋",
    "Zoe's at the desk if you need anything.",
  ],
  lounge: [
    "Coffee run? ☕",
    "The plants are thriving.",
    "Pastries by the plants.",
  ],
  "channel:design": [
    "The new room labels are live ✨",
    "I'm iterating on the corridor lighting.",
  ],
  "channel:dev": [
    "Deploy is green.",
    "Presence is at 10Hz now.",
    "Review when you can.",
  ],
  "channel:general": [
    "Demo at 4 — bring your best bugs.",
    "Standup notes are in the doc.",
  ],
  "meeting:1": ["On a Buzz call", "Two minutes!"],
  "meeting:2": ["Pairing after lunch?", "The whiteboard is free."],
  "focus:1": ["Heads down.", "Focus mode on."],
  "focus:2": ["Heads down until 3", "Focus mode on."],
  "focus:3": ["Almost through the queue.", "Do not disturb."],
  "focus:4": ["Deep work.", "Back at 3."],
  "personal:ada": ["The oak desk was a good call.", "Stop by any time."],
  "personal:tunde": ["The deploy is green.", "Pairing later?"],
  "personal:you": ["Your office looks great.", "The oak desk was a good call."],
  default: ["Hey!", "Welcome in."],
};

const LIVE_LINES: Record<string, string[]> = {
  "channel:general": [
    "The pilot-org smoke is at 5 — I'll post the checklist.",
    "Zoe indexed the office thread. Try asking her about deadlines.",
  ],
  "channel:design": [
    "I pushed the room-label pass. The corridor reads much better.",
    "Can someone check the lounge lighting on mobile?",
  ],
  "channel:dev": [
    "The pathfinding fix is on preview. Click-to-move should feel smoother.",
    "Presence is still holding at 10Hz after the deploy.",
  ],
  lounge: ["Coffee's ready.", "Five minutes until the demo."],
  "meeting:1": ["Buzz call starts in 2.", "I'll share the notes after."],
  "meeting:2": ["Layout validator comments are in.", "Pairing after lunch?"],
  "personal:you": [
    "I left a note on your office layout.",
    "The build looks good.",
  ],
  reception: ["Welcome in 👋", "Zoe's at the desk."],
  default: ["Quick sync later?", "Nice work."],
};

export default function OfficeDemo({
  source = demoSource,
  self,
  onExit,
}: {
  source?: OfficeSource;
  /** The signed-in person. The demo falls back to its seeded user. */
  self?: { id: string; name: string; role?: string };
  /** Leave the building (the live route returns to the organisation). */
  onExit?: () => void;
}) {
  const rooms = source.rooms;
  const roomById = useMemo(() => {
    const map: Record<string, (typeof rooms)[number]> = {};
    for (const room of rooms) map[room.id] = room;
    return map;
  }, [rooms]);

  const demoIdentity = useMemo(() => {
    if (typeof window === "undefined") {
      return { id: "demo_player", name: "Colleague", tint: "#8b5cf6" };
    }
    const w = window as any;
    if (w.__officeTabIdentity) {
      return w.__officeTabIdentity;
    }
    const sessionKey = "office_session_user_id";
    const nameKey = "office_session_user_name";
    const tintKey = "office_session_user_tint";
    const id = `demo_${Math.random().toString(36).slice(2, 8)}`;
    const names = [
      "Alex",
      "Jordan",
      "Taylor",
      "Casey",
      "Morgan",
      "Sam",
      "Kai",
      "Riley",
      "Quinn",
      "Avery",
    ];
    const name = names[Math.floor(Math.random() * names.length)];
    const tints = [
      "#8b5cf6",
      "#3b82f6",
      "#10b981",
      "#f59e0b",
      "#ec4899",
      "#06b6d4",
    ];
    const tint = tints[Math.floor(Math.random() * tints.length)];
    const identity = { id, name, tint };
    w.__officeTabIdentity = identity;
    try {
      sessionStorage.setItem(sessionKey, id);
      sessionStorage.setItem(nameKey, name);
      sessionStorage.setItem(tintKey, tint);
    } catch {
      // Ignore storage errors in restricted contexts
    }
    return identity;
  }, []);

  const selfId = self?.id ?? demoIdentity.id;
  const selfName = self?.name ?? demoIdentity.name;
  const onboardingKey = `office-onboarding-v2-${source.mode}`;
  // The live rooms come from the server, so hit testing has to use them and
  // not the demo floor plan compiled into office-data. Only the storey the
  // engine is showing exists in 3D, so the lookup is scoped to that floor.
  // (Declared after activeFloor so the closure sees the current storey.)

  // The demo opens on its entry screen; the live office goes straight into
  // the building. Both land on the tower first, then step onto a storey.
  const [phase, setPhase] = useState<"entry" | "office">(
    source.mode === "live" ? "office" : "entry"
  );
  // Read once: the engine is created after the first render and must know
  // whether the user is already inside the office.
  const startsInOfficeRef = useRef(phase === "office");
  const [ready, setReady] = useState(false);
  const [engineError, setEngineError] = useState<string | null>(null);

  const [avatar, setAvatar] = useState<AvatarConfig>(() => ({
    ...source.initialAvatar,
    tint: self ? source.initialAvatar.tint : demoIdentity.tint,
  }));
  const [avatarDraft, setAvatarDraft] = useState<AvatarConfig>(() => ({
    ...source.initialAvatar,
    tint: self ? source.initialAvatar.tint : demoIdentity.tint,
  }));
  const [layouts, setLayouts] = useState<Record<string, FurnitureItem[]>>(
    () => source.initialLayouts
  );

  const commonFloorRooms = useMemo(
    () => rooms.filter((room) => (room.floorIndex ?? 0) === 0),
    [rooms]
  );
  const initialRoom = useMemo(
    () =>
      commonFloorRooms.find((room) => room.kind === "reception") ??
      commonFloorRooms.find((room) => room.id === "reception") ??
      commonFloorRooms.find((room) => room.kind === "lobby") ??
      commonFloorRooms.find((room) => room.kind !== "personal") ??
      commonFloorRooms[0] ??
      rooms.find((room) => room.kind === "reception") ??
      rooms[0] ??
      null,
    [commonFloorRooms, rooms]
  );
  const [roomId, setRoomId] = useState<string | null>(
    () => initialRoom?.id ?? "reception"
  );

  useEffect(() => {
    if (initialRoom?.id && (!roomId || roomId === "reception")) {
      setRoomId(initialRoom.id);
    }
  }, [initialRoom?.id, roomId]);
  const [player, setPlayer] = useState(() => ({
    x: initialRoom?.spawn.x ?? 8.5,
    z: initialRoom?.spawn.z ?? 9.4,
    yaw: Math.PI,
  }));
  const [presence, setPresence] = useState<PresencePoint[]>(
    source.mode === "demo" ? initialPresence : []
  );
  const [presenceState, setPresenceState] = useState<"connecting" | "live">(
    source.mode === "demo" ? "live" : "connecting"
  );
  const [nearZoe, setNearZoe] = useState(false);
  /** Personal-office doors the owners have opened or shut, by room id. */
  const [doorStates, setDoorStates] = useState<Record<string, boolean>>({});
  /** The personal-office door the player is standing at, if any. */
  const [nearDoorId, setNearDoorId] = useState<string | null>(null);

  const [towerOpen, setTowerOpen] = useState(false);
  const [towerFocus, setTowerFocus] = useState<number | null>(null);
  const openedInitialTowerRef = useRef(false);
  const [activeFloor, setActiveFloor] = useState(0);
  const floorRooms = useMemo(
    () => rooms.filter((room) => (room.floorIndex ?? 0) === activeFloor),
    [rooms, activeFloor]
  );
  // A portal on the channels floor returns to the private floor the visitor
  // came from. The client owns that target because the server cannot know it;
  // the highest walkable member floor is the default.
  const memberFloors = useMemo(
    () =>
      Array.from(
        new Set(
          rooms
            .filter(
              (room) => room.kind !== "portal" && (room.floorIndex ?? 0) > 0
            )
            .map((room) => room.floorIndex ?? 0)
        )
      ).sort((a, b) => a - b),
    [rooms]
  );
  const topMemberFloor = memberFloors[memberFloors.length - 1] ?? null;
  const [lastMemberFloor, setLastMemberFloor] = useState<number | null>(
    topMemberFloor
  );
  const portalCooldownRef = useRef(0);
  const findRoomAt = useCallback(
    (x: number, z: number) =>
      floorRooms.find(
        (room) =>
          x >= room.bounds.x &&
          x <= room.bounds.x + room.bounds.w &&
          z >= room.bounds.z &&
          z <= room.bounds.z + room.bounds.d
      ) ?? null,
    [floorRooms]
  );
  const [towerHover, setTowerHover] = useState<TowerOffice | null>(null);
  const [liftTarget, setLiftTarget] = useState<number | null>(null);
  /** Office held in frame from the street, with its conversation open. */
  const [towerPreview, setTowerPreview] = useState<string | null>(null);

  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatTargetId, setChatTargetId] = useState<string | null>(null);
  const [zoeOpen, setZoeOpen] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);

  const [editorActive, setEditorActive] = useState(false);
  const [editorCatalogId, setEditorCatalogId] = useState<string | null>(null);
  const [editorMovingId, setEditorMovingId] = useState<string | null>(null);
  const [editorRotation, setEditorRotation] = useState(0);
  const [ghostReason, setGhostReason] = useState<string | null>(null);
  const [selectedFurnitureId, setSelectedFurnitureId] = useState<string | null>(
    null
  );

  const [messagesByRoom, setMessagesByRoom] = useState<
    Record<string, ChatMessage[]>
  >(() => ({ ...source.initialMessages }));
  const [unread, setUnread] = useState(0);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "draft">(
    "saved"
  );
  const [undoStack, setUndoStack] = useState<FurnitureItem[][]>([]);
  const [redoStack, setRedoStack] = useState<FurnitureItem[][]>([]);

  const [tourStep, setTourStep] = useState<number | null>(null);
  const [fading, setFading] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [firstPerson, setFirstPerson] = useState(false);
  const [mouseLook, setMouseLook] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const engineRef = useRef<OfficeEngine | null>(null);
  const handlersRef = useRef<EngineCallbacks | null>(null);
  const timersRef = useRef<number[]>([]);
  const lastInvalidRef = useRef(0);
  const autoTourRef = useRef(false);
  // Rooms whose real conversation has already been read, so re-entering a room
  // does not refetch what is already on screen.
  const historyRef = useRef(new Set<string>());
  const dirtyLayoutsRef = useRef(new Map<string, FurnitureItem[]>());
  const queuedLayoutsRef = useRef(new Map<string, FurnitureItem[]>());
  const saveQueueRef = useRef(Promise.resolve());
  /** A tower dive that is mid-teleport; tags the next room change as via: tower. */
  const pendingTeleportRef = useRef<{ roomId: string; via: string } | null>(
    null
  );

  const currentRoom = roomId ? (roomById[roomId] ?? null) : null;
  // A portal is circulation: no conversation, no roster, nobody stands in it.
  const inPortal = currentRoom?.kind === "portal";
  const currentItems = currentRoom ? (layouts[currentRoom.id] ?? []) : [];
  const selectedItem =
    currentRoom && selectedFurnitureId
      ? ((layouts[currentRoom.id] ?? []).find(
          (item) => item.id === selectedFurnitureId
        ) ?? null)
      : null;
  // Match the directory's room scope; count the signed-in person once.
  const onlineCount =
    presence.filter(
      (point) =>
        point.id !== selfId &&
        point.roomId !== "lobby" &&
        point.roomId === roomId
    ).length + 1;

  // Who is standing anywhere in the building, grouped by room. Populated by
  // fetchOccupancy from a single building-wide read (live) or the seeded
  // directory (demo).
  const [occupantsByRoom, setOccupantsByRoom] = useState<
    Record<string, TowerOccupant[]>
  >({});

  // The tower shows the people, not the rooms: an office is lit while its
  // owner is inside it, and the search only ever matches people. The demo
  // adds the directory-only storeys that fill the building out to ten floors.
  const towerOffices = useMemo<TowerOffice[]>(() => {
    // The occupancy read is source-agnostic, so both branches attach it the
    // same way. The demo has no request of its own but still knows where every
    // seeded person stands, so its cells show faces too.
    const attachOccupants = (offices: TowerOffice[]) =>
      offices.map((office) => {
        const occupants = occupantsByRoom[office.roomId] ?? [];
        if (!occupants.length) return office;
        return { ...office, occupants };
      });

    if (source.mode === "demo") {
      return attachOccupants(demoTowerOffices(rooms, presence));
    }

    // The tower is a directory of the whole organisation. The member roster
    // carries every person and the office they sit in, so the building shows
    // the real team even for offices this requester cannot walk into.
    const presenceByUser = new Map(presence.map((point) => [point.id, point]));
    const people: TowerOffice[] = source.members.map((member) => {
      const here = presenceByUser.get(member.userId);
      return {
        roomId: member.roomId,
        floorIndex: member.floorIndex,
        name: member.displayName,
        kind: "personal",
        occupantName: member.displayName,
        present: member.online || Boolean(here),
        status: here?.status ?? member.status,
        tint: member.tint || undefined,
        avatarUrl: member.avatarUrl || undefined,
        interactive: member.canVisit || member.userId === selfId,
        isSelf: member.userId === selfId,
      };
    });

    const sharedKinds = new Set([
      "channel",
      "reception",
      "lounge",
      "meeting",
      "focus",
      "lobby",
    ]);
    const shared: TowerOffice[] = rooms
      .filter(
        (room) => (room.floorIndex ?? 0) === 0 && sharedKinds.has(room.kind)
      )
      .map((room) => ({
        roomId: room.id,
        floorIndex: 0,
        name: room.name,
        kind: room.kind,
        present: true,
        tint: room.accent,
        interactive: !room.locked,
      }));

    return attachOccupants([...shared, ...people]);
  }, [source.mode, source.members, rooms, presence, selfId, occupantsByRoom]);

  const isShared = Boolean(currentRoom && currentRoom.kind !== "personal");
  const { hasPermission } = useRBAC();
  const canEditShared =
    source.mode === "demo" || hasPermission("manage:organization");
  const canEditRoom = useCallback(
    (room: (typeof rooms)[number] | null | undefined) =>
      Boolean(
        room &&
        !room.locked &&
        (room.kind === "personal" ? room.ownerId === selfId : canEditShared)
      ),
    [selfId, canEditShared]
  );
  const canEditRoomRef = useRef(canEditRoom);
  canEditRoomRef.current = canEditRoom;

  // Only the owner works their own door. The demo's own office belongs to the
  // seeded "you", whichever demo identity this tab was given.
  const ownsOffice = useCallback(
    (room: (typeof rooms)[number] | null | undefined) =>
      Boolean(
        room &&
        room.kind === "personal" &&
        (room.ownerId === selfId ||
          room.id === `personal:${selfId}` ||
          (source.mode === "demo" && room.ownerId === "you"))
      ),
    [selfId, source.mode]
  );
  const nearDoorRoom = nearDoorId ? (roomById[nearDoorId] ?? null) : null;
  const nearDoor = nearDoorRoom
    ? {
        roomId: nearDoorRoom.id,
        name: nearDoorRoom.name,
        open: doorStates[nearDoorRoom.id] !== false,
        own: ownsOffice(nearDoorRoom),
      }
    : null;
  const canEdit = canEditRoom(currentRoom) && currentRoom?.kind !== "portal";
  const chatRoom = chatTargetId
    ? (roomById[chatTargetId] ?? currentRoom)
    : currentRoom;
  const currentMessages = chatRoom ? (messagesByRoom[chatRoom.id] ?? []) : [];
  const existingConversations =
    source.mode === "live"
      ? rooms.filter(
          (room) =>
            room.kind === "personal" &&
            room.chat &&
            !room.locked &&
            room.ownerId !== selfId
        )
      : [];
  // The directory lists places, not doorways: a portal is reached by walking
  // through it or by clicking it on the map, never as a search result.
  const directoryRooms = useMemo(
    () => rooms.filter((room) => room.kind !== "portal"),
    [rooms]
  );
  const nearbyNames = useMemo(() => {
    if (!roomId) return [];
    return presence
      .filter((agent) => agent.roomId === roomId)
      .map(
        (agent) =>
          agent.name ??
          DEMO_USERS.find((user) => user.id === agent.id)?.name ??
          agent.id
      )
      .slice(0, 6);
  }, [presence, roomId]);

  const stateRef = useRef({
    phase,
    ready,
    avatar,
    avatarDraft,
    layouts,
    roomId,
    player,
    presence,
    presenceState,
    nearZoe,
    nearDoor,
    towerOpen,
    editorActive,
    editorCatalogId,
    editorMovingId,
    editorRotation,
    ghostReason,
    selectedFurnitureId,
    chatOpen,
    zoeOpen,
    avatarOpen,
    directoryOpen,
    onboardingOpen,
    tourStep,
    saveState,
    isMobile,
    firstPerson,
  });
  stateRef.current = {
    phase,
    ready,
    avatar,
    avatarDraft,
    layouts,
    roomId,
    player,
    presence,
    presenceState,
    nearZoe,
    nearDoor,
    towerOpen,
    editorActive,
    editorCatalogId,
    editorMovingId,
    editorRotation,
    ghostReason,
    selectedFurnitureId,
    chatOpen,
    zoeOpen,
    avatarOpen,
    directoryOpen,
    onboardingOpen,
    tourStep,
    saveState,
    isMobile,
    firstPerson,
  };

  const schedule = (fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, ms);
    timersRef.current.push(id);
    return id;
  };

  // ------------------------------------------------------------- engine wiring

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    try {
      const mobile = window.matchMedia("(max-width: 900px)").matches;
      const engine = new OfficeEngine(
        container,
        {
          onReady: () => handlersRef.current?.onReady(),
          onError: (message) => handlersRef.current?.onError(message),
          onRoomChange: (room) => handlersRef.current?.onRoomChange(room),
          onPosition: (x, z, yaw) => handlersRef.current?.onPosition(x, z, yaw),
          onZoeProximity: (near) => handlersRef.current?.onZoeProximity(near),
          onFurnitureSelect: (id) => handlersRef.current?.onFurnitureSelect(id),
          onRequestPlace: (x, z) => handlersRef.current?.onRequestPlace(x, z),
          onRequestMove: (id, x, z) =>
            handlersRef.current?.onRequestMove(id, x, z),
          onPresence: (users) => handlersRef.current?.onPresence(users),
          onInvalidTarget: () => handlersRef.current?.onInvalidTarget(),
          onGhostState: (valid, reason) =>
            handlersRef.current?.onGhostState?.(valid, reason),
          onTowerPick: (office) => handlersRef.current?.onTowerPick?.(office),
          onTowerHover: (office) => handlersRef.current?.onTowerHover?.(office),
          onFloorChange: (floorIndex) => {
            setActiveFloor(floorIndex);
            telemetry.floorChanged(floorIndex);
          },
          onDoorProximity: (roomId) =>
            handlersRef.current?.onDoorProximity?.(roomId),
          onMouseLook: setMouseLook,
        },
        {
          isMobile: mobile,
          cinematic: !startsInOfficeRef.current,
          isLive: source.mode === "live",
          avatar: stateRef.current.avatarDraft,
          furniture: Object.values(stateRef.current.layouts).flat(),
          rooms: source.rooms,
          selfId,
        }
      );
      engineRef.current = engine;
      if (process.env.NODE_ENV !== "production") {
        // Dev-only handle so the scene can be inspected from the console.
        (
          window as unknown as { __officeEngine?: OfficeEngine }
        ).__officeEngine = engine;
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "WebGL is unavailable in this browser.";
      setEngineError(message);
    }

    return () => {
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (selfId && engineRef.current) {
      engineRef.current.setSelfId(selfId);
    }
  }, [selfId]);

  // The cinematic belongs to the entry screen. Any route into the office —
  // the entry button, a tour, a deep link, the live office that starts there —
  // must hand control back, so this is driven by the phase instead of by the
  // two entry points that happen to call it.
  useEffect(() => {
    engineRef.current?.setCinematic(phase !== "office");
  }, [phase]);

  // The entry screen sits over the building itself. Let the backdrop alternate
  // between the tower and the floor so a visitor sees both without pressing
  // anything.
  useEffect(() => {
    if (phase !== "entry" || !ready) return;
    const engine = engineRef.current;
    if (!engine) return;

    let showTower = true;
    engine.setView("tower");
    engine.focusTowerFloor(null);

    const timer = window.setInterval(() => {
      showTower = !showTower;
      if (showTower) {
        engine.setView("tower");
        engine.focusTowerFloor(null);
      } else {
        engine.setView("floor");
        engine.setCinematic(true);
      }
    }, 14_000);

    return () => window.clearInterval(timer);
  }, [phase, ready]);

  useEffect(() => {
    engineRef.current?.setRooms(rooms);
    if (source.mode === "live") {
      engineRef.current?.clearDemoAgents();
    }
  }, [rooms, source]);

  // Keep the tower fed with the live directory: the storeys from the backend
  // and who is sitting in each office right now.
  useEffect(() => {
    engineRef.current?.setTower(source.floors ?? [], towerOffices);
  }, [source.floors, towerOffices]);

  // The demo keeps the avatar in localStorage. Restore it after mount, never
  // during render, so a reload keeps the saved look without a hydration
  // mismatch. The live office keeps the avatar the server sent.
  useEffect(() => {
    if (source.mode !== "demo") return;
    const saved = demoAvatar();
    setAvatar(saved);
    setAvatarDraft(saved);
  }, [source.mode]);

  useEffect(() => {
    engineRef.current?.setAvatar(avatarDraft);
  }, [avatarDraft]);

  useEffect(() => {
    engineRef.current?.setFurniture(Object.values(layouts).flat());
  }, [layouts]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setEditState({
      active: editorActive,
      catalogId: editorCatalogId,
      movingId: editorMovingId,
      movingCatalogId: selectedItem?.catalogId ?? null,
      rotation: editorRotation,
    });
    // Keep engine selection in sync with React, including after a placement.
    engine.setSelected(editorActive ? selectedFurnitureId : null);
  }, [
    editorActive,
    editorCatalogId,
    editorMovingId,
    editorRotation,
    selectedFurnitureId,
    selectedItem?.catalogId,
    layouts,
  ]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ x: number; y: number }>).detail;
      engineRef.current?.setJoystick(detail.x, detail.y);
    };
    window.addEventListener("office-joystick", handler);
    return () => window.removeEventListener("office-joystick", handler);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      const state = stateRef.current;
      if (event.key === "Escape") {
        // The browser owns this press while the mouse is captured; cancelling
        // it could swallow the unlock.
        if (document.pointerLockElement) return;
        event.preventDefault();
        // The tower owns the viewport, so Esc always brings the floor back
        // before it starts closing panels.
        if (state.towerOpen) {
          closeTower();
          return;
        }
        if (state.firstPerson) {
          exitFirstPerson();
          return;
        }
        closeTopLayer();
        return;
      }
      if (state.phase !== "office") return;
      const key = event.key.toLowerCase();
      if (key === "e") {
        event.preventDefault();
        if (!state.nearZoe && state.nearDoor?.own) toggleDoor();
        else openZoe();
      } else if (key === "b") {
        event.preventDefault();
        toggleEditor();
      } else if (key === "p" && state.editorActive) {
        event.preventDefault();
        placeGhost();
      } else if (key === "r" && state.editorActive) {
        event.preventDefault();
        rotateSelected();
      } else if (
        (event.key === "Delete" || event.key === "Backspace") &&
        state.editorActive
      ) {
        event.preventDefault();
        deleteSelected();
      } else if (key === "m") {
        event.preventDefault();
        setMapOpen((value) => !value);
      } else if (key === "v") {
        // Holding the key must not strobe between the two cameras.
        if (event.repeat) return;
        event.preventDefault();
        toggleFirstPerson();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Chat, the furniture editor and the tower all cover or replace the floor,
  // so first person cannot stay on behind them.
  useEffect(() => {
    if (
      chatOpen ||
      editorActive ||
      towerOpen ||
      zoeOpen ||
      directoryOpen ||
      onboardingOpen ||
      avatarOpen ||
      tourStep !== null
    )
      exitFirstPerson();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    chatOpen,
    editorActive,
    towerOpen,
    zoeOpen,
    directoryOpen,
    onboardingOpen,
    avatarOpen,
    tourStep,
  ]);

  useEffect(() => {
    const timers = timersRef.current;
    timers.forEach((id) => window.clearTimeout(id));
    return () => {
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, []);

  useEffect(() => {
    if (source.mode === "demo") {
      void source.loadLayouts().then((loaded) => {
        setLayouts(loaded);
      });
    }

    if (window.matchMedia("(max-width: 900px)").matches) {
      setIsMobile(true);
      setMapOpen(false);
    }
    setHydrated(true);
  }, [source]);

  // The intro is per environment and per session: the demo and the real
  // building explain different things, and dismissing one must not hide the
  // other. It opens over the floor, never instead of it.
  useEffect(() => {
    if (phase !== "office") return;
    let dismissed = false;
    try {
      dismissed = Boolean(sessionStorage.getItem(onboardingKey));
    } catch {
      dismissed = false;
    }
    if (dismissed) return;
    const timer = window.setTimeout(() => setOnboardingOpen(true), 900);
    return () => window.clearTimeout(timer);
  }, [phase, onboardingKey]);

  useEffect(() => {
    if (!hydrated || dirtyLayoutsRef.current.size === 0) return;
    const timer = window.setTimeout(() => {
      for (const [roomKey, items] of dirtyLayoutsRef.current) {
        const room = roomById[roomKey];
        if (
          !canEditRoomRef.current(room) ||
          queuedLayoutsRef.current.get(roomKey) === items
        ) {
          continue;
        }
        queuedLayoutsRef.current.set(roomKey, items);
        // Keep each edited room's snapshot, even if the player moves away.
        // Serial writes prevent an older save overwriting a newer edit.
        saveQueueRef.current = saveQueueRef.current.then(async () => {
          try {
            if (
              !canEditRoomRef.current(room) ||
              dirtyLayoutsRef.current.get(roomKey) !== items
            ) {
              return;
            }
            await source.saveLayout(roomKey, items);
            if (dirtyLayoutsRef.current.get(roomKey) === items) {
              dirtyLayoutsRef.current.delete(roomKey);
            }
            setSaveState(
              dirtyLayoutsRef.current.size > 0 || room.kind !== "personal"
                ? "draft"
                : "saved"
            );
          } catch {
            setSaveState("draft");
            showError(
              "Could not save furniture",
              "Your changes are not saved. Edit again to retry."
            );
          } finally {
            if (queuedLayoutsRef.current.get(roomKey) === items) {
              queuedLayoutsRef.current.delete(roomKey);
            }
          }
        });
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [layouts, hydrated, source, roomById, canEditRoom]);

  useEffect(() => {
    if (phase !== "office" || !roomId) return;
    const participants = DEMO_USERS.filter(
      (user) => user.roomId === roomId && user.id !== "zoe" && user.id !== "you"
    );
    if (!participants.length) return;
    const timer = window.setTimeout(() => {
      const user =
        participants[Math.floor(Math.random() * participants.length)];
      const lines = AMBIENT[roomId] ?? AMBIENT.default;
      engineRef.current?.showBubble(
        user.id,
        lines[Math.floor(Math.random() * lines.length)] ?? user.bubble ?? "Hey!"
      );
    }, 1600);
    return () => window.clearTimeout(timer);
  }, [phase, roomId]);

  useEffect(() => {
    // The live office gets its messages from the real conversation, so only
    // the demo simulates the chatter.
    if (phase !== "office" || source.mode !== "demo") return;
    const timer = window.setInterval(() => {
      const state = stateRef.current;
      if (
        !state.roomId ||
        document.visibilityState === "hidden" ||
        state.zoeOpen
      ) {
        return;
      }
      const room = roomById[state.roomId];
      if (!room) return;
      const participants = DEMO_USERS.filter(
        (user) =>
          user.roomId === room.id && user.id !== "you" && user.id !== "zoe"
      );
      if (!participants.length) return;
      const user =
        participants[Math.floor(Math.random() * participants.length)];
      const lines = LIVE_LINES[room.id] ?? LIVE_LINES.default;
      const text = lines[Math.floor(Math.random() * lines.length)];
      const message: ChatMessage = {
        id: `live-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        roomId: room.id,
        userId: user.id,
        name: user.name,
        text,
        at: Date.now(),
      };
      setMessagesByRoom((previous) => ({
        ...previous,
        [room.id]: [...(previous[room.id] ?? []), message],
      }));
      engineRef.current?.showBubble(user.id, text);
      if (!state.chatOpen) setUnread((value) => value + 1);
    }, 22000);
    return () => window.clearInterval(timer);
  }, [phase, source, roomById]);

  useEffect(() => {
    if (!ready || autoTourRef.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("tour") === "1") {
      autoTourRef.current = true;
      startTour();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // Presence is merged rather than replaced: the room snapshot and the
  // realtime stream both carry the same people.
  const mergePresence = useCallback((occupants: OfficeOccupant[]) => {
    // Convert to PresencePoint for the HUD
    const points: PresencePoint[] = occupants.map((occ) => ({
      id: occ.userId,
      name: occ.displayName || occ.username || "Someone",
      x: occ.position?.x ?? 0,
      z: occ.position?.z ?? (occ.position as any)?.y ?? 0,
      roomId: occ.roomId,
      status: occ.status ?? "online",
      tint: occ.avatar?.tint,
    }));

    setPresence(points);
    // The engine draws the room's real people. It drops the signed-in person
    // itself, because that avatar is the one the player is already steering.
    engineRef.current?.setOccupants(occupants);
  }, []);

  // ------------------------------------------------------------------ occupancy
  // Who is standing anywhere in the building: one list, refreshed from a single
  // endpoint instead of one request per room. Live mode asks the backend; demo
  // mode builds it from the seeded directory, which already knows every
  // person's room.
  const fetchOccupancy = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine) return;

    let occupants: OfficeOccupant[] = [];
    if (source.mode === "live") {
      const response = await GetRequest("/office/occupancy");
      // GetRequest returns the error object instead of throwing. Keep the
      // roster that is already on screen rather than blanking the tower on a
      // failed poll.
      const status = (response as { status?: number } | undefined)?.status;
      if (typeof status !== "number" || status < 200 || status >= 300) return;

      // Office routes answer with the usual { status, message, data } envelope,
      // so the roster is `data.data`, with a bare array or `occupants` field
      // accepted as well.
      const envelope = (response as { data?: { data?: unknown } })?.data;
      const payload = envelope?.data ?? envelope;
      const list: unknown[] = Array.isArray(payload)
        ? payload
        : ((payload as { occupants?: unknown[] } | undefined)?.occupants ?? []);
      occupants = list
        .map((item) =>
          normalizeOccupant(item, (item as { roomId?: string })?.roomId ?? "")
        )
        .filter((occ: OfficeOccupant | null): occ is OfficeOccupant =>
          Boolean(occ)
        );
    } else {
      occupants = demoOccupants();
    }

    // Join the roster for name, portrait and tint: the source is the single
    // truth about who a person is, so the tower never invents a second
    // identity for someone.
    const membersById = new Map(source.members.map((m) => [m.userId, m]));
    const byRoom = new Map<string, TowerOccupant[]>();
    for (const occ of occupants) {
      const member = membersById.get(occ.userId) ?? undefined;
      const row: TowerOccupant = {
        userId: occ.userId,
        name: member?.displayName ?? occ.displayName,
        avatarUrl: member?.avatarUrl,
        tint: member?.tint ?? occ.avatar?.tint,
        status: occ.status,
      };
      const list = byRoom.get(occ.roomId) ?? [];
      list.push(row);
      byRoom.set(occ.roomId, list);
    }

    const next = Object.fromEntries(byRoom);
    setOccupantsByRoom(next);
    // Feed the cells without a rebuild unless someone moved rooms.
    engine.setTowerOccupants(next);
  }, [source.members, source.mode]);

  // Demo mode: every seeded person is where their roster says they are, so the
  // directory reads the same way as live's single building-wide read.
  function demoOccupants(): OfficeOccupant[] {
    return DEMO_USERS.filter((user) => !user.isZoe && user.id !== "you").map(
      (user) => ({
        userId: user.id,
        displayName: user.name,
        username: user.username,
        avatar: {
          tint: user.avatar.tint,
          body: user.avatar.body,
          outfit: user.avatar.outfit,
          accessory: user.avatar.accessory,
        },
        roomId: user.roomId,
        status: user.status,
        position: user.position as any,
        rotation: 0,
        updatedAt: new Date().toISOString(),
      })
    );
  }

  // ------------------------------------------------------------------ doors
  useEffect(() => {
    if (phase !== "office" || !source.subscribeDoors) return;
    return source.subscribeDoors(activeFloor, (doorRoomId, open) => {
      setDoorStates((previous) =>
        previous[doorRoomId] === open
          ? previous
          : { ...previous, [doorRoomId]: open }
      );
    });
  }, [source, phase, activeFloor]);

  // Remember the last private floor the visitor stood on, so the return portal
  // on the channels floor is never a guess.
  useEffect(() => {
    if (activeFloor > 0) setLastMemberFloor(activeFloor);
  }, [activeFloor]);

  useEffect(() => {
    engineRef.current?.setDoors(doorStates);
  }, [doorStates, ready]);

  // Single-occupancy rooms (the Focus pods) are the ones a visitor can be
  // turned away from, so their headcount is read from the server before
  // anyone walks up to them. Presence only streams the room the player is in,
  // which is why the other pods on the floor are polled instead.
  const limitedRooms = useMemo(
    () =>
      rooms.filter(
        (room) =>
          room.kind === "focus" &&
          !room.locked &&
          room.capacity > 0 &&
          (room.floorIndex ?? 0) === activeFloor
      ),
    [rooms, activeFloor]
  );
  const [roomCounts, setRoomCounts] = useState<Record<string, number>>({});
  const [availabilityTick, setAvailabilityTick] = useState(0);
  const refreshAvailability = useCallback(
    () => setAvailabilityTick((value) => value + 1),
    []
  );

  useEffect(() => {
    if (source.mode !== "live" || phase !== "office" || !limitedRooms.length)
      return;
    let cancelled = false;
    // A slow read must not land on top of a newer one, so only the latest
    // read is applied.
    let latest = 0;
    const read = () => {
      const sequence = ++latest;
      void Promise.allSettled(
        limitedRooms.map((room) =>
          source
            .fetchOccupants(room.id)
            .then((occupants) => [room.id, occupants.length] as const)
        )
      ).then((results) => {
        if (cancelled || sequence !== latest) return;
        setRoomCounts((previous) => {
          const next = { ...previous };
          for (const result of results) {
            if (result.status === "fulfilled") {
              next[result.value[0]] = result.value[1];
            }
          }
          return next;
        });
      });
    };
    read();
    const timer = window.setInterval(read, AVAILABILITY_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [source, phase, limitedRooms, availabilityTick]);

  // The last read of a pod the player was standing in counted the player too,
  // so it is read again as soon as they move to another room; otherwise the
  // pod they just left would show as full until the next poll.
  useEffect(() => {
    if (source.mode === "live") refreshAvailability();
  }, [source.mode, roomId, refreshAvailability]);

  // Refresh who is standing in the building once in a while so the tower's
  // faces stay current without a page reload and without one request per room.
  useEffect(() => {
    if (phase !== "office" || !ready) return;
    fetchOccupancy();
    const timer = window.setInterval(fetchOccupancy, AVAILABILITY_POLL_MS);
    return () => window.clearInterval(timer);
  }, [phase, ready, fetchOccupancy]);

  // The room the player stands in is judged by the server's answer to their
  // own entry, never by a headcount that may be a few seconds old.
  const fullRoomIds = useMemo(() => {
    const full = new Set<string>();
    for (const room of limitedRooms) {
      if (room.id === roomId) continue;
      if ((roomCounts[room.id] ?? 0) >= room.capacity) full.add(room.id);
    }
    return full;
  }, [limitedRooms, roomCounts, roomId]);

  // The server said no. The player is put back in the corridor, the room is
  // marked full if that was the reason, and the headcounts are read again so
  // the map catches up with the server's decision straight away.
  const handleEntryRejected = useCallback(
    (rejectedId: string, error: unknown) => {
      const room = roomById[rejectedId];
      const name = room?.name ?? "That room";
      const full = isRoomFullError(error);
      // Any answer the server actually gave (4xx or 5xx) means the player was
      // not admitted. A request with no answer at all never gets here: the
      // presence hook retries it instead.
      const refused =
        error instanceof OfficeEntryError && typeof error.status === "number";

      if (full) {
        setRoomCounts((previous) => ({
          ...previous,
          [rejectedId]: Math.max(
            previous[rejectedId] ?? 0,
            room?.capacity ?? 1
          ),
        }));
        showError(
          `${name} is full`,
          "Someone is already in there. Try again once it frees up."
        );
      } else {
        showError(
          `Couldn't enter ${name}`,
          error instanceof Error ? error.message : "Please try again."
        );
      }

      if (full || refused) engineRef.current?.stepOutOfRoom(rejectedId);
      refreshAvailability();
    },
    [roomById, refreshAvailability]
  );

  // Presence, room entry and movement publishing all follow the room the user
  // is in, and all of them are sequenced in one place.
  useOfficePresence({
    source,
    active: phase === "office",
    roomId: inPortal ? null : roomId,
    pose: player,
    onOccupants: mergePresence,
    onState: setPresenceState,
    onEntryRejected: handleEntryRejected,
    onEntered: (enteredId) => handleEntered(enteredId),
  });

  // Telemetry — live mode only, behind the feature flag. The tracker is a pure
  // module; this hook owns the React side and wraps the engine callbacks.
  const telemetry = useOfficeTelemetry({
    source,
    active: phase === "office",
  });

  // The tower is the front door: a visitor who arrives already inside is put
  // in front of the building, with the entrance floor still underneath so
  // closing the tower lands them where they were standing. Both the demo and
  // the live office take this route, and the entry button does too.
  useEffect(() => {
    if (phase !== "office" || !ready) return;
    if (openedInitialTowerRef.current) return;
    openedInitialTowerRef.current = true;

    const engine = engineRef.current;
    if (!engine) return;
    // Stand at the entrance while the tower is in frame, so closing it lands
    // the visitor in reception rather than wherever the engine started.
    if (initialRoom) {
      engine.teleportToRoom(initialRoom.id, true);
    }
    setActiveFloor(engine.getActiveFloor());
    engine.setView("tower");
    engine.focusTowerFloor(null);
    setTowerFocus(null);
    setTowerPreview(null);
    setTowerOpen(true);
    setMapOpen(false);
    setDirectoryOpen(false);
    setChatOpen(false);
    telemetry.towerOpened();
  }, [phase, ready, initialRoom, telemetry]);

  // A room being read is a room whose conversation matters: the one you are
  // standing in, or the one held in frame from the street.
  const readRoomId = towerPreview ?? chatTargetId ?? (inPortal ? null : roomId);

  useEffect(() => {
    if (source.mode !== "live" || phase !== "office" || !readRoomId) return;
    if (historyRef.current.has(readRoomId)) return;
    historyRef.current.add(readRoomId);

    let cancelled = false;
    source
      .fetchMessages(readRoomId)
      .then((messages) => {
        if (cancelled || !messages.length) return;
        setMessagesByRoom((previous) => {
          const local = previous[readRoomId] ?? [];
          const fetched = new Set(messages.map((entry) => entry.id));
          const merged = [
            ...messages,
            ...local.filter((entry) => !fetched.has(entry.id)),
          ].sort((a, b) => a.at - b.at);
          return { ...previous, [readRoomId]: merged };
        });
      })
      .catch(() => {
        // A room that cannot be read is still a room you can stand in, but the
        // next visit should try again.
        historyRef.current.delete(readRoomId);
      });

    return () => {
      cancelled = true;
    };
  }, [source, phase, readRoomId]);

  const ingestLiveMessage = useCallback((message: ChatMessage) => {
    setMessagesByRoom((previous) => {
      const room = previous[message.roomId] ?? [];
      if (room.some((entry) => entry.id === message.id)) return previous;
      return { ...previous, [message.roomId]: [...room, message] };
    });
    if (!stateRef.current.chatOpen) setUnread((value) => value + 1);
    // Whoever is standing here says it out loud; showBubble ignores anyone
    // without a rig, so a message from an empty room stays silent.
    engineRef.current?.showBubble(message.userId, message.text);
  }, []);

  // The room you are in and the office you are reading from the street are
  // usually different rooms, so they carry separate subscriptions.
  const conversationRoomId = chatTargetId ?? (inPortal ? null : roomId);
  useEffect(() => {
    if (source.mode !== "live" || phase !== "office" || !conversationRoomId)
      return;
    return source.subscribeMessages(conversationRoomId, ingestLiveMessage);
  }, [source, phase, conversationRoomId, ingestLiveMessage]);

  useEffect(() => {
    if (source.mode !== "live" || !towerPreview) return;
    return source.subscribeMessages(towerPreview, ingestLiveMessage);
  }, [source, towerPreview, ingestLiveMessage]);

  // ------------------------------------------------------------------- handlers

  /**
   * Handles a room change from the engine. Resets editor state, updates the
   * active room, and reports corridor exits to telemetry so dwell is recorded
   * when leaving a room into the corridor.
   */
  function handleRoomChange(room: typeof currentRoom) {
    const state = stateRef.current;
    const previousId = state.roomId;
    const nextId = room?.id ?? null;

    // The cooldown exists only to stop the landing portal from bouncing the
    // player straight back. Stepping out of it means the next entry is
    // deliberate, so it should travel again.
    const previousRoom = previousId ? roomById[previousId] : undefined;
    if (previousRoom?.kind === "portal" && room?.kind !== "portal") {
      portalCooldownRef.current = 0;
    }

    if (previousId !== nextId) {
      if (state.editorActive) {
        setEditorActive(false);
        setEditorCatalogId(null);
        setEditorMovingId(null);
        setEditorRotation(0);
        setSelectedFurnitureId(null);
        showInfo("Furnish mode closed", "You left the room you were editing.");
      }
      setUndoStack([]);
      setRedoStack([]);
      setSelectedFurnitureId(null);
    }

    setChatTargetId(null);
    setRoomId(nextId);

    // Forward corridor exits to telemetry so dwell is recorded when leaving
    // a room into the corridor. Destination-room entries are reported by
    // handleEntered below.
    if (!room) {
      telemetry.roomChanged(null, "", "", 0, "walk");
    }

    if (!room) {
      setChatOpen(false);
    } else if (room.kind === "portal") {
      // Walking through the doorway swaps the storey in place.
      setChatOpen(false);
      travelThroughPortal();
      return;
    } else if (room.kind === "channel") {
      setChatOpen(true);
      setUnread(0);
    }
  }

  /**
   * Handles the player entering a room. Announces focus mode and reports the
   * entered room to telemetry, resolved from roomById so the corridor (null
   * room) is never recorded as a room entry.
   */
  function handleEntered(enteredId: string) {
    if (roomById[enteredId]?.kind === "focus") {
      showInfo("Focus mode", "Your status is now Do not disturb.");
    }

    const enteredRoom = roomById[enteredId];
    telemetry.roomChanged(
      enteredRoom?.id ?? null,
      enteredRoom?.kind ?? "",
      enteredRoom?.refId ?? "",
      enteredRoom?.floorIndex ?? 0,
      pendingTeleportRef.current?.via ?? "walk"
    );
    pendingTeleportRef.current = null;
  }

  // ------------------------------------------------------------ view controls

  /**
   * First person is a view, not a place: anything that covers the floor or
   * moves the body ends it, so the two cameras never fight over the frame.
   */
  function setFirstPersonView(next: boolean) {
    setFirstPerson(next);
    engineRef.current?.setFirstPerson(next);
  }

  function toggleFirstPerson() {
    const state = stateRef.current;
    // The eye button is hidden on mobile, so V must not open the desktop view.
    // Keep the exit path available if first person is already active.
    if (state.isMobile && !state.firstPerson) return;
    // A panel needs the pointer; capturing it behind one traps the cursor.
    if (
      state.chatOpen ||
      state.editorActive ||
      state.towerOpen ||
      state.zoeOpen ||
      state.directoryOpen ||
      state.onboardingOpen ||
      state.avatarOpen ||
      state.tourStep !== null
    )
      return;
    setFirstPersonView(!state.firstPerson);
  }

  function exitFirstPerson() {
    if (stateRef.current.firstPerson) setFirstPersonView(false);
  }

  // ---------------------------------------------------------------- the tower

  function openTower() {
    setChatTargetId(null);
    const engine = engineRef.current;
    if (!engine) return;
    setActiveFloor(engine.getActiveFloor());
    engine.setView("tower");
    engine.focusTowerFloor(null);
    setTowerFocus(null);
    setTowerPreview(null);
    setTowerOpen(true);
    setMapOpen(false);
    setDirectoryOpen(false);
    setChatOpen(false);
    telemetry.towerOpened();
  }

  /**
   * Closes the tower view and resumes dwell tracking for the room that was
   * active before the tower opened, so tracking restarts without requiring a
   * new room-entry callback.
   */
  function closeTower() {
    engineRef.current?.setView("floor");
    setTowerOpen(false);
    setTowerHover(null);
    setTowerPreview(null);
    setLiftTarget(null);
    setTowerFocus(null);
    telemetry.towerClosed();
  }

  function showWholeTower() {
    engineRef.current?.focusTowerFloor(null);
    setTowerFocus(null);
    setTowerPreview(null);
    setChatOpen(false);
  }

  /**
   * The floor picker frames a storey; it never teleports. Going inside is a
   * decision about one office, made by clicking it twice.
   */
  function selectFloor(floorIndex: number) {
    const engine = engineRef.current;
    if (!engine) return;

    if (towerFocus === floorIndex && floorIndex !== engine.getActiveFloor()) {
      showWholeTower();
      return;
    }

    engine.focusTowerFloor(floorIndex);
    setTowerFocus(floorIndex);
    setTowerPreview(null);
    setChatOpen(false);
    setLiftTarget(floorIndex);
    schedule(() => setLiftTarget(null), 850);
  }

  /**
   * Step into an office seen from the street. The lift ride covers the moment
   * the storey is rebuilt in 3D, and the room's last messages are spoken the
   * moment the player lands so the place does not arrive silent.
   */
  function diveIntoRoom(targetId: string, floorIndex: number) {
    const engine = engineRef.current;
    if (!engine) return;

    const target = roomById[targetId];
    if (target?.locked) {
      engine.pulseOffice(targetId, floorIndex);
      showInfo("Locked office", target.description);
      return;
    }

    setLiftTarget(floorIndex);
    pendingTeleportRef.current = { roomId: targetId, via: "tower" };
    schedule(() => {
      telemetry.towerClosed(false);
      engine.setView("floor");
      exitFirstPerson();
      engine.focusRoom(targetId);
      setRoomId(targetId);
      setActiveFloor(floorIndex);
      setTowerOpen(false);
      setTowerHover(null);
      setTowerPreview(null);
      setLiftTarget(null);
      setChatOpen(true);
      speakRecent(targetId);
    }, 750);
  }

  /** The last couple of messages of a room, said by whoever is standing in it. */
  function speakRecent(targetId: string) {
    const engine = engineRef.current;
    if (!engine) return;
    const inRoom = new Set(
      presence
        .filter((point) => point.roomId === targetId)
        .map((point) => point.id)
    );
    for (const message of (messagesByRoom[targetId] ?? []).slice(-3)) {
      if (message.self) continue;
      // On live the roster for the room is only asked for when you arrive, so
      // the sender is not known at this instant. showBubble already ignores
      // anyone without a rig, so the check is only needed in the demo.
      if (source.mode !== "live" && !inRoom.has(message.userId)) continue;
      engine.showBubble(message.userId, message.text);
    }
  }

  /**
   * The single click model for the tower, shared by the search list and a click
   * on the tower itself. The first click frames one room and opens its
   * conversation without moving the player or joining the room; the second
   * click on the same room walks in.
   */
  function pickTowerRoom(office: { roomId: string; floorIndex: number }) {
    const engine = engineRef.current;
    if (!engine) return;

    const target = roomById[office.roomId];
    const walkable = Boolean(target);

    // Reading a locked room is not allowed either: its conversation is the
    // private DM or a channel this requester is not in, and the server refuses
    // to serve it. Show the door and leave it closed instead of opening an
    // empty chat that cannot send.
    if (target?.locked) {
      engine.pulseOffice(office.roomId, office.floorIndex);
      engine.focusTowerRoom(office.roomId);
      setTowerFocus(office.floorIndex);
      setTowerPreview(null);
      setChatOpen(false);
      showInfo(
        target.kind === "personal" ? "Locked office" : "Locked room",
        target.description
      );
      return;
    }

    // Second click on the same room: go in. The first click only reads it.
    if (walkable && towerPreview === office.roomId) {
      diveIntoRoom(office.roomId, office.floorIndex);
      return;
    }

    // First click: hold this one room in frame and open its conversation.
    // Reading a room from the street is not entering it, so the player stays
    // where they are and no room is joined.
    engine.pulseOffice(office.roomId, office.floorIndex);
    engine.focusTowerRoom(office.roomId);
    setTowerFocus(office.floorIndex);
    setLiftTarget(office.floorIndex);
    schedule(() => setLiftTarget(null), 850);

    if (!walkable) {
      // A directory office on a storey the plan does not have yet.
      setTowerPreview(null);
      setChatOpen(false);
      return;
    }

    setTowerPreview(office.roomId);
    setChatOpen(true);
  }

  handlersRef.current = {
    onReady: () => setReady(true),
    onError: (message) => {
      setReady(false);
      setEngineError(message);
    },
    onRoomChange: handleRoomChange,
    onPosition: (x, z, yaw) => setPlayer({ x, z, yaw }),
    onZoeProximity: setNearZoe,
    onDoorProximity: setNearDoorId,
    onFurnitureSelect: (id) => {
      setSelectedFurnitureId(id);
      if (id) {
        setEditorCatalogId(null);
        setEditorMovingId(null);
      }
    },
    onRequestPlace: (x, z) => placeFurniture(x, z),
    onRequestMove: (id, x, z) => moveFurniture(id, x, z),
    onPresence: (users) => setPresence(users),
    onGhostState: (valid, reason) => {
      setGhostReason(valid ? null : reason);
    },
    onInvalidTarget: () => {
      const now = Date.now();
      if (now - lastInvalidRef.current < 1600) return;
      lastInvalidRef.current = now;
      showInfo("Can't walk there", "Try a clear path or a doorway.");
    },
    // A click on the canvas takes the same path as picking someone from the
    // search: the first click frames and previews the office, the second goes in.
    onTowerPick: ({ roomId: picked, floorIndex }) => {
      // A click on the tower and a click on a search result are the same
      // gesture, so they share one handler: frame and read first, then enter.
      pickTowerRoom({ roomId: picked, floorIndex });
    },
    onTowerHover: (office) => setTowerHover(office),
  };

  function recordHistory(roomKey: string) {
    const snapshot = (stateRef.current.layouts[roomKey] ?? []).map((item) => ({
      ...item,
    }));
    setUndoStack((previous) => [...previous.slice(-24), snapshot]);
    setRedoStack([]);
  }

  function commitRoom(roomKey: string, nextItems: FurnitureItem[]) {
    if (!canEditRoom(roomById[roomKey])) return;
    if (
      JSON.stringify(stateRef.current.layouts[roomKey] ?? []) ===
      JSON.stringify(nextItems)
    ) {
      return;
    }
    recordHistory(roomKey);
    dirtyLayoutsRef.current.set(roomKey, nextItems);
    setLayouts((previous) => ({ ...previous, [roomKey]: nextItems }));
    setSaveState("saving");
  }

  /**
   * P (or a click) commits the green ghost. A red ghost is refused with the
   * reason, so the placement rules are never a mystery.
   */
  function placeGhost() {
    const state = stateRef.current;
    if (!state.editorActive) return;
    const engine = engineRef.current;
    if (!engine) return;
    if (!state.editorCatalogId && !state.editorMovingId) {
      showInfo(
        "Pick an item first",
        "Choose a piece from the catalogue, then hover the floor."
      );
      return;
    }
    const placed = engine.placeGhost();
    if (!placed && state.ghostReason) {
      showError("Can't place there", state.ghostReason);
    }
  }

  function placeFurniture(x: number, z: number) {
    const state = stateRef.current;
    const room = state.roomId ? roomById[state.roomId] : null;
    const catalogId = state.editorCatalogId;
    if (!room || !catalogId) return;
    const hovered = findRoomAt(x, z);
    if (!hovered || hovered.id !== room.id) {
      showError("Can't place there", "That spot is outside this room.");
      return;
    }
    const items = state.layouts[room.id] ?? [];
    const error = validatePlacement(
      items,
      catalogId,
      x,
      z,
      state.editorRotation,
      room
    );
    if (error) {
      showError("Can't place there", error);
      return;
    }
    const item: FurnitureItem = {
      id: `f-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      roomId: room.id,
      catalogId,
      x,
      z,
      rotation: state.editorRotation as 0 | 90 | 180 | 270,
    };
    commitRoom(room.id, [...items, item]);
    setSelectedFurnitureId(item.id);
    setEditorCatalogId(null);
    setEditorMovingId(null);
    setEditorRotation(0);
    setGhostReason(null);
    showSuccess("Placed", CATALOG_BY_ID[catalogId]?.name ?? "Item");
  }

  function moveFurniture(id: string, x: number, z: number) {
    const state = stateRef.current;
    const room = state.roomId ? roomById[state.roomId] : null;
    if (!room) return;
    const items = state.layouts[room.id] ?? [];
    const item = items.find((entry) => entry.id === id);
    if (!item) return;
    const hovered = findRoomAt(x, z);
    if (!hovered || hovered.id !== room.id) {
      showError("Can't move there", "That spot is outside this room.");
      return;
    }
    const error = validatePlacement(
      items.filter((entry) => entry.id !== id),
      item.catalogId,
      x,
      z,
      item.rotation,
      room
    );
    if (error) {
      showError("Can't move there", error);
      return;
    }
    commitRoom(
      room.id,
      items.map((entry) => (entry.id === id ? { ...entry, x, z } : entry))
    );
    setEditorMovingId(null);
    setSelectedFurnitureId(id);
    setGhostReason(null);
    showSuccess("Moved", CATALOG_BY_ID[item.catalogId]?.name ?? "Item");
  }

  function rotateSelected() {
    const state = stateRef.current;
    const room = state.roomId ? roomById[state.roomId] : null;
    if (!room) return;
    if (!state.selectedFurnitureId) {
      if (state.editorCatalogId) {
        const catalog = CATALOG_BY_ID[state.editorCatalogId];
        if (!catalog?.rotatable) {
          showInfo(
            "This item can't rotate",
            "Try another piece or a different spot."
          );
          return;
        }
        setEditorRotation((value) => (value + 90) % 360);
      }
      return;
    }
    const items = state.layouts[room.id] ?? [];
    const item = items.find((entry) => entry.id === state.selectedFurnitureId);
    if (!item) return;
    const catalog = CATALOG_BY_ID[item.catalogId];
    if (!catalog?.rotatable) {
      showInfo(
        "This item can't rotate",
        "Try another piece or a different spot."
      );
      return;
    }
    const rotation = ((item.rotation + 90) % 360) as 0 | 90 | 180 | 270;
    const error = validatePlacement(
      items.filter((entry) => entry.id !== item.id),
      item.catalogId,
      item.x,
      item.z,
      rotation,
      room
    );
    if (error) {
      showError("Can't rotate", error);
      return;
    }
    commitRoom(
      room.id,
      items.map((entry) =>
        entry.id === item.id ? { ...entry, rotation } : entry
      )
    );
    setEditorRotation(rotation);
  }

  function deleteSelected() {
    const state = stateRef.current;
    const room = state.roomId ? roomById[state.roomId] : null;
    if (!room || !state.selectedFurnitureId) return;
    const items = state.layouts[room.id] ?? [];
    const item = items.find((entry) => entry.id === state.selectedFurnitureId);
    if (!item) return;
    commitRoom(
      room.id,
      items.filter((entry) => entry.id !== state.selectedFurnitureId)
    );
    setSelectedFurnitureId(null);
    setEditorCatalogId(null);
    setEditorMovingId(null);
    showSuccess("Removed", CATALOG_BY_ID[item.catalogId]?.name ?? "Item");
  }

  function undo() {
    const state = stateRef.current;
    const roomKey = state.roomId;
    if (!roomKey || !canEditRoom(roomById[roomKey]) || undoStack.length === 0) {
      return;
    }
    const previous = undoStack[undoStack.length - 1];
    dirtyLayoutsRef.current.set(roomKey, previous);
    const current = state.layouts[roomKey] ?? [];
    setUndoStack((stack) => stack.slice(0, -1));
    setRedoStack((stack) => [...stack, current]);
    setLayouts((previousLayouts) => ({
      ...previousLayouts,
      [roomKey]: previous,
    }));
    setSelectedFurnitureId(null);
    setEditorCatalogId(null);
    setEditorMovingId(null);
    setSaveState("saving");
    showInfo("Undone");
  }

  function redo() {
    const state = stateRef.current;
    const roomKey = state.roomId;
    if (!roomKey || !canEditRoom(roomById[roomKey]) || redoStack.length === 0) {
      return;
    }
    const next = redoStack[redoStack.length - 1];
    dirtyLayoutsRef.current.set(roomKey, next);
    const current = state.layouts[roomKey] ?? [];
    setRedoStack((stack) => stack.slice(0, -1));
    setUndoStack((stack) => [...stack, current]);
    setLayouts((previousLayouts) => ({
      ...previousLayouts,
      [roomKey]: next,
    }));
    setSelectedFurnitureId(null);
    setEditorCatalogId(null);
    setEditorMovingId(null);
    setSaveState("saving");
    showInfo("Redone");
  }

  function resetRoom() {
    const room = currentRoom;
    if (!room) return;
    void source
      .resetLayout(room.id)
      .then((defaults) => {
        commitRoom(room.id, defaults);
        setSelectedFurnitureId(null);
        setEditorCatalogId(null);
        setEditorMovingId(null);
        showSuccess("Room reset", "Back to the starter layout.");
      })
      .catch(() => {
        showError("Could not reset the room", "Try again in a moment.");
      });
  }

  function publishLayout() {
    if (!currentRoom || !canEditRoom(currentRoom)) return;
    const room = currentRoom;
    const items = layouts[room.id] ?? [];
    setSaveState("saving");
    dirtyLayoutsRef.current.delete(room.id);
    const publish = saveQueueRef.current.then(() =>
      source.publishLayout(room.id, items)
    );
    saveQueueRef.current = publish.catch(() => {});
    void publish
      .then(() => {
        setSaveState(dirtyLayoutsRef.current.size > 0 ? "draft" : "saved");
        showSuccess(
          "Layout published",
          `Everyone in ${room.name} can see the new arrangement.`
        );
      })
      .catch(() => {
        setSaveState("draft");
        if (!dirtyLayoutsRef.current.has(room.id)) {
          dirtyLayoutsRef.current.set(room.id, items);
        }
        showError("Could not publish", "Your draft is still saved locally.");
      });
  }

  function clearSelection() {
    setSelectedFurnitureId(null);
    setEditorCatalogId(null);
    setEditorMovingId(null);
    setEditorRotation(0);
  }

  function closeEditor() {
    setEditorActive(false);
    setEditorCatalogId(null);
    setEditorMovingId(null);
    setEditorRotation(0);
    setSelectedFurnitureId(null);
    setGhostReason(null);
  }

  function toggleEditor() {
    const state = stateRef.current;
    if (state.editorActive) {
      closeEditor();
      return;
    }
    const room = state.roomId ? roomById[state.roomId] : null;
    if (!room) {
      showInfo("Find a room first", "Walk into a room to furnish it.");
      return;
    }
    if (room.locked) {
      showError("Locked room", room.description);
      return;
    }
    if (room.kind === "portal") {
      showInfo("This is a doorway", "Walk through it to change floors.");
      return;
    }
    if (room.kind === "personal" && room.ownerId !== selfId) {
      showError("Read-only office", "Only the owner can furnish this office.");
      return;
    }
    if (!canEditRoom(room)) {
      showError(
        "Read-only room",
        "Only administrators can furnish shared rooms."
      );
      return;
    }
    setEditorActive(true);
    setEditorCatalogId(null);
    setEditorMovingId(null);
    setEditorRotation(0);
    setSelectedFurnitureId(null);
    setGhostReason(null);
    setChatOpen(false);
    setZoeOpen(false);
    setDirectoryOpen(false);
    setOnboardingOpen(false);
    setSaveState(
      dirtyLayoutsRef.current.has(room.id) || room.kind !== "personal"
        ? "draft"
        : "saved"
    );
  }

  function toggleDoor() {
    const door = stateRef.current.nearDoor;
    if (!door) return;
    if (!door.own) {
      showInfo(
        door.open ? "Not your door" : "The door is shut",
        door.open
          ? `Only ${door.name} can open or close this door.`
          : `${door.name} has shut their door. Say hello in the conversation instead.`
      );
      return;
    }
    if (!source.setDoor) return;
    source.setDoor(door.roomId, !door.open).catch((error: unknown) => {
      showError(
        "The door didn't move",
        error instanceof Error ? error.message : "Please try again."
      );
    });
  }

  function openZoe() {
    const state = stateRef.current;
    if (!state.nearZoe) {
      showInfo(
        "Zoe is at reception",
        "Follow the gold ring by the front desk."
      );
      return;
    }
    if (state.editorActive) closeEditor();
    setZoeOpen(true);
    setChatOpen(false);
    setDirectoryOpen(false);
    setAvatarOpen(false);
    setOnboardingOpen(false);
    engineRef.current?.faceZoe();
  }

  function openAvatar() {
    setAvatarDraft(avatar);
    setAvatarOpen(true);
    exitFirstPerson();
    setZoeOpen(false);
    setChatOpen(false);
    setDirectoryOpen(false);
    setOnboardingOpen(false);
    if (editorActive) closeEditor();
  }

  function saveAvatar() {
    setAvatar(avatarDraft);
    void source
      .saveAvatar(avatarDraft)
      .then(() => {
        setAvatarOpen(false);
        showSuccess("Look saved", "Everyone in The Office will see it.");
      })
      .catch(() => {
        showError("Could not save your look", "Try again in a moment.");
      });
  }

  function cancelAvatar() {
    setAvatarDraft(avatar);
    setAvatarOpen(false);
  }

  function toggleChat() {
    const state = stateRef.current;
    const room = chatTargetId
      ? roomById[chatTargetId]
      : state.roomId
        ? roomById[state.roomId]
        : null;
    if (
      !state.chatOpen &&
      (!room || (!room.chat && room.kind !== "personal"))
    ) {
      showInfo(
        "No chat here",
        room?.kind === "personal"
          ? "This office has no linked conversation. Open a DM in Zedu, then reload Office."
          : "Walk into a channel room or a private office."
      );
      return;
    }
    if (!state.chatOpen && state.editorActive) closeEditor();
    setChatOpen((value) => {
      const next = !value;
      if (next) setUnread(0);
      return next;
    });
  }

  function openConversation(id: string) {
    const target = existingConversations.find((room) => room.id === id);
    if (!target) return;
    if (towerOpen) setTowerPreview(id);
    else setChatTargetId(id);
    setChatOpen(true);
    setUnread(0);
  }

  function appendMessage(message: ChatMessage) {
    setMessagesByRoom((previous) => ({
      ...previous,
      [message.roomId]: [...(previous[message.roomId] ?? []), message],
    }));
  }

  async function sendChat(text: string, overrideRoomId?: string) {
    const state = stateRef.current;
    const id = overrideRoomId ?? state.roomId;
    const room = id ? roomById[id] : null;
    if (!room?.chat) {
      throw new Error("This space has no linked conversation.");
    }
    if (source.mode === "live") {
      const sent = await source.sendMessage(room.id, text);
      if (!sent.length)
        throw new Error(
          "The message could not be confirmed. Your draft is kept."
        );
      for (const message of sent) appendMessage(message);
      engineRef.current?.showBubble("you", text);
      return;
    }
    appendMessage({
      id: `me-${Date.now()}`,
      roomId: room.id,
      userId: selfId,
      name: selfName,
      text,
      at: Date.now(),
      self: true,
    });
    engineRef.current?.showBubble("you", text);

    const responder =
      DEMO_USERS.find(
        (user) =>
          user.roomId === room.id && user.id !== "you" && user.id !== "zoe"
      ) ?? DEMO_USERS[0];
    const lines = REPLIES[room.id] ?? REPLIES.default;
    const reply = lines[Math.floor(Math.random() * lines.length)];

    schedule(
      () => {
        appendMessage({
          id: `reply-${Date.now()}`,
          roomId: room.id,
          userId: responder.id,
          name: responder.name,
          text: reply,
          at: Date.now(),
        });
        engineRef.current?.showBubble(responder.id, reply);
      },
      1100 + Math.random() * 800
    );
  }

  async function askZoe(question: string): Promise<string> {
    const context: OfficeZoeContext = {
      room: {
        id: currentRoom?.id ?? "lobby",
        kind: (currentRoom?.kind ??
          "lobby") as OfficeZoeContext["room"]["kind"],
        name: currentRoom?.name ?? "The Office",
      },
      nearbyUsers: nearbyNames.map((name) => ({
        displayName: name,
        status: "online" as const,
      })),
    };

    return source.askZoe(question, context);
  }

  function dismissOnboarding() {
    setOnboardingOpen(false);
    try {
      sessionStorage.setItem(onboardingKey, "1");
    } catch {
      // Ignore.
    }
  }

  function startTour() {
    setOnboardingOpen(false);
    // The guided tour walks the floor, so it counts as having chosen a storey:
    // the arrival effect must not pull the visitor back to the tower.
    openedInitialTowerRef.current = true;
    setPhase("office");
    setTourStep(0);
    engineRef.current?.setView("floor");
    engineRef.current?.setCinematic(false);
    try {
      sessionStorage.setItem(onboardingKey, "1");
    } catch {
      // Ignore.
    }
    schedule(() => runTourAction(0), 420);
  }

  function runTourAction(index: number) {
    const engine = engineRef.current;
    if (!engine) return;

    // The tour has to resolve the live plan's ids: a channel room is
    // channel:<uuid> and a person's office is personal:<user-id>. The demo
    // keeps #design and the seeded personal office by name.
    const reception = rooms.find((room) => room.kind === "reception");
    const channel =
      rooms.find(
        (room) =>
          room.kind === "channel" &&
          room.chat &&
          !room.locked &&
          room.name === "#design"
      ) ??
      rooms.find(
        (room) => room.kind === "channel" && room.chat && !room.locked
      );
    const ownOffice = rooms.find(
      (room) => room.kind === "personal" && room.ownerId === selfId
    );

    if (index === 0 || index === 1) {
      if (reception) navigateToRoom(reception.id);
      return;
    }

    if (index === 2) {
      if (!channel) return;
      navigateToRoom(channel.id);
      schedule(() => setChatOpen(true), 760);
      return;
    }

    if (index === 3) {
      if (!ownOffice) return;
      navigateToRoom(ownOffice.id);
      schedule(() => {
        const state = stateRef.current;
        if (state.roomId !== ownOffice.id) return;
        setChatOpen(false);
        setEditorActive(true);
        setEditorCatalogId(null);
        setEditorMovingId(null);
        setEditorRotation(0);
        setSelectedFurnitureId(null);
        setSaveState("saved");
      }, 820);
      return;
    }

    if (index === 4) {
      if (reception) navigateToRoom(reception.id);
      schedule(() => {
        setChatOpen(false);
        engine.faceZoe();
        setZoeOpen(true);
      }, 820);
      return;
    }

    if (index === 5) {
      setZoeOpen(false);
      openAvatar();
    }
  }

  function nextTour() {
    if (tourStep === null) return;
    if (tourStep >= TOUR_STEPS.length - 1) {
      setTourStep(null);
      showSuccess(
        "Tour complete",
        "The map, directory and Zoe are always one click away."
      );
      return;
    }
    const next = tourStep + 1;
    setTourStep(next);
    runTourAction(next);
  }

  function backTour() {
    if (tourStep === null || tourStep === 0) return;
    const previous = tourStep - 1;
    setTourStep(previous);
    runTourAction(previous);
  }

  function exitTour() {
    setTourStep(null);
    setZoeOpen(false);
    setAvatarOpen(false);
    setAvatarDraft(avatar);
  }

  /**
   * The portal is the second door between the two wings of the building. It
   * swaps the storey in place and lands the player inside the matching portal
   * on the other side, so only one floor is ever built in 3D.
   */
  function travelThroughPortal() {
    const engine = engineRef.current;
    if (!engine) return;
    if (Date.now() < portalCooldownRef.current) return;

    const from = engine.getActiveFloor();
    const target = from === 0 ? (lastMemberFloor ?? topMemberFloor) : 0;
    if (target === null || target === from) return;

    const portal = rooms.find(
      (room) => room.kind === "portal" && (room.floorIndex ?? 0) === target
    );
    if (!portal) return;

    // Opening the portal from the minimap leaves the current room without a
    // corridor step, so close that dwell before the crossing suppresses the
    // pair it would otherwise produce.
    telemetry.roomChanged(null, "", "", from, "walk");
    telemetry.portalCross("portal");
    portalCooldownRef.current = Date.now() + 1500;
    closeEditor();
    setChatOpen(false);
    setDirectoryOpen(false);
    setZoeOpen(false);
    setAvatarOpen(false);
    setOnboardingOpen(false);
    setFading(true);
    schedule(() => {
      engine.setView("floor");
      engine.setActiveFloor(target);
      engine.movePlayerTo(portal.spawn.x, portal.spawn.z, Math.PI);
      setActiveFloor(target);
      setRoomId(portal.id);
      if (target > 0) setLastMemberFloor(target);
      schedule(() => setFading(false), 140);
    }, 160);
  }

  function navigateToRoom(id: string) {
    const room = roomById[id];
    if (!room) return;
    if (room.locked) {
      showError(
        room.kind === "personal" ? "Private office" : "Locked room",
        room.kind === "personal"
          ? `${room.name} keeps their own door. Say hello in the conversation instead.`
          : room.description
      );
      return;
    }
    // A portal is not a destination on this floor: the map click walks through
    // it, exactly as walking into the doorway does.
    if (room.kind === "portal") {
      travelThroughPortal();
      return;
    }
    if (doorStates[id] === false && !ownsOffice(room)) {
      showInfo(
        "The door is shut",
        `${room.name} has shut their door. Say hello in the conversation instead.`
      );
      return;
    }
    if (fullRoomIds.has(id)) {
      // The headcount may be a few seconds old, so it is read again: a pod
      // that has just freed up is open on the next click.
      refreshAvailability();
      showInfo(
        `${room.name} is occupied`,
        "It's single occupancy and someone is in there. Try another pod."
      );
      return;
    }
    const engine = engineRef.current;
    if (!engine) return;
    exitFirstPerson();
    closeEditor();
    setDirectoryOpen(false);
    setZoeOpen(false);
    setAvatarOpen(false);
    setOnboardingOpen(false);
    setFading(true);
    schedule(() => {
      engine.teleportToRoom(id, true);
      schedule(() => setFading(false), 130);
    }, 150);
  }

  function openDirectory() {
    setDirectoryOpen(true);
    setChatOpen(false);
    setZoeOpen(false);
    setAvatarOpen(false);
    setOnboardingOpen(false);
    if (editorActive) closeEditor();
  }

  function help() {
    setOnboardingOpen(true);
    setChatOpen(false);
    setZoeOpen(false);
    setAvatarOpen(false);
    setDirectoryOpen(false);
    if (editorActive) closeEditor();
  }

  // The arrival effect opens the tower once the phase is "office", so the
  // button only hands over; it does not choose a view of its own.
  function enterOffice() {
    if (!ready) return;
    setPhase("office");
    engineRef.current?.setCinematic(false);
  }

  /**
   * Leaving the office means going back to where the conversations live, not
   * to another screen of the same building. The live route knows its
   * organisation; the demo has no session to return to, so it goes home.
   */
  function exitDemo() {
    if (onExit) {
      onExit();
      return;
    }
    setTourStep(null);
    setChatOpen(false);
    setZoeOpen(false);
    setAvatarOpen(false);
    setDirectoryOpen(false);
    closeEditor();
    router.push("/");
  }

  function closeTopLayer() {
    const state = stateRef.current;
    if (state.zoeOpen) {
      setZoeOpen(false);
      return;
    }
    if (state.avatarOpen) {
      setAvatarDraft(state.avatar);
      setAvatarOpen(false);
      return;
    }
    if (state.directoryOpen) {
      setDirectoryOpen(false);
      return;
    }
    if (state.editorActive) {
      closeEditor();
      return;
    }
    if (state.chatOpen) {
      setChatOpen(false);
      return;
    }
    if (state.onboardingOpen) {
      dismissOnboarding();
      return;
    }
    if (state.tourStep !== null) {
      setTourStep(null);
    }
  }

  const rotation = selectedItem ? selectedItem.rotation : editorRotation;

  return (
    <div className="office-root">
      <div ref={containerRef} className="office-canvas" />
      <div className="office-vignette" />

      <div
        className={cn(
          "pointer-events-none absolute inset-0 z-10 bg-[#070911] transition-opacity duration-200",
          fading ? "opacity-100" : "opacity-0"
        )}
      />

      {phase === "entry" && (
        <EntryScreen
          ready={ready}
          avatar={avatar}
          mode={source.mode}
          onEnter={enterOffice}
          onTour={startTour}
        />
      )}

      {phase === "office" && !towerOpen && (
        <>
          <Hud
            room={currentRoom}
            rooms={floorRooms}
            onlineCount={onlineCount}
            presenceState={source.mode === "live" ? presenceState : "live"}
            currentRoomId={roomId}
            player={player}
            presence={presence}
            avatar={avatar}
            selfName={selfName}
            selfRole={
              self?.role ?? (source.mode === "demo" ? "Product Designer" : "")
            }
            nearZoe={nearZoe}
            door={nearDoor}
            onToggleDoor={toggleDoor}
            unread={unread}
            chatOpen={chatOpen}
            editorOpen={editorActive}
            isMobile={isMobile}
            firstPerson={firstPerson}
            mouseLook={mouseLook}
            mapOpen={mapOpen}
            fullRoomIds={fullRoomIds}
            onToggleMap={() => setMapOpen((value) => !value)}
            onToggleFirstPerson={toggleFirstPerson}
            onOpenDirectory={openDirectory}
            onOpenAvatar={openAvatar}
            onOpenTower={openTower}
            onToggleChat={toggleChat}
            onToggleEditor={toggleEditor}
            onHelp={help}
            onExit={exitDemo}
            onNavigate={navigateToRoom}
            onInteract={openZoe}
          />

          <RoomDirectory
            open={directoryOpen}
            rooms={directoryRooms}
            currentRoomId={roomId}
            presence={presence}
            playerRoomId={roomId}
            roomCounts={roomCounts}
            fullRoomIds={fullRoomIds}
            onClose={() => setDirectoryOpen(false)}
            onNavigate={navigateToRoom}
          />

          <ChatPanel
            open={chatOpen}
            room={chatRoom}
            messages={currentMessages}
            onSend={(text) => sendChat(text, chatTargetId ?? undefined)}
            conversations={existingConversations}
            onChooseConversation={openConversation}
            onClose={() => {
              setChatOpen(false);
              setChatTargetId(null);
            }}
            live={source.mode === "live"}
          />

          {editorActive && currentRoom && canEdit && (
            <FurniturePanel
              room={currentRoom}
              items={currentItems}
              catalogId={editorCatalogId}
              selected={selectedItem}
              rotation={rotation}
              saveState={saveState}
              canUndo={undoStack.length > 0}
              canRedo={redoStack.length > 0}
              isShared={isShared}
              hint={ghostReason}
              isMobile={isMobile}
              onSelectCatalog={(id) => {
                setEditorCatalogId(id);
                setEditorMovingId(null);
                setSelectedFurnitureId(null);
                setEditorRotation(0);
                setGhostReason(null);
              }}
              onMove={() => {
                if (!selectedItem) return;
                setEditorMovingId(selectedItem.id);
                setEditorCatalogId(null);
                setEditorRotation(selectedItem.rotation);
              }}
              onRotate={rotateSelected}
              onDelete={deleteSelected}
              onUndo={undo}
              onRedo={redo}
              onReset={resetRoom}
              onPublish={publishLayout}
              onClose={closeEditor}
              onClearSelection={clearSelection}
            />
          )}

          <Onboarding
            open={onboardingOpen}
            name={selfName}
            mode={source.mode}
            onClose={dismissOnboarding}
            onTour={startTour}
          />

          {tourStep !== null && (
            <TourOverlay
              step={tourStep}
              total={TOUR_STEPS.length}
              data={TOUR_STEPS[tourStep]}
              onNext={nextTour}
              onBack={backTour}
              onExit={exitTour}
            />
          )}
        </>
      )}

      {phase === "office" && towerOpen && (
        <TowerView
          floors={source.floors ?? []}
          offices={towerOffices}
          currentFloor={activeFloor}
          focusedFloor={towerFocus}
          liftTarget={liftTarget}
          hovered={towerHover}
          onSelectFloor={selectFloor}
          onShowTower={showWholeTower}
          onClose={closeTower}
          onLeave={exitDemo}
          onPickRoom={pickTowerRoom}
        />
      )}

      {phase === "office" && towerOpen && towerPreview && (
        <ChatPanel
          open={chatOpen}
          room={roomById[towerPreview] ?? null}
          messages={messagesByRoom[towerPreview] ?? []}
          live={source.mode === "live"}
          onSend={(text) => sendChat(text, towerPreview)}
          conversations={existingConversations}
          onChooseConversation={openConversation}
          onClose={() => {
            setChatOpen(false);
            setTowerPreview(null);
            engineRef.current?.focusTowerFloor(null);
            setTowerFocus(null);
          }}
        />
      )}

      <ZoeDialog
        open={zoeOpen}
        roomName={currentRoom?.name ?? "the corridor"}
        nearby={nearbyNames}
        ask={askZoe}
        onClose={() => setZoeOpen(false)}
      />

      <AvatarDialog
        open={avatarOpen}
        config={avatarDraft}
        onChange={setAvatarDraft}
        onSave={saveAvatar}
        onCancel={cancelAvatar}
      />

      {engineError && (
        <div className="absolute inset-0 z-[70] flex items-center justify-center bg-[#070911]/95 px-4">
          <div className="office-glass-strong w-full max-w-md rounded-3xl p-6 text-center">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#f43f5e]/15 text-[#fb7185]">
              <MonitorX className="h-6 w-6" />
            </span>
            <h2 className="mt-4 text-xl font-black tracking-tight text-white">
              3D isn&apos;t available here
            </h2>
            <p className="mt-2 text-[0.78rem] leading-relaxed text-[#8f98b2]">
              The demo needs WebGL. Try a recent Chrome, Edge or Safari window
              with hardware acceleration enabled.
            </p>
            <p className="mt-2 break-words rounded-lg bg-black/20 px-2 py-1.5 text-[0.6rem] text-[#667089]">
              {engineError}
            </p>
            <div className="mt-5 flex justify-center gap-2">
              <button
                type="button"
                className="office-button-secondary !h-10"
                onClick={() => window.location.reload()}
              >
                <RefreshCw className="h-4 w-4" />
                Retry
              </button>
              <button
                type="button"
                className="office-button-primary !h-10"
                onClick={() => router.push("/")}
              >
                Back to Zedu
              </button>
            </div>
          </div>
        </div>
      )}

      {!ready && !engineError && (
        <div className="pointer-events-none absolute inset-x-0 top-3 z-[65] flex justify-center">
          <div className="office-glass flex items-center gap-2 rounded-full px-3 py-1.5 text-[0.62rem] font-bold uppercase tracking-[0.16em] text-[#8f98b2]">
            <Loader2 className="h-3 w-3 animate-spin text-[#a78bfa]" />
            Preparing the building
          </div>
        </div>
      )}
    </div>
  );
}
