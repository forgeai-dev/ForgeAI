## Description

Delete sites/apps from Dashboard Settings. Each site/app row now has a trash icon button with confirmation dialog. Static sites are deleted via new `DELETE /api/sites/:name` endpoint (removes workspace directory). Apps use existing `DELETE /api/apps/registry/:name`.

## Type of Change

- [ ] Bug fix
- [x] New feature
- [ ] Refactor (no functional changes)
- [ ] Documentation
- [ ] Tests
- [ ] Security

## Changes Made

- **Backend: `DELETE /api/sites/:name`** (`packages/core/src/gateway/chat-routes.ts`):
  - New endpoint to delete static sites from workspace
  - Security: validates name, prevents directory traversal
  - Removes the entire site directory recursively

- **Dashboard API** (`packages/dashboard/src/lib/api.ts`):
  - Added `deleteSite(name)` method

- **Dashboard UI** (`packages/dashboard/src/pages/Settings.tsx`):
  - Added trash icon (Trash2) button to each site/app row
  - Confirmation dialog before deletion
  - Calls `api.unregisterApp()` for apps, `api.deleteSite()` for sites
  - Auto-refreshes the list after deletion

## How to Test

1. `pnpm -r build`
2. Go to Settings → Domain & Sites section
3. Click the trash icon next to any site/app
4. Confirm the deletion dialog
5. Verify the site/app is removed from the list
6. Verify the URL no longer serves content

## Checklist

- [x] Code builds without errors (`pnpm -r build`)
- [x] Commit messages follow Conventional Commits
- [x] No secrets or API keys committed
- [x] Backward compatible
