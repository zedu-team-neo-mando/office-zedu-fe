"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  DoorClosed,
  Building2,
  ChevronDown,
  ChevronUp,
  Compass,
  DoorOpen,
  GripHorizontal,
  HelpCircle,
  LogOut,
  Map,
  MessageSquare,
  Move,
  Palette,
  Sparkles,
  Wrench,
  X,
} from "lucide-react";
import type { AvatarConfig, OfficeRoom, PresenceStatus } from "./office-data";
import { cn } from "~/lib/utils";

export interface PresencePoint {
  id: string;
  /** Their real display name, so the HUD never falls back to a UUID. */
  name?: string;
  x: number;
  z: number;
  roomId: string;
  status: PresenceStatus;
  /** The tint of their in-world avatar, so the tower shows the same person. */
  tint?: string;
}

export type MapDockCorner =
  | "bottom-left"
  | "bottom-right"
  | "top-right"
  | "top-left";

export const MAP_CORNER_LABELS: Record<MapDockCorner, string> = {
  "bottom-left": "Bottom-left",
  "bottom-right": "Bottom-right",
  "top-right": "Top-right",
  "top-left": "Top-left",
};

interface HudProps {
  room: OfficeRoom | null;
  rooms: OfficeRoom[];
  onlineCount: number;
  presenceState: "connecting" | "live";
  currentRoomId: string | null;
  player: { x: number; z: number; yaw: number };
  presence: PresencePoint[];
  avatar: AvatarConfig;
  selfName: string;
  selfRole: string;
  nearZoe: boolean;
  /** The personal-office door the player is standing at, if any. */
  door?: { name: string; open: boolean; own: boolean } | null;
  onToggleDoor?: () => void;
  unread: number;
  chatOpen: boolean;
  editorOpen: boolean;
  isMobile: boolean;
  mapOpen: boolean;
  /** Rooms known to be at capacity, such as an occupied Focus pod. */
  fullRoomIds?: ReadonlySet<string>;
  onToggleMap: () => void;
  onOpenDirectory: () => void;
  onOpenAvatar: () => void;
  onOpenTower: () => void;
  onToggleChat: () => void;
  onToggleEditor: () => void;
  onHelp: () => void;
  onExit: () => void;
  onNavigate: (roomId: string) => void;
  onInteract: () => void;
}

const STATUS_DOT: Record<PresenceStatus, string> = {
  online: "#34d399",
  idle: "#f59e0b",
  away: "#94a3b8",
  call: "#60a5fa",
  dnd: "#f43f5e",
};

/**
 * Main HUD overlay for the Virtual Office, displaying room details, top bar navigation,
 * action buttons (chat, furnish, map, directory), and mobile touch controls.
 *
 * @param props - Office state, rooms, presence, player position, and user action callbacks.
 */
