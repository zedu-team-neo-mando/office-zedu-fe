# Zedu APP

Zedu is a cross-platform collaboration system that consolidates messaging, channels, calls, file sharing, search, and AI coworkers into a unified workspace. It is designed to eliminate fragmentation across tools, reduce context switching, and enable teams to collaborate in real time with intelligent assistance and consistent performance across Web, Mobile, and Desktop.

## Overview

Modern teams depend on multiple disconnected tools: chat apps, conferencing tools, wikis, file sharing apps, and standalone AI assistants. This creates inefficiency and loss of context. Zedu provides a single, structured environment where users, teams, and AI colleagues can work together seamlessly.

The platform supports:

- Unified messaging across channels, direct messages, and AI coworker interactions

- Real-time collaboration through voice and video calls

- File, media, and link organization

- Cross-device continuity

- AI automation and agent workflows

- Intelligent search and workspace discovery

This repository contains the frontend implementation for the Zedu application, including the 3D Virtual Office experience (`/office` and `/[org]/office`).

## Getting Started

To run this app locally, ensure you have the following installed:

- [Node.js](https://nodejs.org/) >= 20.0.0
- [pnpm](https://pnpm.io/) (`pnpm@10.27.0`, as configured in `package.json`)

#### 1. Clone this repository

```bash
git clone https://github.com/zedu-team-neo-mando/office-zedu-fe.git
cd office-zedu-fe
```

#### 2. Install dependencies

```bash
pnpm install
```

#### 3. Configure environment variables

Copy [`env.example`](./env.example) (named without a leading dot because the repository blocks `.env.*` files) to `.env` and fill in your local values:

```bash
cp env.example .env
```

Key variables from `env.example` for local development:

- `NEXT_PUBLIC_BASE_URL` — Zedu REST API base URL (e.g. `https://api.staging.zedu.chat/api/v1`)
- `NEXT_PUBLIC_CLIENT_URL` — Local frontend URL (`http://localhost:3000`)
- `NEXT_PUBLIC_MEDIA_URL` — Public media host (`https://media.zedu.chat`)
- `NEXT_PUBLIC_CONNECT_URL` — Centrifugo WebSocket endpoint (`wss://<host>/connection/websocket`)
- `CONTRIBUTOR_HELPER_URL` & `ZOE_SERVICE_TOKEN` — Server-only variables used by `/api/office/zoe` for Zoe in the virtual office

Never commit `.env` or real credentials.

#### 4. Start the development server

```bash
pnpm dev
```

Open `http://localhost:3000` in your browser:

- `/office` — Standalone 3D Virtual Office demo (runs client-side without backend API calls)
- `/<org>/office` — Live organisation 3D Virtual Office (requires an authenticated Zedu session and configured API/Centrifugo endpoints)

#### 5. Quality checks

Before opening a pull request against `dev`, run the verification scripts defined in `package.json`:

```bash
pnpm check-format
pnpm check-lint
pnpm check-types
pnpm build
```

## Office Documentation

- [Office Product Requirements (`OFFICE_PRD.md`)](./OFFICE_PRD.md)
- [Office Deployment Guide (`OFFICE_DEPLOYMENT.md`)](./OFFICE_DEPLOYMENT.md)

## Contributing

Pull requests target the `dev` branch. Please see [CONTRIBUTING](./CONTRIBUTING.md) for branch, commit, and review guidelines.
