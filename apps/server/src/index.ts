/** Bun entrypoint. Wires the app to Bun's HTTP and WebSocket server. */
import { SnowflakeFactory } from '@revel/protocol';
import { createApp } from './app.js';
import { Hub } from './hub.js';
import { MemoryStore } from './store/memory.js';

const store = new MemoryStore();
const hub = new Hub();
const app = createApp({
  store,
  hub,
  ids: new SnowflakeFactory(0),
  // Placeholder until device challenge-response lands (`docs/17` §2).
  async authenticate(req) {
    const device = req.headers.get('x-revel-device');
    if (!device) return null;
    const record = await store.getDevice(device);
    if (!record || record.revokedAt) return null;
    return { accountId: record.accountId, devicePub: record.pub };
  },
});

const port = Number(process.env.PORT ?? 8080);
console.log(`revel server on :${port}`);
export default { port, fetch: app.fetch };
