"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MonitorX, RefreshCw } from "lucide-react";
import { cn } from "~/lib/utils";
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
import type { TowerOffice } from "./engine/tower-scene";
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
import { demoSource, demoTowerOffices } from "./demo-office-source";
import { useOfficePresence } from "./use-office-presence";
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
  const selfId = self?.id ?? DEMO_USER_ID;
  const selfName = self?.name ?? "Ada Obi";
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

  const [avatar, setAvatar] = useState<AvatarConfig>(source.initialAvatar);
  const [avatarDraft, setAvatarDraft] = useState<AvatarConfig>(
    source.initialAvatar
  );
  const [layouts, setLayouts] = useState<Record<string, FurnitureItem[]>>(
    () => source.initialLayouts
  );
  const [roomId, setRoomId] = useState<string | null>(
    () =>
      rooms.find((room) => room.id === "reception")?.id ?? rooms[0]?.id ?? null
  );
  const [player, setPlayer] = useState({ x: 8.5, z: 9.4, yaw: Math.PI });
  const [presence, setPresence] = useState<PresencePoint[]>(
    source.mode === "demo" ? initialPresence : []
  );
  const [presenceState, setPresenceState] = useState<"connecting" | "live">(
    source.mode === "demo" ? "live" : "connecting"
  );
  const [nearZoe, setNearZoe] = useState(false);

  const [towerOpen, setTowerOpen] = useState(false);
  const [towerFocus, setTowerFocus] = useState<number | null>(null);
  const openedInitialTowerRef = useRef(false);
  const [activeFloor, setActiveFloor] = useState(0);
  const floorRooms = useMemo(
    () => rooms.filter((room) => (room.floorIndex ?? 0) === activeFloor),
    [rooms, activeFloor]
  );
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

  const currentRoom = roomId ? (roomById[roomId] ?? null) : null;
  const currentItems = currentRoom ? (layouts[currentRoom.id] ?? []) : [];
  const selectedItem =
    currentRoom && selectedFurnitureId
      ? ((layouts[currentRoom.id] ?? []).find(
          (item) => item.id === selectedFurnitureId
        ) ?? null)
      : null;
  // Presence rosters may already include the signed-in person; count them once.
  const onlineCount =
    presence.filter((point) => point.id !== selfId).length + 1;

  // The tower shows the people, not the rooms: an office is lit while its
  // owner is inside it, and the search only ever matches people. The demo
  // adds the directory-only storeys that fill the building out to ten floors.
  const towerOffices = useMemo<TowerOffice[]>(() => {
    if (source.mode === "demo") {
      return demoTowerOffices(rooms, presence);
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

    return [...shared, ...people];
  }, [source.mode, source.members, rooms, presence, selfId]);
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
  const canEdit = canEditRoom(currentRoom);
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
          onFloorChange: (floorIndex) => setActiveFloor(floorIndex),
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

  // The live office has no entry screen, but it still opens on the tower: the
  // building is the front door for both routes.
  useEffect(() => {
    if (source.mode !== "live" || phase !== "office" || !ready) return;
    if (openedInitialTowerRef.current) return;
    openedInitialTowerRef.current = true;
    openTower();
  }, [source.mode, phase, ready, openTower]);

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
        event.preventDefault();
        // The tower owns the viewport, so Esc always brings the floor back
        // before it starts closing panels.
        if (state.towerOpen) {
          closeTower();
          return;
        }
        closeTopLayer();
        return;
      }
      if (state.phase !== "office") return;
      const key = event.key.toLowerCase();
      if (key === "e") {
        event.preventDefault();
        openZoe();
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
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      z: occ.position?.z ?? 0,
      roomId: occ.roomId,
      status: occ.status ?? "online",
      tint: occ.avatar?.tint,
    }));

    setPresence(points);
    // The engine draws the room's real people. It drops the signed-in person
    // itself, because that avatar is the one the player is already steering.
    engineRef.current?.setOccupants(occupants);
  }, []);

  // Presence, room entry and movement publishing all follow the room the user
  // is in, and all of them are sequenced in one place.
  useOfficePresence({
    source,
    active: source.mode === "live" && phase === "office",
    roomId,
    pose: player,
    onOccupants: mergePresence,
    onState: setPresenceState,
  });

  // A room being read is a room whose conversation matters: the one you are
  // standing in, or the one held in frame from the street.
  const readRoomId = towerPreview ?? chatTargetId ?? roomId;

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
  const conversationRoomId = chatTargetId ?? roomId;
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

  function handleRoomChange(room: typeof currentRoom) {
    const state = stateRef.current;
    const previousId = state.roomId;
    const nextId = room?.id ?? null;

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

    if (!room) {
      setChatOpen(false);
    } else if (room.kind === "channel") {
      setChatOpen(true);
      setUnread(0);
    }

    if (
      room?.kind === "focus" &&
      roomById[previousId ?? ""]?.kind !== "focus"
    ) {
      showInfo("Focus mode", "Your status is now Do not disturb.");
    }
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
  }

  function closeTower() {
    engineRef.current?.setView("floor");
    setTowerOpen(false);
    setTowerHover(null);
    setTowerPreview(null);
    setLiftTarget(null);
    setTowerFocus(null);
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
    schedule(() => {
      engine.setView("floor");
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

  function pickTowerPerson(office: TowerOffice) {
    const engine = engineRef.current;
    if (!engine) return;

    const target = roomById[office.roomId];
    const walkable = Boolean(target);

    // Reading a locked office is not allowed either: its conversation is the
    // private DM, and the server refuses to serve it. Show the door and leave
    // it closed instead of opening an empty chat that cannot send.
    if (target?.locked) {
      engine.pulseOffice(office.roomId, office.floorIndex);
      engine.focusTowerRoom(office.roomId);
      setTowerFocus(office.floorIndex);
      setTowerPreview(null);
      setChatOpen(false);
      showInfo("Locked office", target.description);
      return;
    }

    // Second click on the same office: go in. The first click only reads it.
    if (walkable && towerPreview === office.roomId) {
      diveIntoRoom(office.roomId, office.floorIndex);
      return;
    }

    // First click: hold this one office in frame and open its conversation.
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
    onTowerPick: ({ roomId: picked, floorIndex }) => {
      const engine = engineRef.current;
      if (!engine) return;
      const room = roomById[picked];
      if (!room) {
        // A directory-only office: keep the tower open on its storey.
        engine.pulseOffice(picked, floorIndex);
        setTowerFocus(floorIndex);
        return;
      }
      if (room.locked) {
        engine.pulseOffice(picked, floorIndex);
        setTowerFocus(floorIndex);
        showInfo("Locked office", room.description);
        return;
      }
      engine.setView("floor");
      engine.focusRoom(picked);
      setRoomId(picked);
      setActiveFloor(floorIndex);
      setTowerOpen(false);
      setTowerHover(null);
      setChatOpen(true);
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

    if (index === 0 || index === 1) {
      navigateToRoom("reception");
      return;
    }

    if (index === 2) {
      navigateToRoom("channel:design");
      schedule(() => setChatOpen(true), 760);
      return;
    }

    if (index === 3) {
      navigateToRoom("personal:you");
      schedule(() => {
        const state = stateRef.current;
        if (state.roomId !== "personal:you") return;
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
      navigateToRoom("reception");
      schedule(() => {
        setChatOpen(false);
        engine.movePlayerTo(8.5, 5.55, Math.PI);
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
    const engine = engineRef.current;
    if (!engine) return;
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

  function enterOffice() {
    if (!ready) return;
    setPhase("office");
    engineRef.current?.setCinematic(false);
    // The tower is the front door: enter the building by choosing a storey.
    openTower();
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
            unread={unread}
            chatOpen={chatOpen}
            editorOpen={editorActive}
            isMobile={isMobile}
            mapOpen={mapOpen}
            onToggleMap={() => setMapOpen((value) => !value)}
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
            rooms={rooms}
            currentRoomId={roomId}
            presence={presence}
            playerRoomId={roomId}
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
          onPickPerson={pickTowerPerson}
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
