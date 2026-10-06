/**
 * Ordered, idempotent shutdown shared by the api and worker entry points.
 * A failing step is logged and the rest still run; a hung step cannot hold the
 * process past `timeoutMs` (keep it below the process manager's kill timeout).
 */

export interface ShutdownStep {
    name: string;
    run: () => Promise<void> | void;
}

interface ShutdownLog {
    info: (obj: object, msg: string) => void;
    error: (obj: object, msg: string) => void;
}

export interface ShutdownOptions {
    steps: ShutdownStep[];
    log: ShutdownLog;
    exit?: (code: number) => void;
    timeoutMs?: number;
}

export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 25_000;

export function createShutdown(opts: ShutdownOptions): (signal: string) => Promise<void> {
    const exit = opts.exit ?? ((code: number) => process.exit(code));
    const timeoutMs = opts.timeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
    let started = false;

    return async (signal: string) => {
        if (started) return;
        started = true;
        opts.log.info({ signal }, 'Shutting down gracefully');

        const timer = setTimeout(() => {
            opts.log.error({ timeoutMs }, 'Graceful shutdown timed out, forcing exit');
            exit(1);
        }, timeoutMs);
        timer.unref?.();

        let failed = false;
        for (const step of opts.steps) {
            try {
                await step.run();
            } catch (err) {
                failed = true;
                opts.log.error({ err, step: step.name }, 'Shutdown step failed');
            }
        }
        clearTimeout(timer);
        exit(failed ? 1 : 0);
    };
}
