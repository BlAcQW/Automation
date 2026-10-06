/**
 * Definitions service: list / load / create-version / activate, always
 * validating with the schema. Published versions are immutable — a change is
 * a new version. `activateVersion` also serves as rollback: it makes version N
 * the highest ACTIVE version by deactivating anything above it.
 *
 * (key, version) uniqueness for DEFAULT rows (tenantId null) is enforced here:
 * Postgres treats NULLs as distinct, so the DB unique index does not cover
 * them. Check-then-insert plus a post-insert tie-break (lowest id wins) keeps
 * two concurrent creators from both keeping the same version.
 */
import { parseFlowDefinition, type ValidateOptions } from './validate.js';
import type { FlowDefinition } from './types.js';

export interface DefinitionRow {
    id: string;
    tenantId: string | null;
    vertical: string | null;
    key: string;
    version: number;
    definition: unknown;
    isActive: boolean;
    createdAt: Date;
    createdBy: string | null;
}

export interface DefinitionScope {
    /** null = platform default flows. */
    tenantId: string | null;
}

export interface DefinitionStore {
    /** All versions of `key` in the scope. */
    findVersions(scope: DefinitionScope, key: string): Promise<DefinitionRow[]>;
    list(scope: DefinitionScope): Promise<DefinitionRow[]>;
    insert(row: Omit<DefinitionRow, 'id' | 'createdAt'>): Promise<DefinitionRow>;
    remove(id: string): Promise<void>;
    setActive(scope: DefinitionScope, key: string, which: { version: number } | { versionAbove: number }, isActive: boolean): Promise<void>;
}

export class FlowDefinitionError extends Error {
    constructor(public readonly errors: string[]) {
        super(`Invalid flow definition: ${errors.join('; ')}`);
        this.name = 'FlowDefinitionError';
    }
}
export class FlowVersionConflictError extends Error {
    constructor(key: string, version: number) {
        super(`Flow "${key}" version ${version} already exists`);
        this.name = 'FlowVersionConflictError';
    }
}
export class FlowNotFoundError extends Error {
    constructor(key: string, version: number) {
        super(`Flow "${key}" version ${version} not found`);
        this.name = 'FlowNotFoundError';
    }
}

export interface CreateVersionArgs {
    tenantId: string | null;
    /** Required for default rows. */
    vertical?: string | null;
    key: string;
    /** `key` and `version` inside are overwritten with the assigned ones. */
    definition: unknown;
    createdBy?: string | null;
    /** Publish immediately (default true). false stores it inactive as a draft. */
    activate?: boolean;
}

export function createDefinitionsService(store: DefinitionStore, validation: ValidateOptions = {}) {
    async function createVersion(args: CreateVersionArgs): Promise<DefinitionRow> {
        const scope = { tenantId: args.tenantId };
        if (args.tenantId === null && !args.vertical) throw new FlowDefinitionError(['default flows need a vertical']);
        if (typeof args.definition !== 'object' || args.definition === null || Array.isArray(args.definition)) {
            throw new FlowDefinitionError(['definition must be an object']);
        }

        const existing = await store.findVersions(scope, args.key);
        const version = existing.reduce((m, r) => Math.max(m, r.version), 0) + 1;
        const candidate = { ...(args.definition as Record<string, unknown>), key: args.key, version };
        const parsed = parseFlowDefinition(candidate, validation);
        if (!parsed.ok) throw new FlowDefinitionError(parsed.errors);

        if (existing.some((r) => r.version === version)) throw new FlowVersionConflictError(args.key, version);

        const row = await store.insert({
            tenantId: args.tenantId,
            vertical: args.vertical ?? null,
            key: args.key,
            version,
            definition: parsed.definition,
            isActive: false,
            createdBy: args.createdBy ?? null,
        });

        if (args.tenantId === null) {
            // The DB cannot enforce this for NULL tenants; settle a concurrent twin.
            const twins = (await store.findVersions(scope, args.key)).filter((r) => r.version === version);
            if (twins.length > 1) {
                const winner = twins.reduce((a, b) => (a.id <= b.id ? a : b));
                if (winner.id !== row.id) {
                    await store.remove(row.id);
                    throw new FlowVersionConflictError(args.key, version);
                }
            }
        }

        if (args.activate ?? true) {
            await store.setActive(scope, args.key, { version }, true);
            return { ...row, isActive: true };
        }
        return row;
    }

    async function getVersion(scope: DefinitionScope, key: string, version: number): Promise<DefinitionRow | null> {
        return (await store.findVersions(scope, key)).find((r) => r.version === version) ?? null;
    }

    /** Highest active version, parsed. null if none (or the stored JSON no longer validates). */
    async function loadActive(scope: DefinitionScope, key: string): Promise<FlowDefinition | null> {
        const active = (await store.findVersions(scope, key)).filter((r) => r.isActive).sort((a, b) => b.version - a.version)[0];
        if (!active) return null;
        const parsed = parseFlowDefinition(active.definition, validation);
        return parsed.ok ? parsed.definition : null;
    }

    async function activateVersion(scope: DefinitionScope, key: string, version: number): Promise<void> {
        const row = await getVersion(scope, key, version);
        if (!row) throw new FlowNotFoundError(key, version);
        const parsed = parseFlowDefinition(row.definition, validation);
        if (!parsed.ok) throw new FlowDefinitionError(parsed.errors);
        await store.setActive(scope, key, { version }, true);
        await store.setActive(scope, key, { versionAbove: version }, false);
    }

    async function deactivateVersion(scope: DefinitionScope, key: string, version: number): Promise<void> {
        if (!(await getVersion(scope, key, version))) throw new FlowNotFoundError(key, version);
        await store.setActive(scope, key, { version }, false);
    }

    return {
        createVersion,
        getVersion,
        loadActive,
        activateVersion,
        deactivateVersion,
        list: (scope: DefinitionScope) => store.list(scope),
        listVersions: (scope: DefinitionScope, key: string) => store.findVersions(scope, key),
    };
}

export type DefinitionsService = ReturnType<typeof createDefinitionsService>;
