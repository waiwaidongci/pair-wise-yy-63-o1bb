// 设计令牌草稿模式迁移引擎
// 职责：
// 1. 兼容读取旧版（v1）草稿：颜色、尺寸（字号/间距/圆角/阴影）与别名记录一律保留
// 2. 修复旧稿不可信的 category 字段：依据 ID/引用/取值重新推断，圆角绝不判成颜色
// 3. 检测「同一令牌在旧稿与当前版本都改过」的冲突，保留两版待裁决，未裁决不进发布包
// 4. 分批写入：单批失败按原批次回滚恢复；重复提交只追加处理记录，不重复落库

export const CURRENT_SCHEMA_VERSION = 2;

export type TokenCategory = 'color' | 'font' | 'spacing' | 'radius' | 'shadow' | 'component';
export type SemanticKind = 'base' | 'semantic' | 'component';

export type Token = {
  id: string;
  name: string;
  category: TokenCategory;
  kind?: SemanticKind;
  value: string;
  ref?: string;
  themes: Record<string, string>;
  usage: number;
  status: 'stable' | 'deprecated' | 'proposed';
  description: string;
};

export type LegacyToken = {
  id: unknown;
  name?: unknown;
  category?: unknown;
  type?: unknown; // 旧稿可能用 type 表达分类
  group?: unknown; // 更老的草稿用 group: color/size/alias
  value: unknown;
  ref?: unknown;
  aliasTo?: unknown; // 旧稿别名字段
  themes?: unknown;
  usage?: unknown;
  status?: unknown;
  desc?: unknown;
  description?: unknown;
};

export type LegacyDraft = {
  schemaVersion?: number;
  version?: number;
  tokens: LegacyToken[];
  source?: string;
  savedAt?: string;
};

export type ConflictStatus = 'pending' | 'resolved';
export type ConflictWinner = 'draft' | 'current' | null;

export type TokenConflict = {
  id: string;
  name: string;
  category: TokenCategory;
  baselineValue: string;
  draftValue: string;
  currentValue: string;
  draftToken: Token;
  currentToken: Token;
  status: ConflictStatus;
  winner: ConflictWinner;
  resolvedToken?: Token;
  resolvedAt?: string;
};

export type BatchStatus = 'pending' | 'applied' | 'rolled-back' | 'recorded';

export type WriteBatch = {
  index: number;
  tokenIds: string[];
  status: BatchStatus;
  attempts: number;
  /** 幂等键：同一批次重复提交命中，不重复落库 */
  idempotencyKey: string;
  lastError?: string;
  appliedAt?: string;
};

export type MigrationPlan = {
  id: string;
  source: string;
  savedAt: string;
  schemaVersion: number;
  /** 规范化后的旧稿令牌（category 已修复，颜色/尺寸/别名全部保留） */
  legacyTokens: Token[];
  /** 旧稿独有：直接纳入草稿 */
  legacyOnly: Token[];
  /** 当前独有：保持不动 */
  currentOnly: Token[];
  /** 两版都改过：两版并存待裁决 */
  conflicts: TokenConflict[];
  batches: WriteBatch[];
  status: 'ready' | 'in-progress' | 'completed' | 'failed' | 'recovered';
};

export type ApplyOutcome = {
  plan: MigrationPlan;
  appliedBatchIndexes: number[];
  failedBatchIndex?: number;
  restored: boolean;
  /** 命中幂等：仅补了处理记录，没有重复写入 */
  duplicated: boolean;
};

export const BATCH_SIZE = 2;

const COLOR_RE = /^#[0-9a-f]{3,8}$|^rgba?\(|^hsla?\(|transparent|currentColor/;
const PX_RE = /^-?\d+(\.\d+)?(px|rem|em|rpx)$/;
const RADIUS_HINT = /radius|round|corner|圆角/i;
const SPACING_HINT = /spacing|space|gap|padding|margin|inset|间距/i;
const FONT_HINT = /font|text\.size|line-height|字号|字体/i;
const SHADOW_HINT = /shadow|elevation|阴影/i;
const COMPONENT_HINT = /(^|\.)(component|button|input|card|dialog|badge|checkbox|switch|link)(\.|$)/;

