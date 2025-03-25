# CLAUDE.md - Agent Instructions

## Development Commands
- `bun install` - Install dependencies
- `bun run dev` - Start development server with auto-reload
- `bun run workers` - Start worker processes
- `bun run lint` - Run ESLint
- `bun run db:init` - Initialize database schema
- `bun run queue:clean` - Clean all queues
- `bun run queue:restart` - Restart queue processing

## Code Style Guidelines
- **Files**: kebab-case for filenames
- **Types**: PascalCase for interfaces/types, placed in `src/types/`
- **Variables/Functions**: camelCase
- **Imports**: Group third-party first, then internal (using @/ aliases)
- **Error Handling**: Use try/catch with custom error classes
- **Validation**: Use zod for input validation
- **Async**: Always use async/await (not raw Promises)
- **Logging**: Use winston logger from utils/logger.ts
- **TypeScript**: Strict mode enabled, avoid `any` type

## Project Structure
- `api/routes/` - Express route handlers
- `middleware/` - Express middleware functions
- `services/` - Business logic and data access
- `workers/` - Background processing
- `utils/` - Shared utility functions
- `database/` - Database connection and schema

Follow existing patterns in the codebase for any new code or modifications.