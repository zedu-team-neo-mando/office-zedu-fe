"use client";

import { useRef, useState } from "react";
import {
  ArrowUp,
  Building2,
  ChevronDown,
  ChevronUp,
  Compass,
  DoorOpen,
  HelpCircle,
  LogOut,
  Map,
  MessageSquare,
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
  unread: number;
  chatOpen: boolean;
  editorOpen: boolean;
  isMobile: boolean;
  mapOpen: boolean;
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
  unread,
  chatOpen,
  editorOpen,
  isMobile,
  mapOpen,
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

      <div
        className={cn(
          "pointer-events-none absolute left-3 z-30 flex flex-col gap-2 sm:left-5",
          isMobile ? "bottom-44" : "bottom-3 sm:bottom-5"
        )}
      >
        {mapOpen ? (
          <Minimap
            rooms={rooms}
            currentRoomId={currentRoomId}
            player={player}
            presence={presence}
            onNavigate={onNavigate}
            onClose={onToggleMap}
            compact={isMobile}
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

export function Minimap({
  rooms,
  currentRoomId,
  player,
  presence,
  onNavigate,
  onClose,
  compact = false,
}: {
  rooms: OfficeRoom[];
  currentRoomId: string | null;
  player: { x: number; z: number; yaw: number };
  presence: PresencePoint[];
  onNavigate: (roomId: string) => void;
  onClose: () => void;
  compact?: boolean;
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
      <div className="flex items-center justify-between border-b border-white/8 px-3 py-2">
        <div className="flex items-center gap-2">
          <Compass className="h-3.5 w-3.5 text-[#a78bfa]" />
          <p className="text-[0.64rem] font-extrabold uppercase tracking-[0.18em] text-[#aeb6cb]">
            Building map
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-[#77809a] transition-colors hover:text-white"
          aria-label="Close map"
        >
          <X className="h-3.5 w-3.5" />
        </button>
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
          return (
            <g key={room.id}>
              <rect
                x={room.bounds.x}
                y={room.bounds.z}
                width={room.bounds.w}
                height={room.bounds.d}
                rx="0.55"
                fill={room.accent}
                fillOpacity={active ? 0.42 : 0.14}
                stroke={active ? "#ffffff" : room.accent}
                strokeOpacity={active ? 0.85 : 0.38}
                strokeWidth={active ? 0.28 : 0.16}
                className="office-minimap-room"
                onClick={() => onNavigate(room.id)}
              >
                <title>{room.name}</title>
              </rect>
              {(room.kind === "channel" ||
                room.kind === "lounge" ||
                room.kind === "reception") && (
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

export function MapHint() {
  return (
    <span className="flex items-center gap-1 text-[0.6rem] text-[#7f89a4]">
      <ChevronUp className="h-3 w-3" /> open map
    </span>
  );
}
