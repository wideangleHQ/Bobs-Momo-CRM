# just <recipe>. Run `just` with no argument to list them.

default:
    @just --list

# Start Postgres and Redis
up:
    docker compose up -d
    docker compose ps

down:
    docker compose down

# Wipe the database volume as well. Local only.
nuke:
    docker compose down -v

# First run on a new laptop
setup:
    bun install
    docker compose up -d
    test -f apps/api/.env || sed -e "s|^JWT_ACCESS_SECRET=.*|JWT_ACCESS_SECRET=\"$(openssl rand -hex 32)\"|" \
        -e "s|^JWT_REFRESH_SECRET=.*|JWT_REFRESH_SECRET=\"$(openssl rand -hex 32)\"|" \
        .env.example > apps/api/.env
    test -f apps/web/.env.local || cp apps/web/.env.example apps/web/.env.local
    bun run shared:build
    bun run --cwd apps/api db:migrate
    bun run --cwd apps/api db:seed
    @echo "Ready. Run: just dev"

# Both apps in watch mode
dev:
    bun run dev

api:
    bun run --cwd apps/api dev

web:
    bun run --cwd apps/web dev

# Everything CI runs, in the same order
validate-all:
    bun run shared:build
    bun run lint
    bun run typecheck
    bun run test
    bun run build

test:
    bun run test

lint:
    bun run lint

# Drop, migrate, reseed. Local only, never staging or production.
db-reset:
    bun run --cwd apps/api db:reset

db-studio:
    bun run --cwd apps/api db:studio

# Read the handbook
book:
    mdbook serve book --open
