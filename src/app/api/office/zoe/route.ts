import { NextResponse } from "next/server";
import { SignJWT, jwtVerify } from "jose";
import { ZoeRequestSchema } from "~/lib/zoe/request-contract";

/**
 * Proxies a question to the contributor helper so Zoe can answer with the
 * requester's real context. The service token stays on the server.
 *
 * The helper is expected to answer with a server sent events stream or a
 * plain JSON body; both are handled here.
 *
 * Security:
 * - Validates the caller's JWT (Zedu auth)
 * - Validates request body with zod
 * - Rate limits per user (in-memory, single-instance)
 * - Constructs a clean payload for the helper (no pass-through)
 */

// ---- Config ----
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 30; // per user per minute
const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET ?? "");

// ---- In-memory rate limiter (single-instance deploy) ----
const rateLimitMap = new Map<string, number[]>();

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;

  const timestamps = rateLimitMap.get(userId) ?? [];
  const recent = timestamps.filter((ts) => ts > windowStart);

  if (recent.length >= RATE_LIMIT_MAX_REQUESTS) {
    return false;
  }

  recent.push(now);
  rateLimitMap.set(userId, recent);
  return true;
}

// ---- JWT verification ----
async function verifyJwt(
  token: string
): Promise<{ userId: string; orgId: string } | null> {
  if (!JWT_SECRET.byteLength) {
    return null; // no secret configured
  }

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const userId = payload.user_id as string | undefined;
    const orgId = payload.org_id as string | undefined;

    if (!userId || !orgId) {
      return null;
    }

    return { userId, orgId };
  } catch {
    return null;
  }
}

// ---- Handler ----
export async function POST(request: Request) {
  const helperUrl = process.env.CONTRIBUTOR_HELPER_URL;
  const serviceToken = process.env.ZOE_SERVICE_TOKEN;

  if (!helperUrl || !serviceToken) {
    return NextResponse.json(
      {
        status: "error",
        message:
          "Zoe is not configured for this deployment. Set CONTRIBUTOR_HELPER_URL and ZOE_SERVICE_TOKEN.",
      },
      { status: 503 }
    );
  }

  // 1. Verify JWT
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : authHeader;

  const claims = await verifyJwt(token);
  if (!claims) {
    return NextResponse.json(
      { status: "error", message: "Unauthorized" },
      { status: 401 }
    );
  }

  // 2. Rate limit
  if (!checkRateLimit(claims.userId)) {
    return NextResponse.json(
      { status: "error", message: "Too many requests. Please slow down." },
      { status: 429 }
    );
  }

  // 3. Validate body with zod
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { status: "error", message: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const parsed = ZoeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        status: "error",
        message: "Invalid request",
        errors: parsed.error.flatten(),
      },
      { status: 400 }
    );
  }

  const { question, context } = parsed.data;

  // 4. Build clean payload for helper (no pass-through)
  const helperPayload = {
    messages: [{ role: "user", content: question }],
    context: {
      location: "office",
      buildingId: claims.orgId,
      room: context.room,
      nearbyUsers: context.nearbyUsers,
      requesterId: claims.userId,
    },
  };

  // 4. Call helper
  try {
    const response = await fetch(`${helperUrl}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Zoe-Service-Token": serviceToken,
        "X-User-Id": claims.userId,
        "X-User-Org": claims.orgId,
      },
      body: JSON.stringify(helperPayload),
      cache: "no-store",
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      console.error("Zoe helper error:", response.status, errorText);
      return NextResponse.json(
        {
          status: "error",
          message: "Zoe could not answer that right now.",
        },
        { status: 502 }
      );
    }

    const contentType = response.headers.get("content-type") ?? "";

    if (contentType.includes("text/event-stream")) {
      return new NextResponse(response.body, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      });
    }

    const payload = await response.json();
    const answer =
      payload?.answer ??
      payload?.data?.answer ??
      payload?.message ??
      payload?.data?.message ??
      "";

    return NextResponse.json({ status: "success", data: { answer } });
  } catch (err) {
    console.error("Zoe proxy error:", err);
    return NextResponse.json(
      {
        status: "error",
        message: "Zoe could not answer that right now.",
      },
      { status: 502 }
    );
  }
}
