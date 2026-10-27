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

This repository contains the frontend implementation for the Zedu application.

## Getting Started

To run this app locally, you should have the following programs installed on your computer:

- [nodejs](https://nodejs.org/)>=20.0.0
- [pnpm](https://yarnpkg.com/)>=9.4.0

#### Clone this repository

```
git clone git@github.com/hngprojects/Zedu_fe.git
cd Zedu_fe
```

#### Install dependencies

```
pnpm install
```

#### Start the server

```
pnpm dev
```

## Google sign-in

The login and sign-up pages use Google Identity Services (`@react-oauth/google`). Two things must
line up for the button to work:

1. `NEXT_PUBLIC_GOOGLE_CLIENT_ID` — the Web application OAuth client ID for that environment. It is
   inlined at build time, so changing it requires a rebuild.
2. The origin the app is served from must be listed under **Authorized JavaScript origins** for that
   client in the Google Cloud Console.

If the origin is missing, Google blocks the request before the app sees it:

```
Access blocked: Authorization Error
Error 400: origin_mismatch
```

No authorization code is returned, so `POST /auth/google` is never called and no session is created.
The login page shows a "Google sign-in failed" toast for this case.

### Registering an origin

1. Find the client ID the build uses: check `NEXT_PUBLIC_GOOGLE_CLIENT_ID` in the deployment
   environment, or search the built JavaScript for `<project>.apps.googleusercontent.com`.
2. Open <https://console.cloud.google.com/apis/credentials> in the project that owns that client.
3. Edit the OAuth 2.0 Client ID of type **Web application**.
4. Under **Authorized JavaScript origins**, add each full origin (scheme + host, no trailing slash
   or path):
   - `http://localhost:3000` for local development
   - `https://office.groups.zedu.chat` for the office staging deployment
   - the production origin, if it differs
5. Save. New origins can take a few minutes (occasionally hours) to propagate; retry afterwards.

If the environment should use a different client, set `NEXT_PUBLIC_GOOGLE_CLIENT_ID` to that client
and redeploy.

Preview deployments have their own origins, so Google sign-in does not work there; use email and
password instead.

## Contributing

Please see [CONTRIBUTING](./CONTRIBUTING.md)
