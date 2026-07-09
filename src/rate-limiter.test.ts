import { describe, expect, it } from "vitest";
import { SlidingWindowRateLimiter } from "./rate-limiter";


describe("example from the spec (3 req / 60 s)", () => {
    it("reproduces the documented sequence", () => {
        const rl = new SlidingWindowRateLimiter({ limit: 3, windowSeconds: 60 })
        expect(rl.allow({ userId: "alice", timestamp: 10 })).toBe(true); // 1st
        expect(rl.allow({ userId: "alice", timestamp: 10 })).toBe(true); // 2nd
        expect(rl.allow({ userId: "alice", timestamp: 70 })).toBe(true); // 3rd (t=10 still inside [10, 70])
        expect(rl.allow({ userId: "alice", timestamp: 70 })).toBe(false); // 4th rejected
        expect(rl.allow({ userId: "alice", timestamp: 71 })).toBe(true); // t=10 requests expired
        // t=65 is earlier than the newest seen (71): clamped to 71. Window holds
        // [70, 71] -> 2 of 3 slots used, so it is allowed and recorded at t=71.
        expect(rl.allow({ userId: "alice", timestamp: 65 })).toBe(true);
        expect(rl.getNewest('alice')).toBe(71)
        expect(rl.allow({ userId: "", timestamp: 70 })).toBe(true); // global bucket, independent of alice
    });
});

describe("window boundary", () => {
  it("still counts a request exactly windowSeconds old (inclusive window)", () => {
    const rl = new SlidingWindowRateLimiter({ limit: 1, windowSeconds: 60 });
     expect(rl.allow({ userId: "u", timestamp: 0 })).toBe(true);
     expect(rl.allow({ userId: "u", timestamp: 60 })).toBe(false);
     expect(rl.allow({ userId: "u", timestamp: 60.001 })).toBe(true);

    // expect(rl.allow("u", 0)).toBe(true);
    // expect(rl.allow("u", 60)).toBe(false); // age == 60 -> still inside
    // expect(rl.allow("u", 60.001)).toBe(true); // age > 60 -> expired
  });

  it("frees exactly the expired slots, not the whole window", () => {
    const rl = new SlidingWindowRateLimiter({ limit: 3, windowSeconds: 60 });

    expect(rl.allow({ userId: "u", timestamp: 0 })).toBe(true);
    expect(rl.allow({ userId: "u", timestamp: 30 })).toBe(true);
    expect(rl.allow({ userId: "u", timestamp: 59 })).toBe(true);
    expect(rl.allow({ userId: "u", timestamp: 59 })).toBe(false);
    expect(rl.allow({ userId: "u", timestamp: 61 })).toBe(true);
    expect(rl.allow({ userId: "u", timestamp: 61 })).toBe(false);

    // expect(rl.allow("u", 0)).toBe(true);
    // expect(rl.allow("u", 30)).toBe(true);
    // expect(rl.allow("u", 59)).toBe(true);
    // expect(rl.allow("u", 59)).toBe(false); // full
    // expect(rl.allow("u", 61)).toBe(true); // only t=0 expired -> one slot free
    // expect(rl.allow("u", 61)).toBe(false); // [30, 59, 61] fill the window again
  });

  it("rejected requests do not consume capacity", () => {
    const rl = new SlidingWindowRateLimiter({ limit: 1, windowSeconds: 60 });
    expect(rl.allow({ userId: "u", timestamp: 0 })).toBe(true);
    for (let i = 1; i <= 5; i++) expect(rl.allow({ userId: "u", timestamp: i })).toBe(false);
    // If the rejected calls had been recorded, this would still be blocked.
    expect(rl.allow({ userId: "u", timestamp: 61 })).toBe(true);
  });
});

describe("many users", () => {
  it("keeps 10,000 users fully isolated", () => {
    const rl = new SlidingWindowRateLimiter({ limit: 2, windowSeconds: 60 });
    for (let u = 0; u < 10_000; u++) {
      const id = `user-${u}`;
      expect(rl.allow({ userId: id, timestamp: 10 })).toBe(true);
      expect(rl.allow({ userId: id, timestamp: 10 })).toBe(true);
      expect(rl.allow({ userId: id, timestamp: 10 })).toBe(false);
    }
    // expect(rl.bucketCount).toBe(10_000);
  });
});

describe("input validation", () => {
  it("throws (not false) on null, undefined and non-string ids", () => {
    const rl = new SlidingWindowRateLimiter({ limit: 3, windowSeconds: 60 });
    expect(() => rl.allow({ userId: null as never, timestamp: 10 })).toThrow(TypeError);
    expect(() => rl.allow({ userId: undefined as never, timestamp: 10 })).toThrow(TypeError);
    expect(() => rl.allow({ userId: 42 as never, timestamp: 10 })).toThrow(TypeError);
    expect(() => rl.allow(undefined as never)).toThrow(TypeError);
  });

  it("throws on invalid timestamps", () => {
    const rl = new SlidingWindowRateLimiter({ limit: 3, windowSeconds: 60 });
    expect(() => rl.allow({ userId: "u", timestamp: NaN })).toThrow(TypeError);
    expect(() => rl.allow({ userId: "u", timestamp: Infinity })).toThrow(TypeError);
    expect(() => rl.allow({ userId: "u", timestamp: "10" as never })).toThrow(TypeError);
  });

  it("does not create a bucket for a rejected invalid call", () => {
    const rl = new SlidingWindowRateLimiter({ limit: 3, windowSeconds: 60 });
    expect(() => rl.allow({ userId: "u", timestamp: NaN })).toThrow(TypeError);
    expect(rl.getNewest("u")).toBeUndefined();
  });
});

describe("getNewest", () => {
  it("returns undefined for a user that was never seen", () => {
    const rl = new SlidingWindowRateLimiter({ limit: 3, windowSeconds: 60 });
    expect(rl.getNewest("nobody")).toBeUndefined();
  });
});

describe("constructor validation", () => {
  it("rejects non-positive or non-integer limits and windows", () => {
    expect(() => new SlidingWindowRateLimiter({ limit: 0 })).toThrow(RangeError);
    expect(() => new SlidingWindowRateLimiter({ limit: -1 })).toThrow(RangeError);
    expect(() => new SlidingWindowRateLimiter({ limit: 2.5 })).toThrow(RangeError);
    expect(() => new SlidingWindowRateLimiter({ windowSeconds: 0 })).toThrow(RangeError);
    expect(() => new SlidingWindowRateLimiter({ windowSeconds: -1 })).toThrow(RangeError);
  });
});