# CLAUDE.md - Development Guidelines

## Commands
- **Backend (check directory):**
  - `cd check && bun install` - Install dependencies
  - `cd check && bun run dev` - Start dev server with auto-reload
  - `cd check && bun run workers` - Start worker processes
  - `cd check && bun run lint` - Run ESLint
  - `cd check && bun test -- -t "test name"` - Run a specific test

- **Frontend (vibe directory):**
  - `cd vibe && pnpm install` - Install dependencies
  - `cd vibe && pnpm start` - Start Expo development server
  - `cd vibe && pnpm lint` - Run linter
  - `cd vibe && pnpm test -- -t "test name"` - Run a specific test

## Code Style
- **TypeScript**: Use strict mode, avoid `any` type
- **Naming**: PascalCase for components/types, camelCase for variables/functions, kebab-case for filenames
- **Imports**: Group by source (third-party first, then internal using aliases)
- **Error Handling**: Use try/catch with proper error types
- **Paths**: Use absolute paths with @/* alias in both projects
- **State Management**: Zustand in frontend, explicit state passing in backend
- **Async**: Always use async/await pattern (never raw Promises)
- **Validation**: Use Zod for input validation in both projects
- **Logging**: Use winston logger in backend