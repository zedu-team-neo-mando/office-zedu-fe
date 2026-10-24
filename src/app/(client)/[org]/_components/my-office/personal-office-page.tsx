"use client";

import { useCallback, useContext, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Building2, Link2, Loader2 } from "lucide-react";
import { DataContext } from "~/store/GlobalState";
import { Button } from "~/components/ui/button";
import { showError, showSuccess } from "~/components/toast/sonner";
import { cn } from "~/lib/utils";
import { DEFAULT_STYLE, styleFor, type AvatarStyle } from "./office-models";
import { PersonalOfficeScene, STARTER, type Theme } from "./office-scene";
import {
  DecoratePanel,
  PersonRow,
  StylePanel,
  VisitPanel,
} from "./office-panels";
import {
  decodeOffice,
  encodeOffice,
  loadConversations,
  loadDm,
  loadMyOffice,
  loadMyStyle,
  loadTeammates,
  openDm,
  saveMyOffice,
  saveMyStyle,
  sendDm,
  watchDm,
  type ChatMessage,
  type Person,
  type SharedOffice,
} from "./personal-office-api";

type Mode = "office" | "style" | "decorate" | "visit";
type Visit = Person & { office?: SharedOffice };

const MODES: Array<[Mode, string]> = [
  ["office", "My office"],
  ["style", "Style me"],
  ["decorate", "Decorate"],
  ["visit", "Visit"],
];

/**
 * A person's own office: their desk and chair, objects they place, their
 * avatar, and visits to teammates' offices where the chat is a Zedu DM.
 */
