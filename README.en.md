# XeCMS

[한국어](./README.md) | [English](./README.en.md)

**A TypeScript CMS that combines the convenience of a UI with the extensibility of code.**

XeCMS is a general-purpose CMS for building applications in which multiple user spaces and
organizations share the same content model with different permissions. Start by managing content
structures and data in CMS Studio, then extend the system as needed with declarative schemas,
TypeScript APIs, Realm-based authorization, and plugins.

PostgreSQL is the official data store. Schema, migrations, REST APIs, the administrative UI, and
authorization decisions all share one model.

> The current version is **0.5.0**. The MVP feature set and full verification pipeline are complete,
> including per-Realm content access ceilings and delegated cross-Realm user administration.

## Language support

| Surface | Support status |
| --- | --- |
| Repository overview and quick start | Korean by default, with this English README available |
| Detailed `docs/` documentation | Currently available in Korean |
| CMS Studio and internal administrative UI | Korean only; UI localization is not yet supported |
| CLI, API, configuration, and schema | English technical identifiers |

This table describes the languages of the documentation and built-in administrative surfaces.
Applications define their own content languages and localization policies.

## Highlights

- **Progressive customization** — Extend only as far as needed, from the UI to canonical schemas,
  TypeScript, and plugins.
- **Complete content lifecycle** — Draft/publish, revisions, restore, soft deletion, media, and
  relations are built in.
- **Hierarchical content** — Tree-based content supports manual ordering, maximum depth, move
  validation, and inherited parent permissions.
- **Vertical and horizontal authorization** — Authority Levels express administrative hierarchy,
  while different roles at the same level remain peers.
- **Resource Scope RBAC** — Evaluate and explain field-level read and write access across sites,
  collections, and document trees.
- **Per-Realm content access ceilings** — The CMS Owner sets `Realm x Collection` entitlements;
  permissions inside a Realm cannot exceed this ceiling.
- **Separate Identity Realms** — CMS operators and content users may share a Global Identity while
  keeping memberships, roles, and scopes independent in each Realm.
- **Delegated cross-Realm user administration** — The CMS defines the maximum set of allowed
  operations, and each Realm Owner controls the actual administrators and roles within that limit.
- **Isolated authentication schemas** — An authentication schema is directly accessible only from
  its owning Realm. Other Realms must use dedicated delegated administration paths.
- **Operational runtime** — Includes a transactional outbox, lease-based workers, audit logging,
  retention, Doctor, backup/restore, and readiness probes.
- **Trusted Plugin SDK** — Provides manifests, compatibility checks, migrations, Server/Admin
  extensions, and a safe lifecycle.

## Quick start

### Requirements

- Node.js 22.22 or later
- pnpm 10 (`corepack enable`)
- PostgreSQL 16 or later (Docker Compose configuration included)

```bash
corepack enable
pnpm create xecms my-cms
cd my-cms
pnpm install
docker compose up -d --wait
pnpm migrate
pnpm dev
```

To select a starter immediately, append `--starter minimal`, `--starter blog`, or
`--starter community` to the create command. The generated `.env` contains local PostgreSQL
settings and a random session secret. Replace them with production values before deployment.

After startup, the following endpoints are available:

| Purpose | URL |
| --- | --- |
| CMS Studio | <http://127.0.0.1:3100/admin/setup> |
| REST API | <http://127.0.0.1:3100/api> |
| Liveness | <http://127.0.0.1:3100/api/live> |
| Readiness | <http://127.0.0.1:3100/api/ready> |

In a generated project, `pnpm dev` starts the API and installed Admin Studio together with
development settings. For production, replace the environment values, validate the schema, and
use `pnpm start`.

```bash
pnpm build
cp .env.production.example .env.production
# Edit the database, public origin, session secret, and media path in .env.production
XECMS_ENV_FILE=.env.production pnpm migrate
XECMS_ENV_FILE=.env.production pnpm start
```

See [Build and deployment](./docs/deployment.md) (Korean) for build artifacts, reverse proxies,
persistent data, and upgrade order.

See [Getting started](./docs/getting-started.md) (Korean) for detailed installation and the first
request.

The first visit to an empty database redirects to `/admin/setup`. Create the first Owner with a
password of at least 12 characters, then choose the Empty Project, Blog, or Community template.
Adjust optional features and collection display names before applying the first schema. If the
browser is closed midway, sign in again as the Owner to resume from the template step. No initial
account is created automatically.

## Content and authorization model

```text
XeCMS Instance
└── Workspace
    ├── Sites
    ├── System Realm ── CMS operator accounts and permissions
    ├── Content Realms ── Service users and independent permissions
    └── Collections
        └── Documents ── Revisions / Hierarchy / Media / Resource Scope
```

A Workspace is the top-level boundary managed by one XeCMS instance. Collections exist once in
the Workspace and are not duplicated per Realm. Instead, the CMS limits which Collections each
Realm may access through entitlements.

```text
Effective content access
= Realm-local Role / Binding / Scope / Constraint
∩ CMS-defined Realm x Collection Entitlement
```

An entitlement never grants permission; it only narrows the upper bound. Access is denied by
default when an entitlement is missing or cannot be evaluated.

