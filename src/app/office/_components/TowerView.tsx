"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Home, Search, X } from "lucide-react";

import { cn } from "~/lib/utils";
import type { OfficeFloor } from "~/types/office";
import type { TowerOffice } from "./engine/tower-scene";

/**
 * The overlay around the tower view. The tower itself is 3D, rendered by the
 * engine; this is the rail, the people search and the lift indicator that sit
 * on top of it. The tower is a mode of the same route, not a second page.
 */
export function TowerView({
  floors,
  offices,
  officePage,
  onSelectOfficePage,
  currentFloor,
  focusedFloor,
  liftTarget,
  hovered,
  onSelectFloor,
  onShowTower,
  onClose,
  onLeave,
  onPickPerson,
}: {
  floors: OfficeFloor[];
  offices: TowerOffice[];
  officePage: number;
  onSelectOfficePage: (page: number) => void;
  currentFloor: number;
  focusedFloor: number | null;
  liftTarget: number | null;
  hovered: TowerOffice | null;
  onSelectFloor: (floorIndex: number) => void;
  onShowTower: () => void;
  onClose: () => void;
  onLeave: () => void;
  onPickPerson: (office: TowerOffice) => void;
}) {
  const [query, setQuery] = useState("");

  // Every member has an office, whether or not they are standing in it, so the
  // search is a real directory. Live presence only adds the status dot. The
  // demo's decorative storeys are not people, so they stay out of the search.
  const people = useMemo(
    () =>
      offices.filter(
        (office) =>
          office.kind === "personal" &&
          (office.interactive !== false || Boolean(office.occupantName))
      ),
    [offices]
  );

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return people
      .filter((office) =>
        (office.occupantName ?? office.name).toLowerCase().includes(needle)
      )
      .slice(0, 6);
  }, [people, query]);

  const ordered = useMemo(
    () => [...floors].sort((a, b) => a.index - b.index),
    [floors]
  );

  // The directory is authoritative, but a floor payload that omits `members`
  // would read as an empty tower; fall back to the offices we can see.
  const memberCount = useMemo(() => {
    const fromFloors = floors.reduce(
      (total, floor) => total + (floor.members ?? 0),
      0
    );
    const fromOffices = offices.filter(
      (office) => office.kind === "personal"
    ).length;
    return Math.max(fromFloors, fromOffices);
  }, [floors, offices]);

  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex flex-col justify-between p-4">
      <div className="pointer-events-auto flex items-start justify-between gap-3">
        <div className="w-64 rounded-2xl border border-white/10 bg-[#0b0f1c]/90 p-3 backdrop-blur">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-white/60">
              The tower
            </p>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full p-1 text-white/60 transition hover:bg-white/10 hover:text-white"
              aria-label="Leave the tower view"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <label className="flex items-center gap-2 rounded-xl bg-white/5 px-2 py-1.5">
            <Search className="h-3.5 w-3.5 text-white/40" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find a person"
              className="w-full bg-transparent text-sm text-white outline-none placeholder:text-white/35"
            />
          </label>

          {results.length > 0 && (
            <ul className="mt-2 space-y-1">
              {results.map((office) => (
                <li key={office.roomId}>
                  <button
                    type="button"
                    onClick={() => onPickPerson(office)}
                    className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm text-white/85 transition hover:bg-white/10"
                  >
                    <span className="truncate">
                      {office.occupantName ?? office.name}
                    </span>
                    <span className="text-[11px] text-white/45">
                      Floor {office.floorIndex}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {query.trim() && results.length === 0 && (
            <p className="mt-2 px-1 text-xs text-white/45">
              Nobody by that name.
            </p>
          )}

          <p className="mt-2 px-1 text-[0.65rem] leading-relaxed text-white/35">
            Click an office to read its chat, click it again to step inside.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <p className="rounded-full border border-white/10 bg-[#0b0f1c]/90 px-3 py-1.5 text-xs text-white/70 backdrop-blur">
            {memberCount} in the tower
          </p>
          <button
            type="button"
            onClick={onLeave}
            className="flex items-center gap-1.5 rounded-full border border-white/10 bg-[#0b0f1c]/90 px-3 py-1.5 text-xs font-medium text-white/70 backdrop-blur transition hover:bg-white/10 hover:text-white"
            aria-label="Leave the office"
            title="Leave the office"
          >
            <Home className="h-3.5 w-3.5" />
            Leave office
          </button>
        </div>
      </div>

      {hovered && (
        <div className="pointer-events-none mx-auto rounded-xl border border-white/10 bg-[#0b0f1c]/90 px-3 py-2 text-center text-xs text-white/80 backdrop-blur">
          <span className="font-medium text-white">{hovered.name}</span>
          <span className="text-white/50"> · Floor {hovered.floorIndex}</span>
          {hovered.present && (
            <span className="ml-2 inline-flex items-center gap-1">
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  hovered.status === "dnd"
                    ? "bg-rose-400"
                    : hovered.status === "call"
                      ? "bg-sky-400"
                      : hovered.status === "idle"
                        ? "bg-amber-400"
                        : hovered.status === "away"
                          ? "bg-slate-400"
                          : "bg-emerald-400"
                )}
              />
              in their office
            </span>
          )}
        </div>
      )}

      <div className="pointer-events-auto mx-auto flex max-w-full items-center gap-3 rounded-2xl border border-white/10 bg-[#0b0f1c]/90 px-3 py-2 backdrop-blur">
        <span className="text-[0.62rem] font-semibold uppercase tracking-wider text-white/45">
          Floors
        </span>
        <div className="relative">
          <select
            value={focusedFloor === null ? "all" : String(focusedFloor)}
            onChange={(event) => {
              const value = event.target.value;
              if (value === "all") onShowTower();
              else onSelectFloor(Number(value));
            }}
            aria-label="Choose a floor"
            className="appearance-none rounded-lg border border-white/10 bg-white/5 py-1.5 pl-3 pr-8 text-xs font-medium text-white outline-none transition hover:bg-white/10"
          >
            <option value="all" className="bg-[#0b0f1c]">
              Whole tower
            </option>
            <option value="0" className="bg-[#0b0f1c]">
              General
            </option>
            {ordered
              .filter((floor) => floor.kind === "member")
              .map((floor) => (
                <option
                  key={floor.index}
                  value={floor.index}
                  className="bg-[#0b0f1c]"
                >
                  {floor.name} · {floor.members}/{floor.capacity}
                </option>
              ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/40" />
        </div>
        <select
          aria-label="Choose offices shown outside"
          value={officePage}
          onChange={(event) => onSelectOfficePage(Number(event.target.value))}
          className="rounded-lg border border-white/10 bg-[#0b0f1c] px-2 py-1.5 text-xs text-white"
        >
          <option value={0}>Offices 1-20</option>
          <option value={1}>Offices 21-40</option>
        </select>
        <span className="hidden text-[0.65rem] text-white/45 sm:inline">
          {focusedFloor === null
            ? "Showing every storey"
            : focusedFloor === 0
              ? "General floor"
              : `Floor ${focusedFloor}`}
        </span>
        <span className="flex items-center gap-1.5 text-[0.65rem] text-emerald-300/80">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          {currentFloor === 0 ? "General" : `Floor ${currentFloor}`}
        </span>
      </div>

      {liftTarget !== null && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="rounded-2xl border border-violet-400/30 bg-[#0b0f1c]/95 px-6 py-4 text-center backdrop-blur">
            <p className="text-xs uppercase tracking-widest text-violet-300/70">
              Lift
            </p>
            <p className="mt-1 text-lg font-semibold text-white">
              {liftTarget === 0 ? "General floor" : `Floor ${liftTarget}`}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
