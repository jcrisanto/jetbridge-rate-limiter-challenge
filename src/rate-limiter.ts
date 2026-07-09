type SlidingWindowRateLimiterOptions = {
    limit?: number;
    windowSeconds?: number;
}

type AllowRequest = {
    userId: string;
    timestamp: number;
}

export class SlidingWindowRateLimiter {
    private limit: number;
    private windowSeconds: number;
    private users: Map<string, number[]> = new Map();

    constructor(options?: SlidingWindowRateLimiterOptions) {
        const limit = options?.limit ?? 100;
        const windowSeconds = options?.windowSeconds ?? 60;
        if (!Number.isInteger(limit) || limit <= 0) {
            throw new RangeError(`limit must be a positive integer, got ${limit}`);
        }
        if (!Number.isFinite(windowSeconds) || windowSeconds <= 0) {
            throw new RangeError(`windowSeconds must be a positive number, got ${windowSeconds}`);
        }
        this.limit = limit;
        this.windowSeconds = windowSeconds;
    }

    allow(request: AllowRequest): boolean {
        if (typeof request?.userId !== "string") {
            throw new TypeError(`userId must be a string ("" selects the shared global bucket), got ${request?.userId === null ? "null" : typeof request?.userId}`);
        }
        if (typeof request.timestamp !== "number" || !Number.isFinite(request.timestamp)) {
            throw new TypeError(`timestamp must be a finite number of seconds, got ${request.timestamp}`);
        }

        if (!this.users.has(request.userId)) {
            this.users.set(request.userId, [])
        }

        const window = this.users.get(request.userId)!;
        const calculatedAsNow = Math.max(request.timestamp, window[window.length - 1] ?? request.timestamp)
        const shouldBeLeft = calculatedAsNow - this.windowSeconds;

        while (window.length > 0 && window[0]! < shouldBeLeft) {
            window.shift();
        }

        if (window.length >= this.limit) {
            return false;
        }

        window.push(calculatedAsNow);
        return true;
    }

    getNewest(userId: string): number | undefined {
        const window = this.users.get(userId);
        return window?.[window.length - 1];
    }
}