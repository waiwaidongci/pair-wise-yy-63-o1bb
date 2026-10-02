import type { Token, TokenConflict } from './types';

export function tokenChanged(a: Token, b: Token): boolean {
  return a.value !== b.value
    || a.ref !== b.ref
    || a.category !== b.category
    || JSON.stringify(a.themes) !== JSON.stringify(b.themes);
}

function clone(t: Token): Token {
  return { ...t, themes: { ...t.themes } };
}

/**
 * 三方合并：base 为共同祖先，oldDraft 为旧稿，current 为当前版本。
 * - 仅一方改动 → 采用该方
 * - 双方都改且不一致 → 保留两版，生成待裁决冲突，令牌标记 pending，不进发布包
 * - 双方改后一致 → 视为同一改动，不构成冲突
 */
export function threeWayMerge(
  base: Token[],
  oldDraft: Token[],
  current: Token[]
): { tokens: Token[]; conflicts: TokenConflict[] } {
  const baseMap = new Map(base.map((t) => [t.id, t]));
  const oldMap = new Map(oldDraft.map((t) => [t.id, t]));
  const curMap = new Map(current.map((t) => [t.id, t]));
  const ids = new Set<string>([...baseMap.keys(), ...oldMap.keys(), ...curMap.keys()]);
  const tokens: Token[] = [];
  const conflicts: TokenConflict[] = [];
  const suffix = Date.now().toString(36);

  for (const id of ids) {
    const b = baseMap.get(id);
    const o = oldMap.get(id);
    const c = curMap.get(id);

    if (o && c) {
      const oldChanged = b ? tokenChanged(b, o) : true;
      const curChanged = b ? tokenChanged(b, c) : true;
      if (oldChanged && curChanged && tokenChanged(o, c)) {
        // 双方都改且不一致 → 保留两版，待裁决
        conflicts.push({
          id: `CF-${id}-${suffix}`,
          tokenId: id,
          base: b ? clone(b) : null,
          oldVersion: clone(o),
          currentVersion: clone(c),
          status: '待裁决'
        });
        tokens.push({ ...clone(c), pending: true });
      } else if (oldChanged && !curChanged) {
        // 仅旧稿改过 → 采用旧稿
        tokens.push(clone(o));
      } else {
        // 仅当前改过，或双方改后一致 → 采用当前
        tokens.push(clone(c));
      }
    } else if (o) {
      tokens.push(clone(o));
    } else if (c) {
      tokens.push(clone(c));
    }
  }

  return { tokens, conflicts };
}