export default function Hud({
  room,
  rooms,
  onlineCount,
  presenceState,
  currentRoomId,
  player,
  presence,
  avatar,
  selfName,
  selfRole,
  nearZoe,
  door,
  onToggleDoor,
  unread,
  chatOpen,
  editorOpen,
  isMobile,
  mapOpen,
  fullRoomIds,
  onToggleMap,
  onOpenDirectory,
  onOpenAvatar,
  onOpenTower,
  onToggleChat,
  onToggleEditor,
  onHelp,
  onExit,
  onNavigate,
  onInteract,
}: HudProps) {
  const roomLabel = room?.name ?? "Corridor";
  const roomAccent = room?.accent ?? "#a78bfa";
  const initials =
    selfName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "Z";

  return (
    <>
      <header className="pointer-events-none absolute left-3 right-3 top-3 z-30 flex items-start justify-between gap-2 sm:left-5 sm:right-5 sm:top-5">
        <div className="pointer-events-auto flex min-w-0 items-center gap-2.5 sm:gap-3">
          <div className="office-glass flex items-center gap-2.5 rounded-2xl px-3 py-2 sm:px-3.5">
            <img
              src="/zedu_white.png"
              alt="Zedu"
              className="h-5 w-auto sm:h-6"
            />
            <span className="hidden h-5 w-px bg-white/12 sm:block" />
            <span className="hidden text-[0.62rem] font-extrabold uppercase tracking-[0.22em] text-[#8f98b2] sm:block">
              Office
            </span>
          </div>

          <div className="office-glass flex min-w-0 items-center gap-2.5 rounded-2xl px-3 py-2">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{
                backgroundColor: roomAccent,
                boxShadow: `0 0 10px ${roomAccent}`,
              }}
            />
            <div className="min-w-0 leading-tight">
              <p className="truncate text-[0.84rem] font-extrabold tracking-tight text-white">
                {roomLabel}
              </p>
              <p className="hidden text-[0.6rem] font-bold uppercase tracking-[0.14em] text-[#7f89a4] sm:block">
                {room?.kind === "personal"
                  ? "Private office"
                  : room?.kind === "channel"
                    ? "Channel room"
                    : room?.kind === "focus"
                      ? "Focus pod"
                      : room?.kind === "meeting"
                        ? "Meeting room"
                        : room
                          ? "Shared space"
                          : "Connecting space"}
              </p>
            </div>
            <span className="ml-1 hidden items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[0.62rem] font-bold text-[#aeb6cb] sm:flex">
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  presenceState === "live"
                    ? "bg-[#34d399]"
                    : "animate-pulse bg-[#f59e0b]"
                )}
              />
              {presenceState === "live" ? `${onlineCount} here` : "Connecting"}
            </span>
          </div>
        </div>

        <div className="pointer-events-auto flex items-center gap-1.5 sm:gap-2">
          <div className="office-glass hidden items-center gap-2 rounded-2xl px-2.5 py-1.5 md:flex">
            <span
              className="flex h-7 w-7 items-center justify-center rounded-full text-[0.62rem] font-black text-[#0b0d17]"
              style={{ backgroundColor: avatar.tint }}
            >
              {initials}
            </span>
            <div className="leading-tight">
              <p className="max-w-[9rem] truncate text-[0.74rem] font-extrabold text-white">
                {selfName}
              </p>
              {selfRole && (
                <p className="max-w-[9rem] truncate text-[0.58rem] font-semibold uppercase tracking-[0.12em] text-[#7f89a4]">
                  {selfRole}
                </p>
              )}
            </div>
          </div>

          <button
            type="button"
            className="office-icon-button hidden sm:inline-flex"
            onClick={onToggleMap}
            data-active={mapOpen}
            aria-label="Toggle map"
          >
            <Map className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="office-icon-button"
            onClick={onOpenDirectory}
            aria-label="Open room directory"
          >
            <Building2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="office-return-button absolute right-0 top-full z-10 mt-2 px-3 text-[0.62rem] lg:static lg:mt-0 lg:px-3.5 lg:text-[0.68rem]"
            onClick={onOpenTower}
            aria-label="Back to tower"
            title="Back to tower"
          >
            <ArrowUp className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="whitespace-nowrap">Back to tower</span>
          </button>
          <button
            type="button"
            className="office-icon-button hidden sm:inline-flex"
            onClick={onOpenAvatar}
            aria-label="Customise avatar"
          >
            <Palette className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="office-icon-button hidden lg:inline-flex"
            onClick={onHelp}
            aria-label="Help"
          >
            <HelpCircle className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="office-icon-button"
            onClick={onExit}
            aria-label="Leave office"
            title="Leave office"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      <RepositionableMap
        mapOpen={mapOpen}
        onToggleMap={onToggleMap}
        rooms={rooms}
        currentRoomId={currentRoomId}
        player={player}
        presence={presence}
        fullRoomIds={fullRoomIds}
        isMobile={isMobile}
        onNavigate={onNavigate}
      />

      <div className="pointer-events-none absolute bottom-3 left-1/2 z-30 hidden w-full max-w-[38rem] -translate-x-1/2 px-3 sm:bottom-5 md:block">
        {nearZoe ? (
          <div className="office-glass pointer-events-auto mx-auto flex w-fit items-center gap-3 rounded-2xl border-[#f4c46a]/30 bg-[#171423]/90 px-4 py-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#f4c46a]/15 text-[#f4c46a]">
              <Sparkles className="h-4.5 w-4.5" />
            </span>
            <div>
              <p className="text-[0.72rem] font-extrabold uppercase tracking-[0.16em] text-[#f4c46a]">
                Zoe is here
              </p>
              <p className="text-[0.78rem] font-semibold text-[#d8dced]">
                Ask about tasks, the team or how Zedu works
              </p>
            </div>
            <button
              type="button"
              className="office-button-primary !h-10 !rounded-xl !px-3.5 !text-[0.78rem]"
              onClick={onInteract}
            >
              <span className="office-kbd !border-white/20 !bg-white/10">
                E
              </span>
              Talk
            </button>
          </div>
        ) : door && (door.own || !door.open) ? (
          <div className="office-glass pointer-events-auto mx-auto flex w-fit items-center gap-3 rounded-2xl px-4 py-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/8 text-[#c4b5fd]">
              {door.open ? (
                <DoorOpen className="h-4.5 w-4.5" />
              ) : (
                <DoorClosed className="h-4.5 w-4.5" />
              )}
            </span>
            <div>
              <p className="text-[0.72rem] font-extrabold uppercase tracking-[0.16em] text-[#c4b5fd]">
                {door.own ? "Your door" : door.name}
              </p>
              <p className="text-[0.78rem] font-semibold text-[#d8dced]">
                {door.own
                  ? door.open
                    ? "Open · visitors can walk in"
                    : "Shut · visitors stay outside"
                  : "Door shut · say hello in the conversation"}
              </p>
            </div>
            {door.own && (
              <button
                type="button"
                className="office-button-primary !h-10 !rounded-xl !px-3.5 !text-[0.78rem]"
                onClick={onToggleDoor}
              >
                <span className="office-kbd !border-white/20 !bg-white/10">
                  E
                </span>
                {door.open ? "Close door" : "Open door"}
              </button>
            )}
          </div>
        ) : editorOpen ? (
          <div className="office-glass mx-auto flex w-fit items-center gap-3 rounded-2xl px-4 py-2 text-[0.72rem] font-semibold text-[#b9c1d6]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#a78bfa]" />
            <span className="office-kbd">P</span> place ·{" "}
            <span className="office-kbd">R</span> rotate ·{" "}
            <span className="office-kbd">Del</span> remove ·{" "}
            <span className="office-kbd">Esc</span> done
          </div>
        ) : (
          <div className="office-glass mx-auto flex w-fit items-center gap-2 rounded-2xl px-3.5 py-2 text-[0.68rem] font-semibold text-[#8d96ae]">
            <span className="office-kbd">W</span>
            <span className="office-kbd">A</span>
            <span className="office-kbd">S</span>
            <span className="office-kbd">D</span>
            move
            <span className="mx-1 h-3 w-px bg-white/10" />
            <span className="office-kbd">Shift</span> run
            <span className="mx-1 h-3 w-px bg-white/10" />
            click floor to walk
            <span className="mx-1 h-3 w-px bg-white/10" />
            <span className="office-kbd">B</span> furnish
          </div>
        )}
      </div>

      <div
        className={cn(
          "absolute right-3 z-30 flex flex-col items-end gap-2 sm:right-5",
          isMobile ? "bottom-44" : "bottom-4 sm:bottom-5"
        )}
      >
        <button
          type="button"
          className="office-icon-button relative !h-11 !w-11 !rounded-2xl"
          onClick={onToggleChat}
          data-active={chatOpen}
          aria-label="Toggle room chat"
        >
          <MessageSquare className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#f43f5e] px-1 text-[0.62rem] font-black text-white">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
        <button
          type="button"
          className="office-icon-button !h-11 !w-11 !rounded-2xl"
          onClick={onToggleEditor}
          data-active={editorOpen}
          aria-label="Furnish room"
        >
          <Wrench className="h-5 w-5" />
        </button>
      </div>

      {isMobile && (
        <MobileControls
          nearZoe={nearZoe}
          editorOpen={editorOpen}
          onInteract={onInteract}
          onToggleEditor={onToggleEditor}
        />
      )}
    </>
  );
}

