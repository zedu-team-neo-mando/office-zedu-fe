# Zedu — Product Requirements Document (PRD)

**Version:** 1.0  
**Date:** June 26, 2026  
**Product:** Zedu (zedu.chat)  
**Repository:** Frontend (`zedu_fe` v0.14.0)  
**Status:** Living document derived from current codebase implementation

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Product Vision & Goals](#2-product-vision--goals)
3. [Problem Statement](#3-problem-statement)
4. [Target Users & Personas](#4-target-users--personas)
5. [Product Scope](#5-product-scope)
6. [Feature Requirements](#6-feature-requirements)
7. [User Journeys & Flows](#7-user-journeys--flows)
8. [Information Architecture](#8-information-architecture)
9. [Roles, Permissions & Governance](#9-roles-permissions--governance)
10. [Pricing & Monetization](#10-pricing--monetization)
11. [Platform & Distribution](#11-platform--distribution)
12. [Technical Architecture (Frontend Perspective)](#12-technical-architecture-frontend-perspective)
13. [Non-Functional Requirements](#13-non-functional-requirements)
14. [Success Metrics](#14-success-metrics)
15. [Out of Scope](#15-out-of-scope)
16. [Open Questions & Future Considerations](#16-open-questions--future-considerations)

---

## 1. Executive Summary

**Zedu** is a cross-platform collaboration and learning workspace purpose-built for bootcamps, schools, universities, and cohort-based learning communities. The product consolidates messaging, structured channels, direct messages, voice/video meetings (Buzz), file management, search, notifications, and organization administration into a single environment — eliminating the fragmentation caused by using separate chat apps, conferencing tools, file-sharing services, and learning management utilities.

Zedu is positioned as an **AI-powered education platform** that helps educators organize cohorts, run live classes, manage communication, and scale modern learning — all within one subscription. The platform is available on **Web**, **iOS**, **Android**, and **Desktop**, with real-time synchronization across devices.

**Core value proposition:** Fewer tools, smarter learning. Replace scattered apps with one structured platform for communication, collaboration, and education workflows.

**Claimed impact metrics (marketing):**

- 10,000+ learners supported
- 98% educator satisfaction
- 3× faster cohort coordination
- 40% less admin workload

---

## 2. Product Vision & Goals

### Vision

To be the unified workspace where educators, administrators, and learners communicate, collaborate, and learn — without context switching between disconnected tools.

### Strategic Goals

| Goal                          | Description                                                        |
| ----------------------------- | ------------------------------------------------------------------ |
| **Unified communication**     | Provide channels, DMs, threads, and meetings in one interface      |
| **Education-first structure** | Organize conversations by cohort, subject, class, or project       |
| **Real-time collaboration**   | Enable instant messaging, live voice/video, and presence awareness |
| **Centralized resources**     | Offer a single hub for files, media, and shared learning materials |
| **Institutional scalability** | Support multi-org membership, role-based access, and billing tiers |
| **Cross-platform continuity** | Deliver consistent experience across web and native clients        |

### Product Principles

1. **Structure over noise** — Channels and threads keep discussions focused and searchable.
2. **Instant over scheduled** — Buzz enables on-demand voice/video without calendar friction.
3. **Onboarding simplicity** — New organizations and invited members reach productive use quickly.
4. **Role-aware governance** — Permissions scale from guest viewers to organization owners.
5. **Real-time by default** — Messages, notifications, and presence update live via WebSocket infrastructure.

---

## 3. Problem Statement

Modern learning teams — bootcamps, schools, training programs — depend on multiple disconnected tools:

- Chat applications for day-to-day communication
- Video conferencing for live classes
- File-sharing services for learning materials
- Email or LMS announcements for updates
- Separate search across siloed systems

This fragmentation causes:

- **Lost context** when conversations, files, and meetings live in different places
- **Administrative overhead** managing users and permissions across tools
- **Poor discoverability** of past discussions and shared resources
- **Delayed collaboration** when scheduling is required for simple voice discussions
- **Inconsistent learner experience** across web and mobile

Zedu addresses these problems by providing a single, structured environment where all collaboration primitives coexist.

---

## 4. Target Users & Personas

### Primary Personas

#### Educator / Instructor

- Runs classes, bootcamp cohorts, or training sessions
- Needs to post announcements, moderate discussions, and start live sessions
- Values organized channels, threaded replies, and quick voice access (Buzz)

#### Learner / Student

- Participates in cohort discussions, asks questions, accesses materials
- Needs clear channel structure, DMs with peers/instructors, and mobile access
- Values search, notifications, and file access from any device

#### Program Administrator

- Manages organization setup, member invites, roles, and billing
- Needs user management, permission controls, and subscription visibility
- Values onboarding flows, audit logs, and plan comparison tools

#### Institution IT / Operations Lead (Enterprise)

- Evaluates security, compliance, integrations, and dedicated support
- Needs enterprise pricing, API access, and institution-level controls

### Target Segments

| Segment               | Use Case                                                               |
| --------------------- | ---------------------------------------------------------------------- |
| **Bootcamps**         | Cohort management, mentor communication, hands-on learning communities |
| **Schools**           | Classroom organization, student engagement, reduced admin overhead     |
| **Universities**      | Large programs, department channels, scalable collaboration            |
| **Training programs** | Structured cohorts with assignment discussions and resource sharing    |

---

## 5. Product Scope

### In Scope (Current Product)

| Domain                      | Capabilities                                                                 |
| --------------------------- | ---------------------------------------------------------------------------- |
| Authentication & onboarding | Sign-up, login, OAuth, magic link, password reset, org creation, invitations |
| Messaging                   | Channels, DMs, group DMs, threads, reactions, mentions, rich text            |
| Meetings                    | Buzz voice/video, screen share, in-meeting chat, recordings                  |
| Files                       | Upload, folders, sharing, trash, preview, filtering                          |
| Search                      | Message and people search with filters                                       |
| Notifications               | In-app, push (OneSignal), email, preferences, quiet hours                    |
| Organization admin          | Members, invites, roles, billing, org profile                                |
| Personal settings           | Profile, security, notification preferences                                  |
| Marketing site              | Homepage, pricing, product pages, solutions, resources, download             |

### Explicitly Out of Scope for This Document

- AI Agents, AI Coworkers, and Bot users
- Agent marketplace, agent tasks, skills, prompts, and workflows
- Colleagues feature (agent-linked directory; nav currently disabled)

---

## 6. Feature Requirements

### 6.1 Authentication & Account Management

#### 6.1.1 Registration

- **Route:** `/auth/sign-up`
- Email and password registration with validation rules
- Social sign-up via **Google OAuth** and **Apple Sign-In**
- Invite token preservation through registration flow
- Post-registration: store auth token, user profile, and organization ID
- Route to onboarding (`/welcome`) if not onboarded; otherwise to organization home

#### 6.1.2 Login

- **Route:** `/auth/login`
- Email/password authentication
- Google and Apple OAuth
- Redirect parameter support (`?redirect=`) for deep-link return
- Post-login routing based on `is_onboarded` status

#### 6.1.3 Passwordless & Recovery

- **Magic link:** Request at `/auth/magiclink` → confirmation at `/auth/success`
- **Forgot password:** `/auth/forgot-password` → reset at `/auth/reset-password`
- **Email verification:** 6-digit OTP at `/auth/verify-account`
- **Auto-login:** Session-based login via `/auth/autologin?session_id=`

#### 6.1.4 Session Guard

- `AuthGuard` requires valid token and organization ID in local storage
- Parallel fetch of user profile and organization data on app load
- Unauthenticated users redirected to login with return URL
- Special recorder session mode for Buzz recording URLs

#### 6.1.5 Personal Account Settings

- **Route:** `/settings/personal/account`
- Editable: avatar, display name, username, title, timezone, email, phone
- Account deletion capability
- Profile edit modal

#### 6.1.6 Security Settings

- **Route:** `/settings/personal/security`
- Change password
- Login activity audit log (device, IP, timestamp) with pagination

---

### 6.2 Organization Onboarding & Management

#### 6.2.1 First-Time Onboarding

1. New user lands on `/welcome`
2. System checks `/auth/onboard-status`
3. User creates organization at `/welcome/create-organization`:
   - Organization name
   - Business/organization type
   - Country (country picker)
4. `POST /organisations` creates workspace
5. User marked onboarded → redirected to first channel

#### 6.2.2 Invited Member Onboarding

1. User receives org invitation email
2. Accepts at `/accept_org_invitation` (org ID + invitation token)
3. Lands on `/invited` welcome screen
4. Directed to `/home/get-started` checklist

#### 6.2.3 Get Started Checklist

- **Route:** `/home/get-started`
- **Say hello:** Horizontal scroll of teammate cards with online status indicators
- **Explore channels:** Suggested channels with member count, avatars, last post time, recent post badges
- Click-through to channel or teammate DM

#### 6.2.4 Organization Profile

- **Route:** `/settings/organisation/general`
- Editable: name, logo, business type, country
- Organization deletion (owner-level action)

#### 6.2.5 Multi-Organization Support

- Users belong to multiple organizations (`GET /users/organisations`)
- Org switcher in topbar; slug-based URL routing (`/{orgSlug}/...`)
- `PUT /users/switch-org/{slug}` issues new token and org context
- Redirect to first channel or org home after switch

#### 6.2.6 Additional Organization Creation

- **Route:** `/organization/create`
- Create secondary workspaces beyond initial onboarding

---

### 6.3 Channels

#### 6.3.1 Purpose

Subject-, cohort-, or project-based communication spaces. Channels can be **public** (discoverable) or **private** (invite-only).

#### 6.3.2 Channel Discovery & Navigation

- **Home sidebar:** Alphabetical channel list with unread indicators
- **Directories:** `/home/channels` — People and Channels tabs with public/private filters
- **Pinned channels:** Displayed in topbar for quick access
- **View all channels** link from sidebar

#### 6.3.3 Channel Lifecycle

| Action  | Description                                                |
| ------- | ---------------------------------------------------------- |
| Create  | Dialog-based channel creation (name, description, privacy) |
| Join    | Join flow for non-member users on public channels          |
| Archive | Archived channel state with dedicated UI                   |
| Invite  | Channel-specific member invitation modal                   |

#### 6.3.4 Channel Conversation View

- **Route:** `/home/channels/[id]`
- Infinite-scroll message history
- Channel header: name, topic, member count, settings
- Channel details dialog with metadata and member list
- Resizable layout: main feed + optional thread reply sidebar + Buzz side panel

#### 6.3.5 Channel Data Model (Key Fields)

```
Channel: id, name, description, topic, is_private, owner, member_count,
         unread_count, mention_count, thread_count, preview_thread,
         last_post_time, isArchived, channel_slug
```

---

### 6.4 Messaging

#### 6.4.1 Message Composition (MessageBox)

Rich-text editor built on **TipTap** with:

| Capability         | Details                                                    |
| ------------------ | ---------------------------------------------------------- |
| Text formatting    | Bold, italic, strikethrough, code, ordered/unordered lists |
| Mentions           | `@user` mention extension with autocomplete                |
| Channel references | `#channel` linking                                         |
| Emoji              | Emoji Mart picker + emoticon shortcuts                     |
| Links              | Inline link insertion dialog                               |
| File attachments   | Drag-and-drop, paste, and file picker upload with progress |
| Voice messages     | In-app voice recorder with waveform thumbnails             |
| Slash commands     | `/` command palette entry point                            |

#### 6.4.2 Message Display

- Threaded messages with author avatar, name, timestamp
- Edited message indicator
- Link previews (Open Graph scraping)
- PDF inline preview
- Media attachments (images, documents, video)
- Markdown rendering with syntax highlighting
- Infinite scroll for history loading

#### 6.4.3 Message Actions

| Action           | Availability                                      |
| ---------------- | ------------------------------------------------- |
| Reply in thread  | All users with `comment:threads`                  |
| Edit             | Author or privileged roles with `edit:messages`   |
| Delete           | Author or privileged roles with `delete:messages` |
| Pin / Unpin      | Pin dialog; pinned messages highlighted           |
| Bookmark / Save  | Save to "Later" collection                        |
| Copy text        | Plain-text clipboard copy                         |
| React with emoji | Emoji reaction picker                             |
| Copy link        | Deep link to message                              |

#### 6.4.4 Real-Time Messaging

Centrifugo WebSocket subscriptions per channel/DM:

| Event Type         | Behavior                             |
| ------------------ | ------------------------------------ |
| New message        | Append to feed, update unread counts |
| Message edit       | In-place content update              |
| Message delete     | Remove from feed                     |
| Reply count update | Thread badge refresh                 |
| Media update       | Attachment state sync                |
| Typing indicator   | "X is typing..." display             |

#### 6.4.5 Presence & Typing

- Online/offline status per user (green dot indicators)
- Real-time typing indicators via `userTyping` state
- Status updates via org-level Centrifugo `StatusConnection`

---

### 6.5 Threads

#### 6.5.1 In-Channel Threads

- Reply to any message opens **ThreadsSidebar** panel (440px)
- Thread replies maintain parent message context
- Reply count badges on parent messages
- Dedicated `ReplyConnection` Centrifugo subscription for reply channels

#### 6.5.2 Global Threads Page

- **Route:** `/threads`
- Aggregated thread list across all channels and DMs
- Select thread → inline reply panel on the right
- Profile hover sidebar (408px) alongside reply panel
- Supports channel, 1:1 DM, and group DM reply APIs

#### 6.5.3 Thread Data Model

```
Thread: thread_id, channels_id, message, message_count, last_reply,
        reactions, media, is_pinned, edited, user_type, channel_type
```

---

### 6.6 Direct Messages (DMs)

#### 6.6.1 Types

| Type         | Description                               |
| ------------ | ----------------------------------------- |
| **1:1 DM**   | Private conversation between two users    |
| **Group DM** | Private conversation among multiple users |

#### 6.6.2 Entry Points

- Sidebar **DMs** nav → `/dm`
- Sidebar **People** accordion → recent DM list
- **New chat:** `/home/people/new-chat` → select one or more users
- People directory: `/home/people`, `/people`

#### 6.6.3 DM Creation Flow

1. User selects recipient(s) on new-chat page
2. Single user → `POST /organisations/{orgId}/dms` → 1:1 route
3. Multiple users → `POST /organisations/{orgId}/group-dms` → group route

#### 6.6.4 DM Routes

| Route Pattern                | Purpose                     |
| ---------------------------- | --------------------------- |
| `/home/people/[id]/[id2]/dm` | 1:1 DM (home layout)        |
| `/home/people/[id]/dms`      | Group DM (home layout)      |
| `/dm/[id]/[id2]`             | 1:1 DM (alternate layout)   |
| `/dm/[id]/dms`               | Group DM (alternate layout) |

#### 6.6.5 DM Features

- Feature parity with channels: edit, delete, reactions, pins, bookmarks, media, mentions, typing
- Real-time via `ChatConnection` (Centrifugo per DM channel ID)
- Unread DM count badge in navigation

---

### 6.7 Buzz (Voice & Video Meetings)

#### 6.7.1 Product Definition

**Buzz** is Zedu's real-time voice and video collaboration product — designed for instant, unscheduled discussions within learning contexts.

#### 6.7.2 Meeting Lobby

- **Route:** `/buzz`
- **Start instant meeting:** Create → auto-join → enter meeting room
- **Schedule for later:** Create → copy shareable link/code
- **Join existing:** Paste link or buzz code → `POST /buzz/{id}/join`

#### 6.7.3 Meeting Room

- **Route:** `/buzz/[id]`
- **Green room:** Pre-join microphone and camera device selection
- **Meeting room features:**

| Feature          | Description                           |
| ---------------- | ------------------------------------- |
| Audio/Video      | Mute/unmute, camera toggle            |
| Screen sharing   | Separate Agora screen-share client    |
| Raise hand       | Animated raise-hand indicator         |
| Emoji reactions  | Floating emoji animations             |
| Participant list | Sidebar with pin participant support  |
| In-meeting chat  | Text chat sidebar during session      |
| Recording        | Recording indicator and recorder mode |
| Session timeout  | Graceful timeout handling             |
| Incoming calls   | Popup for incoming Buzz invitations   |
| Minimized mode   | Pill/mini widgets for multitasking    |

#### 6.7.4 Channel-Embedded Buzz

- Launch Buzz from within a channel via side panel
- `ChannelAgoraConnection` + `ChannelBuzzProvider` — no navigation away from channel
- Centrifugo signals for `buzz_started` / `buzz_ended` in channel context

#### 6.7.5 Recorder Mode

- **Route:** `/buzz-record/[id]`
- Headless recorder session authenticated via URL parameters
- Used for automated session capture

#### 6.7.6 Technical Foundation

- **Agora RTC SDK** for audio/video transport
- Token generation via `/api/agora/token` and backend `agora_token` in join response
- Centrifugo for participant signaling (join/leave, mute, hand raise)
- Post-session AI summary generation (marketing claim; Growth+ plans)

---

### 6.8 File Management

#### 6.8.1 File Views

| View           | Route             | Description                  |
| -------------- | ----------------- | ---------------------------- |
| All files      | `/files`          | Organization-wide file index |
| My files       | `/files/my-files` | User-owned files             |
| Shared with me | `/files/shared`   | Files shared by others       |
| Trash          | `/files/trash`    | Soft-deleted files           |

#### 6.8.2 File Operations

| Operation     | Details                                                            |
| ------------- | ------------------------------------------------------------------ |
| Upload        | Multipart upload with progress tracking (`UploadContext`)          |
| Create folder | Hierarchical folder structure                                      |
| Rename        | Files and folders                                                  |
| Move          | Drag or action-based move between folders                          |
| Delete        | Soft delete to trash; bulk delete support                          |
| Restore       | From trash view                                                    |
| Share         | Generate shareable links (`CreateShareModal`, `is_shareable` flag) |
| Pin           | Pin important files for quick access                               |
| Preview       | In-app preview for supported file types                            |

#### 6.8.3 File Filtering & Pagination

- Filter by type: documents, spreadsheets, images, videos, music
- Filter by date range
- Pagination: 200 items per page

#### 6.8.4 File-Message Integration

- Files attached in messages appear in file management hub
- `Media` entity links: `organisation_id`, `user_id`, `folder_id`, `channel_id`, `message_id`

#### 6.8.5 File Data Model

```
Media: id, file_name, file_type, mime_type, file_link, size,
       organisation_id, user_id, folder_id, channel_id, message_id,
       access_type, is_shareable, deleted_at
```

---

### 6.9 Search

#### 6.9.1 Global Search

- **Route:** `/search`
- Accessible from topbar search bar
- Two search modes: **Messages** and **People**

#### 6.9.2 Message Search

- Full-text search across channel and DM messages
- Results grouped by user with message snippets and channel context
- Filters:
  - **From:** Specific user
  - **In:** Specific channel
  - **Date range:** Today → 12 months
  - **Sort:** Relevance, newest, oldest
- Paginated results

#### 6.9.3 People Search

- Search organization members by name, email, username
- User cards with avatar, role, status

---

### 6.10 Notifications

#### 6.10.1 In-App Notifications

- **Route:** `/notifications`
- Bell icon in primary navigation with unread badge
- Sidebar list + detail panel (JSON payload viewer)
- Real-time feed via `GeneralNotificationConnection` (Centrifugo channel: `{orgId}/{userId}`)
- `NotificationBanner` in client layout for prominent alerts

#### 6.10.2 Unread Tracking

Global state tracks:

- `threadCount` — unread thread replies
- `dmCount` — unread direct messages
- `showBadge` — aggregate notification indicator
- Per-channel `unread_count` and `mention_count`

#### 6.10.3 Push Notifications (OneSignal)

- `OneSignalProvider` initializes web push
- Click handler routes to internal paths via notification payload deep links
- Subscription management component

#### 6.10.4 Notification Preferences

- **Route:** `/settings/personal/notifications`
- Per-organization, per-device-type (`web`) settings:

| Setting         | Options                                    |
| --------------- | ------------------------------------------ |
| Notify about    | All new messages / Mentions only / Nothing |
| Quiet hours     | Time range (from – to)                     |
| Delivery method | Mobile push / Email                        |

- Persisted via `POST /organisations/{orgId}/notification-preference`

#### 6.10.5 Browser Notifications

- Native `Notification` API for desktop alerts
- Toast notifications for in-app events
- Sound on new messages (configurable)

---

### 6.11 User Management & Invitations

#### 6.11.1 Member Management

- **Route:** `/settings/organisation/user-management`
- Members table: search, pagination, role display
- Pending invites table with status filter
- Invite modal: email chips + role selection

#### 6.11.2 Invitation Flows

| Type                    | Route                        | Mechanism                                |
| ----------------------- | ---------------------------- | ---------------------------------------- |
| Organization invite     | `/accept_org_invitation`     | Token verification → access token issued |
| General platform invite | `/accept_general_invitation` | Platform-wide invitation form            |
| Channel invite          | In-channel modal             | Channel-specific member addition         |

#### 6.11.3 Member Data Model

```
Member: id, email, username, name, role, status (active/inactive/suspended),
        entity_type, online
```

---

### 6.12 Billing & Subscriptions

#### 6.12.1 In-App Billing

- **Route:** `/settings/organisation/billing`
- Current subscription display (plan name, next billing date)
- Payment history table
- Stripe checkout completion handler (`session_id` query param)
- Plan comparison and upgrade: `/settings/organisation/billing/all-plans`
- Invoice view: `/billing/invoice/[id]`
- AI credit usage table (subscription credits)

#### 6.12.2 Payment Integration

- **Stripe** checkout for subscription purchases
- `GET /subscriptions/complete?session_id=` for post-checkout confirmation
- `GET /subscriptions/list/{orgId}` for transaction history

---

### 6.13 Marketing Website

#### 6.13.1 Site Structure

| Section       | Routes                                                                  |
| ------------- | ----------------------------------------------------------------------- |
| Homepage      | `/`                                                                     |
| Pricing       | `/pricing`                                                              |
| About         | `/about`                                                                |
| Contact Sales | `/contact-sales`                                                        |
| Download      | `/download`                                                             |
| Resources     | `/resources`                                                            |
| Products      | `/products/channels`, `/products/buzz`, `/products/file-management`     |
| Solutions     | `/solutions/bootcamps`, `/solutions/schools`, `/solutions/universities` |
| Legal         | `/policy`, `/terms-of-service`                                          |

#### 6.13.2 Homepage Sections

1. **Hero** — Value proposition, CTA (Try for free, Contact sales), trust metrics
2. **Features** — Organized Channels, Cohort Communication, Calls & Collaboration
3. **Articles** — Educational content/resources
4. **Pricing** — Plan cards with monthly/yearly toggle
5. **Why Zedu** — Differentiation narrative
6. **FAQ** — Common questions accordion
7. **Footer CTA** — Conversion banner

#### 6.13.3 Product Marketing Pages

**Channels** (`/products/channels`):

- Subject-based organization
- Threaded replies without noise
- Announcement channels for educators
- Education-focused channel design

**Buzz** (`/products/buzz`):

- Real-time voice inside learning channels
- No scheduling friction
- AI-generated session summaries
- Multi-participant organized discussions

**File Management** (`/products/file-management`):

- Centralized learning resource hub
- Share and organize materials

#### 6.13.4 Solution Pages

Vertical-specific landing pages for bootcamps, schools, and universities — each highlighting cohort management, classroom organization, and institutional scalability.

---

## 7. User Journeys & Flows

### 7.1 New Educator (Self-Serve)

```
Sign up → Welcome → Create organization → First channel → Get Started checklist
→ Invite teammates → Create subject channels → Post first announcement
```

### 7.2 Invited Learner

```
Receive email → Accept org invitation → Invited welcome → Get Started
→ Browse suggested channels → Send intro DM → Join channel discussions
```

### 7.3 Daily Collaboration

```
Open app → Land in last channel → Read new messages → Reply in thread
→ @mention classmate → Upload assignment file → Search past discussion
```

### 7.4 Live Class Session

```
Open channel → Start Buzz from side panel → Green room (check A/V)
→ Meeting room (screen share lecture) → End session → Review AI summary
```

### 7.5 Standalone Meeting

```
Buzz nav → Start instant meeting → Share link with participants
→ Join via code → Collaborate → End meeting
```

### 7.6 Administrator Setup

```
Settings → Invite members (bulk emails) → Assign roles
→ Configure notification defaults → Select billing plan → Monitor usage
```

### 7.7 Organization Switch

```
Topbar org picker → Select different org → Token refresh
→ Redirect to first channel in new org context
```

---

## 8. Information Architecture

### 8.1 Primary Navigation (Left Rail — 80px)

| Icon          | Label           | Route                                   |
| ------------- | --------------- | --------------------------------------- |
| Home          | Home            | `/{org}/home/channels/{id}` or `/{org}` |
| DMs           | DMs             | `/{org}/dm`                             |
| People        | People          | `/{org}/people`                         |
| Files         | Files           | `/{org}/files`                          |
| Buzz          | Buzz            | `/{org}/buzz`                           |
| Notifications | (badge)         | `/{org}/notifications`                  |
| Settings      | Settings        | `/{org}/settings`                       |
| Profile       | Avatar dropdown | Org menu, sign out                      |

### 8.2 Contextual Sidebars

| Context      | Sidebar Content                                                                                      |
| ------------ | ---------------------------------------------------------------------------------------------------- |
| Home         | Channels accordion, People accordion, Threads link, org menu, invite (+)                             |
| Files        | All files, My files, Shared, Trash tabs                                                              |
| Settings     | Personal (Account, Notifications, Security), Organisation (General, User Management, Roles, Billing) |
| Channel view | Thread reply panel, Buzz side panel, profile hover sidebar                                           |

### 8.3 Topbar

- Organization switcher (multi-org dropdown)
- Global search bar
- Pinned channels
- Current channel/conversation name
- Buzz mini-widgets (when in active meeting)
- Mobile hamburger menu

### 8.4 Layout Architecture

- Resizable panels via `react-resizable-panels`
- Fixed left rail + collapsible contextual sidebar + main content area
- Mobile: drawer-based sidebar with responsive breakpoints
- Client layout providers: `ChannelBuzzProvider`, `UploadProvider`, `OneSignalProvider`, `TooltipProvider`

---

## 9. Roles, Permissions & Governance

### 9.1 Predefined Roles

| Role              | Hierarchy | Summary                                                                              |
| ----------------- | --------- | ------------------------------------------------------------------------------------ |
| **Owner**         | 100       | Full access including billing management                                             |
| **Administrator** | 90        | Full access except explicit billing manage; hierarchy ≥90 bypasses permission checks |
| **Manager**       | 70        | Channels, members, settings, invites; privileged role                                |
| **Project Lead**  | 50        | Channel management, messaging, invites                                               |
| **User**          | 20        | View/create channels, edit messages, invite, comment                                 |
| **Guest**         | 0         | View channels only                                                                   |

### 9.2 Permission Keys

| Permission             | Description                         |
| ---------------------- | ----------------------------------- |
| `manage:channels`      | Full channel administration         |
| `manage:members`       | Member management                   |
| `manage:organization`  | Organization settings               |
| `manage:settings`      | Workspace settings                  |
| `manage:billing`       | Subscription and payment management |
| `manage:security`      | Security configuration              |
| `manage:roles`         | Role creation and assignment        |
| `manage:integrations`  | Third-party integrations            |
| `view:analytics`       | Analytics dashboard access          |
| `view:billing`         | View billing information            |
| `view:channels`        | View channel content                |
| `edit:messages`        | Edit any message                    |
| `delete:messages`      | Delete any message                  |
| `delete:files`         | Delete any file                     |
| `create:channels`      | Create new channels                 |
| `archive:channels`     | Archive channels                    |
| `invite:members`       | Send organization invitations       |
| `remove:people`        | Remove members from organization    |
| `comment:threads`      | Reply in threads                    |
| `change:user_org_role` | Modify member roles                 |
| `create:role`          | Create custom roles                 |
| `create:webhooks`      | Configure webhooks                  |

### 9.3 Custom Roles

- Organizations can define custom roles with arbitrary permission sets
- **Route:** `/settings/organisation/roles-permissions`
- Create/edit roles with granular permission toggles
- API permission flags mapped to canonical keys (`can_invite_members` → `invite:members`, etc.)

### 9.4 Permission Enforcement

- `useRBAC` hook provides `hasPermission()`, `isPrivileged` checks
- `PermissionBoundary` component for conditional rendering
- `withAuthGate` HOC for route-level protection
- Settings org section visible to administrator, manager, or `manage:organization` holders

---

## 10. Pricing & Monetization

### 10.1 Pricing Tiers

| Plan           | Price                       | Target                                |
| -------------- | --------------------------- | ------------------------------------- |
| **Starter**    | $0/month                    | Small classes, educators starting out |
| **Growth**     | $10/month (billed annually) | Bootcamps and structured programs     |
| **Enterprise** | Contact sales               | Universities, large institutions      |

Annual billing saves 16.6% vs monthly.

### 10.2 Plan Feature Comparison

#### Workspace & Community

| Feature              | Starter | Growth    | Enterprise |
| -------------------- | ------- | --------- | ---------- |
| Workspaces           | 1       | Unlimited | Unlimited  |
| Cohorts / Bootcamps  | 3       | Unlimited | Unlimited  |
| Teachers / Admins    | Up to 5 | Up to 50  | Unlimited  |
| Students per Cohort  | Limited | Up to 500 | Custom     |
| Channels             | ✓       | ✓         | ✓          |
| Threaded Discussions | ✓       | ✓         | ✓          |

#### Communication & Collaboration

| Feature                    | Starter | Growth | Enterprise |
| -------------------------- | ------- | ------ | ---------- |
| Direct Messaging           | ✓       | ✓      | ✓          |
| Group Discussions          | ✓       | ✓      | ✓          |
| Announcement Channels      | ✓       | ✓      | ✓          |
| Voice & Video Calls (Buzz) | ✗       | ✓      | ✓          |
| Screen Sharing             | ✗       | ✓      | ✓          |
| Class Recordings           | ✗       | ✓      | ✓          |

#### Learning Tools

| Feature                | Starter | Growth | Enterprise |
| ---------------------- | ------- | ------ | ---------- |
| File Sharing           | ✓       | ✓      | ✓          |
| Assignment Discussions | ✓       | ✓      | ✓          |
| Course Channels        | ✓       | ✓      | ✓          |
| Shared Resources       | ✗       | ✓      | ✓          |
| AI Study Assistant     | Limited | ✓      | Advanced   |

#### Automation & AI

| Feature                | Starter | Growth | Enterprise |
| ---------------------- | ------- | ------ | ---------- |
| AI Message Summaries   | ✗       | ✓      | ✓          |
| AI Learning Assistants | Limited | ✓      | Advanced   |
| Workflow Automation    | ✗       | ✗      | ✓          |
| AI Moderation          | ✗       | ✗      | ✓          |

#### Administration & Security

| Feature               | Starter | Growth   | Enterprise |
| --------------------- | ------- | -------- | ---------- |
| Admin Controls        | Basic   | Advanced | Full       |
| Workspace Permissions | ✓       | ✓        | ✓          |
| Analytics Dashboard   | ✗       | ✓        | ✓          |
| API / Integrations    | ✗       | Limited  | Full       |
| Dedicated Support     | ✗       | ✗        | ✓          |

### 10.3 Starter Plan Includes

- Up to 3 cohorts
- Organized learning channels
- Basic messaging and threads
- File sharing
- Basic notifications
- Limited AI assistance

### 10.4 Growth Plan Includes

- Everything in Starter
- Unlimited cohorts
- Live classes and collaboration tools
- AI study assistants
- Assignment and cohort management
- Admin moderation tools

### 10.5 Enterprise Plan Includes

- Everything in Growth
- Institution-level workspace control
- Security and compliance tools
- Custom integrations
- Dedicated onboarding
- Priority support

---

## 11. Platform & Distribution

### 11.1 Supported Platforms

| Platform    | Availability                                              |
| ----------- | --------------------------------------------------------- |
| **Web**     | Primary application (Next.js 16, React 19)                |
| **iOS**     | App Store (id6759181591)                                  |
| **Android** | Google Play (net.emerj.zedu)                              |
| **Desktop** | Native desktop application (linked from download page)    |
| **Tauri**   | Desktop wrapper capability (`@tauri-apps/api` dependency) |

### 11.2 Cross-Platform Features

- Real-time sync across all clients via Centrifugo
- Push notifications on mobile via OneSignal
- Consistent navigation and feature parity (web as source of truth)
- Download page promotes mobile + desktop for classes, chat, files, real-time updates

### 11.3 Marketing Distribution

- SEO-optimized product and solution pages
- Open Graph and Twitter card metadata
- Contact sales funnel for enterprise leads
- Resource hub and webinar content

---

## 12. Technical Architecture (Frontend Perspective)

### 12.1 Technology Stack

| Layer           | Technology                                                        |
| --------------- | ----------------------------------------------------------------- |
| Framework       | Next.js 16 (App Router)                                           |
| UI Library      | React 19                                                          |
| Styling         | Tailwind CSS 3, Sass                                              |
| Components      | Radix UI primitives, shadcn/ui patterns                           |
| State           | React Context (`GlobalState` + reducer)                           |
| Rich Text       | TipTap 2.x                                                        |
| Real-time       | Centrifuge JS (Centrifugo)                                        |
| Video/Audio     | Agora RTC SDK                                                     |
| Push            | OneSignal                                                         |
| Payments        | Stripe                                                            |
| Forms           | React Hook Form + Zod                                             |
| Tables          | TanStack Table                                                    |
| Charts          | Recharts                                                          |
| OAuth           | Google (`@react-oauth/google`), Apple (`react-apple-signin-auth`) |
| Email templates | React Email                                                       |
| Testing         | Cypress (E2E)                                                     |

### 12.2 API Integration

- REST API via Axios (`GetRequest`, `PostRequest`, `UploadRequest`)
- Bearer token authentication (localStorage)
- Base URL: `NEXT_PUBLIC_BASE_URL`
- WebSocket URL: `NEXT_PUBLIC_CONNECT_URL`

### 12.3 Real-Time Connection Map

| Component                                    | Subscription Target  | Events                                     |
| -------------------------------------------- | -------------------- | ------------------------------------------ |
| `ChannelConnection`                          | Channel ID           | Messages, edits, deletes, replies, media   |
| `ChatConnection`                             | DM channel ID        | DM messages and updates                    |
| `ReplyConnection`                            | Thread reply channel | Reply thread events                        |
| `GeneralNotificationConnection`              | `{orgId}/{userId}`   | Notifications, unread counts, Buzz signals |
| `StatusConnection`                           | Organization ID      | Presence/status updates                    |
| `AgoraConnection` / `ChannelAgoraConnection` | Buzz signaling       | Participant events, mute, hand raise       |

### 12.4 Global State Domains

```
user, org, orgSlug, channels, DMs, messages, threads, notifications,
bookmarks, pinned, buzzSession, subscriptions, uploads, searchMentions,
profileSidebars, onlineStatus, userTyping, openSidebar
```

### 12.5 Route Groups

| Group                         | Purpose                       |
| ----------------------------- | ----------------------------- |
| `(homepage)`                  | Public marketing site         |
| `(auth)`                      | Authentication pages          |
| `(client)/[org]`              | Authenticated application     |
| `(accept_org_invitation)`     | Org invitation acceptance     |
| `(accept_general_invitation)` | General invitation acceptance |

---

## 13. Non-Functional Requirements

### 13.1 Performance

- Infinite scroll for message history (no full-page reload)
- Debounced search and typing indicators
- Image optimization via Next.js `sharp`
- Skeleton loading states for search, files, and settings
- Upload progress tracking with cancel support

### 13.2 Responsiveness

- Mobile-first sidebar with drawer pattern
- Adaptive meeting UI for small screens
- Resizable panels on desktop
- `100dvh` viewport handling for mobile browsers

### 13.3 Security

- Bearer token session management
- DOMPurify for HTML sanitization
- Rehype-sanitize for markdown rendering
- Login activity audit trail
- Role-based access control at component and route level
- Password change flow with current password verification

### 13.4 Accessibility

- ARIA labels on pagination and interactive controls
- Keyboard-navigable UI components (Radix primitives)
- Semantic HTML in marketing pages

### 13.5 Reliability

- Graceful error handling with toast notifications (`sonner`)
- Fallback images for broken avatars
- Session timeout handling in Buzz meetings
- Auth guard redirect for expired sessions

### 13.6 Internationalization Readiness

- Country picker (country-state-city library)
- Timezone selection in profile
- Time formatting via `moment`, `date-fns`, `timeago.js`

---

## 14. Success Metrics

### 14.1 Acquisition

- Sign-up conversion rate (marketing → registration)
- Organization creation completion rate
- Invitation acceptance rate

### 14.2 Activation

- Time to first message posted
- Get Started checklist completion
- First channel joined within 24 hours
- First Buzz session started within 7 days

### 14.3 Engagement

- Daily active users (DAU) / Monthly active users (MAU)
- Messages sent per user per day
- Thread reply rate
- Buzz session duration and frequency
- File uploads per organization
- Search queries per user

### 14.4 Retention

- 7-day, 30-day, 90-day user retention
- Organization churn rate
- Plan upgrade rate (Starter → Growth)

### 14.5 Revenue

- Monthly recurring revenue (MRR)
- Average revenue per organization
- Enterprise pipeline conversion (contact sales → closed)

### 14.6 Satisfaction

- Educator satisfaction score (target: 98%)
- Support ticket volume and resolution time
- NPS from in-app surveys

---

## 15. Out of Scope

The following are explicitly excluded from this PRD:

| Item                     | Notes                                                |
| ------------------------ | ---------------------------------------------------- |
| AI Agents / AI Coworkers | `/home/agents`, agent nav, agent DM state            |
| Bot users                | `entity_type: "bot"`, bot role permissions           |
| Agent tasks & workflows  | Task lists, skills, prompts, workflow editor         |
| Agent marketplace        | Browse/install agent UI                              |
| Colleagues directory     | Agent-linked colleague features (nav disabled)       |
| "Later" bookmarks (full) | Routes exist; main nav commented out; placeholder UI |
| Whiteboard               | Marketing mention; no implementation found           |
| Storyboard               | Marketing mention; no implementation found           |
| Conversation Mesh        | Marketing mention; no implementation found           |

---

## 16. Open Questions & Future Considerations

| #   | Question                                                                           | Impact                               |
| --- | ---------------------------------------------------------------------------------- | ------------------------------------ |
| 1   | When will "Later" (saved messages) be fully implemented?                           | Bookmark UX completeness             |
| 2   | What is the roadmap for Whiteboard and Storyboard features mentioned in marketing? | Feature parity with marketing claims |
| 3   | How will class recordings be stored, accessed, and governed?                       | Buzz recording lifecycle             |
| 4   | What analytics dashboard capabilities are planned for Growth tier?                 | Admin visibility                     |
| 5   | What API endpoints will be exposed for Enterprise integrations?                    | Institutional adoption               |
| 6   | How will AI Study Assistant and AI Message Summaries be surfaced in UI?            | Plan differentiation                 |
| 7   | What compliance certifications are targeted (FERPA, GDPR, SOC 2)?                  | Enterprise sales                     |
| 8   | Will workflow automation (Enterprise) integrate with external LMS platforms?       | EdTech ecosystem                     |
| 9   | What is the offline/mobile sync strategy for native apps?                          | Cross-platform reliability           |
| 10  | How will rate limits and usage caps be enforced per plan tier?                     | Billing enforcement                  |

---

## Appendix A: Glossary

| Term             | Definition                                                                |
| ---------------- | ------------------------------------------------------------------------- |
| **Channel**      | A structured communication space organized by subject, cohort, or project |
| **Thread**       | A reply chain attached to a parent message                                |
| **Buzz**         | Zedu's real-time voice and video meeting product                          |
| **DM**           | Direct message — private 1:1 or group conversation                        |
| **Cohort**       | A group of learners progressing through a program together                |
| **Green room**   | Pre-join lobby for Buzz meetings (device selection)                       |
| **Centrifugo**   | WebSocket server powering real-time events                                |
| **Organization** | Top-level workspace container (multi-tenant)                              |
| **Slug**         | URL-safe organization identifier used in routing                          |

## Appendix B: API Endpoint Reference (Frontend-Visible)

| Domain        | Key Endpoints                                                                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Auth          | `/auth/sign-up`, `/auth/login`, `/auth/magick-link`, `/auth/password-reset`, `/auth/email-request/verify`, `/auth/onboard-status`                      |
| User          | `/profile`, `/users/me`, `/users/organisations`, `/users/switch-org/{slug}`                                                                            |
| Organizations | `/organisations`, `/organisations/{id}`, `/organisations/{id}/users`, `/organisations/{id}/get-started`, `/organisations/{id}/notification-preference` |
| Channels      | `/channels/{id}`, `/channels/{id}/messages`, `/channels/pin/{id}/thread`, `/threads/{id}`                                                              |
| DMs           | `/organisations/{id}/dms`, `/organisations/{id}/group-dms`, `/dms/messages/{id}`, `/group-dms/messages/{id}`                                           |
| Buzz          | `/buzz/org/create`, `/buzz/{id}/join`                                                                                                                  |
| Files         | File management APIs (upload, folder CRUD, share)                                                                                                      |
| Subscriptions | `/subscriptions/complete`, `/subscriptions/list/{orgId}`                                                                                               |
| Tokens        | `/token/connection`, `/token/subscription`                                                                                                             |
| Reactions     | `/reactions/...`                                                                                                                                       |
| Search        | Backend search API with filter parameters                                                                                                              |

---

## Appendix C: The Office — 3D Tower References

The 3D building ("The Office", `src/app/office`) is part of the product surface. The tower view is judged against these references:

| Reference                                                                    | Why it matters                                                                                                                                                                                     |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [AviOfLagos/zedu-tower](https://github.com/AviOfLagos/zedu-tower/tree/main)  | The primary build: a cutaway office tower with lit rooms, people and lift cores on every storey. Ten storeys, rooms sized from their contents, short storey tags (B1/L/F#), people visible inside. |
| [Chris DiMarco](https://x.com/chrisjdimarco/status/2112951160118431979)      | Presentation: how a populated building should read at a glance.                                                                                                                                    |
| [Konstantin Saifo](https://x.com/konstantinsaifo/status/2113161829891686767) | Presentation: lighting, depth and material treatment.                                                                                                                                              |

### Tower requirements

These rules are the source of truth for the office work; check every visual change against them.

1. **It is a cutaway tower, not a wall of glass.** Storeys are open at the front, with slabs, a lift core, floor tags, a plinth and a roof. Every private office carries its occupant's avatar; a lit office also shows a desk silhouette, an unlit one still reads as somebody's office.
2. **The demo is the full building.** At least ten storeys, and every member floor is filled to the live capacity (40 private offices). The three walkable demo offices stay in the directory among the filler offices.
3. **Storeys keep their existing facade size.** The general floor sizes its grid from its contents; member floors use fixed exterior slots so one member never fills the entire facade.
4. **Private offices have fixed exterior slots.** Each member floor holds up to 40 offices. Outside, show offices 1-20 or 21-40 in ten columns and two rows, filling bottom-to-top within each column. Start on the group containing the viewer; allow group switching and reveal the correct group through people search. Unused slots have closed exterior boards labelled "Unoccupied", without creating fake rooms or clickable entries; the entrance stays clear. Inside, all 40 offices and walking routes remain unchanged.
5. **The general floor resizes for channels.** Channels wrap into as many rows as they need and each row stretches to the full width, so the top floor keeps accommodating every channel the organisation has.
6. **The lift is real.** A car rides the core to the storey in focus and idles between storeys otherwise. Selecting a storey tags it and frames it.
7. **Directory-only storeys stay honest.** Where a storey has offices in the directory but no walkable floor plan (the demo's filler floors), selecting a person frames their storey in the tower instead of diving into an empty plan.
8. **Short tags, not sentences.** Storeys carry L / F1..Fn tags; names and occupancy live in the hover card and the search.
9. **The tower is the front door.** Both the demo and the live office open on the tower, never on a floor plan. Entering the building means choosing a storey from the street.
10. **The facade faces the viewer.** The tower is framed as a straight-on elevation, not a three-quarter or side view, whatever direction the player was last looking in.
11. **Daylight outside, interior light inside.** The tower view is seen from the street: a daylight sky, a site under the plinth and a light fog. The floor view keeps the dark interior ambience the rooms are lit for.
12. **One floor picker.** Storeys are chosen from a single dropdown; there is no rail of floor buttons across the bottom of the tower.
13. **Reading a room is not entering it.** The first click on an office frames that one office and opens its DM or channel chat over the tower without moving the player or joining the room. The second click on the same office transports in, and the room's recent messages are spoken as bubbles the moment the player lands.
14. **An office shows the same person as the floor does.** The avatar in a cell is that person's own identity — the same tint their in-world rig is built from — not the room's accent colour.
15. **Leaving the office means going back to the app.** The tower's leave control returns to the 2D conversation: the organisation's chat in the live office, the site home in the demo. The tower carries no "back to the floor" control; Esc still does that.
16. **The entry copy steps back for the building.** After 30 seconds without input the entry headline, description and chips fade out and the scrim thins with them so the rotating tower/floor backdrop is visible; any movement brings the copy straight back.

---

_This document was generated from analysis of the Zedu frontend codebase (v0.14.0). Backend behavior is inferred from API paths and real-time event shapes visible in connection handlers. For implementation details, refer to the source code in this repository._
