"use client";

import { useEffect, useRef, useState } from "react";
import type {
  OfficeOccupant,
  OfficePresenceState,
  OfficeSource,
} from "~/types/office";

/** How often the publisher wakes up; it sends at most this often. */
const TICK_MS = 200;
/** A refused attempt waits this long before trying again. */
const BACKOFF_MS = 1000;
/** A still avatar still reports in, so a room can expire a quiet one. */
const HEARTBEAT_MS = 30_000;

interface UseOfficePresenceOptions {
  source: OfficeSource;
  /** The scene is the live office and it is on screen. */
  active: boolean;
  /** The room the player stands in, if they are in one yet. */
  roomId: string | null;
  /** The pose the engine last reported. */
  pose: { x: number; z: number; yaw: number };
  /** Everyone standing in the room, complete, whenever that changes. */
  onOccupants: (occupants: OfficeOccupant[]) => void;
  /** Whether the room's realtime roster is connected yet. */
  onState?: (state: OfficePresenceState) => void;
}

/**
 * Keeps this client's side of the room in step with the server: it subscribes
 * to the room's presence, enters the room only once that stream is live,
 * publishes the local pose while it is in there, and leaves on the way out.
 *
 * Presence is read and published per room, so all of this is torn down and
 * started again on every room change. The sequencing matters in one direction
 * only: the stream has to be live before the room is entered, because entry is
 * what makes this avatar visible to everyone else.
 */
export function useOfficePresence({
  source,
  active,
  roomId,
  pose,
  onOccupants,
  onState,
}: UseOfficePresenceOptions) {
  /** The room whose subscription is live right now, if any. */
  const [liveRoom, setLiveRoom] = useState<string | null>(null);
  /** The room the server was told the player is standing in, if any. */
  const [enteredRoom, setEnteredRoom] = useState<string | null>(null);

  // Callbacks and the pose change on every frame the engine reports, while the
  // effects below only belong to a room. Refs keep the newest value reachable
  // without re-subscribing on each of those frames.
  const onOccupantsRef = useRef(onOccupants);
  onOccupantsRef.current = onOccupants;
  const onStateRef = useRef(onState);
  onStateRef.current = onState;
  const poseRef = useRef(pose);
  poseRef.current = pose;

  /** The room entry succeeded for, so a live stretch enters once. */
  const enteredRoomRef = useRef<string | null>(null);
  /** The room entry is being attempted for, so it is not asked twice. */
  const enterAttemptRef = useRef<string | null>(null);
  /** The last pose the server accepted, which is what movement is judged by. */
  const lastPublishedPoseRef = useRef<UseOfficePresenceOptions["pose"] | null>(
    null
  );
  const lastPublishedAtRef = useRef(0);
  const nextPublishAtRef = useRef(0);
  const publishInFlightRef = useRef(false);
  const reenteredRef = useRef(false);

  // Presence is published per room, so the subscription follows the room the
  // user is in. The state callback names the room it belongs to: only that room
  // may claim to be live, and tearing the subscription down withdraws the
  // claim, so a rapid room change can never leave the previous room behind.
  useEffect(() => {
    if (!active || !roomId) {
      setLiveRoom(null);
      onOccupantsRef.current([]);
      return;
    }

    const stop = source.subscribePresence(
      roomId,
      (occupants) => onOccupantsRef.current(occupants),
      (state) => {
        onStateRef.current?.(state);
        setLiveRoom((current) =>
          state === "live" ? roomId : current === roomId ? null : current
        );
      }
    );

    return () => {
      stop();
      setLiveRoom((current) => (current === roomId ? null : current));
    };
  }, [source, active, roomId]);

  // The room is entered only once its own subscription is live, so entry is
  // sequenced with the stream that reports who is inside it, and it is
  // attempted at most once per live stretch. The request helper reports a
  // failure on its own; it is not toasted again here.
  useEffect(() => {
    if (!active || !roomId || liveRoom !== roomId) return;
    if (enteredRoomRef.current === roomId || enterAttemptRef.current === roomId)
      return;

    enterAttemptRef.current = roomId;
    let cancelled = false;

    source
      .enterRoom(roomId)
      .then(() => {
        if (!cancelled) {
          enteredRoomRef.current = roomId;
          setEnteredRoom(roomId);
          return;
        }
        // The player moved on while entry was still in flight, so the server
        // must not be left holding a room nobody is in any more.
        source.leaveRoom(roomId).catch(() => {
          // The request helper already reported the failure.
        });
      })
      .catch(() => {
        if (!cancelled) enterAttemptRef.current = null;
      });

    return () => {
      cancelled = true;
    };
  }, [source, active, roomId, liveRoom]);

  // Only a room that was actually entered is ever left.
  useEffect(() => {
    if (!active) return;

    return () => {
      const entered = enteredRoomRef.current;
      enteredRoomRef.current = null;
      enterAttemptRef.current = null;
      setEnteredRoom(null);
      if (!entered) return;
      source.leaveRoom(entered).catch(() => {
        // The request helper already reported the failure.
      });
    };
  }, [source, active, roomId]);

  // Local movement goes out at most five times a second while the player
  // walks, and once every half minute while they stand still, so the room
  // always knows where they are without a request per frame. Publishing starts
  // only once this room is entered with its own subscription live, and stops
  // on a room change, a disconnect or an unmount. A 409 re-enters the room
  // once instead of retrying; a 429 or any other refusal backs off instead of
  // looping.
  useEffect(() => {
    if (!active || !roomId) return;
    if (liveRoom !== roomId || enteredRoom !== roomId) return;

    lastPublishedPoseRef.current = null;
    lastPublishedAtRef.current = 0;
    nextPublishAtRef.current = 0;
    reenteredRef.current = false;

    const publish = () => {
      if (publishInFlightRef.current) return;
      const now = Date.now();
      if (now < nextPublishAtRef.current) return;

      const current = poseRef.current;
      const sent = lastPublishedPoseRef.current;
      const moved =
        !sent ||
        Math.hypot(sent.x - current.x, sent.z - current.z) > 0.05 ||
        Math.abs(sent.yaw - current.yaw) > 0.05;
      if (lastPublishedAtRef.current > 0) {
        const gap = moved ? TICK_MS : HEARTBEAT_MS;
        if (now - lastPublishedAtRef.current < gap) return;
      }

      publishInFlightRef.current = true;
      source
        .sendPosition(roomId, current.x, current.z, current.yaw)
        .then((status) => {
          publishInFlightRef.current = false;
          if (status >= 200 && status < 300) {
            // Only the pose the server took counts as sent, so a move that
            // happened while the request was in flight still goes out.
            lastPublishedPoseRef.current = current;
            lastPublishedAtRef.current = Date.now();
            return;
          }
          if (status === 409 && !reenteredRef.current) {
            // not_in_room: the entry did not stick, so enter once and let the
            // next attempt publish again.
            reenteredRef.current = true;
            nextPublishAtRef.current = Date.now() + BACKOFF_MS;
            source.enterRoom(roomId).catch(() => {
              // The request helper already reported the failure.
            });
            return;
          }
          // 429, a refused status or no answer at all: wait before trying
          // again rather than pushing in a tight loop.
          nextPublishAtRef.current = Date.now() + BACKOFF_MS;
        })
        .catch(() => {
          publishInFlightRef.current = false;
          nextPublishAtRef.current = Date.now() + BACKOFF_MS;
        });
    };

    const timer = window.setInterval(publish, TICK_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [source, active, roomId, liveRoom, enteredRoom]);
}
