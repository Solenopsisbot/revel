#!/usr/bin/env bun
/**
 * `revel init` — write this Host's key file. (`docs/29` §7)
 *
 * One job, and it is deliberately the *only* thing in this codebase that
 * creates a durable Host key. Nothing generates one implicitly at boot, because
 * a key that appears by itself is a key nobody backed up — and this is the one
 * secret a Host cannot regenerate. It is published in the group context of
 * every group the Host has been an external sender for, and every member has
 * already committed to it.
 *
 *   pnpm host-key                             # ./revel-host.json
 *   REVEL_HOST=chat.example pnpm host-key
 *   pnpm host-key /etc/revel/host.json
 *
 * Named `host-key` rather than `init` because `pnpm init` is a pnpm builtin
 * that writes a `package.json`, and a command that does something entirely
 * different depending on whether you typed `run` is a trap.
 */
import { hostKeyPath, writeHostKey } from './hostkey.js';

const path = process.argv[2] ?? hostKeyPath();
const label = process.env.REVEL_HOST ?? `localhost:${process.env.PORT ?? 8080}`;

try {
  const identity = await writeHostKey(path, label);
  console.log(`wrote ${path} (mode 0600)`);
  console.log(`  host:        ${label}`);
  console.log(`  certificate: ${identity.certificate.slice(0, 32)}…`);
  console.log('');
  console.log('Back this up. It cannot be regenerated: it is published in the');
  console.log('group context of every group this Host becomes an external sender');
  console.log('for, and losing it means never being able to propose into them.');
} catch (err) {
  console.error(`revel init: ${(err as Error).message}`);
  process.exit(1);
}
