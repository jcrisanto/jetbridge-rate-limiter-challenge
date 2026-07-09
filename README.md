# Sliding-Window Rate Limiter

A rate limiter that caps requests per user using a true sliding 60-second window. Default limit: **100 requests / 60 s**. Written in TypeScript with no runtime dependencies.

Implementation: `src/rate-limiter.ts` · Tests: `src/rate-limiter.test.ts`

```ts
import { SlidingWindowRateLimiter } from "./src/rate-limiter";

const rl = new SlidingWindowRateLimiter(); // 100 req / 60 s
rl.allow({ userId: "alice", timestamp: 12.5 }); // -> true | false; timestamps in SECONDS
```

The API takes a single request object rather than positional arguments (`allow(userId, ts)`). That is a deliberate TypeScript-idiom adaptation, which the spec explicitly permits ("adapt the names to your language's conventions"): named fields can't be swapped by accident, and the call site documents itself.

## How to run

Requires Node.js 18+.

```sh
npm install        # installs vitest + typescript (dev-only)
npm run test       # run the tests
npm run typecheck  # tsc --noEmit
```

## Data structure and why

Two levels, both in `src/rate-limiter.ts`:

1. **`Map<string, number[]>` (`users`)** — one entry per distinct `userId`. A `Map` rather than a plain object because user ids are arbitrary strings: there is no prototype-pollution hazard (`"__proto__"` as a userId is just a key), and the empty string is an ordinary key — which is exactly how the spec's shared global bucket falls out for free: every `""` request lands in the same entry, no special-casing anywhere in the code.

2. **`number[]` used as a queue (`window`)** — per user, the timestamps of *allowed* requests, oldest first. This is a "sliding window log", the only strategy that is exact at window boundaries; approximations (fixed buckets, the two-bucket "sliding window counter") would answer the spec's own example wrongly.

   Why a plain array is enough:
   - Only **allowed** requests are recorded (rejected ones consume nothing), so a log can never usefully exceed `limit` entries. Memory per user is hard-bounded — a request flood cannot grow it.
   - The log stays sorted because time never moves backward within a bucket (see the clamping decision below), so `allow` is just: `shift()` expired entries off the front, compare `length` to the limit, `push()` the new timestamp.
   - `shift()` is O(n), but n ≤ 100, so a whole `allow` call is at most a few hundred cheap operations. With a much larger limit I would switch to a ring buffer (fixed array + head index) for O(1) eviction; the interface would not change.

### The shape of `allow`: check first, mutate last

The body of `allow` is a straight pipeline where each step depends only on the ones above it:

```
validate inputs → compute "now" (clamped) → derive cutoff → evict expired → check limit → push
```

State is mutated only after the accept/reject decision is made, so "rejected requests leave no trace" is visible from the code's shape — there is simply no write on the reject path. The alternative — an optimistic push-then-undo-on-reject structure — would be equally correct but rests on invariants a reader has to prove (that the undo always removes exactly what was pushed); check-first was chosen because every step is independently verifiable.

## Behavior decisions (the two tricky lines of the example)

- **`allow(alice, 70)` → the 4th call is rejected, but `allow(alice, 71)` → true.** This forces the window to be *inclusive*: a request aged exactly 60 s still counts, and expires only when its age strictly exceeds 60 s. The code implements this as "evict timestamps `< now − 60`" — strict comparison, so an entry at exactly the cutoff survives.

- **`allow(alice, 65)` after seeing 71 (out-of-order timestamp)** → the timestamp is **clamped up to the newest one already seen for that bucket** (`Math.max(request.timestamp, window[window.length - 1] ?? request.timestamp)`), then processed normally. In the example this returns `true` and is recorded at t = 71.

  Why clamping, against the alternatives considered:
  - *Face value* — evaluating the old, emptier window as it looked at t = 65 — is a bypass: a client at its limit could replay old timestamps to sneak past it. It would also break the sorted-log invariant that makes eviction a simple shift-from-the-front.
  - *Throwing* treats the condition as caller error, but backward timestamps are routine in real systems (several front-ends with slightly skewed clocks feeding one limiter), and the resulting exception lands on a user who did nothing wrong and can fix nothing.
  - *Rejecting (`false`)* overloads the return value: `false` means "over the limit" and typically maps to HTTP 429, but a stale timestamp is a different condition — the user may have consumed none of their quota. It would also fail legitimate traffic under ordinary clock skew.
  - **Clamping** is deterministic, never *more* permissive than the honest timestamp would be, and degrades gracefully: millisecond skew behaves like honest time; a large backdate simply counts against the current window. The clamp is **per bucket**, not global — one user's fast clock does not fast-forward anyone else's window. In production I would add observability (log/metric when the clamp delta is large) to keep visibility into genuine caller bugs without failing users.

