# Error Learning Record

## Date
2026-10-29

## Error Category
[x] Architectural  [ ] Security-Relevant  [ ] Integration Contract Violation

## What Went Wrong
A feature agent working in a git worktree (`.claude/worktrees/...`) had been told to symlink `node_modules`, `apps/web/node_modules` and `apps/api/node_modules` from `/root/home/Automation`. When it ran `npx prisma generate`, Prisma 5 found `prisma` and `@prisma/client` in different node_modules trees and auto-ran `npm install @prisma/client`. That install went through the symlink into the SHARED `/root/home/Automation/apps/api/node_modules`, which the live `bookly-api` process loads. npm moved `@fastify/error`, `@fastify/multipart` and `@fastify/deepmerge` into hidden backup folders and left empty directories. From about 08:51:49 to 08:53 UTC the live API's `@fastify/multipart` was missing on disk; a pm2 restart in that window would have taken the API down. The agent moved the packages back (4.2.0 / 8.3.1 / 2.0.2, matching the lockfile), and the shared `.prisma/client` was checked and found untouched.

## Root Cause
The worktree set-up treated symlinked node_modules as read-only, but npm and Prisma's auto-install write through symlinks. The production app runs straight from `/root/home/Automation/apps/api` (`node dist/index.js` with that node_modules), so the development dependency tree and the live dependency tree are the same folders.

## Corrected Implementation
In a worktree, `apps/api/node_modules` is a real folder that links only the packages the API needs and owns its own Prisma client:

```bash
W=<worktree>
mkdir -p $W/apps/api/node_modules
ln -s /root/home/Automation/apps/api/node_modules/{@fastify,nanoid,openai} $W/apps/api/node_modules/
mkdir -p $W/apps/api/node_modules/@prisma
cp -a /root/home/Automation/node_modules/@prisma/client $W/apps/api/node_modules/@prisma/client
ln -s /root/home/Automation/node_modules/prisma $W/apps/api/node_modules/prisma
cd $W/apps/api && PRISMA_GENERATE_SKIP_AUTOINSTALL=true node node_modules/prisma/build/index.js generate --schema $W/apps/api/prisma/schema.prisma
# client lands in $W/apps/api/node_modules/.prisma/client
```

Never run `npm install` / `npm i` / `npx <pkg>` that installs inside a worktree that links shared node_modules.

## Reasoning Behind the Correction
Generating the client into the worktree's own `.prisma/client` keeps an unfinished schema away from the live client (a client generated with new columns would break the running API's queries after its next restart). Copying `@prisma/client` next to `prisma` satisfies Prisma's same-tree check, so it never tries to install. Linking only leaf packages, not the whole folder, means no npm operation can rename anything in the shared tree.

## Extracted Rule
In /root/home/Automation git worktrees, never symlink the whole `apps/api/node_modules` and never run npm install or `npx prisma generate` with the default settings: make `apps/api/node_modules` a real folder, copy `@prisma/client` into it, and generate with `PRISMA_GENERATE_SKIP_AUTOINSTALL=true` and an explicit `--schema`, because the live bookly-api loads the shared node_modules and the shared `.prisma/client`.

## Recurrence Risk
[x] First occurrence
[ ] Has appeared before — ESCALATE TO ARCHITECTURAL REVIEW