/**
 * RepositionableMap wraps the building Minimap, supporting 4-corner docking presets,
 * pointer-based drag-and-drop repositioning with viewport clamping, and localStorage persistence.
 *
 * @param props - Map open state, rooms list, player position, presence points, and navigation callback.
 */
export function RepositionableMap({
  mapOpen,
  onToggleMap,
  rooms,
  currentRoomId,
  player,
  presence,
  fullRoomIds,
  isMobile,
  onNavigate,
}: {
  mapOpen: boolean;
  onToggleMap: () => void;
  rooms: OfficeRoom[];
  currentRoomId: string | null;
  player: { x: number; z: number; yaw: number };
  presence: PresencePoint[];
  fullRoomIds?: ReadonlySet<string>;
  isMobile: boolean;
  onNavigate: (roomId: string) => void;
}) {
  const STORAGE_MAP_POS = "office-map-pos-v1";
  const [mapCorner, setMapCorner] = useState<MapDockCorner>("bottom-left");
  const [customPos, setCustomPos] = useState<{ x: number; y: number } | null>(
    null
  );
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{
    startX: number;
    startY: number;
    startLeft: number;
    startTop: number;
  } | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapHeightRef = useRef(220);
  const [, setMapHeight] = useState(220);

  useEffect(() => {
    if (!mapOpen) return;
    const container = mapContainerRef.current;
    if (!container) return;

    const updateMapHeight = () => {
      const h = container.offsetHeight;
      mapHeightRef.current = h;
      setMapHeight(h);
      setCustomPos((prev) => {
        if (!prev) return null;
        const maxY = Math.max(56, window.innerHeight - h - 12);
        return { ...prev, y: Math.max(56, Math.min(prev.y, maxY)) };
      });
    };

    updateMapHeight();
    const observer = new ResizeObserver(updateMapHeight);
    observer.observe(container);
    return () => observer.disconnect();
  }, [mapOpen]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_MAP_POS);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (
          parsed.corner &&
          ["bottom-left", "bottom-right", "top-right", "top-left"].includes(
            parsed.corner
          )
        ) {
          setMapCorner(parsed.corner);
        }
        if (
          parsed.customPos &&
          typeof parsed.customPos.x === "number" &&
          typeof parsed.customPos.y === "number"
        ) {
          const mapW = isMobile ? 190 : 248;
          const mapH = mapHeightRef.current;
          const x = Math.max(
            12,
            Math.min(parsed.customPos.x, window.innerWidth - mapW - 12)
          );
          const y = Math.max(
            56,
            Math.min(parsed.customPos.y, window.innerHeight - mapH - 12)
          );
          setCustomPos({ x, y });
        }
      }
    } catch {
      // Ignore storage errors
    }
  }, [isMobile]);

  useEffect(() => {
    const handleResize = () => {
      const container = mapContainerRef.current;
      if (container) {
        mapHeightRef.current = container.offsetHeight;
        setMapHeight(container.offsetHeight);
      }
      setCustomPos((prev) => {
        if (!prev) return null;
        const mapW = isMobile ? 190 : 248;
        const mapH = mapHeightRef.current;
        const maxX = Math.max(12, window.innerWidth - mapW - 12);
        const maxY = Math.max(56, window.innerHeight - mapH - 12);
        return {
          x: Math.max(12, Math.min(prev.x, maxX)),
          y: Math.max(56, Math.min(prev.y, maxY)),
        };
      });
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [isMobile]);

  /**
   * Persists the selected corner preset or custom drag coordinates to local state and localStorage.
   *
   * @param corner - The active dock corner preset.
   * @param custom - Custom x/y coordinates when manually positioned, or null when docked.
   */
  const savePosition = (
    corner: MapDockCorner,
    custom: { x: number; y: number } | null
  ) => {
    setMapCorner(corner);
    setCustomPos(custom);
    try {
      localStorage.setItem(
        STORAGE_MAP_POS,
        JSON.stringify({ corner, customPos: custom })
      );
    } catch {
      // Ignore storage errors
    }
  };

  /**
   * Cycles the minimap dock location clockwise through all 4 viewport corners.
   */
  const cycleCorner = () => {
    const corners: MapDockCorner[] = [
      "bottom-left",
      "bottom-right",
      "top-right",
      "top-left",
    ];
    const currentIndex = corners.indexOf(mapCorner);
    const nextCorner = corners[(currentIndex + 1) % corners.length]!;
    savePosition(nextCorner, null);
  };

  /**
   * Initiates pointer drag on the minimap header handle and captures pointer events.
   *
   * @param e - Pointer down event on the drag handle.
   */
  const handleDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button, a, input")) return;
    const container = mapContainerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startLeft: rect.left,
      startTop: rect.top,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDragging(true);
  };

  /**
   * Updates custom position while dragging, clamping coordinates within visible viewport bounds.
   *
   * @param e - Pointer move event during an active drag.
   */
  const handleDragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging || !dragStartRef.current) return;
    const { startX, startY, startLeft, startTop } = dragStartRef.current;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    const container = mapContainerRef.current;
    const width = container ? container.offsetWidth : isMobile ? 190 : 248;
    const height = container ? container.offsetHeight : mapHeightRef.current;

    const minX = 12;
    const maxX = Math.max(minX, window.innerWidth - width - 12);
    const minY = 56;
    const maxY = Math.max(minY, window.innerHeight - height - 12);

    const newX = Math.max(minX, Math.min(startLeft + dx, maxX));
    const newY = Math.max(minY, Math.min(startTop + dy, maxY));

    setCustomPos({ x: newX, y: newY });
  };

  /**
   * Ends dragging, automatically snapping to the nearest corner if released within margin,
   * or saving the custom clamped position.
   *
   * @param e - Pointer up event concluding the drag.
   */
  const handleDragEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    setIsDragging(false);
    dragStartRef.current = null;

    if (!customPos) return;

    const container = mapContainerRef.current;
    const width = container ? container.offsetWidth : isMobile ? 190 : 248;
    const height = container ? container.offsetHeight : mapHeightRef.current;

    const snapMargin = 90;
    const isLeft = customPos.x <= snapMargin;
    const isRight = customPos.x >= window.innerWidth - width - snapMargin;
    const isTop = customPos.y <= snapMargin + 48;
    const isBottom = customPos.y >= window.innerHeight - height - snapMargin;

    if (isLeft && isBottom) {
      savePosition("bottom-left", null);
    } else if (isRight && isBottom) {
      savePosition("bottom-right", null);
    } else if (isRight && isTop) {
      savePosition("top-right", null);
    } else if (isLeft && isTop) {
      savePosition("top-left", null);
    } else {
      savePosition(mapCorner, customPos);
    }
  };

  /**
   * Computes viewport-aware Tailwind positioning classes for each corner dock preset,
   * ensuring that neither bottom corner overlaps HUD controls or slides off-screen.
   *
   * @param corner - The target dock corner preset.
   * @returns Tailwind class string for positioning the map container.
   */
  const getCornerClasses = (corner: MapDockCorner) => {
    const currentHeight = mapHeightRef.current;
    const isShortMobile =
      isMobile &&
      typeof window !== "undefined" &&
      window.innerHeight - currentHeight < 176 + 12;

    const mobileBottomClass = isShortMobile
      ? typeof window !== "undefined" &&
        window.innerHeight - currentHeight >= 128 + 8
        ? "bottom-32"
        : "top-16"
      : "bottom-44";

    const canFitAboveChatOnMobile =
      typeof window !== "undefined" &&
      window.innerHeight - currentHeight >= 280 + 56;

    const mobileBottomRightClass = canFitAboveChatOnMobile
      ? "bottom-72"
      : "top-28 lg:top-20";

    switch (corner) {
      case "bottom-left":
        return cn(
          "left-3 sm:left-5",
          isMobile ? mobileBottomClass : "bottom-3 sm:bottom-5"
        );
      case "bottom-right":
        return cn(
          "right-3 sm:right-5",
          isMobile ? mobileBottomRightClass : "bottom-32 sm:bottom-[7.75rem]"
        );
      case "top-right":
        return "right-3 sm:right-5 top-28 lg:top-20";
      case "top-left":
        return "left-3 sm:left-5 top-16 sm:top-20";
    }
  };

  return (
    <div
      ref={mapContainerRef}
      style={
        customPos
          ? {
              left: `${customPos.x}px`,
              top: `${customPos.y}px`,
              bottom: "auto",
              right: "auto",
              position: "fixed",
            }
          : undefined
      }
      className={cn(
        "pointer-events-none fixed z-30 flex flex-col gap-2",
        !isDragging && !customPos && "transition-all duration-300 ease-out",
        !customPos && getCornerClasses(mapCorner)
      )}
    >
      {mapOpen ? (
        <Minimap
          rooms={rooms}
          currentRoomId={currentRoomId}
          player={player}
          presence={presence}
          fullRoomIds={fullRoomIds}
          onNavigate={onNavigate}
          onClose={onToggleMap}
          compact={isMobile}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onDragEnd={handleDragEnd}
          isDragging={isDragging}
          corner={mapCorner}
          onCycleCorner={cycleCorner}
        />
      ) : (
        <button
          type="button"
          className="pointer-events-auto office-glass flex items-center gap-2 rounded-2xl px-3 py-2 text-[0.7rem] font-extrabold uppercase tracking-[0.14em] text-[#b9c1d6]"
          onClick={onToggleMap}
        >
          <Map className="h-4 w-4 text-[#a78bfa]" />
          Map
        </button>
      )}
    </div>
  );
}

