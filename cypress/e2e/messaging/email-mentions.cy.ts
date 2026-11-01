/**
 * Message text: an email address is plain text (or a mailto link), never a
 * mention, and real @ and # mentions next to it still render as mentions.
 * The tokenizer cases run in the browser; the channel checks need only the app
 * running, with every API call stubbed, so no real account is used:
 *   CYPRESS_baseUrl=http://localhost:3000 \
 *   pnpm cypress run --spec cypress/e2e/messaging/email-mentions.cy.ts
 */
import { tokenizeMessageText } from "../../../src/app/(client)/[org]/_components/ChannelMessage/tokenize-message-text";

const ORG = "mock-org-email-mentions";
const SLUG = "testorg";
const CHANNEL = "mock-channel-email-mentions";
const USER = { id: "user-1", user_id: "user-1", username: "tester" };

// Without NEXT_PUBLIC_GTM_SCRIPT_URL the analytics <Script> loads the page's
// own HTML and throws "Unexpected token '<'"; push (OneSignal) isn't set up
// when testing either. Neither is related to message text.
Cypress.on(
  "uncaught:exception",
  (err) =>
    !err.message.includes("Unexpected token '<'") &&
    !err.message.includes("OneSignal")
);

// [input, emails, mentions]. Plain strings, without mailto links or mention
// markup, so only the tokenizer decides.
const CASES: [string, string[], string[]][] = [
  ["person@gmail.com", ["person@gmail.com"], []],
  ["first.last+tag@example.co.uk", ["first.last+tag@example.co.uk"], []],
  ["Contact person@team.example.org.", ["person@team.example.org"], []],
  ["@username and person@gmail.com", ["person@gmail.com"], ["@username"]],
  ["person@gmail.com and @username", ["person@gmail.com"], ["@username"]],
  ["(@username)", [], ["@username"]],
  [".@username", [], ["@username"]],
  ["Hello @username", [], ["@username"]],
  ["@first and @second", [], ["@first", "@second"]],
  ["@username and the team", [], ["@username"]],
  ["@username, please review.", [], ["@username"]],
  ["(@username); #general!", [], ["@username", "#general"]],
  ["@first.last and @second-user", [], ["@first.last", "@second-user"]],
  ["@first. and #general-", [], ["@first", "#general"]],
  ["@Jane Doe", [], ["@Jane"]],
  ["@channel", [], ["@channel"]],
  ["#channel", [], ["#channel"]],
  ["@channel and #channel", [], ["@channel", "#channel"]],
  [
    "@first person@gmail.com @second first.last+tag@example.co.uk",
    ["person@gmail.com", "first.last+tag@example.co.uk"],
    ["@first", "@second"],
  ],
  ["www.person@example.com", ["www.person@example.com"], []],
  // Internationalised addresses
  ["josé@example.com", ["josé@example.com"], []],
  ["**josé@example.com**", ["josé@example.com"], []],
  ["Contact josé@example.com.", ["josé@example.com"], []],
  ["用户@example.com", ["用户@example.com"], []],
  ["person@exämple.com", ["person@exämple.com"], []],
