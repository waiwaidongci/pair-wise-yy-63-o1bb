import type { Token, TokenCategory } from './types';

/** 草稿结构版本：v1 裸数组 / v2 无版本信封 / v3 带版本信封 */
export const CURRENT_SCHEMA_VERSION = 3;

const CATEGORY_PREFIX: Array<[string, TokenCategory]> = [
  ['color.', 'color'],
  ['font.', 'font'],
  ['spacing.', 'spacing'],
  ['radius.', 'radius'],
  ['shadow.', 'shadow'],
  ['component.', 'component']
];

/** 依据令牌 ID 前缀推断分类，避免旧草稿把圆角误判成颜色 */
export function inferCategory(id: string, fallback: TokenCategory = 'color'): TokenCategory {
  const found = CATEGORY_PREFIX.find(([prefix]) => id.startsWith(prefix));
  return found ? found[1] : fallback;
}

export function isColorValue(value: string): boolean {
  const v = value.trim();
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v)
    || /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}/i.test(v)
    || /^hsla?\(\s*\d{1,3}\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%/i.test(v);
}

export function isSizeValue(value: string): boolean {
  return /^-?\d*\.?\d+(px|rem|em|dp|sp)?$/.test(value.trim());
}

/**
 * 类型化写入校验：新类型不能把圆角当成颜色。
 * 引用值（{token.id}）始终允许，由引用完整性校验兜底。
 */
export function validateTokenWrite(token: Token, value: string): string | null {
  const v = value.trim();
  if (v.startsWith('{') && v.endsWith('}')) return null;
  if (token.category === 'color' && !isColorValue(v)) {
    return `颜色令牌 ${token.id} 不能写入非颜色值 "${value}"：圆角、间距等尺寸值不能作为颜色`;
  }
  if ((token.category === 'radius' || token.category === 'spacing') && !isSizeValue(v)) {
    return `尺寸令牌 ${token.id} 不能写入非尺寸值 "${value}"`;
  }
  return null;
}

type RawToken = Record<string, unknown>;

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/** v1 草稿：type/alias/default 等旧字段名，需要归一化 */
function normalizeV1(raw: RawToken): Token {
  const id = asString(raw.id);
  const category: TokenCategory = (raw.category as TokenCategory) ?? (raw.type as TokenCategory) ?? inferCategory(id);
  const refRaw = raw.ref ?? raw.alias ?? raw.reference;
  const value = asString(raw.value, asString(raw.default));
  const ref = typeof refRaw === 'string' ? refRaw.replace(/^\{|\}$/g, '') : undefined;
  return {
    id,
    name: asString(raw.name, id),
    category,
    value,
    ref,
    themes: (raw.themes as Token['themes']) ?? { light: value, dark: value, ops: value, contrast: value },
    usage: typeof raw.usage === 'number' ? raw.usage : 0,
    status: (raw.status as Token['status']) ?? 'proposed',
    description: asString(raw.description)
  };
}

/** v2 草稿：信封已具雏形但缺分类/别名兜底 */
function normalizeV2(raw: RawToken): Token {
  const id = asString(raw.id);
  const value = asString(raw.value);
  const ref = typeof raw.ref === 'string'
    ? raw.ref.replace(/^\{|\}$/g, '')
    : (value.startsWith('{') ? value.slice(1, -1) : undefined);
  return {
    id,
    name: asString(raw.name, id),
    category: (raw.category as TokenCategory) ?? inferCategory(id),
    value,
    ref,
    themes: (raw.themes as Token['themes']) ?? { light: value, dark: value, ops: value, contrast: value },
    usage: typeof raw.usage === 'number' ? raw.usage : 0,
    status: (raw.status as Token['status']) ?? 'proposed',
    description: asString(raw.description)
  };
}

export type MigratedEnvelope = {
  fromVersion: number;
  schemaVersion: number;
  tokens: Token[];
  changes: any[];
  conflicts: any[];
  snapshots: any[];
  queue: any[];
  batches: any[];
  meta: Record<string, any>;
};

/**
 * 旧草稿兼容读取：
 * - v1（裸数组、type/alias 旧字段）→ 归一化
 * - v2（无版本信封）→ 补全分类、别名与主题
 * - v3（带版本信封）→ 原样保留
 * 颜色、尺寸、别名记录一律不丢。
 */
export function migrateEnvelope(raw: unknown): MigratedEnvelope {
  let version: number;
  let rawTokens: RawToken[];
  let changes: any[] = [];
  let conflicts: any[] = [];
  let snapshots: any[] = [];
  let queue: any[] = [];
  let batches: any[] = [];
  const meta: Record<string, any> = {};

  if (Array.isArray(raw)) {
    version = 1;
    rawTokens = raw as RawToken[];
  } else if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    version = typeof r.schemaVersion === 'number' ? (r.schemaVersion as number) : 2;
    rawTokens = Array.isArray(r.tokens) ? (r.tokens as RawToken[]) : [];
    changes = Array.isArray(r.changes) ? r.changes : [];
    conflicts = Array.isArray(r.conflicts) ? r.conflicts : [];
    snapshots = Array.isArray(r.snapshots) ? r.snapshots : [];
    queue = Array.isArray(r.queue) ? r.queue : [];
    batches = Array.isArray(r.batches) ? r.batches : [];
    for (const [k, v] of Object.entries(r)) {
      if (!['schemaVersion', 'tokens', 'changes', 'conflicts', 'snapshots', 'queue', 'batches'].includes(k)) meta[k] = v;
    }
  } else {
    version = CURRENT_SCHEMA_VERSION;
    rawTokens = [];
  }

  const fromVersion = version;
  let tokens: Token[] = rawTokens.map((t) => (version < 2 ? normalizeV1(t) : normalizeV2(t)));

  if (version < 3) {
    tokens = tokens.map((t) => ({
      ...t,
      category: t.category ?? inferCategory(t.id),
      ref: t.ref ?? (t.value.startsWith('{') ? t.value.slice(1, -1) : undefined),
      themes: t.themes ?? { light: t.value, dark: t.value, ops: t.value, contrast: t.value },
      status: t.status ?? 'proposed',
      usage: t.usage ?? 0,
      description: t.description ?? ''
    }));
    version = CURRENT_SCHEMA_VERSION;
  }

  return { fromVersion, schemaVersion: CURRENT_SCHEMA_VERSION, tokens, changes, conflicts, snapshots, queue, batches, meta };
}
