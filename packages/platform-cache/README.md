# Platform Cache

Owns Redis/Valkey connectivity and disposable coordination primitives.

Allowed responsibilities:

- Redis client lifecycle
- dedicated publisher/subscriber connection pairs for pub/sub consumers
- health and retry behavior
- environment-specific key construction
- cache, counter, lock, and coordination contracts

Business truth must remain in MySQL. Domain-specific economy or game rules do not
belong in this package.
