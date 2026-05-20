# types/

## Responsibility

This folder provides **ambient TypeScript type declarations** for dependencies that lack adequate bundled types. Its sole tenant is `better-sqlite3.d.ts`, which declares the module shapes that `better-sqlite3` (a native C++ SQLite binding for Node.js) exposes at runtime.

The project uses `better-sqlite3` as its local database engine (via Drizzle ORM) but does not install `@types/better-sqlite3` as an explicit dependency. Instead of relying on possibly-mismatched third-party types, this folder supplies a **minimal, project-tailored declaration** that covers exactly the subset of the better-sqlite3 API consumed by the application: `Database`, `Statement`, `RunResult`, and generic parameter binding.

Without this file, importing `better-sqlite3` would produce a "Could not find declaration file" error under strict mode, because the native package ships no `.d.ts` of its own.

## Design

**Ambient module declaration.** The file uses `declare module "better-sqlite3"` (not a module with imports/exports) so TypeScript merges it into the global module space. This means any file in the project can `import Database from "better-sqlite3"` without a path prefix and receive these types.

**Deliberately minimal surface.** Only four types are declared:

| Type | Purpose |
|---|---|
| `BetterSqlite3Params` | Union of `unknown[]` (positional params) and `Record<string, unknown>` (named params). Models the two argument shapes SQLite prepared statements accept. |
| `RunResult` | Return shape of `.run()` — conveys `changes` count and `lastInsertRowid`. |
| `Statement<BindParameters, Result>` | Generic prepared-statement interface. Conditionally spreads tuple params so that `all(...["a","b"])` and `all({x:"a"})` both typecheck. |
| `Database` (default export) | Constructor, `.pragma()`, `.prepare()`, `.exec()`, `.close()`. |

No types are exported for `backup`, `transaction`, `function`, `aggregate`, `table`, or WAL pragmas — the project does not call them.

**Generic parameter binding trick.** The `Statement` interface uses a conditional rest-parameter pattern:
```
run(...params: BindParameters extends unknown[] ? BindParameters : [BindParameters])
```
When `BindParameters` resolves to an array (positional), the method accepts spread args. When it resolves to an object (named), the method expects a single-element tuple. This matches the runtime behavior of better-sqlite3's statement runner.

## Flow

Control flow through these types is **static (compile-time only)** — there is no runtime code in this folder.

```
[TypeScript compiler reads tsconfig.json]
        |
        v
tsconfig.json includes: "types/**/*.d.ts"
        |
        v
[Compiler loads types/better-sqlite3.d.ts as ambient declaration]
        |
        v
Every file that does "import Database from 'better-sqlite3'"
is now type-checked against the shapes declared here.
```

At runtime the actual C++ addon (`node_modules/better-sqlite3/build/Release/better_sqlite3.node`) is loaded — these `.d.ts` files are stripped and have zero runtime presence.

## Integration

**Consumed by the entire server-side persistence layer:**

```
types/better-sqlite3.d.ts      (provides ambient types)
        |
        v
server/storage/db.ts            opens Database, wraps in drizzle()
server/storage/pricing-db.ts    opens Database, wraps in drizzle()
server/storage/db-internals.ts   opens Database directly
server/services/raw-opencode.ts  opens Database directly
        |
        v
Drizzle ORM (drizzle-orm/better-sqlite3) sits atop the Database instance
for schema-driven queries in db.ts / pricing-db.ts.
The two internals/raw files bypass Drizzle and call .prepare().all() / .get()
directly, which is why Statement<Result> carries a Result generic.
```

**tsconfig.json linkage.** The compiler's `include` array lists `"types/**/*.d.ts"` explicitly (line 23), ensuring these declarations are visible regardless of which module does the import. `skipLibCheck` is `true` (line 14), so `node_modules/@types/better-sqlite3` (if present transitively) is not re-checked and cannot conflict.

This folder is intentionally small: it solves exactly one problem (type safety for the database binding) with the minimum viable declaration surface. No other ambient types are needed because every other dependency (`express`, `react`, `drizzle-orm`, `zod`) ships or pulls its own types via `@types/*` packages.
