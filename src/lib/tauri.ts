// The one door to the Rust core. Inside the app, calls go to Tauri; in a
// plain browser (`npm run dev` on its own, or a test run) they go to a
// stand-in kept in localStorage (browserBackend.ts), so the interface can
// be worked on and exercised without the native shell.
import { Channel, invoke as tauriInvoke } from "@tauri-apps/api/core";
import type { InvokeArgs, InvokeOptions } from "@tauri-apps/api/core";
import { browserInvoke, browserStream } from "./browserBackend";
import type { StreamEvent } from "./types";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function invoke<T>(cmd: string, args?: InvokeArgs, options?: InvokeOptions): Promise<T> {
  if (isTauri) return tauriInvoke<T>(cmd, args, options);
  return browserInvoke<T>(cmd, args);
}

/** A command that reports as it runs (a chat turn, a download): `onEvent`
 *  gets each event; the promise settles when the command returns. */
export function invokeStreaming<E>(
  cmd: string,
  args: Record<string, unknown>,
  channelArg: string,
  onEvent: (e: E) => void,
): Promise<void> {
  if (!isTauri) return browserStream(cmd, args, onEvent as (e: unknown) => void);
  const channel = new Channel<E>();
  channel.onmessage = onEvent;
  return tauriInvoke<void>(cmd, { ...args, [channelArg]: channel });
}

export type { StreamEvent };
