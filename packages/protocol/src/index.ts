/**
 * @revel/protocol — the contract.
 *
 * The server, every client and every SDK are typed against this package.
 * Changing a schema here is a protocol change; see `docs/29` §1 for the rules
 * that make one safe, given encrypted history can never be rewritten.
 */
export * from './base64.js';
export * from './envelope.js';
export * from './events.js';
export * from './ids.js';
export * from './permissions.js';
export * from './socket.js';
