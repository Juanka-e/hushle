# Platform DB

Owns the shared Prisma client lifecycle and database connection configuration.

This package does not introduce repositories or hide Prisma queries. Domain and
application services may continue using Prisma directly through the exported
singleton until a concrete testing or data-source requirement justifies more
abstraction.
