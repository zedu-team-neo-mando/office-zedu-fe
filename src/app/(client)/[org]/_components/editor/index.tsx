import { useContext, useRef, useState } from "react";
import { Extension, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Mention from "@tiptap/extension-mention";
import Link from "@tiptap/extension-link";
import { DataContext } from "~/store/GlobalState";
import { ACTIONS } from "~/store/Actions";
import Code from "@tiptap/extension-code";
import HardBreak from "@tiptap/extension-hard-break";
import SlackCodeBlock from "./slack-code-block";
import { AppleEmoji } from "./apple-emoji";

// Shift+Enter: MessageHardBreak. Plain Enter: message-box (send / lists).
const MessageHardBreak = HardBreak.extend({
  addKeyboardShortcuts() {
    return {
      "Shift-Enter": () => this.editor.commands.setHardBreak(),
      "Mod-Enter": () => this.editor.commands.setHardBreak(),
    };
  },
});

// ProseMirror handles keydown before the wrapper's React onKeyDown, so its default
// Enter (split block / list item) ran before the send. Claim plain Enter here and let
// the wrapper send or split the list; code blocks keep the default new line.
const MessageEnter = Extension.create({
  name: "messageEnter",
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      Enter: () => !this.editor.isActive("codeBlock"),
    };
  },
});

const SLASH_COMMAND_ICON = "/image/TelexIcon.svg";
const CHANNEL_MENTION_ICON = "/images/megaphone.png";
/** Backend id for @channel (notify everyone in this channel). */
export const CHANNEL_MENTION_ID = "system-channel-mention";

const createChannelMentionItem = () => ({
  id: CHANNEL_MENTION_ID,
  name: "@channel",
  avatar_url: CHANNEL_MENTION_ICON,
  full_name: "Notify everyone in this channel",
  is_online: false,
  type: "user",
});

const SLASH_COMMANDS: {
  id: string;
  label: string;
  description: string;
  icon: string;
}[] = [
  {
    id: "remind",
    label: "remind",
    description: "Set a reminder",
    icon: SLASH_COMMAND_ICON,
  },
  {
    id: "poll",
    label: "invite",
    description: "Invite someone to this channel",
    icon: SLASH_COMMAND_ICON,
  },
  {
    id: "giphy",
    label: "remove",
    description: "Remove someone from this channel",
    icon: SLASH_COMMAND_ICON,
  },
  {
    id: "code",
    label: "archive",
    description: "Archive this channel",
    icon: SLASH_COMMAND_ICON,
  },
  {
    id: "me",
    label: "me",
    description: "Display an action message (emote style)",
    icon: SLASH_COMMAND_ICON,
  },
  {
    id: "shrug",
    label: "collapse",
    description: "Collapse the current thread",
    icon: SLASH_COMMAND_ICON,
  },
  {
    id: "tableflip",
    label: "expand",
    description: "Expand the current thread",
    icon: SLASH_COMMAND_ICON,
  },
  {
    id: "todo",
    label: "join",
    description: "Join this channel",
    icon: SLASH_COMMAND_ICON,
  },
  {
    id: "quote",
    label: "leave",
