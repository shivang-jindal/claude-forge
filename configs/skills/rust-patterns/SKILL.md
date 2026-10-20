---
name: rust-patterns
description: Idiomatic Rust — error handling, trait design, ownership, and zero-cost abstractions that stay readable.
---

# Rust Patterns

**Errors**
- `Result<T, E>` for recoverable failure, `Option<T>` for absence. Never panic
  on user input, network data, or lock contention.
- `unwrap()` / `expect()` only where a panic is the correct outcome, with a
  message explaining *why* it cannot fail. `expect("validated above")` is a
  useful comment; `unwrap()` is not.
- Custom errors implement `std::error::Error` (usually with `thiserror`). Use
  `anyhow` for application-level error aggregation.
- `?` to propagate. `let Ok(x) = ... else { continue }` for expected failure.

**Traits**
- Traits describe capability, not implementation. `Read`, `Write`, `Iterator`.
- Generic functions take `impl Trait`; concrete structs implement `Trait`.
- Keep traits narrow. A trait with eight methods cannot be faked in a test.
- Do not add a trait with exactly one implementor and no second planned use.
  That is a premature abstraction wearing a design-pattern costume.

**Ownership**
- Borrow (`&`) over clone (`clone()`) by default; clone when the lifetime
  argument is not worth it.
- `Rc<T>` single-threaded, `Arc<T>` across threads, `Cell`/`RefCell` interior
  mutability single-threaded, `Mutex`/`RwLock` across threads.
- Do not hold a `Mutex` guard across `.await`; it serialises the executor and
  can deadlock. Use `tokio::sync::Mutex` when it must be held.
- Lifetimes are inferred; write them only when they change the API.

**Performance**
- `iter()` over `iter_mut()` unless mutating.
- `Vec::with_capacity` when the size is known.
- `bytes::Bytes` / `String` reuse in hot loops; `Cow` for mostly-borrowed data.
- Zero-copy parsing (`serde_json::from_slice`, `memchr`).
- `unsafe` is a last resort with a `// SAFETY:` comment proving the invariant.

**Testing**
- `#[test]` functions; `proptest` for property-based checks.
- `assert_eq!` with a message for domain-specific failures.
- `tokio::test` for async; `#[should_panic]` sparingly.
- `cargo clippy -- -D warnings` and `cargo fmt --check` in CI.
