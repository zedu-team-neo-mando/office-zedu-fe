import axios from "axios";

type WebhookParam = string | number | boolean | null | undefined;

const buildWebhookUrl = (
  baseUrl: string | undefined,
  params: Record<string, WebhookParam>
): string | null => {
  const base = baseUrl?.trim();
  // An unset NEXT_PUBLIC_* variable is inlined as the string "undefined",
  // which used to turn every call into a relative request to a 404.
  if (!base || base === "undefined") return null;

  let url: URL;
  try {
    url = new URL(base);
  } catch {
    // Relative bases can only be resolved in the browser.
    if (typeof window === "undefined") return null;
    try {
      url = new URL(base, window.location.origin);
    } catch {
      return null;
    }
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });

  return url.toString();
};

const sendWebhook = async (
  baseUrl: string | undefined,
  params: Record<string, WebhookParam>
) => {
  const url = buildWebhookUrl(baseUrl, params);
  if (!url) return null;

  try {
    return await axios.get(url);
  } catch (error: any) {
    return error;
  }
};

// ==========PATCH REQUEST=====================
export const RegisterWebhookRequest = async (
  username: string,
  event_name?: any,
  message?: string,
  status?: string
) => {
  return sendWebhook(process.env.NEXT_PUBLIC_REGISTER_WEBHOOK_URL, {
    event_name,
    message,
    status,
    username,
  });
};

export const LoginWebhookRequest = async (
  username: string,
  event_name?: any,
  message?: string,
  status?: string,
  avatar_url?: string
) => {
  return sendWebhook(process.env.NEXT_PUBLIC_LOGIN_WEBHOOK_URL, {
    event_name,
    message,
    status,
    username,
    avatar_url,
  });
};

export const PageVisitsWebhook = async (
  username: string,
  event_name?: any,
  message?: string,
  status?: string
) => {
  return sendWebhook(process.env.NEXT_PUBLIC_PAGE_VISIT_WEBHOOK_URL, {
    event_name,
    message,
    status,
    username,
  });
};

export const SuccessWebhook = async (
  username: string,
  event_name?: any,
  message?: string,
  status?: string
) => {
  return sendWebhook(process.env.NEXT_PUBLIC_SUCCESS_WEBHOOK_URL, {
    event_name,
    message,
    status,
    username,
  });
};

export const ErrorWebhook = async (
  username: string,
  event_name?: any,
  message?: string,
  status?: string
) => {
  return sendWebhook(process.env.NEXT_PUBLIC_ERROR_WEBHOOK_URL, {
    event_name,
    message,
    status,
    username,
  });
};