/** 旧稿 category/type/group 的容错别名 */
function mapLegacyCategory(raw: unknown): TokenCategory | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toLowerCase();
  if (['color', 'colour', '颜色', 'paint'].includes(v)) return 'color';
  if (['font', 'typography', '字体', '字号', 'text'].includes(v)) return 'font';
  if (['spacing', 'space', '尺寸', '间距', 'size', 'dimension'].includes(v)) return 'spacing';
  if (['radius', 'border-radius', '圆角', 'corner'].includes(v)) return 'radius';
  if (['shadow', 'elevation', '阴影'].includes(v)) return 'shadow';
  if (['component', 'alias', '别名', 'semantic'].includes(v)) return 'component';
  return null;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : value == null ? fallback : String(value);
}

function isAliasValue(value: string): boolean {
  return /^\{.+\}$/.test(value.trim());
}

function aliasTarget(value: string): string {
  return value.trim().slice(1, -1);
}

/**
 * 依据 ID / 取值 / 引用关系推断分类。
 * 关键安全约束：值为长度量（含 radius）且 ID 提示圆角时，永远不会判成 color；
 * 旧稿自报的 category 仅作参考，不允许把圆角标成颜色。
 */
export function inferCategory(id: string, value: string, ref?: string, selfReported?: unknown): TokenCategory {
  // 1. ID 前缀是最强信号
  if (id.startsWith('color.')) {
    // color.semantic.* 是语义颜色别名，分类仍为 color（颜色记录不能丢）
    return 'color';
  }
  if (id.startsWith('radius.')) return 'radius';
  if (id.startsWith('spacing.')) return 'spacing';
  if (id.startsWith('font.')) return 'font';
  if (id.startsWith('shadow.')) return 'shadow';
  if (id.startsWith('component.')) return 'component';

  // 2. ID 中的尺寸类语义提示（强于松散的组件子串：x.card.corner 是圆角而非组件）
  if (RADIUS_HINT.test(id)) return 'radius';
  if (SPACING_HINT.test(id)) return 'spacing';
  if (SHADOW_HINT.test(id)) return 'shadow';
  if (FONT_HINT.test(id)) return 'font';

  // 3. 无 component. 前缀但 ID 段含组件名
  if (COMPONENT_HINT.test(id)) return 'component';

  // 4. 引用别名：跟随目标分类；指向组件别名则归组件
  if (ref && (ref.startsWith('component.') || COMPONENT_HINT.test(ref))) return 'component';

  // 4. 取值形态：长度量。圆角/间距提示优先于颜色匹配（长度量绝不可能是颜色）
  if (PX_RE.test(value.trim()) || /^\d+(\.\d+)?$/.test(value.trim())) {
    if (RADIUS_HINT.test(id)) return 'radius';
    if (SPACING_HINT.test(id)) return 'spacing';
    if (FONT_HINT.test(id)) return 'font';
    // 旧稿自报 radius 时予以采信（值是纯长度量，不可能是颜色）
    const reported = mapLegacyCategory(selfReported);
    if (reported === 'radius') return 'radius';
    if (reported === 'font') return 'font';
    return 'spacing';
  }
  if (/^0\s+\d+px\s+\d+px/.test(value) || /rgba?\([^)]*\)\s*,?\s*\d+/.test(value) || value.includes('px rgba')) {
    return 'shadow';
  }

  // 5. 颜色值
  if (COLOR_RE.test(value.trim())) {
    // 即便旧稿自报 radius/spacing，颜色形态也优先——但长度量分支已先拦截圆角，
    // 这里不会出现「6px 被当颜色」：6px 走 PX_RE 分支。
    return 'color';
  }
  if (ref) {
    if (ref.startsWith('radius.')) return 'radius';
    if (ref.startsWith('spacing.')) return 'spacing';
    if (ref.startsWith('font.')) return 'font';
    if (ref.startsWith('shadow.')) return 'shadow';
    if (ref.startsWith('color.')) return 'color';
  }

  // 6. 回退：自报分类（已知合法），再兜底 color
  return mapLegacyCategory(selfReported) ?? 'color';
}

/** 旧稿 kind 判定：基础 / 语义 / 组件别名 */
function inferKind(id: string, ref?: string): SemanticKind {
  if (id.startsWith('component.') || (ref?.startsWith('component.')) || COMPONENT_HINT.test(id)) return 'component';
  if (ref || id.includes('.semantic.')) return 'semantic';
  return 'base';
}

