
# Take-Home Task: Rate Limiter with History

Hi! Thanks for your interest in working with us. This task is meant to check how you **think** about a problem and how you make decisions — not how many lines of code you write.

## General rules

- **Language and stack: completely up to you.** Pick whatever you're most comfortable with (TypeScript, Go, Python, Rust, Java, C#, anything). We don't judge the language choice.
- You don't need a framework or a database. A library/module that can be tested is enough.
- **You may use any tools, including AI.** We care about the result and your understanding of what you submit — in the interview we'll ask you to walk through your decisions and to make small changes live, so make sure you understand every part of your solution.
- Estimated time: **2 hours**. If it takes longer, submit what you have and describe what you didn't finish.

## The task

Implement a **rate limiter** that caps the number of requests per user. The public API of the component (adapt the names to your language's conventions):

```
allow(userId, timestamp) -> boolean
```

`allow` returns `true` if the request fits within the limit (and "consumes" it), or `false` if it should be rejected.

### Requirements

1. The limit is **100 requests per minute** using a **sliding window** (a moving 60-second window).
2. `timestamp` is passed as a number (seconds or milliseconds — choose and document which). Do not use the system clock internally — time always comes from the argument, so the behavior can be tested deterministically.
3. Handle the following `userId` cases:
   - a normal, non-empty identifier → the limit is counted separately for each user,
   - an **empty string `""`** → treat it as a single, **shared global limit** (all such requests fall into one common counter),
   - **`null` / missing value** → reject the request as invalid (throw an exception / return an error appropriate for your language — not `false`).
4. The solution must work correctly for many users at the same time.

### Example of expected behavior

Assume a limit of 3 req / 60 s (smaller, for readability of the example). Time in seconds.

```
allow("alice", 10)  -> true     # 1st request from alice
allow("alice", 10)  -> true     # 2nd
allow("alice", 70)  -> true     # 3rd
allow("alice", 70)  -> false    # 4th rejected
allow("alice", 71)  -> true     # the window has passed for requests at t=10, there is room
allow("alice", 65)  -> ?        # note: timestamp earlier than the previous one
allow("",      70)  -> true     # global counter, independent of alice
```

Think about what your code does in the last two lines, and make sure it does it deliberately.

## What to submit

Send a repository (or a zip) containing:

1. **Code** for the solution.
2. **Tests** covering at least the cases from the "Example" section and the edge cases (window boundary, different `userId` values).
3. A **README** (separate from this file) containing:
   - how to run the code and the tests,
   - **which data structure you used and why** — in reference to your code, not in generic terms,
   - **what happens with ~10,000 active users**: what is the memory complexity of your solution and what you would change if it had to run in production for a long time (e.g. cleaning up stale entries),
   - **a list of things you found unclear, contradictory, or requiring an assumption** in this specification, and how you resolved them.

We take the last point seriously — reading a specification with understanding is part of the job.

## How we evaluate

- **Correctness** on edge cases (window boundary, time ordering, `userId` variants).
- **Clarity of decisions** — whether the README explains *why*, not just *what*.
- **Awareness of limitations** — whether you know where your solution breaks.
- **Readability** of the code and tests.

We do not evaluate: language choice, "cleverness," or the number of lines.

Good luck — and don't hesitate to submit something unfinished with a good description rather than a "complete" solution you can't defend.