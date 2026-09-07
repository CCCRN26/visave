# Financial architecture boundary

Phase 1 deliberately contains no financial balances or transaction engines. Future money values must use PostgreSQL `NUMERIC` or integer kobo, never floating point. Savings, loans, social-fund activity, and share-out will use an immutable append-only ledger. Corrections will be represented by reversal and replacement entries rather than edits to posted transactions.

The existing route → validation → authentication → authorization → service → repository → PostgreSQL boundary is the extension point for Phase 2 modules.