/** 把单条旧稿记录规范化为当前模式令牌；记录不合法时返回 null（调用方计数，不静默吞掉） */
export function normalizeLegacyToken(raw: LegacyToken): Token | null {
  const id = asString(raw.id).trim();
  if (!id) return null;
  const value = asString(raw.value).trim();
  const explicitRef = asString(raw.ref ?? raw.aliasTo).trim();
  const ref = explicitRef || (isAliasValue(value) ? aliasTarget(value) : undefined);
  const reported = raw.category ?? raw.type ?? raw.group;
  const category = inferCategory(id, value, ref, reported);

  let themes: Record<string, string> = {};
  if (raw.themes && typeof raw.themes === 'object') {
    for (const [key, val] of Object.entries(raw.themes as Record<string, unknown>)) {
      const v = asString(val).trim();
      if (v) themes[key] = v;
    }
  }
  if (Object.keys(themes).length === 0) {
    themes = { light: value, dark: value, ops: value, contrast: value };
  }

  const rawStatus = asString(raw.status, 'stable');
  const status: Token['status'] = ['stable', 'deprecated', 'proposed'].includes(rawStatus)
    ? (rawStatus as Token['status'])
    : 'stable';

  return {
    id,
    name: asString(raw.name, id),
    category,
    kind: inferKind(id, ref),
    value,
    ...(ref ? { ref } : {}),
    themes,
    usage: typeof raw.usage === 'number' ? raw.usage : 0,
    status,
    description: asString(raw.description ?? raw.desc, '')
  };
}

export function detectSchemaVersion(raw: unknown): number {
  if (!raw || typeof raw !== 'object') return 1;
  const draft = raw as Partial<LegacyDraft>;
  if (typeof draft.schemaVersion === 'number') return draft.schemaVersion;
  if (typeof draft.version === 'number') return draft.version;
  return 1;
}

function snapshotValue(token: Token): string {
  return token.value;
}

/**
 * 生成迁移计划：
 * @param draft    解析后的旧稿
 * @param current  当前版本令牌
 * @param baseline 上一发布基线（判断「是否改过」），缺省以当前值为基线
 */
export function buildMigrationPlan(
  draft: LegacyDraft,
  current: Token[],
  baseline: { id: string; value: string }[] = []
): MigrationPlan {
  const legacyTokens = draft.tokens
    .map(normalizeLegacyToken)
    .filter((token): token is Token => token !== null);

  const currentById = new Map(current.map((token) => [token.id, token]));
  const baselineById = new Map(baseline.map((item) => [item.id, item.value]));
  const legacyById = new Map(legacyTokens.map((token) => [token.id, token]));

  const legacyOnly: Token[] = [];
  const currentOnly: Token[] = [];
  const conflicts: TokenConflict[] = [];

  legacyTokens.forEach((legacyToken) => {
    const currentToken = currentById.get(legacyToken.id);
    if (!currentToken) {
      legacyOnly.push(legacyToken);
      return;
    }
    const base = baselineById.get(legacyToken.id) ?? currentToken.value;
    const draftChanged = snapshotValue(legacyToken) !== base;
    const currentChanged = currentToken.value !== base;
    if (draftChanged && currentChanged && legacyToken.value !== currentToken.value) {
      // 同一令牌两版都改过：两版并存，等待人工裁决
      conflicts.push({
        id: legacyToken.id,
        name: currentToken.name || legacyToken.name,
        category: currentToken.category,
        baselineValue: base,
        draftValue: legacyToken.value,
        currentValue: currentToken.value,
        draftToken: legacyToken,
        currentToken,
        status: 'pending',
        winner: null
      });
    }
    // 两版都改但结果一致，或仅一版改过，不构成冲突；写入阶段以旧稿值补齐（见写入清单）。
  });

  current.forEach((token) => {
    if (!legacyById.has(token.id)) currentOnly.push(token);
  });

  // 写入清单：旧稿独有 + 无冲突的旧稿令牌（冲突令牌裁决后再写）
  const conflictIds = new Set(conflicts.map((item) => item.id));
  const writable = legacyTokens.filter((token) => !conflictIds.has(token.id));
  const batches: WriteBatch[] = [];
  for (let start = 0, index = 0; start < writable.length; start += BATCH_SIZE, index += 1) {
    const slice = writable.slice(start, start + BATCH_SIZE);
    batches.push({
      index,
      tokenIds: slice.map((token) => token.id),
      status: 'pending',
      attempts: 0,
      idempotencyKey: `batch-${draft.source ?? 'legacy'}-${index}-${slice.map((t) => t.id).join('|')}`
    });
  }

  return {
    id: `MIG-${Date.now().toString(36)}`,
    source: draft.source ?? '旧版草稿',
    savedAt: draft.savedAt ?? new Date().toISOString(),
    schemaVersion: draft.schemaVersion ?? 1,
    legacyTokens,
    legacyOnly,
    currentOnly,
    conflicts,
    batches,
    status: 'ready'
  };
}

