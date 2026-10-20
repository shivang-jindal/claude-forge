---
name: go-patterns
description: Idiomatic Go patterns — errors, interfaces, concurrency, and the stdlib tools that replace third-party dependencies.
---

# Go Patterns

**Errors**
- Return errors, don't panic. `panic` is for programmer bugs in `init`/`main` only.
- Wrap with context: `fmt.Errorf("load config %s: %w", path, err)`. `%w` keeps the
  chain testable with `errors.Is` / `errors.As`.
- Define sentinel errors (`var ErrNotFound = errors.New(...)`) and typed errors
  (`type ValidationError struct{...}`) when callers need to branch.
- Check every error. `_ = err` is a decision, and a bad one.

**Interfaces**
- Accept interfaces, return concrete types.
- Define the interface at the *consumer*, in the consumer's package. A package
  that defines an interface for its own return type is doing it backwards.
- Keep interfaces small: one or two methods. A 6-method interface is a struct
  wearing a hat.

**Concurrency**
- `context.Context` is the first parameter of anything that can block, and it
  is threaded all the way down. It is never stored in a struct.
- Every goroutine has an owner and a lifetime. Use `errgroup` for a group of
  tasks that must all finish, with `WithContext` for cancellation.
- Channels: the sender closes. Only one sender closes, exactly once.
- `sync.Once` for idempotent init; `sync.Map` only for genuinely write-once-read-many
  or disjoint-key workloads — a `map` + `RWMutex` is usually clearer.
- Protect shared state with a mutex or hand ownership to one goroutine. No
  "it's fine, it is atomic" without saying which atomicity.

**Zero values**
- Design types so the zero value is useful. `sync.Mutex`, `bytes.Buffer`, and
  `time.Time` are not examples; `bytes.Buffer` is.
- Initialise deliberately with constructors when that is not possible.

**Stdlib first**
- `slices` / `maps` (Go 1.21+) before hand-rolled loops.
- `errors.Join` for multiple errors; `fmt.Errorf` with multiple `%w`.
- `net/http` router (`http.ServeMux` with method patterns) before a framework.
- `log/slog` for structured logging. `context` for deadlines, `sync` for
  sharing, `time` for clocks — import these instead of a utility library.

**Testing**
- `t.Parallel()` for independent tests.
- `t.Helper()` in test helpers so failures point at the caller.
- Table-driven tests for pure logic; one behaviour per case.
- `httptest.NewServer` for HTTP handlers; `t.TempDir()` for filesystem work.
- `-race` in CI. It is not optional.
