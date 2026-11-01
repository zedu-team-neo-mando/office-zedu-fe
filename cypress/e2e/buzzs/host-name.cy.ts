/**
 * Buzzs page: each buzz shows its host's name, not "Someone", even when the
 * host isn't in the first page (50) of workspace members.
 * Needs only the app running; every API call is stubbed, so no real account
 * is used:
 *   CYPRESS_baseUrl=http://localhost:3000 \
 *   pnpm cypress run --spec cypress/e2e/buzzs/host-name.cy.ts
 */
const ORG = "mock-org-host-name";
const SLUG = "testorg";

// Without NEXT_PUBLIC_GTM_SCRIPT_URL the analytics <Script> loads the page's
// own HTML and throws "Unexpected token '<'"; push (OneSignal) isn't set up
// when testing either. Neither is related to this page.
Cypress.on(
  "uncaught:exception",
  (err) =>
    !err.message.includes("Unexpected token '<'") &&
    !err.message.includes("OneSignal")
);

const member = (id: string, name: string) => ({
  id,
  name,
  username: name.toLowerCase().replace(" ", "."),
  email: `${id}@example.com`,
  avatar_url: "",
});

// first: in the first page of members. listed: only in the full member list.
// fetched: in neither list, found through /users/mentions/:id. gone: deleted.
const FIRST = member("host-first", "Ada First");
const LISTED = member("host-listed", "Bola Listed");

const buzz = (code: string, hostId: string, hoursAgo: number) => {
  const start = new Date(Date.now() - hoursAgo * 3600e3);
  return {
    buzz_id: `id-${code}`,
    buzz_code: code,
    channel_id: "",
    channel_type: "channel",
    host_id: hostId,
    org_id: ORG,
    status: "ended",
    participant_count: 2,
    buzz_type: "channel",
    created_at: start.toISOString(),
    started_at: start.toISOString(),
    ended_at: new Date(start.getTime() + 20 * 60e3).toISOString(),
  };
};

const BUZZES = [
  buzz("CODE-FIRST", "host-first", 1),
  buzz("CODE-LISTED", "host-listed", 2),
  buzz("CODE-FETCHED-1", "host-fetched", 3),
  buzz("CODE-FETCHED-2", "host-fetched", 4),
  buzz("CODE-GONE", "host-gone", 5),
];

const titleOf = (code: string) =>
  cy.contains(code).closest(".group").find("p").first();

describe("buzz host names", () => {
  beforeEach(() => {
    // Anything not stubbed below gets an empty success.
    cy.intercept(/\/api\/v1\//, { body: { status: "success", data: [] } });
    cy.intercept("GET", "**/organisations/*/users?*", (req) => {
      // limit=50 is the first page; the larger limit is the full list.
      const firstPage = req.query.limit === "50";
      req.reply({
        status: "success",
        data: firstPage ? [FIRST] : [FIRST, LISTED],
        pagination: { current_page: 1, total_pages: 1, total_items: 2 },
      });
    });
    cy.intercept("GET", "**/users/mentions/*", (req) => {
