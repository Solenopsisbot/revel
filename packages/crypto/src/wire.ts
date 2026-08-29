/**
 * What crosses the thread boundary.
 *
 * Derived from `CryptoEngine` rather than written out, so the two cannot drift:
 * add a method to the interface and the dispatch table below stops compiling
 * until it is handled. A hand-maintained copy of an interface is a bug with a
 * delay on it.
 */
import type { CryptoEngine } from './engine.js';

/** Every method name on the engine. */
export type Op = keyof CryptoEngine;

export type Args<K extends Op> = CryptoEngine[K] extends (...args: infer A) => unknown ? A : never;

export type Result<K extends Op> = CryptoEngine[K] extends (...args: never[]) => Promise<infer R>
  ? R
  : never;

/** One call, in flight. `id` pairs it with its reply. */
export type Request = { [K in Op]: { id: number; op: K; args: Args<K> } }[Op];

/**
 * One reply.
 *
 * Errors cross as a string, not an Error: a structured clone of an Error loses
 * everything except the message anyway, and the failures that matter here —
 * "no group X in this session", "epoch not found" — *are* their message.
 */
export type Response =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: string };

/** Where the wasm comes from. The caller decides; this package does not guess. */
export type WasmSource = string | URL | ArrayBuffer | Uint8Array;

/** Sent once, before anything else, because instantiating wasm is async. */
export interface BootRequest {
  boot: WasmSource;
}

export type BootResponse = { booted: true } | { booted: false; error: string };

export function isBoot(message: unknown): message is BootRequest {
  return typeof message === 'object' && message !== null && 'boot' in message;
}