/**
 * 分批写入迁移结果。
 * @param shouldFail 测试钩子：返回 true 时该批次写入失败
 * 单批失败：该批已写入的改动按原批次回滚，计划标记 failed/recovered，其余批次不再继续。
 * 重复提交（同一幂等键已 applied/recorded）：只追加处理记录，attempts+1，不重复落库。
 */
export function applyMigrationBatches(
  plan: MigrationPlan,
  write: (token: Token) => void,
  tokenById: (id: string) => Token | undefined,
  shouldFail: (batch: WriteBatch) => boolean = () => false,
  now: () => Date = () => new Date()
): ApplyOutcome {
  const appliedBatchIndexes: number[] = [];
  const writableById = new Map(plan.legacyTokens.map((token) => [token.id, token]));
  let duplicated = false;
  // 存在 rolled-back 批次 = 失败后的恢复重试，已应用批次保持 applied；
  // 全部批次都已完成则属于重复提交，走幂等「只补处理记录」。
  const isRecoveryRetry = plan.batches.some((batch) => batch.status === 'rolled-back');

  for (const batch of plan.batches) {
    if (batch.status === 'recorded') {
      batch.attempts += 1;
      duplicated = true;
      appliedBatchIndexes.push(batch.index);
      continue;
    }
    if (batch.status === 'applied') {
      if (!isRecoveryRetry) {
        // 重复提交：只追加处理记录，不重复落库
        batch.attempts += 1;
        batch.status = 'recorded';
        duplicated = true;
      }
      appliedBatchIndexes.push(batch.index);
      continue;
    }
    if (batch.status === 'rolled-back') {
      // 恢复后的重试：重新走写入流程
      batch.status = 'pending';
    }

    batch.attempts += 1;
    if (shouldFail(batch)) {
      // 升级写入失败：按原批次恢复（本批此前未落任何库，前序批次保持已应用）
      batch.status = 'rolled-back';
      batch.lastError = `批次 ${batch.index + 1} 写入失败，已按原批次恢复`;
      plan.status = 'failed';
      return { plan, appliedBatchIndexes, failedBatchIndex: batch.index, restored: true, duplicated };
    }

    // 记录原值，便于失败时按原批次精确恢复
    const originals = new Map<string, Token | undefined>();
    batch.tokenIds.forEach((id) => originals.set(id, tokenById(id) ? { ...tokenById(id)! } : undefined));

    let writeError: unknown = null;
    try {
      batch.tokenIds.forEach((id) => {
        const incoming = writableById.get(id);
        if (incoming) write(incoming);
      });
    } catch (error) {
      writeError = error;
    }

    if (writeError) {
      // 写入中途失败：逐条恢复本批原值
      batch.tokenIds.forEach((id) => {
        const original = originals.get(id);
        if (original) write(original);
      });
      batch.status = 'rolled-back';
      batch.lastError = writeError instanceof Error ? writeError.message : String(writeError);
      plan.status = 'recovered';
      return { plan, appliedBatchIndexes, failedBatchIndex: batch.index, restored: true, duplicated };
    }

    batch.status = 'applied';
    batch.appliedAt = now().toISOString();
    appliedBatchIndexes.push(batch.index);
  }

  plan.status = plan.conflicts.some((item) => item.status === 'pending') ? 'in-progress' : 'completed';
  return { plan, appliedBatchIndexes, restored: false, duplicated };
}

