## Description

Major agent intelligence upgrade: connects the AutoPlanner to the runtime for structured task execution, enables parallel tool execution for speed, and adds automatic reflection/verification for quality assurance.

## Type of Change

- [ ] Bug fix
- [x] New feature
- [ ] Refactor (no functional changes)
- [ ] Documentation
- [ ] Tests
- [ ] Security

## Changes Made

### 1. AutoPlanner Integration (`plan_create` / `plan_update` tools)
- New `packages/tools/src/tools/plan-tools.ts`: `plan_create` and `plan_update` tools with per-session plan store
- Agent creates structured plans before complex tasks (3+ steps)
- Plan context injected into every LLM iteration via `planContextProvider`
- Real-time plan progress tracking (step status: pending/in_progress/completed/failed/skipped)
- Auto-advances to next step on completion; max 15 steps per plan
- System prompt updated with EXECUTION PLANNING instructions

### 2. Parallel Tool Execution
- When LLM returns 2+ tool calls in one response, they execute concurrently via `Promise.allSettled`
- Single tool calls remain sequential (no overhead)
- Graceful error handling: rejected promises produce error results without crashing
- Progress shows "N tools in parallel" during concurrent execution
- Results processed in order for correct LLM message sequencing

### 3. Reflection/Verification Step
- After complex tasks (3+ iterations, 3+ tool calls), triggers one reflection pass
- LLM verifies: all steps completed? errors? files exist?
- If issues found, LLM can make corrective tool calls automatically
- `reflectionDone` flag prevents infinite reflection loops
- Emits "Verifying work quality..." step for real-time UI feedback

## Checklist

- [x] Commit messages follow Conventional Commits
- [x] No secrets or API keys committed
- [x] Full build passes (`pnpm -r build`)

### Files Changed

| File | Changes |
|------|---------|
| `packages/tools/src/tools/plan-tools.ts` | NEW: plan_create, plan_update tools + session plan store + buildPlanContext |
| `packages/tools/src/index.ts` | Export plan tools + register in createDefaultToolRegistry |
| `packages/agent/src/runtime.ts` | planContextProvider, _sessionId injection, parallel execution, reflection step, system prompt update |
| `packages/core/src/gateway/chat-routes.ts` | Import buildPlanContext, wire as planContextProvider on default agent |