/**
 * Renders the 2D SVG floor plan of the current office floor, showing room boundaries,
 * names, capacity statuses, player coordinates, and colleague presence dots.
 *
 * @param props - Room list, current room, player location, presence list, and drag handlers.
 */
export function Minimap({
  rooms,
  currentRoomId,
  player,
  presence,
  fullRoomIds,
  onNavigate,
  onClose,
  compact = false,
  onDragStart,
  onDragMove,
  onDragEnd,
  isDragging = false,
  corner = "bottom-left",
  onCycleCorner,
}: {
  rooms: OfficeRoom[];
  currentRoomId: string | null;
  player: { x: number; z: number; yaw: number };
  presence: PresencePoint[];
  fullRoomIds?: ReadonlySet<string>;
  onNavigate: (roomId: string) => void;
  onClose: () => void;
  compact?: boolean;
  onDragStart?: (e: React.PointerEvent<HTMLDivElement>) => void;
  onDragMove?: (e: React.PointerEvent<HTMLDivElement>) => void;
  onDragEnd?: (e: React.PointerEvent<HTMLDivElement>) => void;
  isDragging?: boolean;
  corner?: MapDockCorner;
  onCycleCorner?: () => void;
}) {
  const width = compact ? 190 : 248;
  // The map is drawn from the rooms on the floor the user is standing on, so a
  // live layout (which can be wider and deeper than the demo) always fits.
  const frame = (() => {
    if (!rooms.length) {
      return { minX: 0, minZ: 0, width: 56, depth: 36, pad: 0.6 };
    }
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (const room of rooms) {
      minX = Math.min(minX, room.bounds.x);
      minZ = Math.min(minZ, room.bounds.z);
      maxX = Math.max(maxX, room.bounds.x + room.bounds.w);
      maxZ = Math.max(maxZ, room.bounds.z + room.bounds.d);
    }
    const depth = maxZ - minZ;
    return {
      minX,
      minZ,
      width: maxX - minX,
      depth,
      pad: Math.max(0.8, Math.max(maxX - minX, depth) * 0.035),
    };
  })();
  const floorRoomIds = new Set(rooms.map((room) => room.id));
  const floorPresence = presence.filter((point) =>
    floorRoomIds.has(point.roomId)
  );
  const zoeRoom = rooms.find((room) => room.kind === "reception");
  const zoe = zoeRoom
    ? {
        x: zoeRoom.bounds.x + zoeRoom.bounds.w / 2,
        z: zoeRoom.bounds.z + zoeRoom.bounds.d * 0.25,
      }
    : null;
  return (
    <div
      className="office-glass pointer-events-auto overflow-hidden rounded-2xl"
      style={{ width }}
    >
      <div
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onLostPointerCapture={onDragEnd}
        className={cn(
          "office-map-drag-handle flex items-center justify-between border-b border-white/8 px-3 py-2 select-none",
          isDragging ? "cursor-grabbing" : "cursor-grab"
        )}
      >
        <div className="flex items-center gap-2 pointer-events-none">
          <GripHorizontal className="h-3.5 w-3.5 text-[#77809a]" />
          <Compass className="h-3.5 w-3.5 text-[#a78bfa]" />
          <p className="text-[0.64rem] font-extrabold uppercase tracking-[0.18em] text-[#aeb6cb]">
            Building map
          </p>
        </div>
        <div className="flex items-center gap-1.5 pointer-events-auto">
          {onCycleCorner && (
            <button
              type="button"
              onClick={onCycleCorner}
              className="text-[#77809a] transition-colors hover:text-white p-0.5 rounded"
              title={`Dock map to next corner (currently ${MAP_CORNER_LABELS[corner]})`}
              aria-label="Dock map to next corner"
            >
              <Move className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="text-[#77809a] transition-colors hover:text-white p-0.5 rounded"
            aria-label="Close map"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <svg
        viewBox={`${frame.minX - frame.pad} ${frame.minZ - frame.pad} ${
          frame.width + frame.pad * 2
        } ${frame.depth + frame.pad * 2}`}
        className="block w-full"
        role="img"
        aria-label="Office floor map"
      >
        <rect
          x={frame.minX - frame.pad}
          y={frame.minZ - frame.pad}
          width={frame.width + frame.pad * 2}
          height={frame.depth + frame.pad * 2}
          rx="0.8"
          fill="#080b14"
          stroke="rgba(255,255,255,0.12)"
          strokeWidth="0.18"
        />
        {rooms.map((room) => {
          const active = room.id === currentRoomId;
          const full = !active && Boolean(fullRoomIds?.has(room.id));
          return (
            <g key={room.id}>
              <rect
                x={room.bounds.x}
                y={room.bounds.z}
                width={room.bounds.w}
                height={room.bounds.d}
                rx="0.55"
                fill={full ? "#f43f5e" : room.accent}
                fillOpacity={active ? 0.42 : full ? 0.2 : 0.14}
                stroke={active ? "#ffffff" : full ? "#fb7185" : room.accent}
                strokeOpacity={active ? 0.85 : full ? 0.7 : 0.38}
                strokeWidth={active ? 0.28 : 0.16}
                strokeDasharray={
                  room.kind === "portal" ? "0.55 0.35" : undefined
                }
                className="office-minimap-room"
                onClick={() => onNavigate(room.id)}
              >
                <title>{full ? `${room.name} · Full` : room.name}</title>
              </rect>
              {full && (
                <text
                  x={room.bounds.x + room.bounds.w / 2}
                  y={room.bounds.z + room.bounds.d / 2 + 0.45}
                  textAnchor="middle"
                  fontSize="1.25"
                  fontWeight="800"
                  fill="#fb7185"
                  pointerEvents="none"
                >
                  FULL
                </text>
              )}
              {(room.kind === "channel" ||
                room.kind === "lounge" ||
                room.kind === "reception" ||
                room.kind === "portal") && (
                <text
                  x={room.bounds.x + room.bounds.w / 2}
                  y={room.bounds.z + room.bounds.d / 2 + 0.5}
                  textAnchor="middle"
                  fontSize="1.55"
                  fontWeight="700"
                  fill={active ? "#ffffff" : "rgba(255,255,255,0.62)"}
                  pointerEvents="none"
                >
                  {room.shortName}
                </text>
              )}
              {room.locked && (
                <text
                  x={room.bounds.x + room.bounds.w - 1.2}
                  y={room.bounds.z + 1.5}
                  textAnchor="middle"
                  fontSize="1.6"
                  fill="#fb7185"
                  pointerEvents="none"
                >
                  ×
                </text>
              )}
            </g>
          );
        })}
        {floorPresence.map((agent) => (
          <circle
            key={agent.id}
            cx={agent.x}
            cy={agent.z}
            r="0.42"
            fill={STATUS_DOT[agent.status]}
            stroke="#080b14"
            strokeWidth="0.16"
            opacity="0.95"
          />
        ))}
        {zoe && (
          <>
            <circle cx={zoe.x} cy={zoe.z} r="0.62" fill="#f4c46a" />
            <text
              x={zoe.x}
              y={zoe.z + 0.65}
              textAnchor="middle"
              fontSize="0.95"
              fontWeight="900"
              fill="#0b0d17"
            >
              Z
            </text>
          </>
        )}
        <circle
          cx={player.x}
          cy={player.z}
          r="1.1"
          fill="#a78bfa"
          opacity="0.28"
        />
        <circle
          cx={player.x}
          cy={player.z}
          r="0.62"
          fill="#ffffff"
          stroke="#8b5cf6"
          strokeWidth="0.24"
        />
        <line
          x1={player.x}
          y1={player.z}
          x2={player.x + Math.sin(player.yaw) * 1.3}
          y2={player.z + Math.cos(player.yaw) * 1.3}
          stroke="#a78bfa"
          strokeWidth="0.24"
          strokeLinecap="round"
        />
      </svg>
      <div className="flex items-center justify-between gap-2 border-t border-white/8 px-3 py-1.5">
        <div className="flex items-center gap-2 text-[0.56rem] font-bold uppercase tracking-[0.1em] text-[#7f89a4]">
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-[#34d399]" /> online
          </span>
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-[#60a5fa]" /> call
          </span>
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-[#f43f5e]" /> dnd
          </span>
        </div>
        <span className="text-[0.52rem] font-bold uppercase tracking-[0.1em] text-[#5f6880]">
          click to go
        </span>
      </div>
    </div>
  );
}

/**
 * Mobile on-screen touch controls, including a virtual analog joystick for movement
 * and quick-action buttons for interacting with Zoe and furnishing.
 *
 * @param props - Interaction state flags and trigger callbacks.
 */
function MobileControls({
  nearZoe,
  editorOpen,
  onInteract,
  onToggleEditor,
}: {
  nearZoe: boolean;
  editorOpen: boolean;
  onInteract: () => void;
  onToggleEditor: () => void;
}) {
  const padRef = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0, active: false });

  /**
   * Translates touch/pointer coordinates to a normalised directional vector for the joystick.
   *
   * @param clientX - Pointer X client coordinate.
   * @param clientY - Pointer Y client coordinate.
   */
  const update = (clientX: number, clientY: number) => {
    const pad = padRef.current;
    if (!pad) return;
    const rect = pad.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = clientX - cx;
    const dy = clientY - cy;
    const radius = rect.width / 2 - 18;
    const length = Math.hypot(dx, dy) || 1;
    const scale = Math.min(length, radius) / length;
    const x = (dx * scale) / radius;
    const y = (dy * scale) / radius;
    setKnob({ x, y, active: true });
    window.dispatchEvent(
      new CustomEvent("office-joystick", { detail: { x, y } })
    );
  };

  /**
   * Resets the joystick knob position and dispatches a zeroed joystick event.
   */
  const end = () => {
    setKnob({ x: 0, y: 0, active: false });
    window.dispatchEvent(
      new CustomEvent("office-joystick", { detail: { x: 0, y: 0 } })
    );
  };

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex items-end justify-between px-4">
      <div
        ref={padRef}
        className="pointer-events-auto relative flex h-28 w-28 touch-none items-center justify-center rounded-full border border-white/10 bg-[#0d1020]/80 backdrop-blur"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          update(event.clientX, event.clientY);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            update(event.clientX, event.clientY);
          }
        }}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <div className="absolute inset-3 rounded-full border border-white/5" />
        <div
          className={cn(
            "h-12 w-12 rounded-full border border-white/20 bg-gradient-to-br from-[#a78bfa] to-[#6d4aff] shadow-lg transition-transform",
            !knob.active && "duration-200"
          )}
          style={{ transform: `translate(${knob.x * 30}px, ${knob.y * 30}px)` }}
        />
      </div>

      <div className="pointer-events-auto flex flex-col items-end gap-2">
        {nearZoe && (
          <button
            type="button"
            onClick={onInteract}
            className="flex items-center gap-2 rounded-2xl border border-[#f4c46a]/40 bg-[#f4c46a]/15 px-3.5 py-2.5 text-[0.72rem] font-extrabold uppercase tracking-[0.12em] text-[#f4c46a] backdrop-blur"
          >
            <Sparkles className="h-4 w-4" />
            Talk to Zoe
          </button>
        )}
        <button
          type="button"
          onClick={onToggleEditor}
          className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-[#0d1020]/80 text-[#d6dcf0] backdrop-blur"
          aria-label="Furnish"
          data-active={editorOpen}
        >
          <Wrench className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}

/**
 * Pill badge displaying the current room name and icon, triggering the directory modal when clicked.
 *
 * @param props - Current room reference and modal opener callback.
 */
export function RoomPill({
  room,
  onOpen,
}: {
  room: OfficeRoom | null;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[0.68rem] font-bold text-[#b9c1d6]"
    >
      <DoorOpen className="h-3.5 w-3.5" />
      {room?.name ?? "Corridor"}
      <ChevronDown className="h-3 w-3" />
    </button>
  );
}

/**
 * Small keyboard/touch shortcut hint label indicating how to toggle the minimap.
 */
export function MapHint() {
  return (
    <span className="flex items-center gap-1 text-[0.6rem] text-[#7f89a4]">
      <ChevronUp className="h-3 w-3" /> open map
    </span>
  );
}
