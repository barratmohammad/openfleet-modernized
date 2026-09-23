## Forge Development Standards

# Forge Development Standards — Java

## Naming Conventions

- Classes & interfaces: PascalCase (`AuthService`, `UserRepository`)
- Methods & variables: camelCase (`getUserById`, `isActive`)
- Constants: UPPER_SNAKE_CASE (`MAX_RETRIES`)
- Packages: lowercase dot-separated (`com.example.auth`)
- Interfaces for DI: `I` prefix or descriptive name (`IAuthProvider` or `AuthProvider`)

## Coding Standards

- Program to interfaces, not implementations
- Use `@Override` annotation consistently
- Prefer constructor injection over field injection
- Use `Optional<T>` instead of returning null
- Checked exceptions for recoverable errors, unchecked for bugs
- Use `try-with-resources` for `AutoCloseable` resources
- Prefer `Stream` API for collection transformations

## Type Safety

Strong static typing. Use generics over raw types. Avoid unchecked casts. Use `@Nullable`/`@NonNull` annotations.

## Module Structure

Maven/Gradle project layout: `src/main/java/`, `src/test/java/`. One public class per file. Package-by-feature.

## Test Conventions

- Test file pattern: `Foo.java` -> `FooTest.java` in mirrored `src/test/java/` tree
- Framework: JUnit 5 with Mockito for mocking

## Architecture

- Follow a layered architecture: routes/controllers -> services -> repositories/data-access -> providers
- Services receive dependencies through constructor injection — no hidden coupling
- External integrations use the strategy/factory pattern — depend on interfaces, not vendor SDKs
- Repositories contain zero business logic — only CRUD and queries
- Route handlers are thin: parse request, call service, format response

## File Discipline

- Keep files focused on a single responsibility
- Split files exceeding 500 lines — extract helpers, sub-services, or utility functions
- Move shared types/interfaces to dedicated type files

## Comments

- Explain **why**, not **what** — the code already says what it does
- Add comments for non-obvious business rules, workarounds, and trade-off decisions
- No commented-out code — use git history
- No TODOs without a ticket reference

## Error Handling

- Services throw descriptive errors; routes catch and return appropriate status codes
- Never silently swallow errors without documenting why
- Error messages should include what failed and how to fix it

## Implementation Quality

- Before writing new code, READ the existing files you will modify — match their patterns, style, and conventions
- Write complete, production-ready implementations — no placeholder code, no TODOs, no mock stubs
- Follow the project's existing frameworks and libraries — do not introduce alternatives without explicit instruction
- When implementation_steps are provided in a work order, follow them in order without skipping

## Unit Testing

- Every new or modified source file MUST have a corresponding unit test file
- Tests must cover: happy path, error/edge cases, and boundary conditions
- Mock external dependencies (databases, APIs, file systems, AI providers)
- Never commit code without running tests and confirming they pass
- Aim for meaningful coverage — test behavior, not implementation details

## Branching & PR Workflow

Branching, pushing, and PR timing are **user-driven**. Never pick a branch name, push, or open a PR on your own — always defer those decisions to the user.

- **Never push directly to the default branch.** Always work on a feature branch.
- **At the start of each user story — ask the user which branch to use:**
  - First inspect the repo for existing naming conventions: `git branch -r | head -20`.
  - If you are NOT already on a feature branch, ask: "Which branching convention would you like to use? I can see the repo uses `<observed patterns>`. Options: reuse one of those patterns, use `wo/<short-id>`, or give me a name of your choice."
  - If you ARE already on a feature branch from a previous user story, ask: "Continue on the existing branch `<name>` or create a new one?"
  - Only create or switch branches after the user confirms. When creating a new branch, base it off the repo's `default_branch` (from `set_project` / `list_linked_repos` — do NOT assume `main`):
    ```
    git fetch origin
    git checkout -b <user-chosen-branch> origin/<default_branch>
    ```
- **At the end of each user story — ask before committing, then follow the Forge checklist:**
  - Summarize what changed and ask: "Ready to commit the changes for `<WO-id>`?" Wait for confirmation.
  - When the user agrees, follow the Forge MCP completion loop (do not skip hooks):
    1. Call `prepare_commit` to get the commit message.
    2. Complete the pre-commit checklist (self-review, tests, AC evidence, RTM drift).
    3. Create `.forge-commit-ready` containing `ready`, then commit using the `prepare_commit` message (it includes a `[WO-]` marker).
    4. Call `comment_on_work_order` with `trigger_ai: false` (implementation summary + AC evidence).
    5. Call `update_work_order` with branch, commit SHA, files, and test results.
  - One commit per user story — never batch multiple WOs into a single commit.
- **After the commit — ask before pushing / opening a PR:**
  - Ask: "Push this branch and open a PR now, or keep working on more user stories on the same branch first?"
  - Only push and call `create_pull_request` when the user opts in. The tool returns a provider-specific `cli_command` (GitHub, GitLab, Azure DevOps, or Bitbucket) — run it, then report `pr_url` and `pr_number` back via `update_work_order`.
  - Always pass `branch_name`, `repo_url`, and `repo_name` to `create_pull_request`.
- **Never start a new user story with uncommitted changes from the previous one** — resolve or stash first, and confirm with the user.

## Forge Process Flow

- After `peek_next_work_order` or `get_next_work_order`, call `get_work_order` then present: WO heading, Goal, In/Out of scope, Files, Blockers. If the user only asked to get the next story, STOP — do not write code and do not ask to skip blockers or whether to implement.
- `get_next_work_order` is sticky across IDEs for the same user: it resumes your assigned active story instead of consuming another backlog item. Use `peek_next_work_order` for a read-only preview.
- If they asked to implement and `dependency_health` is `has_blockers`, implement the incomplete blocker first. Do not ask whether to proceed anyway. Do not ask which model to use.
- Call `get_work_order` and read the user story + RTM traceability context before writing any code. Do not start from `get_next_work_order` or a thin IDE launch prompt alone.
- The `implementation_brief` is an execution protocol for code work — not a UX mock. Visual design lives on `list_ux_references` and `get_artifact(type=ui_design)`.
- Cross-reference RTM rows to identify which PRD sections and architecture components are relevant
- Validate every acceptance criterion against your changes before committing
- Write/update unit tests for all changed files
- Run the full test suite and fix any failures
- One commit per user story — never batch multiple WOs into a single commit. When the user agrees to commit, follow the Forge checklist above. Push/PR remain the user's call.
- Never start a new user story with uncommitted changes from the previous one