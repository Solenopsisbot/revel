/// <reference lib="webworker" />
/**
 * The Worker. All of the crypto happens in here and none of it anywhere else.
 *
 * `docs/31` §5: a 500-leaf removal is 212 ms and a 2,000-leaf one is 804 ms.
 * On the main thread those are 13 and 48 dropped frames. In here they are
 * nothing — the app keeps painting, and the call simply takes as long as it
 * takes.
 *
 * The file is deliberately thin. Everything worth testing is in `handlers.ts`
 * and `session.ts`, which run fine in Node; what is left here is `postMessage`,
 * and the way to keep that correct is to keep it boring.
 */
import init from '@revel/crypto-wasm';
import { Dispatcher } from './handlers.js';
import { type BootResponse, isBoot, type Request, type Response } from './wire.js';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const dispatcher = new Dispatcher();
let booted = false;

scope.onmessage = async (event: MessageEvent<Request | { boot: unknown }>) => {
  const message = event.data;

  if (isBoot(message)) {
    let reply: BootResponse;
    try {
      // A URL is fetched, bytes are instantiated directly. The caller chooses,
      // because only the caller knows how its bundler emits the asset.
      await init({ module_or_path: message.boot as never });
      booted = true;
      reply = { booted: true };
    } catch (e) {
      reply = { booted: false, error: describe(e) };
    }
    scope.postMessage(reply);
    return;
  }

  const request = message as Request;
  let reply: Response;
  try {
    if (!booted) throw new Error('the crypto worker has not loaded its wasm yet');
    reply = { id: request.id, ok: true, value: dispatcher.handle(request) };
  } catch (e) {
    reply = { id: request.id, ok: false, error: describe(e) };
  }

  // Structured-cloned, not transferred. A 837 KiB Welcome is the largest thing
  // that crosses here and copying it costs a fraction of a millisecond against
  // the 1.7 s join that produced it — not worth the class of bug where the
  // sender's buffer is silently detached.
  scope.postMessage(reply);
};

/**
 * Errors from wasm-bindgen arrive as plain `Error`s carrying the Rust message.
 * That message is the useful part and the only part that survives a clone.
 */
function describe(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
