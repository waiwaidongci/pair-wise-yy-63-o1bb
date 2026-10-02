import type { Token } from './types';

/** 沿引用链解析最终值；循环引用返回 null */
export function resolveRef(tokens: Token[], id: string, seen: Set<string> = new Set()): string | null {
  if (seen.has(id)) return null;
  const t = tokens.find((x) => x.id === id);
  if (!t) return null;
  if (!t.ref) return t.value;
  seen.add(id);
  return resolveRef(tokens, t.ref, seen);
}

/** 解析某主题下的引用值；非引用字面量原样返回 */
export function resolveThemeValue(tokens: Token[], t: Token, theme: string): string | null {
  const v = t.themes[theme];
  if (!v) return null;
  if (v.startsWith('{') && v.endsWith('}')) return resolveRef(tokens, v.slice(1, -1));
  return v;
}

/**
 * 重算单个令牌的 value（从 ref 解析）。
 * 主题保留引用串（别名记录不丢），渲染时经 resolveThemeValue 解析，
 * 因此基础令牌一变，所有语义令牌与组件别名立即反映新值。
 */
export function recalculateToken(tokens: Token[], t: Token): boolean {
  if (!t.ref) return false;
  const v = resolveRef(tokens, t.id);
  if (v !== null && t.value !== v) {
    t.value = v;
    return true;
  }
  return false;
}

function recalc(tokens: Token[], skipId?: string): string[] {
  const affected = new Set<string>();
  let guard = tokens.length + 1;
  let changed = true;
  while (changed && guard-- > 0) {
    changed = false;
    for (const t of tokens) {
      if (skipId && t.id === skipId) continue;
      if (!t.ref) continue;
      if (recalculateToken(tokens, t)) {
        affected.add(t.id);
        changed = true;
      }
    }
  }
  return [...affected];
}

/**
 * 基础令牌变化后，立即重算所有引用它的语义令牌与组件别名（未发布工作稿）。
 * 已发布版本保存在快照中，不受影响。
 */
export function recalculateDependents(tokens: Token[], changedId: string): string[] {
  return recalc(tokens, changedId);
}

export function recalculateAll(tokens: Token[]): string[] {
  return recalc(tokens);
}
