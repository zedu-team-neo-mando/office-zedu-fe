/**
 * Blocked desktop notifications: a compact notice under the conversation
 * header, with browser help on demand, that stays dismissed for the account
 * for the browser session and never covers the messages or the composer.
 * The permission helpers run in the browser; the page checks need only the app
 * running, with every API call stubbed, so no real account is used:
 *   CYPRESS_baseUrl=http://localhost:3000 \
 *   pnpm cypress run --spec cypress/e2e/notifications/blocked-notice.cy.ts
 */
import {
  type Browser,
  type NotificationState,
  createNotificationDismissal,
  getDismissalState,
  getGuidanceBrowser,
  notificationGuidance,
  shouldShowNotificationNotice,
} from "../../../src/app/(client)/[org]/_components/notification-permission";

const ORG = "mock-org-notifications";
const SLUG = "testorg";
const CHANNEL = "mock-channel-notifications";
const NOTICE = "Desktop notifications are blocked.";
const DISMISS = '[aria-label="Dismiss notification notice"]';
const EDITOR = ".ProseMirror";

// Without NEXT_PUBLIC_GTM_SCRIPT_URL the analytics <Script> loads the page's
// own HTML and throws "Unexpected token '<'"; push (OneSignal) isn't set up
// when testing either. Neither is related to the notice.
Cypress.on(
  "uncaught:exception",
  (err) =>
    !err.message.includes("Unexpected token '<'") &&
    !err.message.includes("OneSignal")
);

describe("notification permission helpers", () => {
  const states: NotificationState[] = [
    "default",
    "denied",
    "granted",
    "unsupported",
  ];
  states.forEach((permission) => {
    it(`shows the notice for "${permission}" only when denied, ready and not dismissed`, () => {
      [false, true].forEach((ready) =>
        [false, true].forEach((dismissed) =>
          expect(
            shouldShowNotificationNotice(permission, { ready, dismissed })
          ).to.equal(permission === "denied" && ready && !dismissed)
        )
      );
    });
  });

  const agents: [string, Browser][] = [
    ["Chrome/130 Safari/537", "chrome"],
    ["Chrome/130 Safari/537 Edg/130", "edge"],
    ["Firefox/130", "firefox"],
    ["Version/18 Safari/605", "safari"],
    ["iPhone Version/18 Safari/605", "other"],
    ["Chrome/130 Safari/537 OPR/115", "other"],
    ["Unknown browser", "other"],
  ];
  agents.forEach(([userAgent, browser]) => {
    it(`picks the ${browser} guidance for "${userAgent}"`, () => {
      expect(getGuidanceBrowser(userAgent)).to.equal(browser);
      expect(notificationGuidance[browser]).to.have.length(2);
    });
  });

  it("is not ready until the current account's dismissal has been read", () => {
    const alice = { accountId: "alice", dismissed: true };
    const bob = { accountId: "bob", dismissed: false };
    const cases: [string | null, typeof alice | null, boolean, boolean][] = [
      ["alice", null, false, false],
      ["alice", alice, true, true],
      ["bob", alice, false, false],
      ["bob", bob, true, false],
      ["alice", bob, false, false],