## Input handling

- `userId` must be a string. `null`, `undefined`, or any non-string **throws `TypeError`** — not `false` — as the spec requires: "invalid input" and "over the limit" are different answers and must not share one. TypeScript's types only guard compile time; the runtime check is what actually enforces this. `""` is valid and selects the shared global bucket.
- `timestamp` must be a finite number (seconds; fractions allowed). `NaN`/`Infinity`/strings throw — `NaN` in particular would otherwise poison a bucket, since every later comparison against it is `false`.
- Validation runs before the bucket is created, so an invalid call leaves no trace (a test pins this).
- The constructor rejects `limit ≤ 0`, non-integer limits, and non-positive windows with `RangeError`. This is not pedantry: a negative window would make every entry evict instantly, i.e. a rate limiter that silently limits nothing.

## Behavior at ~10,000 active users, and long-running production

**Memory is O(active users × limit).** Worst case per user: an array of `limit` numbers ≈ 800 bytes at limit 100, plus ~100–150 bytes of `Map` entry / array / key overhead. For 10,000 active users that is roughly **8–10 MB** — trivial for one process. The 10,000-user test exercises isolation at this scale directly.

Known limitations, in honesty:

1. **The map never shrinks.** `allow` only ever adds buckets, so memory grows with users *ever seen*, not currently active. For long-running production I would add a periodic sweep that deletes any bucket whose newest timestamp has fallen out of the window (such a bucket can no longer influence any decision, so removal is behaviorally invisible), or bound the map with an LRU/expiring-map if sweep cost mattered. This is deliberately not implemented here — the spec asks for the analysis, and I preferred a smaller correct surface over an untested extra feature.

2. **Single process only.** Node's single-threaded execution makes each `allow` call atomic, which is what makes "many users at the same time" safe here. Behind a load balancer with N instances each enforcing 100/min independently, a user gets up to N×100/min. Fixing that means shared state (e.g. Redis — `ZADD`/`ZREMRANGEBYSCORE`/`ZCARD` in a Lua script is this exact algorithm), splitting the budget `limit / N` per instance, or accepting approximate enforcement.

## Unclear / contradictory points in the spec, and how I resolved them

1. **Window boundary semantics are unstated** — is a request exactly 60 s old inside or outside? The example answers it implicitly (t=10 must still count at t=70, must not at t=71), so I derived the inclusive `[t−60, t]` window from it and pinned it with boundary tests (`t=60` rejected after `t=0` with limit 1; `t=60.001` allowed).

2. **Timestamp unit: "seconds or milliseconds — choose and document."** Chose **seconds**, matching the example. Fractional seconds are accepted, so millisecond precision remains expressible (`60.001`).

3. **The out-of-order line is deliberately a question (`-> ?`).** Resolved by per-bucket clamping, reasoning above. Notably, *all* candidate policies return `true` on that specific example line — the differences only appear in adversarial cases (replaying old timestamps while at the limit), so the choice was made on those, not on the example.

4. **Does the `""` global bucket share the same limit value?** The spec says "one common counter" but never sizes it. Assumed the same 100/min. If it were meant as a larger service-wide cap, that would be a second limiter instance with its own limit.

5. **Do rejected requests consume capacity?** The spec's wording — `true` "consumes" the request — implies rejected ones don't, and the example is only consistent that way. Only allowed requests are recorded (this also yields the per-user memory bound). A test pins it: after five rejections, a slot that frees up is actually usable.

6. **"Reject as invalid — not `false`" for `null`/missing.** Implemented as `TypeError`, extended to any non-string `userId` and non-finite timestamps, since silently coercing those corrupts state.

7. **"Must work correctly for many users at the same time."** Interpreted as correct per-user isolation under interleaved calls in one process — JavaScript's execution model makes each synchronous `allow` atomic, so there are no data races by construction. Multi-instance concurrency is a different problem (see the production section).