The vertical authorization axis determines who may administer whom. Roles at the same Authority
Level are peers, so a Content Administrator and Security Administrator can have separate
responsibilities without arbitrarily managing each other's roles. Actual content access is
evaluated separately and must satisfy the Realm, Role Binding, Resource Scope, and Constraint.

CMS Studio provides `Basic`, `Standard`, and `Advanced` display modes. This personal browser
preference changes only how many menus and technical details are shown; it does not affect actual
permissions or direct URL access.

## Realms and user administration

Being a CMS operator does not automatically grant access to a Content Realm. To sign in to a
content service, an operator must receive a Membership and Role Binding in that Realm. Realm Full
Access must also be granted explicitly in the target Realm.

User administration is separated by impact:

- **Membership-scoped operations** — Assigning membership, suspending or reactivating membership,
  and changing Realm roles affect only one Realm. The Realm Owner and its internal authorization
  policy control these operations.
- **Identity-scoped operations** — Password resets, account deactivation, session revocation, and
  account edits may affect several Realms. XeCMS cross-checks every Membership of the target
  Identity using an `all` (strict) or `any` (permissive) policy.
- **Cross-Realm delegation** — The CMS Owner opens the maximum set of operations a managing Realm
  may perform in a target Realm. The Realm Owner selects actual administrators through roles and
  permissions.

Authentication schemas are exceptions to ordinary Collection entitlements:

```text
Authentication schema in its owning Realm
→ Always allowed and enforced by the server

Authentication schema from another Realm
→ Always denied and enforced by the server

Cross-Realm user administration
→ Uses dedicated user administration APIs and delegation policies,
  not direct authentication-schema access
```

Even a CMS Owner therefore cannot open another Realm's authentication ledger as ordinary content.

## Starters and CLI

The project scaffold provides the following starters:

| Starter | Purpose |
| --- | --- |
| `minimal` | Start with an empty schema in CMS Studio |
| `blog` | Posts, pages, and a category hierarchy |
| `community` | An authenticatable Members Realm and posts |

The interactive Admin setup flow is the default route for choosing a template. CLI starter options
remain available for automation and compatibility with existing projects, and `pnpm create xecms`
creates an independent project.

The primary CLI contract is:

```text
xecms dev
xecms start
xecms migrate
xecms schema validate [file]
xecms schema export [file]
xecms generate types --source file|active
xecms doctor [--json]
xecms backup create <directory>
xecms backup restore <directory> --confirm-empty
```

Migrations are forward-only. See the [Operations guide](./docs/operations.md) (Korean) for upgrades,
backup, and restore procedures. The full documentation is listed in the
[documentation index](./docs/README.md) (Korean).

## Development and verification

To develop XeCMS itself, clone the repository and prepare the local environment:

```bash
git clone https://github.com/mkjang2000/XeCMS.git
cd XeCMS
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
pnpm db:up
pnpm migrate
pnpm dev
```

In the repository, `pnpm dev` starts the API watch server and the Vite Admin development server.
The Admin URL is <http://127.0.0.1:5173/admin/setup>.

Use the fast static and unit verification commands during normal development:

```bash
pnpm check
pnpm verify:quick
```

PostgreSQL integration tests and browser E2E tests require Docker. The full release gate runs
static and unit checks, production builds, deployment tarballs, PostgreSQL regression tests,
upgrades, real backup/restore, and isolated Chromium user journeys.

```bash
pnpm exec playwright install chromium
pnpm test:database   # PostgreSQL integration tests
pnpm test:e2e        # Complete browser user journeys
pnpm verify          # Final release gate
```

See [Development and verification](./docs/development.md) (Korean) for the scope of each command
and selective execution options.

## Current scope

Version 0.5.0 is the MVP stabilization release. The following are intentionally out of scope:

- Full SaaS multi-tenancy with multiple Workspaces
- Explicit Deny rules and an arbitrary JavaScript policy language
- An untrusted plugin sandbox, marketplace, and hot reload
- Official database adapters other than PostgreSQL
- External object storage, PITR/WAL, and zero-downtime migration orchestration
- Fully productized OIDC/SAML, a plugin marketplace, and automated container registry publishing

## Documentation

Detailed documentation is currently available in Korean.

- [Documentation index](./docs/README.md)
- [Getting started](./docs/getting-started.md) · [Core concepts](./docs/concepts.md) ·
  [Authentication](./docs/authentication.md)
- [REST API](./docs/rest-api.md) · [TypeScript SDK](./docs/typescript-sdk.md) ·
  [Schema](./docs/schema.md)
- [Build and deployment](./docs/deployment.md) ·
  [Development and verification](./docs/development.md)
- [Operations guide](./docs/operations.md) · [Extensions](./docs/extending.md)
- [Contributing guide](./CONTRIBUTING.md) · [Security policy](./SECURITY.md)

## License

XeCMS is distributed under the [Apache License 2.0](./LICENSE). See
[Third-Party Notices](./THIRD_PARTY_NOTICES.md) for licenses and notices covering bundled external
components.

`create-xecms` and the required `@xecms/*` runtime packages are published to the public npm
registry. An official container image is not yet available.
