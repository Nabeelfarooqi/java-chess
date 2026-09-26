export class RequestError extends Error {
    constructor(message: string, public status = 0) { super(message); this.name = 'RequestError'; }
}

// A request gets one bounded attempt. Callers reconcile uncertain mutations
// with the server before offering a retry; this helper never repeats a POST.
export async function requestJson<T>(input: string, init: RequestInit = {}, timeoutMs = 10000): Promise<T> {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    try {
        const response = await fetch(input, { cache: 'no-store', credentials: 'same-origin', ...init, signal });
        let body: unknown;
        try { body = await response.json(); }
        catch (error) {
            if (signal.aborted) throw error;
            throw new RequestError(response.ok ? 'The server returned an unreadable response. Please retry.' : 'The room is temporarily unavailable. Please retry.', response.status);
        }
        if (!response.ok) {
            const message = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : 'The room is temporarily unavailable. Please retry.';
            throw new RequestError(message, response.status);
        }
        signal.throwIfAborted();
        return body as T;
    } catch (error) {
        if (init.signal?.aborted) throw init.signal.reason;
        if (timeout.aborted) throw new RequestError('The request timed out. Check your connection and retry.');
        if (error instanceof RequestError) throw error;
        throw new RequestError('Could not reach the room. Check your connection and retry.');
    }
}

export const isCancelled = (error: unknown) => error instanceof Error && error.name === 'AbortError';