export default function PersonalOfficePage() {
  const { state } = useContext(DataContext);
  const orgId: string = state?.orgId ?? "";
  const orgSlug: string = state?.orgSlug ?? "";
  const user = state?.user ?? {};
  const userId: string = user.id ?? user.user_id ?? "";
  const userName: string =
    user.username || user.fullname || user.first_name || "You";
  const me: Person = { id: userId, name: userName, avatar: user.avatar_url };

  const mount = useRef<HTMLDivElement>(null);
  const scene = useRef<PersonalOfficeScene | null>(null);
  const [mode, setMode] = useState<Mode>("office");
  const [style, setStyle] = useState<AvatarStyle>(DEFAULT_STYLE);
  const [theme, setTheme] = useState<Theme>("oak");
  const [selected, setSelected] = useState<string | null>(null);
  const [visiting, setVisiting] = useState<Visit | null>(null);
  const [dmId, setDmId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [teammates, setTeammates] = useState<Person[]>([]);
  const [loadingTeam, setLoadingTeam] = useState(false);
  const [conversations, setConversations] = useState<Person[]>([]);
  const seen = useRef(new Set<string>());
  const styleRef = useRef(style);
  styleRef.current = style;

  /* ---------- Scene ---------- */

  useEffect(() => {
    if (!mount.current || !orgId || !userId) return;
    const office = loadMyOffice(orgId, userId);
    const s = new PersonalOfficeScene(mount.current, {
      onSelect: setSelected,
      onLayoutChange: (layout) => {
        const current = loadMyOffice(orgId, userId);
        saveMyOffice(orgId, userId, { ...current, layout });
      },
    });
    scene.current = s;
    setTheme(office.theme);
    s.buildRoom(office.theme, userName);
    s.setLayout(office.layout);
    s.setMe(`${userName} (you)`, DEFAULT_STYLE);
    s.sitAtDesk();
    loadMyStyle(userId).then((loaded) => {
      setStyle(loaded);
      s.setMyStyle(loaded);
    });
    loadConversations(orgId).then(setConversations);
    return () => {
      s.dispose();
      scene.current = null;
    };
    // The scene is built once per person and organisation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, userId]);

  useEffect(() => {
    const s = scene.current;
    if (!s) return;
    s.decorating = mode === "decorate";
    if (mode !== "decorate") s.select(null);
    const wide = window.innerWidth > 820;
    s.setInsets(mode === "office" || !wide ? 0 : 296, wide ? 360 : 0);
  }, [mode]);

  /* ---------- Style ---------- */

  const saveStyleSoon = useRef<ReturnType<typeof setTimeout>>(undefined);
  const updateStyle = (patch: Partial<AvatarStyle>) => {
    const next = { ...styleRef.current, ...patch };
    setStyle(next);
    scene.current?.setMyStyle(next);
    clearTimeout(saveStyleSoon.current);
    saveStyleSoon.current = setTimeout(() => saveMyStyle(userId, next), 800);
  };

  /* ---------- Home and visits ---------- */

  const goHome = useCallback(() => {
    const s = scene.current;
    if (!s) return;
    const office = loadMyOffice(orgId, userId);
    s.setHost(null);
    s.buildRoom(office.theme, userName);
    s.setLayout(office.layout);
    s.sitAtDesk();
    setVisiting(null);
    setDmId(null);
    setMessages([]);
    setMode("office");
    loadConversations(orgId).then(setConversations);
  }, [orgId, userId, userName]);

  const visit = useCallback(
    async (person: Visit) => {
      const s = scene.current;
      if (!s) return;
      if (person.id === userId) return goHome();
      const shared = person.office;
      // Someone who hasn't shared their office link gets a starter office.
      s.buildRoom(shared?.theme ?? "ash", person.name);
      s.setLayout(shared?.layout?.length ? shared.layout : STARTER);
      s.setHost(person.name, shared?.style ?? styleFor(person.id));
      s.walkInAsGuest();
      setVisiting(person);
      setMode("office");
      setMessages([]);
      seen.current = new Set();
      setDmId(null);
      try {
        const channel = await openDm(orgId, person.id);
        setDmId(channel);
        const history = await loadDm(channel);
        history.forEach((m) => seen.current.add(m.id));
        setMessages(history);
      } catch (cause) {
        showError(
          cause instanceof Error ? cause.message : "The chat could not open."
        );
      }
    },
    [goHome, orgId, userId]
  );

  // Opening someone's office link takes you straight to their office.
  useEffect(() => {
    if (!scene.current) return;
    const shared = decodeOffice(window.location.hash);
    if (!shared) return;
    window.history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search
    );
    if (shared.owner.id !== userId) visit({ ...shared.owner, office: shared });
  }, [visit, userId]);

  useEffect(() => {
    if (mode !== "visit" || teammates.length || !orgId) return;
    setLoadingTeam(true);
    loadTeammates(orgId, userId)
      .then(setTeammates)
      .finally(() => setLoadingTeam(false));
  }, [mode, teammates.length, orgId, userId]);

  /* ---------- Chat ---------- */

  const receive = useCallback(
    (m: ChatMessage) => {
      if (!m.text || seen.current.has(m.id)) return;
      seen.current.add(m.id);
      setMessages((list) => [...list, m]);
      scene.current?.say(m.userId === userId ? "me" : "host", m.text);
    },
    [userId]
  );

  useEffect(() => {
    if (!dmId) return;
    return watchDm(dmId, receive);
  }, [dmId, receive]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !dmId) return;
    setDraft("");
    scene.current?.say("me", text);
    try {
      const sent = await sendDm(dmId, text);
      const m = sent ?? {
        id: `local-${Date.now()}`,
        userId,
        name: userName,
        text,
        at: Date.now(),
      };
      seen.current.add(m.id);
      setMessages((list) => [
        ...list,
        { ...m, userId, name: userName, text: m.text || text },
      ]);
    } catch {
      setDraft(text);
    }
  };

  const shareLink = async () => {
    const office = loadMyOffice(orgId, userId);
    const link = `${window.location.origin}${window.location.pathname}#office=${encodeOffice(
      {
        ...office,
        owner: { id: userId, name: userName },
        style,
      }
    )}`;
    try {
      await navigator.clipboard.writeText(link);
      showSuccess(
        "Office link copied",
        "Send it to a teammate so they can visit."
      );
    } catch {
      window.prompt("Copy your office link:", link);
    }
  };

  /* ---------- Decorating ---------- */

  const changeTheme = (next: Theme) => {
    setTheme(next);
    saveMyOffice(orgId, userId, {
      ...loadMyOffice(orgId, userId),
      theme: next,
    });
    scene.current?.buildRoom(next, userName);
  };

  const resetOffice = () => {
    if (!window.confirm("Clear your office back to just a desk and chair?"))
      return;
    scene.current?.setLayout(STARTER);
    saveMyOffice(orgId, userId, { theme, layout: STARTER });
    scene.current?.sitAtDesk();
  };

  // The session loads after the first render; the auth guard handles
  // people who aren't signed in.
  if (!orgId || !userId) {
    return (
      <div className="office-root z-[100] grid place-items-center">
        <p className="office-glass flex items-center gap-3 rounded-2xl px-5 py-4 text-sm font-bold">
          <Loader2 className="h-4 w-4 animate-spin text-[#a78bfa]" />
          Opening your office…
        </p>
      </div>
    );
  }

  const glass = "office-glass rounded-2xl";

  return (
    <div className="office-root z-[100]">
      <div ref={mount} className="absolute inset-0" />

      <header className="pointer-events-none absolute inset-x-3 top-3 z-10 flex flex-wrap items-center gap-2">
        <Link
          href={`/${orgSlug}`}
          className={cn(
            glass,
            "pointer-events-auto flex items-center gap-2 px-3 py-2 text-[0.85rem] font-black"
          )}
        >
          <ArrowLeft className="h-4 w-4" /> Zedu
        </Link>
        <nav className={cn(glass, "pointer-events-auto flex gap-1 p-1")}>
          {MODES.map(([key, label]) => (
            <button
              key={key}
              type="button"
              disabled={key === "decorate" && !!visiting}
              onClick={() => setMode(key)}
              className={cn(
                "rounded-xl px-3 py-1.5 text-[0.82rem] font-bold transition-colors disabled:opacity-30",
                mode === key
                  ? "bg-[#8b5cf6] text-white"
                  : "text-[#9aa3bd] hover:text-white"
              )}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="flex-1" />
        <Link
          href={`/${orgSlug}/office`}
          className={cn(
            glass,
            "pointer-events-auto flex items-center gap-2 px-3 py-2 text-[0.82rem] font-bold"
          )}
        >
          <Building2 className="h-4 w-4" /> Building
        </Link>
      </header>

      {visiting && (
        <div className="absolute left-1/2 top-[68px] z-10 flex -translate-x-1/2 items-center gap-3 whitespace-nowrap rounded-full bg-black/80 py-1.5 pl-4 pr-1.5 text-[0.82rem]">
          You&apos;re visiting {visiting.name}&apos;s office
          <button
            type="button"
            onClick={goHome}
            className="rounded-full bg-white px-3 py-1 font-bold text-[#111422]"
          >
            Back to my office
          </button>
        </div>
      )}

      {mode !== "office" && (
        <aside
          className={cn(
            glass,
            "office-scroll absolute left-3 top-[68px] z-10 max-h-[calc(100%-80px)] w-[calc(100%-24px)] overflow-y-auto p-4 md:w-[280px]"
          )}
        >
          {mode === "style" && (
            <StylePanel style={style} onChange={updateStyle} />
          )}
          {mode === "decorate" && (
            <DecoratePanel
              theme={theme}
              selected={selected}
              onTheme={changeTheme}
              onAdd={(id) => scene.current?.addItem(id)}
              onRotate={() => scene.current?.rotateSelected()}
              onDuplicate={() => scene.current?.duplicateSelected()}
              onRemove={() => scene.current?.removeSelected()}
              onReset={resetOffice}
            />
          )}
          {mode === "visit" && (
            <VisitPanel
              teammates={teammates}
              loading={loadingTeam}
              visitingId={visiting?.id}
              onVisit={visit}
              onLink={(link) => {
                const shared = decodeOffice(link);
                if (shared) visit({ ...shared.owner, office: shared });
                else showError("That doesn't look like an office link.");
              }}
            />
          )}
        </aside>
      )}

      <section
        className={cn(
          glass,
          "absolute bottom-3 right-3 z-10 flex h-[40%] w-[calc(100%-24px)] flex-col overflow-hidden md:top-[68px] md:h-auto md:w-[340px]"
        )}
      >
        <header className="border-b border-white/10 px-4 py-3">
          <p className="truncate text-[0.95rem] font-black">
            {visiting ? visiting.name : "My office"}
          </p>
          <p className="text-[0.72rem] text-[#9aa3bd]">
            {visiting ? "Direct message on Zedu" : "Your conversations"}
          </p>
        </header>
        <div className="office-scroll flex flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-3">
          {visiting ? (
            messages.length ? (
              messages.map((m) => (
                <div key={m.id} className="text-[0.85rem] leading-snug">
                  <span
                    className={cn(
                      "font-bold",
                      m.userId === userId ? "text-[#c4b5fd]" : "text-[#67e8f9]"
                    )}
                  >
                    {m.userId === userId ? "You" : m.name}
                  </span>{" "}
                  <span className="text-[0.68rem] text-[#6b7390]">
                    {new Date(m.at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <p className="[overflow-wrap:anywhere]">{m.text}</p>
                </div>
              ))
            ) : (
              <p className="m-auto text-center text-[0.82rem] text-[#9aa3bd]">
                You&apos;re in {visiting.name}&apos;s office. Say hello 👋
              </p>
            )
          ) : (
            <>
              <p className="text-[0.7rem] font-bold uppercase tracking-wider text-[#9aa3bd]">
                Share your office
              </p>
              <p className="text-[0.78rem] text-[#9aa3bd]">
                Teammates who open your link see your office the way you
                decorated it.
              </p>
              <Button
                variant="secondary"
                size="sm"
                className="self-start bg-white/10 text-[#eef0fa] hover:bg-white/20"
                onClick={shareLink}
              >
                <Link2 className="mr-1.5 h-4 w-4" /> Copy my office link
              </Button>
              <p className="mt-3 text-[0.7rem] font-bold uppercase tracking-wider text-[#9aa3bd]">
                Recent conversations
              </p>
              {conversations.length ? (
                conversations
                  .slice(0, 20)
                  .map((p) => (
                    <PersonRow
                      key={p.id}
                      person={p}
                      subtitle="Visit their office"
                      onClick={() => visit(p)}
                    />
                  ))
              ) : (
                <p className="text-[0.78rem] text-[#9aa3bd]">
                  No conversations yet. Use Visit to drop by a teammate&apos;s
                  office.
                </p>
              )}
            </>
          )}
        </div>
        {visiting && (
          <form
            onSubmit={send}
            className="flex gap-2 border-t border-white/10 p-2.5"
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={`Message ${visiting.name}…`}
              maxLength={2000}
              className="min-w-0 flex-1 rounded-xl border border-white/10 bg-[#111422] px-3 py-2 text-[0.85rem] text-[#eef0fa] outline-none focus:border-[#a78bfa]/60"
            />
            <Button type="submit" disabled={!dmId || !draft.trim()}>
              Send
            </Button>
          </form>
        )}
      </section>
    </div>
  );
}