// ---------------------------------------------------------------------------
// 引用解析与级联重算
// ---------------------------------------------------------------------------

export type Resolution = { value: string; ref?: string; chain: string[]; valid: boolean };

/** 解析令牌在某主题下的最终值（沿 {ref} 链回溯到基础字面量） */
export function resolveTokenValue(
  token: Token,
  tokenById: Map<string, Token>,
  theme: string,
  seen: string[] = []
): Resolution {
  const raw = token.themes[theme] ?? token.value;
  const ref = isAliasValue(raw) ? aliasTarget(raw) : token.ref;
  if (ref) {
    if (seen.includes(token.id) || seen.includes(ref)) {
      return { value: raw, ref, chain: [...seen, token.id], valid: false };
    }
    const target = tokenById.get(ref);
    if (!target) return { value: raw, ref, chain: [...seen, token.id], valid: false };
    const nested = resolveTokenValue(target, tokenById, theme, [...seen, token.id]);
    return { ...nested, ref, chain: [token.id, ...nested.chain] };
  }
  return { value: raw, chain: [...seen, token.id], valid: true };
}

/** 受基础令牌影响的全部下游令牌（语义 + 组件别名），含传递依赖 */
export function downstreamOf(rootId: string, tokenById: Map<string, Token>): Token[] {
  const result: Token[] = [];
  const visited = new Set<string>();
  const walk = (id: string) => {
    tokenById.forEach((token) => {
      const pointsTo = (t: Token) => {
        const values = Object.values(t.themes);
        return t.ref === id || values.some((v) => isAliasValue(v) && aliasTarget(v) === id);
      };
      if (!visited.has(token.id) && pointsTo(token)) {
        visited.add(token.id);
        result.push(token);
        walk(token.id);
      }
    });
  };
  walk(rootId);
  return result;
}

// ---------------------------------------------------------------------------
// 发布快照与产品通道
// ---------------------------------------------------------------------------

export type ReleaseSnapshot = {
  version: string;
  createdAt: string;
  actor: string;
  themes: string[];
  /** 冻结的逐令牌逐主题最终值；别名已烘焙为字面量，历史查看永远按旧快照 */
  tokens: { id: string; name: string; category: TokenCategory; resolved: Record<string, string> }[];
};

export function bakeReleaseSnapshot(
  version: string,
  tokens: Token[],
  themes: string[],
  actor: string,
  now: () => Date = () => new Date()
): ReleaseSnapshot {
  const map = new Map(tokens.map((token) => [token.id, token]));
  return {
    version,
    createdAt: now().toISOString(),
    actor,
    themes,
    tokens: tokens
      .filter((token) => token.status !== 'deprecated')
      .map((token) => {
        const resolved: Record<string, string> = {};
        themes.forEach((theme) => {
          resolved[theme] = resolveTokenValue(token, map, theme).value;
        });
        return { id: token.id, name: token.name, category: token.category, resolved };
      })
  };
}

export type ChannelStatus = 'ready' | 'queued' | 'delivered' | 'blocked';

export type ProductChannel = {
  id: string;
  name: string;
  /** 当前剩余容量（份） */
  capacity: number;
  /** 每份发布占用容量 */
  cost: number;
};

export type ChannelDispatch = {
  channelId: string;
  name: string;
  status: ChannelStatus;
  reason?: string;
  attempts: number;
  batchNo: number;
};

/**
 * 通道派发：容量充足的通道照常投递；容量不足的通道进入排队，不阻断其他通道与批次。
 */
export function dispatchToChannels(
  snapshot: ReleaseSnapshot,
  channels: ProductChannel[],
  options: { batchNo: number; capacityBoost?: number }
): ChannelDispatch[] {
  return channels.map((channel) => {
    const available = channel.capacity + (options.capacityBoost ?? 0);
    if (available >= channel.cost) {
      channel.capacity = Math.max(0, channel.capacity - channel.cost);
      return { channelId: channel.id, name: channel.name, status: 'delivered', attempts: 1, batchNo: options.batchNo };
    }
    return {
      channelId: channel.id,
      name: channel.name,
      status: 'queued',
      reason: `容量不足（需 ${channel.cost}，剩 ${channel.capacity}），已排队等待补货`,
      attempts: 1,
      batchNo: options.batchNo
    };
  });
}
