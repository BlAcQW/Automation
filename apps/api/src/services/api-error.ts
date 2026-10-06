/**
 * An HTTP error with a stable, machine-readable `code` for API clients.
 *
 * Thrown from a route, plugins/error-handler.ts turns it into
 *   { statusCode, error, code, message }
 * at its own status (5xx included: the message is written for the client).
 * External apps (e.g. the TURBO console) branch on `code`; `message` is
 * human copy that may change.
 */
export class ApiError extends Error {
    readonly statusCode: number;
    readonly publicCode: string;
    /** When set, the error handler adds a Retry-After header. */
    readonly retryAfterSec?: number;

    constructor(statusCode: number, code: string, message: string, retryAfterSec?: number) {
        super(message);
        if (retryAfterSec !== undefined) this.retryAfterSec = retryAfterSec;
        this.name = ApiError.errorName(statusCode);
        this.statusCode = statusCode;
        this.publicCode = code;
    }

    private static errorName(status: number): string {
        switch (status) {
            case 400: return 'Bad Request';
            case 403: return 'Forbidden';
            case 404: return 'Not Found';
            case 409: return 'Conflict';
            case 429: return 'Too Many Requests';
            case 502: return 'Bad Gateway';
            case 503: return 'Service Unavailable';
            default: return 'Error';
        }
    }
}
