"use client";

import { useEffect, useState } from "react";
import {
  ArrowRight,
  Armchair,
  DoorOpen,
  Loader2,
  Play,
  ShieldCheck,
  Sparkles,
  UserRound,
  Users,
} from "lucide-react";
import type { AvatarConfig } from "./office-data";

interface EntryScreenProps {
  ready: boolean;
  avatar: AvatarConfig;
  mode: "live" | "demo";
  onEnter: () => void;
  onTour: () => void;
}

export default function EntryScreen({
  ready,
  avatar,
  mode,
  onEnter,
  onTour,
}: EntryScreenProps) {
  const live = mode === "live";
  // Let the building show itself: the copy steps back after half a minute
  // without input and returns as soon as the visitor moves.
  const [idle, setIdle] = useState(false);

  useEffect(() => {
    let timer = 0;
    const wake = () => {
      setIdle(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setIdle(true), 30_000);
    };
    wake();
    const events = [
      "pointermove",
      "pointerdown",
      "keydown",
      "wheel",
      "touchstart",
    ];
    for (const event of events) {
      window.addEventListener(event, wake, { passive: true });
    }
    return () => {
      window.clearTimeout(timer);
      for (const event of events) {
        window.removeEventListener(event, wake);
      }
    };
  }, []);

  const scrimOff = idle ? "opacity-[0.35]" : "opacity-100";

  return (
    <div className="office-entry">
      {/* The scrim exists to keep the copy readable over a daylight building.
          Once the copy steps back, it thins with it so the tower shows through. */}
      <div
        aria-hidden
        className={`office-entry-scrim pointer-events-none transition-opacity duration-700 ${scrimOff}`}
      />
      <div className="office-entry-content">
        <div className="flex items-center gap-3">
          <img src="/zedu_white.png" alt="Zedu" className="h-7 w-auto" />
          <span className="h-5 w-px bg-white/15" />
          <span className="office-chip border-[#a78bfa]/30 bg-[#a78bfa]/10 text-[#d8cbff]">
            <Sparkles className="h-3 w-3" />
            The Office
          </span>
          <span className="office-chip hidden sm:inline-flex">
            {live ? "Live" : "Demo"}
          </span>
        </div>

        <div
          className={
            idle
              ? "pointer-events-none opacity-0 transition-opacity duration-700"
              : "opacity-100 transition-opacity duration-700"
          }
        >
          <p className="mt-10 text-[0.7rem] font-extrabold uppercase tracking-[0.34em] text-[#a78bfa]">
            Zedu · spatial collaboration
          </p>
          <h1 className="office-entry-title mt-4">
            Your team,
            <br />
            <span>with a sense of place.</span>
          </h1>
          <p className="mt-6 max-w-[30rem] text-[0.98rem] leading-relaxed text-[#aab2c8]">
            The conversations you already have, in a building you can walk
            through. Channel rooms, private offices, presence, furniture and Zoe
            — all on your existing Zedu session.
          </p>

          <div className="office-pill-row mt-7">
            <span className="office-chip">
              <DoorOpen className="h-3.5 w-3.5 text-[#a78bfa]" />
              Channel rooms
            </span>
            <span className="office-chip">
              <Armchair className="h-3.5 w-3.5 text-[#34d399]" />
              Private offices
            </span>
            <span className="office-chip">
              <Users className="h-3.5 w-3.5 text-[#60a5fa]" />
              Live presence
            </span>
            <span className="office-chip">
              <Sparkles className="h-3.5 w-3.5 text-[#f4c46a]" />
              Zoe in-world
            </span>
          </div>
        </div>

        <div className="mt-9 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            className="office-button-primary"
            onClick={onEnter}
            disabled={!ready}
          >
            {ready ? (
              <>
                {live ? "Enter the office" : "Enter the demo"}
                <ArrowRight className="h-4 w-4" />
              </>
            ) : (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Building the office…
              </>
            )}
          </button>
          <button
            type="button"
            className="office-button-secondary"
            onClick={onTour}
            disabled={!ready}
          >
            <Play className="h-4 w-4" />
            Take the 60-second tour
          </button>
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.045] px-3.5 py-2.5">
            <div
              className="relative flex h-10 w-10 items-center justify-center rounded-full text-sm font-black text-[#0b0d17]"
              style={{ backgroundColor: avatar.tint }}
            >
              {live ? <UserRound className="h-4 w-4" /> : "AO"}
              <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[#0b0d17] bg-[#34d399]" />
            </div>
            <div className="leading-tight">
              <p className="text-sm font-bold text-white">
                {live ? "Your session" : "Ada Obi"}
              </p>
              <p className="text-[0.7rem] font-medium text-[#8f98b2]">
                {live ? "Signed in to Zedu" : "Product Designer · Zedu HQ"}
              </p>
            </div>
            <span className="ml-2 hidden items-center gap-1.5 rounded-full border border-[#34d399]/25 bg-[#34d399]/10 px-2 py-1 text-[0.62rem] font-extrabold uppercase tracking-wider text-[#86efac] sm:flex">
              <ShieldCheck className="h-3 w-3" />
              Session
            </span>
          </div>
          <p className="max-w-[17rem] text-[0.7rem] leading-relaxed text-[#6f7891]">
            Already signed in with your Zedu session. No second account, no
            second chat app.
          </p>
        </div>
      </div>

      {!live && (
        <div className="office-desktop-only pointer-events-none absolute bottom-6 right-7 text-right">
          <p className="text-[0.62rem] font-bold uppercase tracking-[0.24em] text-white/30">
            Demo build · local data
          </p>
          <p className="mt-1 text-[0.62rem] text-white/20">
            The Office · zedu-team-mando · 2026
          </p>
        </div>
      )}

      {!live && (
        <div className="pointer-events-none absolute right-[7%] top-[16%] hidden lg:block">
          <div className="office-float relative">
            <div className="absolute inset-0 -z-10 rounded-full bg-[#8b5cf6]/20 blur-3xl" />
            <div className="office-glass rounded-2xl px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[#34d399]" />
                <p className="text-[0.66rem] font-extrabold uppercase tracking-[0.18em] text-[#9aa3bd]">
                  Live in the pilot org
                </p>
              </div>
              <p className="mt-2 text-sm font-bold text-white">
                8 teammates online
              </p>
              <div className="mt-2 flex -space-x-2">
                {["#f472b6", "#34d399", "#f59e0b", "#60a5fa", "#22d3ee"].map(
                  (tint) => (
                    <span
                      key={tint}
                      className="h-6 w-6 rounded-full border-2 border-[#111422]"
                      style={{ backgroundColor: tint }}
                    />
                  )
                )}
                <span className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-[#111422] bg-white/10 text-[0.55rem] font-bold text-white">
                  +3
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
