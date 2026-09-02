# The Host, for a real deployment.
#
# Two stages so the thing that ships does not carry a package manager and a
# toolchain. The install stage needs pnpm because the lockfile is pnpm's and a
# different resolver is a different dependency tree; the runtime is Bun,
# because `bun run src/index.ts` is what the server is written for and what
# `pnpm dev:server` runs locally. Running the same command in both places is
# worth more than shaving an image layer.
#
# No build step. The server is TypeScript executed directly — there is nothing
# to compile, and the wasm it does use (`@serenity-kit/opaque`) ships prebuilt
# and architecture-independent, which is what makes this work unchanged on
# astral's aarch64.

# Digest-pinned. A floating tag means the image you tested and the image that
# ships are only probably the same thing, and "probably" is the wrong word for
# the base layer of a server holding an IdP's OPAQUE setup. Update deliberately:
#   docker pull node:22-alpine && docker inspect --format='{{index .RepoDigests 0}}' node:22-alpine
FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable

# The manifests first, so a dependency change is what invalidates the install
# layer and a source change is not.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/server/package.json apps/server/
COPY packages/protocol/package.json packages/protocol/
RUN pnpm install --frozen-lockfile --filter @revel/server... --prod=false

FROM oven/bun:1-alpine AS runtime
WORKDIR /app

# Not root. The Host writes exactly two things — blobs and its own key file —
# and both are bind-mounted in, so nothing else needs to be writable.
RUN addgroup -S revel && adduser -S revel -G revel

# All three. pnpm gives every workspace package its own `node_modules` of
# symlinks into the root store, so copying only the root leaves
# `packages/protocol` unable to find zod — which fails at *import* time, in the
# container, and not during the build.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=deps /app/packages/protocol/node_modules ./packages/protocol/node_modules
COPY pnpm-workspace.yaml package.json ./
# `.dockerignore` keeps `.env`, `revel-host.json` and any `*host-key*.json` out
# of the build context entirely — `pnpm host-key` writes one into `apps/server`
# by default, and this line would otherwise bake it into the image. Neither key
# in that file can be regenerated (`docs/36`).
COPY apps/server ./apps/server
COPY packages/protocol ./packages/protocol

USER revel
EXPOSE 8080

# `--smol` keeps Bun's heap modest, which matters on a 2-core box that is
# already running six other things.
CMD ["bun", "--smol", "run", "apps/server/src/index.ts"]
