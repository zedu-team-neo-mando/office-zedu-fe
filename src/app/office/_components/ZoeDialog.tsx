"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, RotateCcw, Sparkles, Square, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { ZOE_GREETING, ZOE_QUICK_CHIPS } from "./office-data";

interface ZoeMessage {
  id: string;
  role: "assistant" | "user";
  content: string;
  streaming?: boolean;
  error?: boolean;
  originalPrompt?: string;
}

export default function ZoeDialog({
  open,
  roomName,
  nearby,
  ask,
  onClose,
}: {
  open: boolean;
  roomName: string;
  nearby: string[];
  ask: (question: string) => Promise<string>;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<ZoeMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const timerRef = useRef<number | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const stop = () => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    timerRef.current = null;
    timeoutRef.current = null;
    setThinking(false);
    setStreaming(false);
    setMessages((prev) =>
      prev.map((message) => ({ ...message, streaming: false }))
    );
  };

  useEffect(() => {
    if (!open) {
      stop();
      return;
    }
    if (messages.length === 0) {
      setMessages([
        {
          id: "zoe-greeting",
          role: "assistant",
          content: ZOE_GREETING,
        },
      ]);
    }
    const timer = window.setTimeout(() => inputRef.current?.focus(), 280);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    if (!list) return;
    list.scrollTop = list.scrollHeight;
  }, [messages, open, thinking]);

  const send = (raw: string) => {
    const text = raw.trim();
    if (!text || thinking || streaming) return;
    const userMessage: ZoeMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      content: text,
    };
    const answerId = `z-${Date.now()}`;
    setMessages((prev) => [...prev, userMessage]);
    setDraft("");
    setThinking(true);

    timeoutRef.current = window.setTimeout(() => {
      setThinking(false);

      ask(text)
        .then((answer) => {
          setMessages((prev) => [
            ...prev,
            { id: answerId, role: "assistant", content: "", streaming: true },
          ]);
          setStreaming(true);

          let index = 0;
          timerRef.current = window.setInterval(() => {
            index = Math.min(answer.length, index + 3);
            setMessages((prev) =>
              prev.map((message) =>
                message.id === answerId
                  ? { ...message, content: answer.slice(0, index) }
                  : message
              )
            );
            if (index >= answer.length) {
              if (timerRef.current) window.clearInterval(timerRef.current);
              timerRef.current = null;
              setStreaming(false);
              setMessages((prev) =>
                prev.map((message) =>
                  message.id === answerId
                    ? { ...message, streaming: false }
                    : message
                )
              );
            }
          }, 16);
        })
        .catch((error: unknown) => {
          const message =
            error instanceof Error
              ? error.message
              : "Zoe could not answer that right now.";
          setMessages((prev) => [
            ...prev,
            {
              id: answerId,
              role: "assistant",
              content: message,
              error: true,
              originalPrompt: text,
            },
          ]);
        });
    }, 700);
  };

  const retry = (prompt: string) => {
    if (!prompt || thinking || streaming) return;
    const answerId = `z-${Date.now()}`;

    setMessages((prev) =>
      prev.filter(
        (message) =>
          !(
            message.role === "assistant" &&
            message.error &&
            message.originalPrompt === prompt
          )
      )
    );
    setThinking(true);

    ask(prompt)
      .then((answer) => {
        setMessages((prev) => [
          ...prev,
          { id: answerId, role: "assistant", content: "", streaming: true },
        ]);
        setStreaming(true);

        let index = 0;
        timerRef.current = window.setInterval(() => {
          index = Math.min(answer.length, index + 3);
          setMessages((prev) =>
            prev.map((message) =>
              message.id === answerId
                ? { ...message, content: answer.slice(0, index) }
                : message
            )
          );
          if (index >= answer.length) {
            if (timerRef.current) window.clearInterval(timerRef.current);
            timerRef.current = null;
            setStreaming(false);
            setMessages((prev) =>
              prev.map((message) =>
                message.id === answerId
                  ? { ...message, streaming: false }
                  : message
              )
            );
          }
        }, 16);
      })
      .catch((error: unknown) => {
        const message =
          error instanceof Error
            ? error.message
            : "Zoe could not answer that right now.";
        setMessages((prev) => [
          ...prev,
          {
            id: answerId,
            role: "assistant",
            content: message,
            error: true,
            originalPrompt: prompt,
          },
        ]);
      })
      .finally(() => {
        setThinking(false);
      });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (!next ? onClose() : undefined)}
    >
      <DialogContent
        className="office-dialog-content z-[70] flex h-[min(40rem,88vh)] w-[min(42rem,94vw)] flex-col overflow-hidden rounded-3xl p-0"
        overlayClassName="office-dialog-overlay z-[65]"
      >
        <div className="flex items-center gap-3 border-b border-white/8 px-5 py-4">
          <span className="relative flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-[#f4c46a] to-[#c98b2e] text-[#1a1208]">
            <span className="text-lg font-black">Z</span>
            <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[#0d1020] bg-[#34d399]" />
          </span>
          <div className="min-w-0 flex-1">
            <DialogHeader className="space-y-0 text-left">
              <DialogTitle className="flex items-center gap-2 text-left text-lg font-black tracking-tight text-white">
                Zoe
                <span className="rounded-full border border-[#f4c46a]/25 bg-[#f4c46a]/10 px-2 py-0.5 text-[0.52rem] font-extrabold uppercase tracking-[0.16em] text-[#f4c46a]">
                  in-world
                </span>
              </DialogTitle>
              <DialogDescription className="text-left text-[0.68rem] font-semibold text-[#8f98b2]">
                Contributor assistant · {roomName}
                {nearby.length > 0 ? ` · ${nearby.length} nearby` : ""}
              </DialogDescription>
            </DialogHeader>
          </div>
          <button
            type="button"
            className="office-icon-button !h-8 !w-8 !rounded-lg"
            onClick={onClose}
            aria-label="Close Zoe"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-2 border-b border-white/6 bg-white/[0.02] px-5 py-2">
          <Sparkles className="h-3 w-3 text-[#f4c46a]" />
          <p className="text-[0.6rem] font-bold uppercase tracking-[0.14em] text-[#7f89a4]">
            Context: room + nearby presence, never private room contents
          </p>
        </div>

        <div
          ref={listRef}
          className="office-scroll office-scroll-area flex-1 space-y-3 overflow-y-auto px-5 py-4"
        >
          {messages.map((message) => (
            <div
              key={message.id}
              className={
                message.role === "user"
                  ? "flex justify-end"
                  : "flex items-start gap-2.5"
              }
            >
              {message.role === "assistant" && (
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#f4c46a]/15 text-[0.68rem] font-black text-[#f4c46a]">
                  Z
                </span>
              )}
              <div className="flex max-w-[88%] flex-col gap-1.5">
                <div
                  className={
                    message.role === "user"
                      ? "max-w-[85%] rounded-2xl rounded-br-md bg-gradient-to-br from-[#8b5cf6] to-[#6d4aff] px-3.5 py-2.5 text-[0.82rem] font-medium leading-relaxed text-white"
                      : "whitespace-pre-wrap rounded-2xl rounded-tl-md border border-white/8 bg-white/[0.045] px-3.5 py-2.5 text-[0.82rem] font-medium leading-relaxed text-[#e6e9f6]"
                  }
                >
                  {message.content}
                  {message.streaming && (
                    <span className="office-blink ml-0.5 inline-block h-3.5 w-1 rounded-sm bg-[#f4c46a] align-middle" />
                  )}
                </div>
                {message.role === "assistant" &&
                  message.error &&
                  message.originalPrompt && (
                    <button
                      type="button"
                      onClick={() => retry(message.originalPrompt!)}
                      disabled={thinking || streaming}
                      className="flex w-fit items-center gap-1.5 rounded-lg border border-rose-400/30 bg-rose-400/10 px-2.5 py-1 text-[0.68rem] font-bold text-rose-300 transition-opacity disabled:opacity-40"
                    >
                      <RotateCcw className="h-3 w-3" />
                      Retry
                    </button>
                  )}
              </div>
            </div>
          ))}

          {thinking && (
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#f4c46a]/15 text-[0.68rem] font-black text-[#f4c46a]">
                Z
              </span>
              <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-md border border-white/8 bg-white/[0.045] px-3.5 py-3">
                {[0, 1, 2].map((index) => (
                  <span
                    key={index}
                    className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#f4c46a]"
                    style={{ animationDelay: `${index * 0.12}s` }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-white/8 px-5 py-3">
          <div className="mb-2.5 flex flex-wrap gap-1.5">
            {ZOE_QUICK_CHIPS.map((chip) => (
              <button
                key={chip}
                type="button"
                className="office-option rounded-full px-2.5 py-1 text-[0.62rem] font-bold text-[#b9c1d6]"
                onClick={() => send(chip)}
                disabled={thinking || streaming}
              >
                {chip}
              </button>
            ))}
          </div>
          <form
            className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-2.5 py-1.5 focus-within:border-[#f4c46a]/40"
            onSubmit={(event) => {
              event.preventDefault();
              send(draft);
            }}
          >
            <input
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Ask Zoe about tasks, the team, deadlines…"
              className="h-9 flex-1 bg-transparent text-[0.82rem] font-medium text-white placeholder:text-[#667089] focus:outline-none"
            />
            {streaming ? (
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-white"
                onClick={stop}
                aria-label="Stop response"
              >
                <Square className="h-3.5 w-3.5" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!draft.trim() || thinking}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#f4c46a] text-[#1a1208] transition-opacity disabled:opacity-35"
                aria-label="Send to Zoe"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            )}
          </form>
          <p className="mt-1.5 text-[0.55rem] font-semibold uppercase tracking-[0.12em] text-[#5f6880]">
            Demo knowledge · proxied to contributor-helper in production
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
