"use client";

import { useMemo, useState } from "react";
import { Copy, RotateCw, Trash2 } from "lucide-react";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import {
  ACCESSORIES,
  BODIES,
  FURNITURE,
  HAIR_STYLES,
  OUTFITS,
  PALETTES,
  styleFor,
  type AvatarStyle,
} from "./office-models";
import { THEMES, type Theme } from "./office-scene";
import type { Person } from "./personal-office-api";

const panelButton =
  "rounded-xl border border-white/10 bg-white/5 px-2 py-2 text-left text-[0.78rem] font-semibold text-[#eef0fa] transition-colors hover:border-[#a78bfa]/60 hover:bg-white/10";

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-2.5 flex items-center justify-between gap-2 text-[0.82rem]">
      <span className="text-[#9aa3bd]">{label}</span>
      {children}
    </div>
  );
}

function Choice<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Record<T, string | { label: string }>;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="w-[130px] rounded-lg border border-white/10 bg-[#111422] px-2 py-1.5 text-[0.8rem] text-[#eef0fa]"
    >
      {(Object.keys(options) as T[]).map((key) => {
        const option = options[key];
        return (
          <option key={key} value={key}>
            {typeof option === "string" ? option : option.label}
          </option>
        );
      })}
    </select>
  );
}

function Swatches({
  value,
  colors,
  onChange,
  label,
}: {
  value: string;
  colors: string[];
  onChange: (color: string) => void;
  label: string;
}) {
  return (
    <div className="flex max-w-[160px] flex-wrap justify-end gap-1.5">
      {colors.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={`${label} ${color}`}
          onClick={() => onChange(color)}
          style={{ background: color }}
          className={cn(
            "h-5 w-5 rounded-full border-2 border-[#111422]",
            value === color ? "ring-2 ring-[#a78bfa]" : "ring-1 ring-white/20"
          )}
        />
      ))}
      <input
        type="color"
        aria-label={`Custom ${label.toLowerCase()}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-5 w-6 cursor-pointer border-0 bg-transparent p-0"
      />
    </div>
  );
}

export function StylePanel({
  style,
  onChange,
}: {
  style: AvatarStyle;
  onChange: (patch: Partial<AvatarStyle>) => void;
}) {
  return (
    <>
      <h3 className="mb-1 text-[0.95rem] font-black">Style yourself</h3>
      <p className="mb-3 text-[0.75rem] leading-relaxed text-[#9aa3bd]">
        Your colour, build, outfit and extra also show in the shared office.
      </p>
      <Row label="Skin">
        <Swatches
          label="Skin"
          value={style.skin}
          colors={PALETTES.skin}
          onChange={(skin) => onChange({ skin })}
        />
      </Row>
      <Row label="Hair">
        <Choice
          label="Hair"
          value={style.hairStyle}
          options={HAIR_STYLES}
          onChange={(hairStyle) => onChange({ hairStyle })}
        />
      </Row>
      <Row label="Hair colour">
        <Swatches
          label="Hair colour"
          value={style.hair}
          colors={PALETTES.hair}
          onChange={(hair) => onChange({ hair })}
        />
      </Row>
      <Row label="Colour">
        <Swatches
          label="Colour"
          value={style.tint}
          colors={PALETTES.tint}
          onChange={(tint) => onChange({ tint })}
        />
      </Row>
      <Row label="Trousers">
        <Swatches
          label="Trousers"
          value={style.bottom}
          colors={PALETTES.bottom}
          onChange={(bottom) => onChange({ bottom })}
        />
      </Row>
      <Row label="Outfit">
        <Choice
          label="Outfit"
          value={style.outfit}
          options={OUTFITS}
          onChange={(outfit) => onChange({ outfit })}
        />
      </Row>
      <Row label="Build">
        <Choice
          label="Build"
          value={style.body}
          options={BODIES}
          onChange={(body) => onChange({ body })}
        />
      </Row>
      <Row label="Extra">
        <Choice
          label="Extra"
          value={style.accessory}
          options={ACCESSORIES}
          onChange={(accessory) => onChange({ accessory })}
        />
      </Row>
      <Button
        variant="secondary"
        className="mt-1 w-full bg-white/10 text-[#eef0fa] hover:bg-white/20"
        onClick={() => onChange(styleFor(String(Math.random())))}
      >
        Surprise me
      </Button>
    </>
  );
}

export function DecoratePanel({
  theme,
  selected,
  onTheme,
  onAdd,
  onRotate,
  onDuplicate,
  onRemove,
  onReset,
}: {
  theme: Theme;
  selected: string | null;
  onTheme: (theme: Theme) => void;
  onAdd: (catalogId: string) => void;
  onRotate: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onReset: () => void;
}) {
  return (
    <>
      <h3 className="mb-1 text-[0.95rem] font-black">Decorate your office</h3>
      <p className="mb-3 text-[0.75rem] leading-relaxed text-[#9aa3bd]">
        Add objects, then drag them where you want. Select one and press R to
        rotate or Delete to remove it.
      </p>
      <Row label="Room style">
        <Choice
          label="Room style"
          value={theme}
          options={THEMES}
          onChange={onTheme}
        />
      </Row>
      <div className="mb-3 grid grid-cols-2 gap-1.5">
        {Object.entries(FURNITURE).map(([id, def]) => (
          <button
            key={id}
            type="button"
            className={panelButton}
            onClick={() => onAdd(id)}
          >
            + {def.label}
          </button>
        ))}
      </div>
      <div className="border-t border-white/10 pt-3">
        {selected ? (
          <>
            <p className="mb-2 text-[0.85rem] font-bold">
              {FURNITURE[selected]?.label}
            </p>
            <div className="flex flex-wrap gap-1.5">
              <Button
                size="sm"
                variant="secondary"
                className="bg-white/10 text-[#eef0fa] hover:bg-white/20"
                onClick={onRotate}
              >
                <RotateCw className="mr-1 h-3.5 w-3.5" /> Rotate
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="bg-white/10 text-[#eef0fa] hover:bg-white/20"
                onClick={onDuplicate}
              >
                <Copy className="mr-1 h-3.5 w-3.5" /> Duplicate
              </Button>
              <Button size="sm" variant="destructive" onClick={onRemove}>
                <Trash2 className="mr-1 h-3.5 w-3.5" /> Remove
              </Button>
            </div>
          </>
        ) : (
          <p className="text-[0.75rem] text-[#9aa3bd]">
            Click an object in your office to select it.
          </p>
        )}
      </div>
      <Button
        variant="ghost"
        className="mt-3 w-full text-[#c4b5fd]"
        onClick={onReset}
      >
        Start over
      </Button>
    </>
  );
}

export function PersonRow({
  person,
  subtitle,
  onClick,
}: {
  person: Person;
  subtitle: string;
  onClick: () => void;
}) {
  const [broken, setBroken] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-xl p-2 text-left hover:bg-white/5"
    >
      <span className="grid h-8 w-8 flex-none place-items-center overflow-hidden rounded-full bg-[#8b5cf6] text-[0.8rem] font-black text-white">
        {person.avatar && !broken ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={person.avatar}
            alt=""
            className="h-full w-full object-cover"
            onError={() => setBroken(true)}
          />
        ) : (
          (person.name[0] ?? "?").toUpperCase()
        )}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[0.85rem] font-bold">
          {person.name}
        </span>
        <span className="block truncate text-[0.72rem] text-[#9aa3bd]">
          {subtitle}
        </span>
      </span>
    </button>
  );
}

export function VisitPanel({
  teammates,
  loading,
  visitingId,
  onVisit,
  onLink,
}: {
  teammates: Person[];
  loading: boolean;
  visitingId?: string;
  onVisit: (person: Person) => void;
  onLink: (link: string) => void;
}) {
  const [query, setQuery] = useState("");
  const shown = useMemo(
    () =>
      teammates
        .filter((p) => p.name.toLowerCase().includes(query.toLowerCase()))
        .slice(0, 50),
    [teammates, query]
  );
  const input =
    "mb-2 w-full rounded-xl border border-white/10 bg-[#111422] px-3 py-2 text-[0.8rem] text-[#eef0fa] outline-none placeholder:text-[#6b7390] focus:border-[#a78bfa]/60";
  return (
    <>
      <h3 className="mb-1 text-[0.95rem] font-black">Visit a teammate</h3>
      <p className="mb-3 text-[0.75rem] leading-relaxed text-[#9aa3bd]">
        Walk into a teammate&apos;s office and chat with them directly.
      </p>
      <input
        className={input}
        placeholder="Paste an office link…"
        onChange={(e) =>
          e.target.value.includes("office=") && onLink(e.target.value)
        }
      />
      <input
        className={input}
        placeholder="Search teammates"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {loading ? (
        <p className="text-[0.75rem] text-[#9aa3bd]">Loading teammates…</p>
      ) : shown.length ? (
        shown.map((p) => (
          <PersonRow
            key={p.id}
            person={p}
            subtitle={p.id === visitingId ? "You are here" : "Visit office"}
            onClick={() => onVisit(p)}
          />
        ))
      ) : (
        <p className="text-[0.75rem] text-[#9aa3bd]">No teammates found.</p>
      )}
    </>
  );
}
