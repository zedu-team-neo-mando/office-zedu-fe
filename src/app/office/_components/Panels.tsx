"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Armchair,
  ArrowUpRight,
  Box,
  Check,
  ChevronRight,
  CircleDot,
  DoorOpen,
  Flower2,
  Info,
  Lamp,
  Layers,
  Loader2,
  Lock,
  MessageSquare,
  Move,
  RotateCw,
  Search,
  Send,
  Square,
  Table2,
  Trash2,
  TriangleAlert,
  Undo2,
  Redo2,
  Users,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { cn } from "~/lib/utils";
import {
  ACCESSORY_OPTIONS,
  AVATAR_TINTS,
  BODY_OPTIONS,
  CATALOG_BY_ID,
  FURNITURE_CATALOG,
  OUTFIT_OPTIONS,
  ROOM_GROUPS,
  formatTime,
  type AvatarConfig,
  type ChatMessage,
  type FurnitureItem,
  type OfficeRoom,
} from "./office-data";
import type { PresencePoint } from "./Hud";

// ------------------------------------------------------------------ directory

export function RoomDirectory({
  open,
  rooms,
  currentRoomId,
  presence,
  playerRoomId,
  onClose,
  onNavigate,
}: {
  open: boolean;
  rooms: OfficeRoom[];
  currentRoomId: string | null;
  presence: PresencePoint[];
  playerRoomId: string | null;
  onClose: () => void;
  onNavigate: (roomId: string) => void;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return rooms.filter(
      (room) =>
        room.name.toLowerCase().includes(q) ||
        room.description.toLowerCase().includes(q)
    );
  }, [query, rooms]);

  const occupancy = useMemo(() => {
    const map: Record<string, number> = {};
    for (const agent of presence) {
      if (agent.roomId === "lobby") continue;
      map[agent.roomId] = (map[agent.roomId] ?? 0) + 1;
    }
    if (playerRoomId) map[playerRoomId] = (map[playerRoomId] ?? 0) + 1;
    return map;
  }, [presence, playerRoomId]);

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 z-40 transition-opacity duration-200",
        open ? "opacity-100" : "opacity-0"
      )}
      inert={!open}
    >
      <button
        type="button"
        tabIndex={open ? 0 : -1}
        aria-label="Close room directory"
        className={cn(
          "absolute inset-0 bg-black/35 backdrop-blur-[2px]",
          // The overlay keeps its space while it fades out, so it must not keep
          // swallowing clicks after it closes.
          open ? "pointer-events-auto" : "pointer-events-none"
        )}
        onClick={onClose}
      />
      <aside
        className={cn(
          "office-glass-strong pointer-events-auto absolute bottom-0 left-0 top-0 flex w-[min(23rem,92vw)] flex-col border-r border-white/10 transition-transform duration-300",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex items-center justify-between border-b border-white/8 px-4 py-3.5">
          <div>
            <p className="text-[0.64rem] font-extrabold uppercase tracking-[0.2em] text-[#8f98b2]">
              Zedu HQ
            </p>
            <h2 className="mt-0.5 text-lg font-black tracking-tight text-white">
              Room directory
            </h2>
          </div>
          <button
            type="button"
            className="office-icon-button"
            onClick={onClose}
            aria-label="Close directory"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-4 pt-3">
          <div className="flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3">
            <Search className="h-3.5 w-3.5 text-[#7f89a4]" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search rooms and channels"
              className="h-full flex-1 bg-transparent text-[0.8rem] font-semibold text-white placeholder:text-[#667089] focus:outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="text-[#7f89a4] hover:text-white"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="office-scroll office-scroll-area mt-2 flex-1 overflow-y-auto px-2.5 pb-4">
          {filtered ? (
            filtered.length ? (
              <div className="mt-2 space-y-1">
                {filtered.map((room) => (
                  <RoomRow
                    key={room.id}
                    room={room}
                    active={room.id === currentRoomId}
                    people={occupancy[room.id] ?? 0}
                    onNavigate={() => onNavigate(room.id)}
                  />
                ))}
              </div>
            ) : (
              <p className="mt-8 text-center text-[0.78rem] font-semibold text-[#7f89a4]">
                No rooms match “{query}”.
              </p>
            )
          ) : (
            ROOM_GROUPS.map((group) => (
              <div key={group.label} className="mt-4">
                <div className="flex items-center gap-2 px-2 pb-1.5">
                  <p className="text-[0.58rem] font-extrabold uppercase tracking-[0.2em] text-[#667089]">
                    {group.label}
                  </p>
                  <span className="h-px flex-1 bg-white/6" />
                </div>
                <div className="space-y-1">
                  {group.ids.map((id) => {
                    const room = rooms.find((entry) => entry.id === id);
                    if (!room) return null;
                    return (
                      <RoomRow
                        key={room.id}
                        room={room}
                        active={room.id === currentRoomId}
                        people={occupancy[room.id] ?? 0}
                        onNavigate={() => onNavigate(room.id)}
                      />
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="border-t border-white/8 px-4 py-3">
          <p className="text-[0.62rem] leading-relaxed text-[#667089]">
            Rooms are derived from Zedu channels, DMs and users. There is no
            second room registry.
          </p>
        </div>
      </aside>
    </div>
  );
}

function RoomRow({
  room,
  active,
  people,
  onNavigate,
}: {
  room: OfficeRoom;
  active: boolean;
  people: number;
  onNavigate: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onNavigate}
      className="office-room-row flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left"
      data-active={active}
    >
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/8"
        style={{ backgroundColor: `${room.accent}1f`, color: room.accent }}
      >
        {room.kind === "personal" ? (
          <Armchair className="h-3.5 w-3.5" />
        ) : room.kind === "focus" ? (
          <CircleDot className="h-3.5 w-3.5" />
        ) : room.kind === "meeting" ? (
          <Users className="h-3.5 w-3.5" />
        ) : room.locked ? (
          <Lock className="h-3.5 w-3.5" />
        ) : (
          <DoorOpen className="h-3.5 w-3.5" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[0.78rem] font-bold text-white">
            {room.name}
          </span>
          {room.locked && (
            <span className="rounded-full bg-[#f43f5e]/15 px-1.5 py-0.5 text-[0.52rem] font-extrabold uppercase tracking-wider text-[#fb7185]">
              locked
            </span>
          )}
          {active && (
            <span className="rounded-full bg-[#a78bfa]/15 px-1.5 py-0.5 text-[0.52rem] font-extrabold uppercase tracking-wider text-[#c4b5fd]">
              you
            </span>
          )}
        </span>
        <span className="mt-0.5 block truncate text-[0.62rem] font-medium text-[#77809a]">
          {room.locked
            ? room.kind === "personal"
              ? "A colleague's office · you can walk up to the door"
              : "Join the channel in Zedu to enter"
            : room.description}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1 text-[0.6rem] font-bold text-[#8f98b2]">
        {people > 0 && (
          <>
            <span className="h-1.5 w-1.5 rounded-full bg-[#34d399]" />
            {people}
          </>
        )}
        <ChevronRight className="ml-0.5 h-3.5 w-3.5 text-[#5f6880]" />
      </span>
    </button>
  );
}

// ----------------------------------------------------------------------- chat

export function ChatPanel({
  open,
  room,
  messages,
  onSend,
  onClose,
  live = false,
}: {
  open: boolean;
  room: OfficeRoom | null;
  messages: ChatMessage[];
  onSend: (text: string) => void;
  onClose: () => void;
  /** Live office rooms mirror the real Zedu conversation; the demo does not. */
  live?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    list.scrollTop = list.scrollHeight;
  }, [messages.length, open]);

  useEffect(() => {
    if (open) {
      const timer = window.setTimeout(() => inputRef.current?.focus(), 320);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [open]);

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft("");
  };

  return (
    <div
      className={cn(
        "pointer-events-none absolute bottom-0 right-0 top-0 z-40 flex w-[min(25rem,100vw)] items-stretch p-2 transition-transform duration-300 sm:p-3",
        open ? "translate-x-0" : "translate-x-[110%]"
      )}
      inert={!open}
    >
      <section className="office-glass-strong pointer-events-auto flex h-full w-full flex-col overflow-hidden rounded-2xl border-white/10">
        <div className="flex items-center gap-2.5 border-b border-white/8 px-3.5 py-3">
          <span
            className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/10"
            style={{
              backgroundColor: `${room?.accent ?? "#a78bfa"}1f`,
              color: room?.accent,
            }}
          >
            <MessageSquare className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[0.84rem] font-extrabold text-white">
              {room?.name ?? "Room chat"}
            </p>
            <p className="text-[0.6rem] font-bold uppercase tracking-[0.14em] text-[#7f89a4]">
              {room?.kind === "personal"
                ? "DM · private office"
                : room?.kind === "channel"
                  ? "Existing channel messages"
                  : "Room chat"}
            </p>
          </div>
          <span className="hidden items-center gap-1 rounded-full border border-[#34d399]/20 bg-[#34d399]/10 px-2 py-1 text-[0.55rem] font-extrabold uppercase tracking-wider text-[#86efac] sm:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-[#34d399]" />
            {live ? "synced" : "live"}
          </span>
          <button
            type="button"
            className="office-icon-button !h-8 !w-8 !rounded-lg"
            onClick={onClose}
            aria-label="Close chat"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {room && room.chat ? (
          <>
            <div
              ref={listRef}
              className="office-scroll office-scroll-area flex-1 space-y-3 overflow-y-auto px-3.5 py-3"
            >
              <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 text-[0.64rem] leading-relaxed text-[#8f98b2]">
                <p className="font-bold text-[#c9cfe4]">
                  Same conversation, new room.
                </p>
                <p className="mt-0.5">
                  {room.kind === "personal"
                    ? "This is the DM with the office owner. Guests read along; the owner furnishes."
                    : live
                      ? `This is the real ${room.name} channel. New messages appear here as they are sent.`
                      : `Messages here are the existing ${room.name} messages, filtered to this room.`}
                </p>
              </div>
              {messages.map((message) => (
                <ChatRow key={message.id} message={message} />
              ))}
            </div>

            <form
              className="border-t border-white/8 p-3"
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
            >
              <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-2.5 py-1.5 focus-within:border-[#a78bfa]/45">
                <input
                  ref={inputRef}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={
                    room.kind === "personal"
                      ? "Message the office owner…"
                      : `Message ${room.name}…`
                  }
                  className="h-8 flex-1 bg-transparent text-[0.8rem] font-medium text-white placeholder:text-[#667089] focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!draft.trim()}
                  className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#8b5cf6] text-white transition-opacity disabled:opacity-35"
                  aria-label="Send message"
                >
                  <Send className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="mt-1.5 text-[0.55rem] font-semibold uppercase tracking-[0.12em] text-[#5f6880]">
                {live
                  ? "Live · sent to the same conversation as the 2D chat"
                  : "Demo · messages stay in this browser"}
              </p>
            </form>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5 text-[#7f89a4]">
              <Lock className="h-5 w-5" />
            </span>
            <p className="text-sm font-bold text-white">
              No chat in this space
            </p>
            <p className="text-[0.72rem] leading-relaxed text-[#7f89a4]">
              Walk into a channel room or a private office to see the
              conversation that already exists there.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

function ChatRow({ message }: { message: ChatMessage }) {
  if (message.system) {
    return (
      <div className="flex items-center gap-2 px-1 py-0.5">
        <Info
          aria-hidden="true"
          className="h-3.5 w-3.5 shrink-0 text-[#7f89a4]"
        />
        <p className="min-w-0 flex-1 text-[0.72rem] font-medium leading-relaxed text-[#8f98b2]">
          {message.text}
        </p>
        <span className="shrink-0 whitespace-nowrap text-[0.55rem] font-semibold uppercase tracking-wider text-[#5f6880]">
          {formatTime(message.at)}
        </span>
      </div>
    );
  }

  if (message.self) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%]">
          <div className="office-chat-bubble rounded-2xl rounded-br-md bg-gradient-to-br from-[#8b5cf6] to-[#6d4aff] px-3 py-2 text-[0.78rem] font-medium leading-relaxed text-white">
            {message.text}
          </div>
          <p className="mt-1 text-right text-[0.55rem] font-bold uppercase tracking-wider text-[#5f6880]">
            You · {formatTime(message.at)}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <span
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[0.58rem] font-black text-[#0b0d17]"
        style={{ backgroundColor: userTint(message.userId) }}
      >
        {initials(message.name)}
      </span>
      <div className="min-w-0 max-w-[85%]">
        <div className="flex items-baseline gap-2">
          <p className="text-[0.68rem] font-extrabold text-[#d8dced]">
            {message.name}
          </p>
          <p className="text-[0.52rem] font-semibold uppercase tracking-wider text-[#5f6880]">
            {formatTime(message.at)}
          </p>
        </div>
        <div className="office-chat-bubble mt-1 rounded-2xl rounded-tl-md border border-white/8 bg-white/[0.055] px-3 py-2 text-[0.78rem] font-medium leading-relaxed text-[#e6e9f6]">
          {message.text}
        </div>
      </div>
    </div>
  );
}

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

const TINTS: Record<string, string> = {
  ada: "#f472b6",
  tunde: "#34d399",
  maya: "#f59e0b",
  leo: "#60a5fa",
  ife: "#22d3ee",
  nia: "#fb7185",
  sam: "#e5e7eb",
  zoe: "#f4c46a",
  you: "#8b5cf6",
};

function userTint(id: string) {
  return TINTS[id] ?? "#8b5cf6";
}

// --------------------------------------------------------------------- avatar

export function AvatarDialog({
  open,
  config,
  onChange,
  onSave,
  onCancel,
}: {
  open: boolean;
  config: AvatarConfig;
  onChange: (config: AvatarConfig) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (!next ? onCancel() : undefined)}
    >
      <DialogContent
        className="office-dialog-content max-h-[92vh] w-[min(46rem,94vw)] overflow-y-auto rounded-3xl p-0"
        overlayClassName="office-dialog-overlay"
      >
        <div className="border-b border-white/8 px-6 py-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-left text-xl font-black tracking-tight text-white">
              <PaletteIcon />
              Make it yours
            </DialogTitle>
            <DialogDescription className="text-left text-[0.76rem] font-medium text-[#8f98b2]">
              Your look is saved to your Zedu profile and visible to everyone in
              the building.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="grid gap-5 p-6 sm:grid-cols-[13rem_1fr]">
          <div className="office-avatar-preview flex flex-col items-center justify-center rounded-2xl p-4">
            <AvatarPreview config={config} />
            <p className="mt-3 text-[0.66rem] font-extrabold uppercase tracking-[0.18em] text-[#a78bfa]">
              Live preview
            </p>
            <p className="mt-1 text-center text-[0.62rem] text-[#7f89a4]">
              Updates in the building as you choose.
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <p className="mb-2 text-[0.62rem] font-extrabold uppercase tracking-[0.18em] text-[#8f98b2]">
                Tint
              </p>
              <div className="flex flex-wrap gap-2">
                {AVATAR_TINTS.map((tint) => (
                  <button
                    key={tint}
                    type="button"
                    className="office-tint-swatch"
                    style={{ backgroundColor: tint }}
                    data-active={config.tint === tint}
                    onClick={() => onChange({ ...config, tint })}
                    aria-label={`Choose ${tint}`}
                  />
                ))}
              </div>
            </div>

            <OptionRow
              label="Body"
              options={BODY_OPTIONS}
              value={config.body}
              onChange={(body) => onChange({ ...config, body })}
            />
            <OptionRow
              label="Outfit"
              options={OUTFIT_OPTIONS}
              value={config.outfit}
              onChange={(outfit) => onChange({ ...config, outfit })}
            />
            <OptionRow
              label="Accessory"
              options={ACCESSORY_OPTIONS}
              value={config.accessory}
              onChange={(accessory) => onChange({ ...config, accessory })}
            />
          </div>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-white/8 px-6 py-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            className="office-button-secondary !h-10"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="office-button-primary !h-10"
            onClick={onSave}
          >
            <Check className="h-4 w-4" />
            Save look
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PaletteIcon() {
  return (
    <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#8b5cf6]/15 text-[#c4b5fd]">
      <Layers className="h-4 w-4" />
    </span>
  );
}

function OptionRow<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ id: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div>
      <p className="mb-2 text-[0.62rem] font-extrabold uppercase tracking-[0.18em] text-[#8f98b2]">
        {label}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            className="office-option rounded-lg px-3 py-1.5 text-[0.7rem] font-bold text-[#b9c1d6]"
            data-active={value === option.id}
            onClick={() => onChange(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function AvatarPreview({ config }: { config: AvatarConfig }) {
  const width = config.body === "a" ? 54 : config.body === "c" ? 76 : 64;
  const bodyColor =
    config.outfit === "lab"
      ? "#eef1fa"
      : config.outfit === "smart"
        ? shade(config.tint, -0.18)
        : config.tint;
  const skin = "#e8b990";

  return (
    <svg
      viewBox="0 0 200 250"
      className="h-56 w-full"
      role="img"
      aria-label="Avatar preview"
    >
      <defs>
        <linearGradient id="office-avatar-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={bodyColor} />
          <stop offset="100%" stopColor={shade(config.tint, -0.3)} />
        </linearGradient>
        <radialGradient id="office-avatar-glow">
          <stop offset="0%" stopColor={config.tint} stopOpacity="0.28" />
          <stop offset="100%" stopColor={config.tint} stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="100" cy="230" rx="62" ry="13" fill="#000" opacity="0.28" />
      <ellipse
        cx="100"
        cy="200"
        rx="72"
        ry="36"
        fill="url(#office-avatar-glow)"
      />
      <rect
        x={100 - width / 2 - 16}
        y="118"
        width="14"
        height="82"
        rx="7"
        fill={bodyColor}
        opacity="0.9"
      />
      <rect
        x={100 + width / 2 + 2}
        y="118"
        width="14"
        height="82"
        rx="7"
        fill={bodyColor}
        opacity="0.9"
      />
      <rect x="76" y="196" width="18" height="34" rx="8" fill="#1a1d2b" />
      <rect x="106" y="196" width="18" height="34" rx="8" fill="#1a1d2b" />
      <rect x="72" y="222" width="26" height="10" rx="5" fill="#0f111a" />
      <rect x="102" y="222" width="26" height="10" rx="5" fill="#0f111a" />
      <rect
        x={100 - width / 2}
        y="112"
        width={width}
        height="92"
        rx="24"
        fill="url(#office-avatar-body)"
      />
      {config.outfit === "smart" && (
        <>
          <path
            d={`M ${100 - width / 2 + 8} 116 L 100 150 L ${100 + width / 2 - 8} 116`}
            fill="#f4f5fb"
            opacity="0.92"
          />
          <rect
            x="96"
            y="132"
            width="8"
            height="46"
            rx="4"
            fill={config.tint}
          />
        </>
      )}
      {config.outfit === "hoodie" && (
        <>
          <path
            d={`M ${100 - width / 2 + 4} 118 Q 100 160 ${100 + width / 2 - 4} 118`}
            fill={shade(config.tint, -0.15)}
          />
          <rect
            x={100 - width / 2 + 4}
            y="168"
            width={width - 8}
            height="22"
            rx="10"
            fill={shade(config.tint, 0.06)}
            opacity="0.8"
          />
        </>
      )}
      {config.outfit === "lab" && (
        <>
          <rect
            x="96"
            y="132"
            width="8"
            height="42"
            rx="4"
            fill={config.tint}
            opacity="0.8"
          />
          <rect
            x={100 - width / 2 + 10}
            y="174"
            width={width - 20}
            height="6"
            rx="3"
            fill={shade(config.tint, -0.2)}
            opacity="0.6"
          />
        </>
      )}
      {config.outfit === "casual" && (
        <rect
          x={100 - width / 2 + 8}
          y="118"
          width={width - 16}
          height="10"
          rx="5"
          fill="#ffffff"
          opacity="0.16"
        />
      )}

      <rect x="94" y="96" width="12" height="18" rx="6" fill={skin} />
      <circle cx="100" cy="70" r="34" fill={skin} />
      <path
        d="M 66 66 Q 68 34 100 33 Q 132 34 134 66 Q 124 50 100 50 Q 78 50 66 66"
        fill="#2a1b15"
      />
      <circle cx="89" cy="70" r="3.1" fill="#171a24" />
      <circle cx="111" cy="70" r="3.1" fill="#171a24" />
      <path
        d="M 93 82 Q 100 87 107 82"
        stroke="#8d5458"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
      />
      {config.accessory === "glasses" && (
        <g stroke="#11131c" strokeWidth="2" fill="none">
          <circle cx="89" cy="70" r="10" />
          <circle cx="111" cy="70" r="10" />
          <path d="M 99 70 L 101 70" />
        </g>
      )}
      {config.accessory === "headphones" && (
        <g>
          <path
            d="M 64 68 Q 64 34 100 32 Q 136 34 136 68"
            stroke="#1b1e2d"
            strokeWidth="5"
            fill="none"
          />
          <rect x="57" y="60" width="14" height="22" rx="7" fill="#1b1e2d" />
          <rect x="129" y="60" width="14" height="22" rx="7" fill="#1b1e2d" />
        </g>
      )}
      {config.accessory === "cap" && (
        <g>
          <path
            d="M 66 56 Q 70 26 100 26 Q 132 28 134 56 Z"
            fill={config.tint}
          />
          <rect
            x="126"
            y="52"
            width="22"
            height="6"
            rx="3"
            fill={config.tint}
          />
        </g>
      )}
      <ellipse
        cx="100"
        cy="236"
        rx="34"
        ry="7"
        fill="none"
        stroke="#34d399"
        strokeWidth="2"
        opacity="0.7"
      />
    </svg>
  );
}

function shade(hex: string, amount: number) {
  const color = hex.replace("#", "");
  const value = parseInt(color, 16);
  const r = Math.round(
    Math.min(255, Math.max(0, ((value >> 16) & 255) * (1 + amount)))
  );
  const g = Math.round(
    Math.min(255, Math.max(0, ((value >> 8) & 255) * (1 + amount)))
  );
  const b = Math.round(
    Math.min(255, Math.max(0, (value & 255) * (1 + amount)))
  );
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

// ------------------------------------------------------------------- furniture

const CATEGORY_ICONS = {
  Work: Table2,
  Lounge: Armchair,
  Decor: Flower2,
};

export function FurniturePanel({
  room,
  items,
  catalogId,
  selected,
  rotation,
  saveState,
  canUndo,
  canRedo,
  isShared,
  hint,
  isMobile,
  onSelectCatalog,
  onMove,
  onRotate,
  onDelete,
  onUndo,
  onRedo,
  onReset,
  onPublish,
  onClose,
  onClearSelection,
}: {
  room: OfficeRoom;
  items: FurnitureItem[];
  catalogId: string | null;
  selected: FurnitureItem | null;
  rotation: number;
  saveState: "saved" | "saving" | "draft";
  canUndo: boolean;
  canRedo: boolean;
  isShared: boolean;
  hint?: string | null;
  isMobile?: boolean;
  onSelectCatalog: (id: string) => void;
  onMove: () => void;
  onRotate: () => void;
  onDelete: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onReset: () => void;
  onPublish: () => void;
  onClose: () => void;
  onClearSelection: () => void;
}) {
  return (
    <div className="pointer-events-none absolute bottom-3 right-3 z-40 w-[min(24rem,calc(100vw-1.5rem))] sm:bottom-20 sm:right-5">
      <section className="office-glass-strong pointer-events-auto flex max-h-[72vh] flex-col overflow-hidden rounded-2xl">
        <div className="flex items-center gap-2.5 border-b border-white/8 px-3.5 py-3">
          <span
            className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/10"
            style={{ backgroundColor: `${room.accent}1f`, color: room.accent }}
          >
            <Lamp className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[0.84rem] font-extrabold text-white">
              Furnish · {room.name}
            </p>
            <p className="text-[0.6rem] font-bold uppercase tracking-[0.14em] text-[#7f89a4]">
              {isShared
                ? "Admin build mode · draft"
                : "Personal office · autosave"}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            {saveState === "saving" ? (
              <span className="flex items-center gap-1 text-[0.56rem] font-bold uppercase tracking-wider text-[#a78bfa]">
                <Loader2 className="h-3 w-3 animate-spin" />
                saving
              </span>
            ) : saveState === "draft" ? (
              <span className="rounded-full bg-[#f59e0b]/15 px-2 py-1 text-[0.54rem] font-extrabold uppercase tracking-wider text-[#fbbf24]">
                draft
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[0.56rem] font-bold uppercase tracking-wider text-[#34d399]">
                <Check className="h-3 w-3" />
                saved
              </span>
            )}
            <button
              type="button"
              className="office-icon-button !h-7 !w-7 !rounded-lg"
              onClick={onClose}
              aria-label="Close furniture editor"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="office-scroll office-scroll-area flex-1 overflow-y-auto px-3.5 py-3">
          {selected ? (
            <div className="mb-3 rounded-xl border border-[#a78bfa]/30 bg-[#8b5cf6]/10 p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-[0.78rem] font-extrabold text-white">
                    {CATALOG_BY_ID[selected.catalogId]?.name ??
                      selected.catalogId}
                  </p>
                  <p className="text-[0.6rem] font-semibold text-[#9aa3bd]">
                    x {selected.x.toFixed(1)} · z {selected.z.toFixed(1)} ·{" "}
                    {selected.rotation}°
                  </p>
                </div>
                <button
                  type="button"
                  className="text-[0.6rem] font-bold uppercase tracking-wider text-[#a78bfa] hover:text-white"
                  onClick={onClearSelection}
                >
                  clear
                </button>
              </div>
              <div className="mt-2.5 grid grid-cols-3 gap-1.5">
                <button
                  type="button"
                  className="office-option flex items-center justify-center gap-1 rounded-lg py-2 text-[0.64rem] font-bold text-[#c9cfe4]"
                  onClick={onMove}
                >
                  <Move className="h-3.5 w-3.5" />
                  Move
                </button>
                <button
                  type="button"
                  className="office-option flex items-center justify-center gap-1 rounded-lg py-2 text-[0.64rem] font-bold text-[#c9cfe4]"
                  onClick={onRotate}
                >
                  <RotateCw className="h-3.5 w-3.5" />
                  Rotate
                </button>
                <button
                  type="button"
                  className="office-option flex items-center justify-center gap-1 rounded-lg py-2 text-[0.64rem] font-bold text-[#fb7185]"
                  onClick={onDelete}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </button>
              </div>
            </div>
          ) : (
            <div
              className={
                hint
                  ? "mb-3 flex items-start gap-2 rounded-xl border border-[#f43f5e]/30 bg-[#f43f5e]/10 px-3 py-2 text-[0.66rem] font-semibold text-[#fda4af]"
                  : "mb-3 flex items-center gap-2 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 text-[0.66rem] font-semibold text-[#9aa3bd]"
              }
            >
              {hint ? (
                <>
                  <TriangleAlert className="mt-px h-4 w-4 shrink-0 text-[#fb7185]" />
                  <span>{hint}</span>
                </>
              ) : (
                <>
                  <Box className="h-4 w-4 shrink-0 text-[#a78bfa]" />
                  {catalogId
                    ? isMobile
                      ? "Drag the ghost where you want it, then tap the floor to place."
                      : "Hover the floor until the ghost turns green, then press P to place."
                    : isMobile
                      ? "Pick an item, then tap the floor to place it."
                      : "Pick an item, then hover the floor and press P to place it."}
                </>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-1.5">
            {FURNITURE_CATALOG.map((item) => {
              const Icon = CATEGORY_ICONS[item.category] ?? Square;
              const count = items.filter(
                (entry) => entry.catalogId === item.id
              ).length;
              return (
                <button
                  key={item.id}
                  type="button"
                  className="office-catalog-card flex items-start gap-2 rounded-xl p-2.5 text-left"
                  data-active={catalogId === item.id}
                  onClick={() => onSelectCatalog(item.id)}
                >
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                    style={{
                      backgroundColor: `${item.color}22`,
                      color: item.color,
                    }}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[0.7rem] font-bold text-white">
                      {item.name}
                    </span>
                    <span className="mt-0.5 block text-[0.56rem] font-semibold uppercase tracking-wider text-[#7f89a4]">
                      {item.footprint.w}×{item.footprint.d} · {count}/
                      {item.maxPerRoom}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="border-t border-white/8 px-3.5 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="office-icon-button !h-8 !w-8 !rounded-lg"
                onClick={onUndo}
                disabled={!canUndo}
                aria-label="Undo"
              >
                <Undo2 className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className="office-icon-button !h-8 !w-8 !rounded-lg"
                onClick={onRedo}
                disabled={!canRedo}
                aria-label="Redo"
              >
                <Redo2 className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className="ml-1 rounded-lg px-2 py-1 text-[0.6rem] font-bold uppercase tracking-wider text-[#7f89a4] transition-colors hover:text-white"
                onClick={onReset}
              >
                reset
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              {isShared ? (
                <button
                  type="button"
                  className="flex items-center gap-1.5 rounded-lg bg-[#8b5cf6] px-3 py-1.5 text-[0.66rem] font-extrabold text-white"
                  onClick={onPublish}
                >
                  <ArrowUpRight className="h-3.5 w-3.5" />
                  Publish
                </button>
              ) : (
                <button
                  type="button"
                  className="flex items-center gap-1.5 rounded-lg bg-white/8 px-3 py-1.5 text-[0.66rem] font-extrabold text-[#d8dced] hover:bg-white/12"
                  onClick={onClose}
                >
                  <Check className="h-3.5 w-3.5" />
                  Done
                </button>
              )}
            </div>
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[0.55rem] font-semibold text-[#5f6880]">
            <span>
              {items.length} item{items.length === 1 ? "" : "s"} · rotation{" "}
              {rotation}°
            </span>
            <span>
              {isShared ? "Publish bumps the room version" : "500ms autosave"}
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
