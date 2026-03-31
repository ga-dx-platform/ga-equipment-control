# Merge conflict resolution guide (GitHub PR)

Use this when GitHub shows conflicts around `index.html` in the equipment API block.

## Recommended approach (fastest)

1. Update your local branch from latest remote branch.
2. Cherry-pick the conflict-safe commit that unifies both paths:
   - `60094e5` (`refactor: combine fallback and strict error paths for equipment API`)
3. Push branch again.

```bash
git checkout <your-feature-branch>
git fetch origin
git pull --rebase origin <your-feature-branch>
git cherry-pick 60094e5
git push origin <your-feature-branch>
```

## If conflict editor still appears on GitHub

In the `index.html` conflict area, keep the **combined logic** below:

- Keep `const { data, error } = await sb.from('equipment')...`
- Keep normalized map with `eq_id: r.eq_id || r.id`
- Keep fallback branch for non-legacy mode (`canUseLocalFallback()`)
- Keep strict throw path for legacy mode

### Expected final behavior

- **legacy mode**: DB errors should throw (no silent local fallback)
- **users_no_pin/demo mode**: DB read/write failures fall back to local storage

## Verification

Run these before pushing:

```bash
git diff --check
git status --short
rg -n "canUseLocalFallback\(|action === 'getEquipment'|action === 'addEquipment'|action === 'updateEquipment'|action === 'deleteEquipment'" index.html
```
