# The Office — Product Requirements Document

**Version:** 1.5  
**Date:** October 24, 2026  
**Status:** Ready for sprint planning  
**Target:** One 4-day sprint, shipping a release every day  
**Team:** 15–20 AI-assisted contributors, mostly inexperienced  
**Ship model:** `NEXT_PUBLIC_FF_3D_OFFICE` (client) and `FF_3D_OFFICE` (server) are global kill switches, both default **OFF**; `organisations.office_settings.enabled` is the per-org gate. PRs merge to `dev`; the verified day's head is promoted daily and the pilot org is enabled after smoke. Rollback is a commit revert or turning the flag off.

---

## 0. Change Log

| Version | Change                                                                                                                                                                                                                                                                                       |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0     | Initial PRD. Assumed a multi-week plan, contributor-helper login, static furniture, and reuse of a legacy 2D prototype.                                                                                                                                                                      |
| 1.1     | Rewritten after product decisions: Zedu-native auth; Zoe proxied now and ported later; shared building + private offices; channel/DM spatial mapping; grid-snap furniture with admin and personal persistence; one 4-day sprint with daily releases; legacy prototype assumptions removed.   |
| 1.2     | Merge-to-`dev` delivery with revert-based rollback and daily dev→production promotion. Workstreams renamed to squads. Rulings: personal-office guest invites cut; Zoe is stateless with no rate limiting; office presence syncs to 2D presence on transitions; avatar sources are CC0 packs. |
| 1.3     | Lean schema: rooms are derived, not stored; `office_layouts` + `office_room_configs`; avatar config on `profiles`; audit via `audit_logs`; no building/room registry.                                                                                                                        |
| 1.4     | Final-consistency pass: feature flags restored per repo policy; 1:1 DM ownership per the requester's `dm_channels` row and group-DM ownership by group join order; team size fixed at 15–20; API path, draft, contract, and channel-naming fixes; PR-review allowlist called out.            |
| 1.5     | Presentation reset after the deployed build regressed: the original floor is the benchmark, overlay-first UI is a defect, and the tower must earn its place. Added design references and the rule that every office change is measured against this document.                                |

### Locked decisions

| Area            | Decision                                                                                                                                                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Authentication  | Zedu login and session only. No NextAuth or Google login from contributor-helper.                                                                                                                                                          |
| Zoe backend     | Proxy to contributor-helper for this sprint, then port Zoe into zedu-fe later.                                                                                                                                                             |
| Spatial model   | One shared building per organisation, plus one private office per user.                                                                                                                                                                    |
| Channel mapping | Zedu channels map to shared collaboration rooms/lounges.                                                                                                                                                                                   |
| DM mapping      | Zedu DMs map to private offices.                                                                                                                                                                                                           |
| Furniture       | Grid snap + zones. Admins furnish the building; users furnish their personal office. Persist in Zedu Postgres.                                                                                                                             |
| Rooms in v1     | Channel rooms, private offices, meeting rooms, Zoe reception, lounge/social, focus pods. No open-plan desk clusters.                                                                                                                       |
| Avatar          | Tint + preset body/outfit/accessory parts, saved to Zedu user state.                                                                                                                                                                       |
| Delivery        | One 4-day sprint, daily dev→production releases, 15–20 AI-assisted contributors. Global flags `NEXT_PUBLIC_FF_3D_OFFICE` and `FF_3D_OFFICE` default OFF; per-org `office_settings.enabled` controls the pilot. A broken slice is reverted. |
| Guest access    | Cut. Personal offices are enterable by the owner and active DM participants only; no invite flow.                                                                                                                                          |

---

## 1. Executive Summary & Goals

### 1.1 Vision

The Office is a WebGL/Three.js spatial layer over Zedu. Contributors log in with their existing Zedu account, enter their organisation's building, walk between channel rooms and private offices, see who is online, and talk to Zoe at her reception desk. Zoe is no longer a separate flat chat page; she is an in-world assistant triggered by proximity and backed by the existing contributor-helper knowledge base.

The product does **not** replace Zedu chat, auth, org roles, or calls. It gives those primitives a physical place.

### 1.2 Product thesis

1. **Reuse Zedu primitives.** Auth, org membership, channels, DMs, messages, RBAC, presence, and Buzz calls already exist. The Office adds geometry, furniture, proximity, and a spatial presence layer.
2. **Spatial rooms are views over existing conversations.** A channel room renders messages from that Zedu channel. A private office renders the DM with its owner. There is no second chat system.
3. **Only new state is spatial.** Spatial room overrides, furniture layouts, avatar config, and ephemeral positions are the only new data.
4. **Ship daily.** Every day ends with a verified slice promoted from `dev` to production. A broken slice is fixed by reverting its merge, not patched live.

### 1.3 Day-4 acceptance criteria

The sprint is successful when a logged-in Zedu user can:

1. Click **Enter Office** from the Zedu client and load the 3D building.
2. Move an avatar with WASD, arrow keys, or click-to-move, with collision against walls and furniture.
3. Enter a channel room mapped from a Zedu channel and see its members' messages as spatial chat.
4. Enter a private office mapped from a DM; only the owner and DM participant can enter.
5. See other online users' avatars, nameplates, and status rings in real time.
6. Walk to Zoe's desk, press **E**, and receive a streamed answer grounded in the Zoe knowledge base.
7. As an admin, enter build mode, place/move/rotate/delete furniture in the building, publish, and have all clients update.
8. As a user, place/move/rotate/delete furniture in their personal office, reload, and find it persisted.
9. Customize avatar tint and preset parts, reload, and find the avatar persisted.

### 1.4 Success metrics

| Metric                      | Target                                  |
| --------------------------- | --------------------------------------- |
| Login → controllable avatar | < 3s p75 on desktop, < 6s p75 on mobile |
| Frame rate                  | 60fps desktop, ≥ 30fps mobile           |
| Presence update latency     | < 500ms p95                             |
| Zoe first streamed token    | < 2s p75                                |
| Furniture save round-trip   | < 300ms p75                             |
| Layout publish propagation  | < 2s p95 to all connected clients       |
| Daily releases              | 4/4 days                                |
| P0 bugs at demo             | 0                                       |
| 20-user room stability      | 10-minute session without disconnect    |

### 1.5 Non-goals

- VR/AR.
- Voice synthesis or lip-sync for Zoe.
- Full character creator with body sliders and a clothing catalog.
- Custom 3D modelling pipeline; use primitives and licensed low-poly assets.
- Cross-organisation buildings.
- Persistent voice channels inside rooms (Buzz calls are launched from rooms; audio stays in the existing Buzz/Agora flow).
- Open-plan desk assignment.

### 1.6 Design references & presentation direction

These are the references the office presentation is measured against:

- [zedu-tower prototype](https://github.com/AviOfLagos/zedu-tower/tree/main) — teams are floors, channels are rooms, people sit where presence says they are. Its mapping is the reference for clarity and information density, not for interaction chrome.
- [chrisjdimarco — spatial interface reference](https://x.com/chrisjdimarco/status/2112951160118431979)
- [konstantinsaifo — 3D presentation reference](https://x.com/konstantinsaifo/status/2113161829891686767)

Rules that follow from them:

1. **The floor is the product.** The original floor build — walking, camera follow, click-to-move, collision and room bounds — is the benchmark. Presentation work must not regress movement, framing or click targets. A change that makes the floor feel worse is rejected even if it looks better in a screenshot.
2. **No overlay-first presentation.** Full-screen or edge-to-edge panels that cover the floor, modal-first flows and stacked chrome are defects, not features. UI is in-world or a thin HUD; anything that hides the room needs an explicit exception in this document.
3. **The tower must earn its place.** A tower view ships only if it tells the user where people and rooms are faster than the floor view does. A decorative tower that intercepts the first click, or a lift/floor picker that hides the floor, is out of scope until it clears that bar.
4. **Judge presentation in the running app**, against the deployed build and the previous version — not in isolation.
5. **The building is lit.** The interior reads as an office at working hours — plaster walls, warm floor finishes, ceiling downlights and glazed door heads — not a dark shell carrying neon trim. A private office is a room with a door you can shut, not a cubicle. The tower seen from the street and the floor walked from inside are one building and take their colours from one place (`src/app/office/_components/engine/palette.ts`); a colour that exists in only one of the two views is a defect.

Every office change is reviewed against this PRD. If a change contradicts it, update the PRD in the same PR and state why.

---

## 2. Users, Stories & Workflows

### 2.1 Personas

| Persona                | Needs                                           | Success looks like                                                              |
| ---------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------- |
| **New contributor**    | Onboarding, task discovery, "where do I start?" | Spawns at reception, Zoe greets, asks a question, gets a grounded answer.       |
| **Active contributor** | Quick answers, awareness of teammates           | Walks to a channel room, sees who is present, reads/sends messages, visits Zoe. |
| **Team lead**          | See activity, manage space                      | Sees occupancy, opens a meeting room, asks Zoe for a summary.                   |
| **Org admin**          | Control the building                            | Enters build mode, arranges furniture, publishes, sees changes live.            |

### 2.2 User stories

**US-1 — Zedu login**
As a Zedu user, I open The Office from my organisation and I am already authenticated, with my name, avatar, role, and org loaded from my existing session.

_Acceptance:_ no second login screen; missing/expired token redirects to the existing Zedu login with a return URL; org slug stays correct.

**US-2 — Avatar**
As a user, I can choose a tint and preset body/outfit/accessory parts, and my choice persists across devices.

_Acceptance:_ saved through the Zedu API; visible to other users; default is deterministic from user ID.

**US-3 — Movement**
As a user, I can move with WASD/arrows or click the floor, and I cannot walk through walls, closed doors, or furniture.

_Acceptance:_ smooth acceleration, rotation, collision, and a camera that follows without clipping.

**US-4 — Channel rooms**
As a channel member, I can walk into the room mapped to my channel and see/send messages there.

_Acceptance:_ messages use the existing channel API and Centrifugo stream; non-members see a locked door; history loads on entry.

**US-5 — Private offices**
As a user, I have a private office mapped to my DMs. I can furnish it; only I can edit it; my active DM counterparts can enter as read-only guests.

_Acceptance:_ access enforced server-side; unauthorized users cannot subscribe to the room channel or load its layout.

**US-6 — Presence**
As a user, I see other online users in the same room as avatars with nameplates and status.

_Acceptance:_ join/leave in < 2s; positions interpolate; idle/away/call/DND states are visible.

**US-7 — Zoe**
As a user, I walk to Zoe's desk, press E, and ask a question. Zoe answers using the existing knowledge base and knows which room I am in and who is nearby.

_Acceptance:_ proximity prompt; streaming SSE; grounded answers; clear "I don't know" behavior; no private data leakage.

**US-8 — Personal furniture**
As a user, I can place, move, rotate, and delete furniture in my office, and it persists.

_Acceptance:_ grid snap; overlap and bounds validation; autosave; reload restores; guests see updates.

**US-9 — Admin building furniture**
As an admin, I can edit shared rooms and the building shell in-world and publish a new layout.

_Acceptance:_ build mode gated by role; draft is private; publish validates, increments version, persists, and broadcasts; all clients reconcile.

### 2.3 Core workflows

#### Workflow A — First entry

1. User clicks **Enter Office** in the Zedu sidebar.
2. `/[org]/office` loads inside the existing client layout and `AuthGuard`.
3. Client reads `token` and `orgId` from `localStorage` via `AuthGuard` and profile/org from `DataContext`; `orgSlug` comes from the route param.
4. Building bootstrap request returns building, rooms, channel/DM mapping, and published layouts.
5. User spawns at reception. If no avatar config exists, the avatar modal opens with presets.
6. Zoe proximity trigger greets the user with a short onboarding prompt.

#### Workflow B — Channel room

1. User walks to a channel door and enters, or clicks a room in the minimap.
2. Client requests room access and layout.
3. Server checks channel membership, returns the room shell and layout, and issues/authorizes Centrifugo subscription.
4. Client loads the room scene and recent messages.
5. Messages sent in the room use the existing channel message endpoint.
6. Leaving the room unsubscribes and returns the avatar to the corridor.

#### Workflow C — DM private office

1. User opens a DM in the normal Zedu UI or clicks a colleague's avatar and selects **Message**.
2. Client resolves the requester's DM row to the counterpart's private office (`dm_channels.participant_id`); for a group DM it resolves to the earliest-added participant's office. Every other participant enters as a read-only guest.
3. The office owner is the counterpart on the requester's row, so the requester enters as a read-only guest. The owner enters their own office from the directory (or when a counterpart's DM maps to it).
4. Messages use the existing DM endpoints; the 3D view renders them as spatial bubbles.

#### Workflow D — Zoe

1. Avatar enters a 2m radius of Zoe's desk.
2. A billboard prompt appears: **Press E to talk to Zoe**.
3. Pressing E opens the Zoe dialog and pauses movement input.
4. The client posts to `POST /api/office/zoe` with the Zedu bearer token.
5. The zedu-fe route validates the token with zedu-be, builds a trusted office context, and proxies to contributor-helper with a service token.
6. The response streams back as SSE and renders with the existing typewriter pattern.
7. Closing the dialog returns control to the canvas.

#### Workflow E — Furniture edit

1. Owner/admin toggles **Edit** (or presses B).
2. Catalog opens; grid overlay and room bounds appear.
3. Place/move/rotate/delete items; client validates locally.
4. Personal office: autosave after 500ms idle. Admin building: save draft; **Publish** validates, increments version, persists transactionally, and broadcasts.
5. Other clients receive the published layout and reconcile without a reload.

---

## 3. Spatial Model

### 3.1 Zedu → Office mapping

| Zedu concept      | Office construct                                                                                                          | Access                                          | Chat source                       | Furniture editor                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------- | ------------------------------------- |
| Organisation      | Building                                                                                                                  | Org members                                     | —                                 | Org admins                            |
| Channel           | Shared collaboration room or lounge                                                                                       | Channel members                                 | Existing channel messages         | Org admins (MVP)                      |
| DM (1:1 or group) | Private office owned by the 1:1 counterpart on the requester's `dm_channels` row, or the earliest-added group participant | Owner + DM participants; non-owner read-only    | Existing DM messages              | Office owner                          |
| User              | Avatar + personal office                                                                                                  | Owner + DM participants; org members see avatar | —                                 | Self                                  |
| Org role          | Build-mode permission                                                                                                     | `manage:organization` (owner/administrator)     | —                                 | —                                     |
| Buzz call         | Meeting room action                                                                                                       | Room occupants                                  | Agora/Buzz                        | Org admins                            |
| Focus pod         | DND booth                                                                                                                 | One occupant                                    | —                                 | Org admins                            |
| Zoe               | Reception NPC                                                                                                             | All org members                                 | Contributor-helper knowledge base | Org admins (desk is system furniture) |

**DM rule (explicit):** a DM's spatial home is a private office. For a 1:1 DM, the office owner is the **counterpart on the requester's `dm_channels` row** (`participant_id`). `dm_channels` is a per-user view, so A's row maps to B's office and B's row maps to A's office; each is a read-only guest in the other's office. For a group DM, the owner is the **earliest-added participant** — earliest `channel_participants.created_at` for that DM, ties broken by lowest user id — and every other participant enters as a read-only guest. This satisfies both "personal office per user" and "DMs map to private offices" without creating a second room per pair.

### 3.2 Building layout (re-planned)

The previous open-plan desk cluster layout is removed. The building is a set of wings around a central corridor:

```
+--------------------------------------------------------------------------------+
|  RECEPTION / ZOE DESK          |  MEETING A        |  MEETING B                |
|  spawn point, Zoe, noticeboard |  Buzz-enabled     |  Buzz-enabled             |
+--------------------------------+-------------------+---------------------------+
|  LOUNGE / SOCIAL               |  FOCUS PODS (4)                               |
|  sofas, proximity chat         |  single occupancy, auto-DND                   |
+--------------------------------+-----------------------------------------------+
|  CHANNEL WING                                                                  |
|  one door per channel the user belongs to: #general, #design, #dev, #marketing  |
|  locked doors for channels the user is not in                                  |
+--------------------------------------------------------------------------------+
|  PRIVATE WING                                                                  |
|  corridor of personal office doors; owner/DM access only                       |
+--------------------------------------------------------------------------------+
```

- Grid: **1 metre per tile**. Building shell: 40 × 30 tiles. Rooms: 8 × 8 to 12 × 10. Corridors: 2 tiles wide.
- Live floors use the backend's room coordinates, with internal 2-tile corridors between office blocks and rows. Touching offices share one normal-thickness wall without solid gap-fill.
- On the General floor, the meeting rooms are equally enlarged to 7 × 6 tiles, sharing a wall while Meeting 2 keeps its origin. Reception leaves a 2-tile passage to Meeting 1. Focus rooms remain 4 × 4 tiles in aligned pairs with 2-tile centre/cross corridors and a 3-tile gap before the channel row. A three-channel row uses equal widths across the shared frontage with two 2-tile passages.
- Member floors retain forty 5 × 5.4 offices in four rows, split into two five-office blocks per row with internal connecting corridors; shared-area passages stay open.
- The visible platform and navigation share one footprint. A tiled corridor finish and edge border distinguish circulation from the surrounding site. The outer wall faces have a small clearance from the border line; this trim is not another corridor. The front corridor serves the last row of doors.
- Doors occupy reserved tiles and cannot be blocked by furniture.
- Shared rooms and the building shell are one scene. Channel rooms and private offices are **room-scoped interiors** loaded on entry, so the client never renders every office at once.
- Every position carries a `roomId`; the lobby/corridor is a room (`kind = "lobby"`). Presence and chat subscriptions are per room.
- Deep link: `/[org]/office?room=<url-encoded roomId>`.

### 3.3 Room lifecycle

Rooms are **derived from existing Zedu entities**, not stored as a parallel registry:

| Room kind   | Derived from                        | Default layout                       |
| ----------- | ----------------------------------- | ------------------------------------ |
| `lobby`     | Fixed building key                  | Seeded                               |
| `reception` | Fixed building key                  | Seeded; Zoe desk system item         |
| `lounge`    | Fixed building key                  | Seeded                               |
| `meeting`   | Fixed keys `meeting:1`, `meeting:2` | Seeded                               |
| `focus`     | Fixed keys `focus:1..4`             | Seeded                               |
| `channel`   | `channels.id`                       | Template chosen by channel name hash |
| `personal`  | Owner's `users.id`                  | Template by avatar/tint hash         |

Only **spatial overrides** (bounds, capacity, enabled) and **layouts** are persisted. A channel rename, archive, or membership change is reflected on the next bootstrap without syncing room rows. `roomId` is an opaque composite: `channel:<channelId>`, `personal:<ownerUserId>`, `lobby`, `meeting:<n>`, `focus:<n>`, `lounge`, `reception`. A DM deep link resolves through the requester's `dmOfficeMap` to `personal:<ownerUserId>`.

---

## 4. Architecture & Codebase Touchpoints

### 4.1 System diagram

```
Browser (zedu-fe)
  ├─ AuthGuard + DataContext ............ existing Zedu session
  ├─ /[org]/office ...................... new route
  │   ├─ OfficeCanvas (Three.js)
  │   ├─ RoomScene / BuildingScene
  │   ├─ AvatarLayer / PresenceManager
  │   ├─ FurnitureEditor / Catalog
  │   └─ ZoeDialog
  ├─ existing channel + DM APIs ......... GetRequest/PostRequest
  ├─ existing Centrifugo connections .... chat/status
  └─ POST /api/office/zoe ............... zedu-fe server route (new)
        │  validates Zedu bearer token
        │  adds service token + trusted identity
        ▼
contributor-helper /api/chat ............ temporary Zoe brain
        │  OpenAI-compatible stream (OpenRouter)
        └─ knowledge.ts + clean-transcripts corpus

zedu-be (Go/Gin)
  ├─ /api/v1/office/* ................... new router/controller/service
  ├─ /api/v1/users/me/avatar ............ avatar config
  ├─ existing channels/DMs/messages ..... unchanged
  ├─ existing Centrifugo publish/auth ... extended for office rooms
  └─ Postgres ........................... office + furniture tables
```

### 4.2 Authentication flow (Zedu only)

1. `AuthGuard` (`src/app/(client)/[org]/_components/auth/auth-guard.tsx`) reads `token`, `orgId` from `localStorage`, dispatches `TOKEN`/`ORG_ID`, and fetches `/profile` and `/organisations/:orgId`.
2. The office route is inside `(client)/[org]`, so it inherits the guard and `client-layout.tsx`.
3. All office REST calls go through `GetRequest`/`PostRequest`/`PutRequest`/`DeleteRequest` from `src/utils/new-request.ts`, which attach `Authorization: Bearer <token>`.
4. All office server routes (only Zoe needs one) read the same bearer token and validate it against zedu-be before doing anything privileged.
5. There is **no** NextAuth session, Google OAuth, or contributor-helper login in the office path.

### 4.3 Zoe proxy flow (temporary)

- `zedu-fe/src/app/api/office/zoe/route.ts`:
  - Requires `Authorization: Bearer <zedu-token>`.
  - Calls zedu-be `GET /api/v1/users/me` (or the existing `/profile` endpoint) to resolve `userId`, `orgId`, display name, and role.
  - Builds the office context from a **server-validated** room membership check, not from raw client claims.
  - Calls contributor-helper `POST /api/chat` with `Authorization: Bearer ${ZOE_SERVICE_TOKEN}` and `x-zedu-user-id`, `x-zedu-org-id`, `x-zedu-role`.
  - Streams SSE back to the browser.
- `contributor-helper/src/app/api/chat/route.ts`:
  - Extend `getAuthenticatedUser()` to accept a constant-time-validated service token when `ZOE_ALLOW_SERVICE_AUTH=true`.
  - Keep the NextAuth path for standalone contributor-helper use.
  - Never trust identity headers unless the service token is valid.
- Secrets: `ZOE_SERVICE_TOKEN` is server-only in both deployments. It is never shipped to the browser.
- Context caps only (transport hygiene, not rate limiting): max 30 conversation messages, max 10 nearby users, max 20 tasks in context. No rate limiting this sprint — an accepted risk.
- Persistence: service-token chats are stateless. contributor-helper stores nothing for office traffic, so the Google-sub vs `x-zedu-user-id` key mismatch never materialises; the client supplies the conversation window on every request.
- **Port plan:** move the prompt and `knowledge.ts` into `zedu-fe/src/lib/zoe/`, move chat persistence to zedu-be, and keep the `POST /api/office/zoe` request/response shared schema unchanged. UI does not change.

### 4.4 Frontend structure

```
src/app/(client)/[org]/office/
├── page.tsx                     # office entry; dynamic import of the canvas
├── layout.tsx                   # office shell, providers
├── _components/
│   ├── OfficeCanvas.tsx         # renderer, scene lifecycle, resize, quality tier
│   ├── engine/
│   │   ├── useOfficeEngine.ts   # loop, input, movement, collision, camera
│   │   ├── useRoomLoader.ts     # room bootstrap + scene swap
│   │   ├── grid.ts              # grid math, AABB, pathfinding
│   │   └── quality.ts           # desktop/mobile tiers
│   ├── scenes/
│   │   ├── BuildingScene.tsx    # lobby, corridor, doors, lounge, meeting, focus
│   │   ├── RoomScene.tsx        # channel/personal/meeting interior
│   │   └── ZoeDesk.tsx          # reception NPC + interaction sphere
│   ├── avatars/
│   │   ├── Avatar.tsx           # GLTF, tint, nameplate, status ring
│   │   ├── AvatarLayer.tsx      # local + remote avatars, interpolation
│   │   └── avatarPresets.ts     # body/outfit/accessory presets
│   ├── presence/
│   │   ├── PresenceManager.tsx  # Centrifugo subscription + heartbeat
│   │   └── presenceMath.ts      # throttle, interpolation, dead reckoning
│   ├── chat/
│   │   ├── RoomChat.tsx         # existing channel/DM message hooks
│   │   └── SpeechBubbles.tsx    # sprite bubbles, distance fade
│   ├── furniture/
│   │   ├── FurnitureEditor.tsx  # edit mode, selection, transform
│   │   ├── CatalogPanel.tsx     # searchable catalog
│   │   ├── gridOverlay.ts       # grid + reserved tiles
│   │   └── layoutValidation.ts  # bounds, overlap, doors, limits
│   ├── zoe/
│   │   ├── ZoeDialog.tsx        # shadcn Dialog + streaming chat
│   │   ├── useZoeChat.ts        # SSE client + typewriter
│   │   └── zoePrompt.tsx        # proximity billboard + E key
│   └── ui/
│       ├── OfficeHud.tsx        # room name, online count, controls
│       ├── Minimap.tsx          # rooms + avatars
│       ├── RoomDirectory.tsx    # channel/personal room list
│       └── LoadingScreen.tsx
```

The Zoe proxy is **not** nested under the client route. It is a top-level App Router handler:

```
src/app/api/office/zoe/route.ts   # server proxy only
```

> **PR-review allowlist:** `src/app/(client)/[org]/office/`, `src/app/api/office/`, `src/lib/office/`, and `src/types/office.ts` are not in `.github/pr-review.config.json` today. Day 0 must extend that protected config (reviewer + `config-change-approved`) or the bot rejects every new office file.

### 4.5 Backend structure

```
pkg/router/office.go              # register /api/v1/office/*
pkg/controller/office/            # bind, validate, respond
services/office/                  # derive rooms, access, layouts, publish, avatar
internal/models/office.go         # OfficeLayout, OfficeRoomConfig
internal/models/migrations/       # additive migration + two nullable columns
tests/test_office/                # package test_office
```

No `office_buildings` or `office_rooms` tables. The building is the organisation; rooms are derived from channels, DMs, and users.

Register `Office(r, ApiVersion, validator, db, logger)` in `pkg/router/router.go` next to the other feature routers. Use `middleware.Authorize(db.Postgresql)` and existing deactivated/org checks. Register the router only when `FF_3D_OFFICE=true` (default OFF); the client route is separately gated by `NEXT_PUBLIC_FF_3D_OFFICE`.

### 4.6 Reuse map

| Need                 | Reuse                                                                     |
| -------------------- | ------------------------------------------------------------------------- |
| Auth/session         | `AuthGuard`, `DataContext`, `localStorage` token, `new-request.ts`        |
| Org/role/permissions | `DataContext.orgData`, `src/types/rbac.ts`, `PermissionBoundary`          |
| Channel messages     | Existing channel message endpoints and Centrifugo chat connection         |
| DM messages          | Existing DM endpoints and hooks (`useOrganisationDms`)                    |
| Calls                | `src/lib/agora/`, `src/hooks/buzz/`                                       |
| Presence transport   | Existing Centrifugo connection/token setup                                |
| UI                   | `src/components/ui/dialog.tsx`, `button.tsx`, `avatar.tsx`, `tooltip.tsx` |
| Toasts               | `src/components/toast/sonner.tsx`                                         |
| Zoe knowledge        | `contributor-helper/src/lib/knowledge.ts` and chat prompt                 |
| Server HTTP          | `src/utils/new-request.ts` (client), `fetch` with `ZEDU_API_URL` (server) |

### 4.7 Key files to create or extend

| File                                                                              | Type   | Purpose                                                                         |
| --------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------- |
| `zedu-fe/src/app/(client)/[org]/office/page.tsx`                                  | New    | Office entry, dynamic canvas import                                             |
| `zedu-fe/src/app/(client)/[org]/office/_components/OfficeCanvas.tsx`              | New    | Renderer and scene lifecycle                                                    |
| `zedu-fe/src/app/(client)/[org]/office/_components/engine/useOfficeEngine.ts`     | New    | Movement, collision, input, camera                                              |
| `zedu-fe/src/app/(client)/[org]/office/_components/scenes/BuildingScene.tsx`      | New    | Building shell and doors                                                        |
| `zedu-fe/src/app/(client)/[org]/office/_components/scenes/RoomScene.tsx`          | New    | Room interiors                                                                  |
| `zedu-fe/src/app/(client)/[org]/office/_components/avatars/Avatar.tsx`            | New    | Avatar rendering                                                                |
| `zedu-fe/src/app/(client)/[org]/office/_components/presence/PresenceManager.tsx`  | New    | Presence sync                                                                   |
| `zedu-fe/src/app/(client)/[org]/office/_components/chat/RoomChat.tsx`             | New    | Channel/DM chat in room                                                         |
| `zedu-fe/src/app/(client)/[org]/office/_components/furniture/FurnitureEditor.tsx` | New    | Placement and edit mode                                                         |
| `zedu-fe/src/app/(client)/[org]/office/_components/zoe/ZoeDialog.tsx`             | New    | Zoe UI                                                                          |
| `zedu-fe/src/app/api/office/zoe/route.ts`                                         | New    | Zoe proxy                                                                       |
| `zedu-fe/src/types/office.ts`                                                     | New    | Shared frontend schema                                                          |
| `zedu-fe/src/lib/office/`                                                         | New    | API client, catalog, mapping, validation                                        |
| `zedu-fe/.github/pr-review.config.json`                                           | Extend | Allow the new office paths (protected; reviewer + `config-change-approved`)     |
| `zedu-fe/src/app/(client)/[org]/client-layout.tsx`                                | Extend | Add **Enter Office** entry                                                      |
| `zedu-fe/src/components/layout/sidebar/`                                          | Extend | Office nav item                                                                 |
| `contributor-helper/src/app/api/chat/route.ts`                                    | Extend | Service-token auth path                                                         |
| `zedu-be/pkg/router/office.go`                                                    | New    | Routes                                                                          |
| `zedu-be/pkg/controller/office/office.go`                                         | New    | Handlers                                                                        |
| `zedu-be/services/office/office.go`                                               | New    | Business logic                                                                  |
| `zedu-be/internal/models/office.go`                                               | New    | Models and DTOs                                                                 |
| `zedu-be/internal/models/audit_trail.go`                                          | Extend | Add `ResourceOfficeLayout` and office layout actions                            |
| `zedu-be/pkg/router/router.go`                                                    | Extend | Register office router                                                          |
| `zedu-be/internal/config/env.go`                                                  | Extend | `FF_3D_OFFICE` + Centrifugo office settings (protected file; approval required) |

---

## 5. Feature Specifications

### 5.1 Authentication & session

| Requirement        | Spec                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Login              | Existing Zedu login only. The office is inside the authenticated client shell.                                                                                                                                                                                                                                                                                                      |
| Token              | Bearer token from `localStorage.token`; `orgId` and `orgSlug` from storage/context.                                                                                                                                                                                                                                                                                                 |
| Expiry             | 401 triggers the existing `handleSessionExpired()` and returns to `/auth/login?redirect=...`.                                                                                                                                                                                                                                                                                       |
| Org switch         | Switching org in Zedu reloads the office with the new org's building.                                                                                                                                                                                                                                                                                                               |
| Server auth        | Office routes use `middleware.Authorize`; room access checks run after auth.                                                                                                                                                                                                                                                                                                        |
| Contributor-helper | Not a login surface. Only the server-to-server Zoe proxy uses it.                                                                                                                                                                                                                                                                                                                   |
| Feature gate       | Global flags `NEXT_PUBLIC_FF_3D_OFFICE` (client) and `FF_3D_OFFICE` (server) default OFF. When the client flag is OFF, the sidebar item is hidden and `/[org]/office` redirects to `/[org]/home`. When the server flag is OFF, the office API and `/api/office/zoe` return 404. When both are ON, `organisations.office_settings.enabled` decides whether that org sees the office. |

### 5.2 Avatar & profile

- **Data source:** Zedu profile (`display_name`, `username`, `avatar_url`, `role`) + `profiles.avatar_config`.
- **Customization:** tint color; body preset (3); outfit preset (4); accessory (none, headphones, glasses, cap).
- **Defaults:** deterministic from `userId` hash so users never appear blank.
- **Persistence:** `GET/PUT /api/v1/users/me/avatar`; optimistic UI with rollback on failure.
- **Rendering:** low-poly rigged GLTF; idle/walk/run clips; nameplate sprite; status ring; LOD for far avatars.
- **Tint clamp:** clamp saturation/lightness so dark or washed-out choices stay visible against the floor palette.
- **2D app:** unchanged; avatar config is additive.

### 5.3 3D engine and movement

| Item            | Spec                                                                                                            |
| --------------- | --------------------------------------------------------------------------------------------------------------- |
| Renderer        | `WebGLRenderer({ antialias: true, powerPreference: "high-performance" })`; shadows on desktop, off on low tier. |
| Camera          | Third-person follow, FOV 60, smooth lerp; no orbit controls in v1.                                              |
| Input           | WASD/arrows relative to camera; click/tap floor to pathfind; Shift to run.                                      |
| Movement        | Acceleration/deceleration; max walk 3 m/s, run 5 m/s; rotation via quaternion slerp.                            |
| Collision       | Grid AABB against walls, closed doors, and furniture footprints; sliding along walls.                           |
| Pathfinding     | A\* on the room grid; click target snapped to walkable tile; path cancels on manual input.                      |
| Room transition | Door interaction or click → fade → load target room → spawn at its entry tile.                                  |
| Quality tiers   | Desktop: shadows, 2× DPR cap. Mobile/low: no shadows, 1.5× DPR cap, fewer decorative items.                     |
| Pause           | Tab hidden pauses rendering; presence heartbeat continues at reduced rate.                                      |

**Performance budget**

| Metric           | Desktop              | Mobile |
| ---------------- | -------------------- | ------ |
| Draw calls       | < 100                | < 60   |
| Triangles        | < 60k                | < 30k  |
| Initial shell JS | < 2.5MB gzip         | same   |
| Room assets      | Lazy-loaded per room | same   |
| Avatars visible  | 30                   | 15     |
| Position updates | 10Hz                 | 5Hz    |

### 5.4 Building, rooms, and access

- **Building bootstrap:** `GET /api/v1/office/bootstrap` returns the organisation's office settings, a room directory derived from channels/DMs/users, the channel/DM mapping, and published layouts for visible rooms. The building id is the organisation id; there is no separate building row.
- **Room directory:** channels the user can see; locked state for channels they cannot join; personal office door; meeting rooms; focus pods; lounge; reception.
- **Room access rules:**

| Room kind   | Who can enter                  | Who can subscribe          | Who can edit furniture |
| ----------- | ------------------------------ | -------------------------- | ---------------------- |
| `lobby`     | Org members                    | Org members                | Org admins             |
| `reception` | Org members                    | Org members                | Org admins             |
| `lounge`    | Org members                    | Org members                | Org admins             |
| `meeting`   | Org members; capacity 8        | Org members up to capacity | Org admins             |
| `focus`     | One occupant; capacity 1       | Occupant                   | Org admins             |
| `channel`   | Channel members                | Channel members            | Org admins (MVP)       |
| `personal`  | Owner + active DM participants | Same                       | Owner                  |

- **Capacity:** room-level `capacity`; entering a full room is blocked with a toast.
- **Locked doors:** show channel name and “Join channel in Zedu to enter”.
- **Meeting rooms:** an in-room **Start Buzz** action calls the existing Buzz flow with the room's occupants.
- **Focus pods:** entering sets status `dnd`; leaving restores previous status.
- **No open-plan desks:** removed from scope.

### 5.5 Presence and status

- **Transport:** Centrifugo. One presence channel per room: `office:room:{encodedRoomId}:presence`, where `encodedRoomId` is the URI-encoded `roomId` (`channel%3Ach_1`) so the colon inside the room id does not collide with the channel separators.
- **Client → server:** position/rotation/status at 10Hz (5Hz mobile), throttled and validated.
- **Server validation:** room membership, bounds, max speed (anti-teleport), timestamp monotonicity.
- **Server → clients:** join, leave, update events; clients interpolate remote avatars.
- **Status values:** `online`, `idle` (>2 min no input), `away` (tab hidden), `call` (Buzz active), `dnd` (focus pod).
- **2D presence sync:** office enter/leave writes through via the existing `POST /api/v1/profile/presence` endpoint, which broadcasts `user_presence_changed`; position updates never write through. `call`/`dnd` are shown in the office status ring and are mapped to the existing status text/icon endpoint where supported; otherwise they stay office-local. `idle`/`away` remain office-local.
- **Nameplates:** display name + status icon; distance-based scaling and culling.
- **Reconnect:** exponential backoff; resubscribe; resync full room presence snapshot.
- **Grace:** remove an avatar 30s after disconnect unless presence returns.

### 5.6 Spatial chat

- **No new message store.** Channel rooms use existing channel messages; private offices use existing DM messages.
- **Send:** existing `PostRequest`/message hooks; the 3D client supplies the channel/DM id from the room mapping.
- **Receive:** existing Centrifugo chat connection; the office filters events to the active room.
- **Bubbles:** show the latest message above the sender for 8s; fade by distance beyond 8m; mute in focus pods.
- **Proximity:** client-side visibility radius (default 10m) within the same room; the message is still persisted normally.
- **History:** existing channel/DM history endpoints; last 30 messages rendered in the room log.
- **Moderation:** inherits channel permissions, edits, deletes, and restrictions.
- **Safety:** render message text as sanitized Markdown/plain text; no raw HTML.

### 5.7 Zoe spatial assistant

| Item        | Spec                                                                                                                                                     |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Placement   | Reception desk, fixed system furniture, interaction radius 2m.                                                                                           |
| Prompt      | Billboard above desk when in range: “Press E to talk to Zoe”.                                                                                            |
| Dialog      | shadcn `Dialog`; header “Zoe — Zedu Contributor Assistant”; close returns to canvas.                                                                     |
| Streaming   | SSE from `/api/office/zoe`; typewriter reveal; stop button aborts the request.                                                                           |
| Inputs      | Text only in v1; quick chips: “My tasks”, “Team status”, “Deadlines”, “How do I…?”                                                                       |
| Context     | Room kind/name, nearby users (max 10), user role/timezone, user tasks if available. No private room content.                                             |
| Knowledge   | Existing Zoe system prompt + `knowledge.ts` summaries and transcript matching.                                                                           |
| Answers     | Grounded in Zedu docs + cohort call knowledge; say “I couldn't find that” rather than invent.                                                            |
| Proactive   | Stretch only: one greeting on first entry and one tip per session. No unsolicited spam.                                                                  |
| Persistence | Stateless: office chats are not persisted by contributor-helper; the client sends the 30-message window each request. No rate limiting in v1 (accepted). |
| Port later  | Same shared schema; move prompt/knowledge into zedu-fe and persistence to zedu-be.                                                                       |

**Zoe context shape**

```json
{
  "location": "office",
  "buildingId": "org_...",
  "room": { "id": "channel:ch_...", "kind": "channel", "name": "#design" },
  "nearbyUsers": [
    { "displayName": "Ada", "status": "online" },
    { "displayName": "Tunde", "status": "dnd" }
  ],
  "user": { "role": "user", "timezone": "Africa/Lagos" },
  "tasks": []
}
```

### 5.8 Furniture system

**Placement model:** grid snap, 1m tiles, 90° rotations, room zones.

**Catalog (MVP):** desk, chair, meeting table, sofa, plant, whiteboard, screen, rug, lamp, bookshelf, reception counter, Zoe desk (system), focus booth (system). Each item declares footprint, allowed room kinds, collision, max per room, and variant.

```json
{
  "id": "desk_oak",
  "name": "Oak desk",
  "category": "desk",
  "footprint": { "w": 2, "d": 1 },
  "rotatable": true,
  "allowedRoomKinds": ["channel", "personal", "meeting"],
  "collision": true,
  "maxPerRoom": 8,
  "variants": ["oak", "white", "black"]
}
```

**Layout document**

```json
{
  "roomId": "channel:ch_1",
  "version": 7,
  "grid": { "width": 12, "height": 10, "tile": 1 },
  "items": [
    {
      "id": "f_01",
      "catalogId": "desk_oak",
      "x": 4,
      "y": 7,
      "rotation": 90,
      "variant": "oak"
    }
  ],
  "updatedAt": "2026-10-19T12:00:00Z"
}
```

**Validation rules**

- Item footprint must be inside room bounds.
- No overlap with another item's footprint.
- Reserved tiles (doors, spawn, Zoe interaction area) cannot be blocked.
- Item must be allowed in the room kind.
- Rotation ∈ {0, 90, 180, 270}.
- Per-room item cap: 100; per-catalog cap enforced.
- Publish requires `If-Match: <version>`; mismatch returns `409` with the current layout.
- Server re-validates everything; client validation is only for UX.

**Editing**

| Context               | Who                 | Save model                 | Sync                                                         |
| --------------------- | ------------------- | -------------------------- | ------------------------------------------------------------ |
| Building/shared rooms | Owner/administrator | Draft → Publish            | Publish increments version and broadcasts `layout.published` |
| Personal office       | Owner               | Autosave (debounced 500ms) | Broadcast `layout.updated` to occupants                      |
| DM guest              | Non-owner           | Read-only                  | Receives updates                                             |
| Channel room          | Org admins (MVP)    | Draft → Publish            | Same as building                                             |

**Editor UX:** toggle build mode (B), catalog drawer, grid overlay, ghost preview with valid/invalid tint, select, move, rotate (R), delete (Del), undo/redo (Ctrl+Z/Y), reset room, publish/cancel. Admin drafts are saved server-side per admin (`status = draft`) and do not affect the live room. Personal office autosaves.

**Real-time sync:** Centrifugo `office:room:{encodedRoomId}:layout` carries a notify payload `{ type: "published" | "updated", version, roomId, updatedBy }`; clients fetch the new layout on notify and ignore stale versions. Publish is transactional: validate → write version → broadcast notify.

**Persistence:** Zedu Postgres is the source of truth. No localStorage as source of truth; localStorage may cache the last layout for instant paint.

### 5.9 Admin building editor

- Visible only to `owner`/`administrator` (or the existing `manage:organization` permission) via `PermissionBoundary`.
- In-world edit mode covers lobby, lounge, reception, meeting rooms, focus pods, and channel rooms.
- Draft is per admin; only one publish at a time per room (`409` on version conflict).
- Publish writes a new `office_layouts` row with `status = published` and marks the previous published version `superseded`.
- “Reset to template” restores the seeded layout.
- Audit fields: `updated_by`, `published_at`, `version`.

### 5.10 Personal office & access

- One personal office per user, derived from `personal:<userId>` (no room row is created).
- Access check: owner OR active DM participant. For a 1:1 DM, the office owner is the counterpart on the requester's `dm_channels` row (`participant_id`). For a group DM the office owner is the earliest-added participant (earliest `channel_participants.created_at`, ties broken by lowest user id); other participants are read-only guests.
- Guests see the owner's published/autosaved layout and cannot edit.
- Personal office chat uses the DM conversation the visitor arrived from (1:1 or group); non-owner participants are view-only guests. If a guest enters from the directory with no DM context, use their 1:1 DM with the owner; if the owner enters with no visitor, show an empty room with a prompt to open a DM.
- Door labels show the owner's display name and a lock state.

### 5.11 UI, HUD, onboarding

- **HUD:** room name, online count, controls hint, quality toggle, mute toggle, exit to Zedu.
- **Minimap:** room shapes, doors, local avatar, nearby avatars, Zoe marker.
- **Room directory:** searchable list of channels/rooms with lock state and occupancy.
- **Onboarding:** first entry shows a 3-step card (move, enter a room, talk to Zoe), dismissible and persisted.
- **Loading:** progress for assets + room bootstrap; skeleton HUD.
- **Errors:** toasts via `showError`; retry on bootstrap failure; safe fallback to 2D Zedu.
- **Accessibility:** keyboard-only movement and room entry; focus trap in Zoe dialog; reduced-motion option; readable nameplates; color-blind-safe status icons (not color alone).

### 5.12 Mobile

- Touch joystick for movement; tap floor to move; tap avatar/room for actions.
- Lower quality tier by default; 30fps target.
- Zoe dialog full-screen sheet on small screens.
- Furniture editor supports tap-select and drag; rotate/delete buttons.
- If WebGL is unavailable, show a clear fallback with a link back to Zedu chat.

---

## 6. Data Models & APIs

### 6.1 Frontend Shared Schema (`zedu-fe/src/types/office.ts`)

```ts
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}
export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export type RoomKind =
  | "lobby"
  | "reception"
  | "lounge"
  | "meeting"
  | "focus"
  | "channel"
  | "personal";

export type PresenceStatus = "online" | "idle" | "away" | "call" | "dnd";

export interface AvatarConfig {
  tint: string;
  body: "a" | "b" | "c";
  outfit: "casual" | "smart" | "hoodie" | "lab";
  accessory: "none" | "headphones" | "glasses" | "cap";
}

export interface UserPresence {
  userId: string;
  displayName: string;
  username: string;
  avatar: AvatarConfig;
  roomId: string;
  position: Vec3;
  rotation: number;
  status: PresenceStatus;
  updatedAt: number;
}

export interface OfficeRoom {
  id: string; // composite: "channel:ch_1", "personal:usr_2", "lobby"
  kind: RoomKind;
  name: string;
  refId?: string; // channel_id, dm_channel_id, user_id, or "meeting:1"
  capacity: number;
  isLocked: boolean;
  bounds: { x: number; y: number; w: number; h: number };
}

export interface FurnitureItem {
  id: string;
  catalogId: string;
  x: number;
  y: number;
  rotation: 0 | 90 | 180 | 270;
  variant?: string;
}

export interface RoomLayout {
  roomId: string;
  version: number;
  grid: { width: number; height: number; tile: number };
  items: FurnitureItem[];
  updatedAt: string;
}

export interface BuildingBootstrap {
  building: { id: string; orgId: string; name: string };
  settings: { enabled: boolean };
  rooms: OfficeRoom[];
  layouts: Record<string, RoomLayout>;
  channelRoomMap: Record<string, string>;
  dmOfficeMap: Record<string, string>; // built per requester; 1:1 entries point to the counterpart's office
}

export interface ZoeRequest {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  context: {
    location: "office";
    buildingId: string;
    room: { id: string; kind: RoomKind; name: string };
    nearbyUsers: Array<{ displayName: string; status: PresenceStatus }>;
    user: { role: string; timezone: string };
    tasks: string[];
  };
}
```

### 6.2 Schema strategy: extend before duplicating

**Rule:** if Zedu already has the entity, key the office record to it. Create a new table only when the data has its own lifecycle (versioned layouts), is too large for a hot row (furniture JSON), or is a genuinely new relation.

| Existing table                                                        | Office change                                                                                                                                                | Why not a new entity table                                                                                                                                            |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `organisations`                                                       | Add `office_settings JSONB NULL` (`enabled`, `theme`, `capacity`) — or a 1:1 `organisation_office_settings` row if you want zero impact on org serialization | The building **is** the organisation. `office_buildings` would duplicate `id`, `name`, and timestamps.                                                                |
| `profiles`                                                            | Add `avatar_config JSONB NULL` (`tint`, `body`, `outfit`, `accessory`)                                                                                       | Avatar is 1:1 with the user's profile. `user_avatar_configs` adds a join for no benefit. If avatars must be identical across orgs, put the column on `users` instead. |
| `channels` / `dm_channels` / `channel_participants` / `user_channels` | No change                                                                                                                                                    | Channel, 1:1-DM, and group-DM membership already define room access. Do not duplicate rooms, members, or names.                                                       |
| `channel_invitations`                                                 | Reuse for private channel access                                                                                                                             | Already models channel-scoped invites.                                                                                                                                |
| `audit_logs`                                                          | Reuse with new `ResourceOfficeLayout` and `ActionOfficeLayoutPublish` values                                                                                 | `AuditLog` already stores actor, resource, old/new JSON, and timestamps. `office_layout_events` is redundant.                                                         |
| Centrifugo / Redis                                                    | Presence only                                                                                                                                                | Positions are ephemeral; do not persist them in Postgres.                                                                                                             |

**New tables (2)**

| Table                 | Key columns                                                                                                                                                       | Notes                                                                                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `office_layouts`      | `id`, `organisation_id`, `room_kind`, `ref_id`, `version`, `status`, `draft_owner_id?`, `layout JSONB`, `updated_by`, `published_at?`, `created_at`, `updated_at` | Versioned furniture. `ref_id` is `channel_id`, `user_id`, or a fixed key such as `meeting:1`. `status`: `draft`, `published`, `superseded`. |
| `office_room_configs` | `organisation_id`, `room_kind`, `ref_id`, `bounds JSONB`, `capacity`, `template`, `enabled`, `updated_by`, `updated_at`                                           | The table always exists; rows are written only for rooms that override the derived default (bounds, capacity, template).                    |

Group DM access and ownership resolve through `channel_participants`; do not infer group membership from `dm_channels` alone. 1:1 DM ownership resolves through `dm_channels.participant_id` on the requester's row, so the mapping is built per requester.

**Indexes and constraints**

- `office_layouts`: partial unique `(organisation_id, room_kind, ref_id, version) WHERE status IN ('published', 'superseded')` — version history.
- `office_layouts`: partial unique `(organisation_id, room_kind, ref_id) WHERE status = 'published'` — one live layout per room.
- `office_layouts`: partial unique `(organisation_id, room_kind, ref_id, draft_owner_id) WHERE status = 'draft'` — one draft per admin per room.
- `office_layouts`: index `(organisation_id, room_kind, ref_id, status)`.
- `office_room_configs`: primary key `(organisation_id, room_kind, ref_id)`.
- `organisations.office_settings` and `profiles.avatar_config`: no index needed; nullable, default `NULL`.

**Why not add room columns to `channels`?**

- `channels` is a hot, wide table read by every channel list and message query. Adding `office_bounds`, `office_capacity`, etc. changes every read and every API payload.
- DMs live in `dm_channels`, not `channels`; personal offices map to `users`. Expanding `channels` would require parallel changes in three tables.
- A polymorphic `office_room_configs` keyed by `(room_kind, ref_id)` covers all room types without touching chat tables.

**Why keep layouts in a new table?**

- Multi-row, versioned, draft/published, and potentially large JSON. It does not belong on `channels` or `organisations`.
- The feature can be removed without altering core chat/org tables.
- Existing clients and mobile builds are unaffected.

**Migration rules**

- Add nullable/defaulted columns first; backfill only if needed; never rename or drop existing columns in this sprint.
- Use additive migrations in `internal/models/migrations/`.
- GORM models live in `internal/models/office.go`.
- Wrap `office_settings` and `avatar_config` with `json:"-"` in the base models and expose them through dedicated response DTOs so existing API payloads do not change.

### 6.3 API endpoints

**zedu-be (`/api/v1`, authorized)**

`roomId` in these routes is the opaque composite defined in §3.3 (`channel:<channelId>`, `personal:<ownerUserId>`, `lobby`, `meeting:<n>`, `focus:<n>`, `lounge`, `reception`). URL-encode `:` as `%3A` in path segments (for example `channel%3Ach_1`). The service resolves it to `(room_kind, ref_id)` and checks access against existing `user_channels`, `dm_channels` + `channel_participants` (group DMs), and `org_user_managements` rows.

| Method | Path                                   | Purpose                                                                                               |
| ------ | -------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `GET`  | `/office/bootstrap`                    | Organisation office settings + derived room directory + mapping + published layouts for visible rooms |
| `GET`  | `/office/rooms/:roomId`                | Derived room metadata + access result                                                                 |
| `GET`  | `/office/rooms/:roomId/layout`         | Published layout                                                                                      |
| `GET`  | `/office/rooms/:roomId/layout/draft`   | Read the requesting admin's draft (`status = draft`)                                                  |
| `POST` | `/office/rooms/:roomId/layout/draft`   | Save admin draft (`office_layouts`, `status = draft`)                                                 |
| `POST` | `/office/rooms/:roomId/layout/publish` | Validate + publish + broadcast (`If-Match` version)                                                   |
| `POST` | `/office/rooms/:roomId/layout/reset`   | Reset a shared room to its seeded template (admin)                                                    |
| `PUT`  | `/office/rooms/:roomId/layout`         | Autosave personal office layout (owner only)                                                          |
| `GET`  | `/office/rooms/:roomId/occupants`      | REST fallback snapshot                                                                                |
| `GET`  | `/users/me/avatar`                     | Read avatar config from `profiles.avatar_config`                                                      |
| `PUT`  | `/users/me/avatar`                     | Save avatar config                                                                                    |
| `POST` | `/office/rooms/:roomId/enter`          | Access check + Centrifugo subscription authorization                                                  |
| `POST` | `/office/rooms/:roomId/leave`          | Leave + status cleanup                                                                                |

**zedu-fe server route**

| Method | Path              | Purpose                                                             |
| ------ | ----------------- | ------------------------------------------------------------------- |
| `POST` | `/api/office/zoe` | Validate Zedu token, build context, proxy SSE to contributor-helper |

**contributor-helper (extension)**

| Method | Path        | Change                                                                    |
| ------ | ----------- | ------------------------------------------------------------------------- |
| `POST` | `/api/chat` | Accept `ZOE_SERVICE_TOKEN` + trusted identity headers; keep NextAuth path |

### 6.4 Centrifugo channels

| Channel                                | Payload                                                        | Notes                                                                                |
| -------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `office:room:{encodedRoomId}:presence` | `{ type: "join"\|"leave"\|"update", presence: UserPresence }`  | Position/status; server-validated. `encodedRoomId` is URI-encoded (`channel%3Ach_1`) |
| `office:room:{encodedRoomId}:layout`   | `{ type: "published"\|"updated", version, roomId, updatedBy }` | Clients fetch the new layout                                                         |
| `office:user:{userId}:zoe`             | `{ type: "tip", content }`                                     | Stretch: proactive Zoe                                                               |

Chat is **not** re-published on an office channel. The client reuses the existing channel/DM Centrifugo events and filters them to the mapped conversation id.

Subscribe authorization must check room access server-side. Do not rely on client-side checks.

### 6.5 Permissions matrix

| Action                     | Owner/Administrator | Channel member | Personal office owner | DM guest            |
| -------------------------- | ------------------- | -------------- | --------------------- | ------------------- |
| Enter building             | Yes                 | Yes            | Yes                   | Yes                 |
| Enter channel room         | Yes                 | Yes            | Yes                   | No                  |
| Enter personal office      | Yes                 | No             | Yes                   | DM participant only |
| Edit shared furniture      | Yes                 | No             | No                    | No                  |
| Publish shared layout      | Yes                 | No             | No                    | No                  |
| Edit own office furniture  | Yes                 | Yes            | Yes                   | No                  |
| Start Buzz in meeting room | Yes                 | Yes            | Yes                   | Yes                 |

Gate admin UI with `PermissionBoundary permission="manage:organization"` from `src/components/rbac/`. A dedicated `manage:office` permission is a later enhancement, not a sprint dependency.

### 6.6 Validation & concurrency

- Layout save validates grid bounds, overlap, reserved tiles, catalog rules, and version.
- **Admin publish:** transaction — validate → insert new `office_layouts` row with `status = 'published'`, `version = max(non-draft version for the room) + 1`, and `published_at = now()` → mark the previous published row `status = 'superseded'` → enqueue Centrifugo broadcast. Retain the last 10 superseded versions per room (cleanup job or on-publish prune).
- **Personal autosave:** update the single published row in place and increment `version` (and `published_at`); no draft row. `PUT` uses `If-Match`; on mismatch return `409` with the latest layout and a “reload” toast.
- **Admin draft:** one `status = 'draft'` row per `(room, admin)`, enforced by the partial unique index. Drafts use `version = 0` and do not participate in the published/superseded version index. Saving a draft does not affect the live room.
- `office_room_configs` writes are admin-only back-office operations this sprint (seeded or updated outside the in-world editor); they do not version furniture.
- Chat and presence are not stored in Postgres as layout data; presence is ephemeral in Centrifugo/Redis.
- Publish events are written to the existing `audit_logs` table with `ResourceType = office_layout` and `Action = office.layout_publish`; no separate event table.

---

## 7. 4-Day Sprint Plan

### 7.1 Operating model

- **One sprint, four daily releases.** PRs target `dev`; each day the verified `dev` head is promoted to production. Where the repo requires `central-staging`, promote the same head through it without a separate QA hold; there is no additional staging soak in this sprint.
- **15–20 contributors.** Divided into 9 squads (SQ0–SQ8) with a squad lead each; 1–3 people per squad, and some contributors cover two squads.
- **Task size:** 2–6 hours per task, one owner, one PR, one reviewer. No task spans two days.
- **Shared schema first.** Day 0 freezes `src/types/office.ts`, API paths, room kinds, Centrifugo channel names, and the layout JSON schema. Only team-lead consensus changes them.
- **Feature flag.** Global flags `NEXT_PUBLIC_FF_3D_OFFICE` and `FF_3D_OFFICE` default OFF, so every merge lands dark. After the daily smoke, keep the flags ON and enable the pilot org with `office_settings.enabled`; other orgs remain dark. Every merge must be independently revertable.
- **File ownership.** Each squad owns a branch. Contributors do not edit another squad's branch.
- **Mocks before backend.** Frontend squads use a mock bootstrap/layout fixture until the API lands.
- **Daily integration:** 13:00 merge window opens, 15:30 freeze, 17:00 release, 17:30 demo, 18:00 review.
- **Cut line:** if a feature is not green by 15:30, it does not ship that day; do not hold the release. The flag keeps the slice dark for everyone else while it waits for the next window.

### 7.2 Squads and staffing

| Squad                       | Owner             | Scope                                                                                                                                                    |
| --------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SQ0 Shared Schema & Release | Team leads        | Types, API schema, CI, integration branch, feature flag, daily release, revert runbook                                                                   |
| SQ1 Auth & Data             | Backend           | `office_layouts`/`office_room_configs` migrations, `organisations.office_settings`, `profiles.avatar_config`, bootstrap, access, avatar API, layout APIs |
| SQ2 3D Core                 | 3D                | Renderer, scene, camera, movement, collision, click-to-move, quality tiers                                                                               |
| SQ3 Rooms & Mapping         | Product           | Building shell, room scenes, channel/DM mapping, doors, meeting/focus rooms                                                                              |
| SQ4 Presence & Chat         | Realtime          | Centrifugo presence, interpolation, status, room chat, bubbles                                                                                           |
| SQ5 Zoe                     | AI                | NPC, proximity, dialog, proxy, streaming, context, prompt                                                                                                |
| SQ6 Furniture               | 3D/product        | Catalog, editor, validation, draft/publish, autosave, real-time sync                                                                                     |
| SQ7 Avatar & UI             | Designer/frontend | Avatar presets, tint, HUD, minimap, directory, onboarding, mobile                                                                                        |
| SQ8 QA & Release            | QA                | Smoke tests, two-browser tests, bug triage, release checklist                                                                                            |

### 7.3 Day 0 — Shared Schema and setup (half day)

**Exit criteria**

- [ ] Revert runbook drafted: identify the day's office merges in the org and revert them to restore prior behaviour.
- [ ] `src/types/office.ts` merged with room kinds, layout schema, API DTOs, and Centrifugo names.
- [ ] API schema table reviewed by team leads.
- [ ] Feature-flag names and default-OFF behaviour confirmed for both repos.
- [ ] PR-review allowlist extended (or approval obtained) for the office paths listed in §4.4.
- [ ] Mock bootstrap and mock layout fixtures available.
- [ ] Asset list approved; licenses recorded; GLTF files in the repo or CDN.
- [ ] Backend migration branch created.
- [ ] Task board populated with 2–6 hour tasks and owners.
- [ ] Two test accounts and one admin account ready in the dev environment; one pilot org identified for production enablement.
- [ ] Rollback steps documented.

### 7.4 Day 1 — Walkthrough

**Goal:** login → enter building → move → see the shell → open Zoe with a stub response.

| Squad | Deliverable                                                                                                                                                                 |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SQ0   | Feature flag + route skeleton, CI green, release pipeline, revert runbook                                                                                                   |
| SQ1   | `office_layouts`/`office_room_configs` migrations, `organisations.office_settings`, `profiles.avatar_config`; bootstrap endpoint deriving seeded + channel + personal rooms |
| SQ2   | Canvas mounts; floor/walls; camera follow; WASD + collision; click-to-move stub                                                                                             |
| SQ3   | Building shell: reception, corridor, channel doors, private wing doors, lounge, meeting, focus                                                                              |
| SQ4   | Local presence only; remote avatar placeholder; Centrifugo connection spike                                                                                                 |
| SQ5   | Zoe desk mesh; proximity prompt; dialog shell; stub stream                                                                                                                  |
| SQ6   | Catalog data + grid overlay + read-only seeded furniture                                                                                                                    |
| SQ7   | HUD, loading screen, room name, exit button; avatar placeholder                                                                                                             |
| SQ8   | Smoke checklist: login, enter, move, open Zoe, reload                                                                                                                       |

**Release gate**

- [ ] A logged-in user enters the building and moves for 60s without errors.
- [ ] Collision works against walls and seeded furniture.
- [ ] Zoe prompt appears at the desk and the dialog opens.
- [ ] Promoted from `dev` to production; non-office behaviour unchanged.

### 7.5 Day 2 — Identity and rooms

**Goal:** avatars persist, channel rooms and private offices are enterable, other users appear, Zoe streams real answers.

| Squad | Deliverable                                                                                                                 |
| ----- | --------------------------------------------------------------------------------------------------------------------------- |
| SQ0   | Shared schema adjustments only; integration and release                                                                     |
| SQ1   | Avatar API; room enter/leave; channel membership checks; DM office mapping; 2D presence write-through on office enter/leave |
| SQ2   | Smooth movement, run, pathfinding, room transition fade, quality tier                                                       |
| SQ3   | Channel room interior loader; personal office interior; meeting/focus interactions; locked doors                            |
| SQ4   | Presence join/leave/update; remote avatar interpolation; status rings; idle/away detection                                  |
| SQ5   | Zoe proxy route; service-token path in contributor-helper; real SSE streaming; context injection; quick chips               |
| SQ6   | Furniture rendering in rooms; local placement prototype                                                                     |
| SQ7   | Avatar presets + tint modal; minimap; room directory; nameplates                                                            |
| SQ8   | Two-browser presence test; three-user room test; Zoe grounding spot-check                                                   |

**Release gate**

- [ ] Avatar changes persist after reload.
- [ ] Two users see each other move in the same room.
- [ ] A channel member enters the channel room; a non-member sees a locked door.
- [ ] A DM participant can enter the owner's private office; an unrelated user cannot.
- [ ] Zoe streams a grounded answer with room context.
- [ ] Promoted from `dev` to production.

### 7.6 Day 3 — Interaction and furniture

**Goal:** spatial chat, admin build mode, personal office editing, publish and real-time sync.

| Squad | Deliverable                                                                                                                                   |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| SQ0   | Release, conflict triage, release contents review                                                                                             |
| SQ1   | Draft/publish endpoints; version checks; broadcast on publish                                                                                 |
| SQ2   | Door interaction; room spawn points; collision with placed furniture; performance pass                                                        |
| SQ3   | Occupancy limits; focus pod DND; meeting room Buzz action                                                                                     |
| SQ4   | Room chat via existing channel/DM APIs; speech bubbles; distance fade; mute in focus pods; online/offline write-through on office enter/leave |
| SQ5   | Zoe dialog polish; abort/stop; error states; first-entry greeting                                                                             |
| SQ6   | Full editor: place, move, rotate, delete, undo/redo, validation; personal autosave; admin draft/publish; real-time reconciliation             |
| SQ7   | Onboarding card; admin build-mode affordance; mobile controls; empty/error states                                                             |
| SQ8   | Admin publish test on two browsers; personal autosave test; chat moderation spot-check                                                        |

**Release gate**

- [ ] Messages sent in a room appear as bubbles and in the room log.
- [ ] Admin places furniture, publishes, and a second browser updates within 2s.
- [ ] Personal furniture survives reload and is visible to a guest.
- [ ] Invalid placement (overlap, door block, out of bounds) is rejected.
- [ ] Version conflict returns 409 and recovers cleanly.
- [ ] Promoted from `dev` to production.

### 7.7 Day 4 — Hardening and launch

**Goal:** stable demo, performance, mobile, QA, documentation, rollback drill.

| Squad | Deliverable                                                              |
| ----- | ------------------------------------------------------------------------ |
| SQ0   | Release candidate, rollback drill, revert runbook, demo script           |
| SQ1   | Query/index review; audit fields; seed data for demo                     |
| SQ2   | Performance: draw calls, triangle count, memory; fix top 5 hotspots      |
| SQ3   | Room transition edge cases; capacity errors; reconnect after room switch |
| SQ4   | 100-user load test at target load; reconnect/backoff; presence cleanup   |
| SQ5   | Zoe prompt safety review, context caps, fallback message                 |
| SQ6   | Editor bug bash; mobile drag; persistence edge cases                     |
| SQ7   | Mobile pass; accessibility pass; copy and empty states                   |
| SQ8   | Full regression; P0/P1 triage; sign-off                                  |

**Release gate**

- [ ] All Day-4 acceptance criteria pass.
- [ ] 20-user room test passes for 10 minutes.
- [ ] Mobile 30fps on a mid-range device.
- [ ] No P0/P1 bugs open.
- [ ] Rollback drill verified: reverting the day's office merges restores the 2D experience.
- [ ] Demo script and support runbook published.

### 7.8 Daily cadence

| Time        | Activity                                                        |
| ----------- | --------------------------------------------------------------- |
| 09:00       | 15-min standup by squad; blockers and shared schema changes     |
| 09:30–12:30 | Build block 1                                                   |
| 12:30       | Integration check; merge window opens                           |
| 13:00–15:30 | Build block 2; bug fixes                                        |
| 15:30       | Code freeze for release; only release-blocking fixes            |
| 16:00       | Release candidate; smoke tests                                  |
| 17:00       | Production release                                              |
| 17:30       | Demo and retro notes                                            |
| 18:00       | Release review: what shipped, what slipped, what ships tomorrow |

### 7.9 Task template

Every task must include:

- **Outcome:** one sentence.
- **Files owned:** exact paths.
- **Shared schema:** request/response or props.
- **Acceptance:** 1–3 checks a reviewer can run.
- **Mock:** what to use if the dependency is not ready.
- **Revert unit:** the PR(s) to revert if this misbehaves.
- **Estimate:** 2–6 hours.
- **Reviewer:** squad lead.

### 7.10 AI-assisted contributor guardrails

Because most contributors are using AI:

1. **One task, one folder.** Do not let AI refactor unrelated code.
2. **Shared schema is read-only** unless SQ0 approves.
3. **No new dependencies** without SQ0 approval; `three` is the only planned addition.
4. **Generated code must pass** `pnpm check-format`, `check-lint`, `check-types`, `build`; Go must pass `go build ./...` and `go test ./tests/... -p 1`.
5. **Every PR has a reviewer** from the squad; do not self-merge.
6. **Screenshots or a 30s clip** for UI tasks.
7. **No secrets in code.** Zoe service token stays server-side.
8. **Feature flags stay default OFF.** After the daily smoke, keep the global flags ON and enable the pilot org via `office_settings.enabled`. A broken slice is reverted at the merge, not patched live. Keep PRs independently revertable.
9. **Ask before touching** protected files (`.github/`, AGENTS.md, CONTRIBUTING.md, tooling config, `internal/config/`).
10. **Keep PRs under ~400 meaningful lines.** Split larger work.

---

## 8. QA, Release & Risk

### 8.1 Test matrix

| Test                               | Type                          | When   |
| ---------------------------------- | ----------------------------- | ------ |
| Login redirect and org switch      | Manual                        | Daily  |
| Enter building, move, collide      | Manual + Cypress smoke        | Daily  |
| Two users see each other           | Manual, two browsers          | Day 2+ |
| Channel room access vs locked door | Manual + Go test              | Day 2+ |
| DM private office access           | Manual + Go test              | Day 2+ |
| Zoe streaming + grounding          | Manual + API test             | Day 2+ |
| Zoe service-token rejection        | contributor-helper API test   | Day 2+ |
| Furniture place/rotate/delete      | Manual + Go test (validation) | Day 3+ |
| Publish + real-time reconciliation | Manual, two browsers          | Day 3+ |
| Personal autosave + reload         | Manual + Go test              | Day 3+ |
| Version conflict 409               | Go test                       | Day 3+ |
| 20-user presence stress            | Manual                        | Day 4  |
| Mobile 30fps                       | Manual                        | Day 4  |
| Non-office regression (2D paths)   | Manual                        | Daily  |
| Rollback drill                     | Manual                        | Day 4  |

**Required commands before merge**

```sh
# zedu-fe
pnpm check-format
pnpm check-lint
pnpm check-types
pnpm build

# zedu-be
go build ./...
go test ./tests/... -p 1 -timeout 600s
```

### 8.2 Release checklist

- [ ] Release contents reviewed: only this cycle's office merges are included.
- [ ] Global flags verified OFF before enablement; pilot-org enablement is a separate, named step that turns them ON and sets `office_settings.enabled` for that org.
- [ ] Revert plan: the exact merge commits to revert are identified before the release ships.
- [ ] Backend migration applied; additive only.
- [ ] Smoke test passed.
- [ ] Rollback: git-revert the listed merges and redeploy; no DB rollback needed for additive migrations.
- [ ] On-call owner named for the release window.
- [ ] Demo notes posted.

### 8.3 Risks and mitigations

| Risk                                      | Likelihood | Impact   | Mitigation                                                                                                  |
| ----------------------------------------- | ---------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| Scope exceeds 4 days                      | High       | High     | Must/Should/Stretch cut line; cut stretch first; unshipped slices wait for the next window                  |
| Contributors + AI create conflicts        | High       | High     | Task ownership, shared schema, small tasks, lead review, mocks                                              |
| Merge conflicts across 15–20 people       | High       | Medium   | Task ownership; short-lived branches; 13:00 merge window                                                    |
| WebGL performance on low-end devices      | Medium     | High     | Quality tiers, instancing, LOD, no shadows on mobile                                                        |
| Centrifugo room authorization gaps        | Medium     | Critical | Server-side access checks; subscribe authorization tests                                                    |
| Zoe proxy auth mismatch                   | Medium     | High     | Service-token path built Day 1; stub fallback; port plan ready                                              |
| Furniture sync conflicts                  | Medium     | Medium   | Version checks, 409 recovery, publish transaction                                                           |
| Privacy leak in private offices/DMs       | Low        | Critical | Server-enforced access; no client-only checks; context caps                                                 |
| Asset licensing                           | Low        | Medium   | CC0 packs only (Kenney/Quaternius/KayKit); license log; no ripped assets                                    |
| Protected-file changes block PR           | Medium     | Medium   | Request approval on Day 0 for `internal/config/`, `.github/pr-review.config.json`, and tooling              |
| Daily release pressure causes regressions | Medium     | High     | Smoke tests, pre-identified revert commits, daily rollback drill                                            |
| PR-review bot rejects new office paths    | High       | High     | Extend `.github/pr-review.config.json` allowlist on Day 0 with reviewer approval (`config-change-approved`) |

### 8.4 Cut lines (MoSCoW)

**Must**

- Zedu auth/session.
- Building shell + movement + collision.
- Channel rooms + DM private offices.
- Presence + status.
- Zoe proximity + streaming proxy.
- Admin building furniture + personal office furniture + persistence + real-time publish.
- Avatar tint + presets + persistence.

**Should**

- Speech bubbles and distance fade.
- Minimap and room directory.
- Focus pod DND.
- Meeting room Buzz action.
- Onboarding card.

**Stretch**

- Zoe proactive tips.
- Room capacity animations.
- Avatar accessory variety.
- Layout templates per channel type.
- Voice input for Zoe.

**Cut**

- Personal-office guest invites — not modeled; access is owner + active DM participants. Revisit post-sprint.
- Zoe rate limiting — deliberate acceptance for this sprint; context caps only.

### 8.5 Day 0 decisions and assumptions

1. DM ↔ personal office ownership: resolved — for a 1:1 DM, the counterpart on the requester's `dm_channels` row (`participant_id`); for a group DM, the earliest-added participant (`channel_participants.created_at`); non-owners are read-only guests.
2. Channel room furniture is admin-only in MVP; channel managers can edit later.
3. Personal-office guest invites are cut; access is owner + active DM participants.
4. Meeting rooms are occupancy-based, not calendar-booked.
5. Building capacity is 500 concurrent users; target load is 100.
6. Zoe text only; no voice.
7. Primitive + low-poly GLTF assets only.

---

## 9. Appendices

### 9.1 Environment variables

```env
# zedu-fe
NEXT_PUBLIC_FF_3D_OFFICE=false
NEXT_PUBLIC_OFFICE_TILE_SIZE=1
NEXT_PUBLIC_OFFICE_PRESENCE_HZ=10
NEXT_PUBLIC_OFFICE_PROXIMITY_RADIUS=10
NEXT_PUBLIC_ZOE_INTERACTION_RADIUS=2

# zedu-fe server only
ZEDU_API_URL=https://api.example.com
ZOE_SERVICE_URL=https://contributors.example.com
ZOE_SERVICE_TOKEN=server-only-secret

# contributor-helper server only
ZOE_ALLOW_SERVICE_AUTH=false
ZOE_SERVICE_TOKEN=server-only-secret

# zedu-be
FF_3D_OFFICE=false
CENTRIFUGO_OFFICE_CHANNEL_PREFIX=office
```

Both global flags must be ON and `organisations.office_settings.enabled` true for an org to expose the office; both flags default OFF. `ZOE_ALLOW_SERVICE_AUTH` is set true only in the deployment that serves the office; the sample keeps it false. Secrets are server-only. Never expose `ZOE_SERVICE_TOKEN` via `NEXT_PUBLIC_*`.

### 9.2 Dependencies

```json
{
  "dependencies": {
    "three": "^0.160.0"
  },
  "devDependencies": {
    "@types/three": "^0.160.0"
  }
}
```

No physics engine. Grid AABB collision and A\* are implemented in `engine/grid.ts`. Avoid adding `@react-three/fiber` unless SQ0 approves; a plain Three.js scene keeps the bundle smaller and the AI-generated code easier to review. The version above is illustrative — pin the current stable `three` and `@types/three` at Day 0, and keep them in lockstep.

### 9.3 Asset list

| Asset                    | Source                                    | Notes                                                          |
| ------------------------ | ----------------------------------------- | -------------------------------------------------------------- |
| Avatar base              | Quaternius / KayKit character packs (CC0) | Rigged low-poly GLB, idle/walk/run; mix-and-match preset parts |
| Zoe desk                 | Primitive/custom low-poly                 | System item, not editable                                      |
| Desk, chair, table, sofa | Kenney Furniture Kit (CC0)                | Instanced                                                      |
| Plant, lamp, rug, shelf  | Kenney (CC0)                              | Instanced                                                      |
| Whiteboard, screen       | Primitive                                 | Emissive screen optional                                       |
| Focus booth              | Primitive                                 | System item                                                    |
| Meeting glass            | `MeshPhysicalMaterial`                    | Transparent, no transmission on mobile                         |

Record the license and source for every asset in `zedu-3d-office/ASSETS.md`.

### 9.4 Shared Schema examples

**Bootstrap response**

```json
{
  "building": { "id": "org_1", "orgId": "org_1", "name": "Zedu HQ" },
  "settings": { "enabled": true },
  "rooms": [
    {
      "id": "lobby",
      "kind": "lobby",
      "name": "Lobby",
      "refId": null,
      "capacity": 100,
      "isLocked": false,
      "bounds": { "x": 0, "y": 0, "w": 40, "h": 30 }
    },
    {
      "id": "channel:ch_1",
      "kind": "channel",
      "name": "#general",
      "refId": "ch_1",
      "capacity": 30,
      "isLocked": false,
      "bounds": { "x": 4, "y": 18, "w": 12, "h": 10 }
    }
  ],
  "layouts": {
    "channel:ch_1": {
      "roomId": "channel:ch_1",
      "version": 3,
      "grid": { "width": 12, "height": 10, "tile": 1 },
      "items": [
        {
          "id": "f_1",
          "catalogId": "table_meeting",
          "x": 4,
          "y": 4,
          "rotation": 0
        }
      ],
      "updatedAt": "2026-10-19T10:00:00Z"
    }
  },
  "channelRoomMap": { "ch_1": "channel:ch_1" },
  "dmOfficeMap": { "dm_1": "personal:user_2" }
}
```

`dmOfficeMap` is built for the requesting user. For a 1:1 DM, the same DM channel id maps to the counterpart's office for each caller, so A's map points to B's office and B's map points to A's office. For a group DM, it points to the earliest-added participant's office.

**Presence event**

```json
{
  "type": "update",
  "presence": {
    "userId": "usr_2",
    "displayName": "Ada",
    "username": "ada",
    "avatar": {
      "tint": "#7c3aed",
      "body": "b",
      "outfit": "smart",
      "accessory": "glasses"
    },
    "roomId": "channel:ch_1",
    "position": { "x": 4.2, "y": 0, "z": 7.8 },
    "rotation": 1.57,
    "status": "online",
    "updatedAt": 1760875200000
  }
}
```

**Publish request**

```http
POST /api/v1/office/rooms/channel%3Ach_1/layout/publish
Authorization: Bearer <token>
If-Match: 3
Content-Type: application/json

{ "items": [ { "id": "f_1", "catalogId": "table_meeting", "x": 4, "y": 4, "rotation": 0 } ] }
```

### 9.5 Definition of Ready / Done

**Ready**

- Shared schema is locked.
- Task ownership is clear.
- Acceptance checks are written.
- Mock is available or dependency is merged.
- Revert unit is known.
- Estimate ≤ 6 hours.

**Done**

- Acceptance checks pass.
- Format/lint/types/build or Go build/tests pass.
- Reviewer approved.
- Independently revertable: reverting this PR alone restores prior behaviour.
- Screenshot/clip for UI.
- No unrelated changes.

### 9.6 Glossary

| Term              | Meaning                                                                               |
| ----------------- | ------------------------------------------------------------------------------------- |
| Building          | The org-wide 3D space.                                                                |
| Room              | An addressable interior: lobby, channel, personal, meeting, focus, lounge, reception. |
| Room-scoped scene | The client loads only the current interior plus the building shell, not every room.   |
| Layout            | Grid-snapped furniture document for one room.                                         |
| Draft             | Unpublished admin layout.                                                             |
| Publish           | Validated, versioned layout visible to everyone.                                      |
| Presence          | Ephemeral position/status data transported by Centrifugo.                             |
| Zoe               | The in-world contributor assistant backed by the knowledge base.                      |

---

**End of PRD**
