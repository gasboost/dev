# @gasboost/console-runtime

Generic localhost runtime for typed, registered developer-console operations.

`@gasboost/console-runtime` provides the transport and security boundary used by `@gasboost/console`.

It intentionally contains no gasboost-, clasp-, Apps Script-, or Firebase-specific lifecycle knowledge.

## Responsibilities

The runtime provides infrastructure for:

- localhost HTTP serving
- browser transport
- registered operation execution
- structured input validation
- progress events
- log events
- result events
- session validation
- origin validation
- browser opening

gasboost-specific operations are registered by higher-level packages such as `@gasboost/console`.

## Security Boundary

The browser can execute only known registered operations.

```text
browser
   ↓
operation ID
   ↓
OperationRegistry
   ↓
Zod input validation
   ↓
registered implementation
```

An operation must be registered before it can be called.

Input must satisfy that operation's Zod schema.

The runtime does not expose:

```text
shell command endpoint
arbitrary executable endpoint
arbitrary executable + args endpoint
generic command execution
```

This is a deliberate security boundary.

## Registered Operations

Operations are identified by explicit IDs.

The runtime resolves the ID through its `OperationRegistry` and invokes the corresponding implementation only after validating structured input.

Unknown operation IDs are not treated as shell commands or executable names.

## Responsibility Boundary

```text
@gasboost/console
  ├─ gasboost project lifecycle knowledge
  ├─ Apps Script operations
  ├─ Firebase operations
  ├─ Deployment operations
  └─ Development operations

@gasboost/console-runtime
  ├─ localhost server
  ├─ browser transport
  ├─ operation registry
  ├─ input validation
  ├─ event transport
  └─ session / origin boundary
```

This separation allows the runtime to remain generic while the console owns domain-specific developer workflows.

## License

MIT
