import { defineStore } from 'pinia';
import {
  CURRENT_SCHEMA_VERSION,
  applyMigrationBatches,
  bakeReleaseSnapshot,
  buildMigrationPlan,
  dispatchToChannels,
  downstreamOf,
  resolveTokenValue,
  type ChannelDispatch,
  type MigrationPlan,
  type ProductChannel,
  type ReleaseSnapshot,
  type Token,
  type TokenConflict,
  type WriteBatch
} from './migration';
import { legacyBaselineSeed, legacyDraftSeed } from './legacyDraft';

export type { Token } from './migration';
export type TokenCategory = Token['category'];

export type ChangeRequest = {
  id: string;
  title: string;
  requester: string;
  scope: string;
  impact: number;
  status: '待评审' | '已接受' | '已退回';
  diff: { token: string; before: string; after: string };
};

const initialTokens: Token[] = [
  { id: 'color.base.blue.600', name: '品牌主色 600', category: 'color', kind: 'base', value: '#2864dc', themes: { light: '#2864dc', dark: '#6f96ff', ops: '#24786a', contrast: '#0b4dba' }, usage: 184, status: 'stable', description: '主操作、链接和重点状态' },
  { id: 'color.semantic.primary', name: '语义主色', category: 'color', kind: 'semantic', value: '{color.base.blue.600}', ref: 'color.base.blue.600', themes: { light: '{color.base.blue.600}', dark: '{color.base.blue.400}', ops: '{color.base.green.600}', contrast: '{color.base.blue.800}' }, usage: 126, status: 'stable', description: '组件库统一主色别名' },
  { id: 'color.base.blue.400', name: '品牌蓝 400', category: 'color', kind: 'base', value: '#6f96ff', themes: { light: '#6f96ff', dark: '#6f96ff', ops: '#58a99a', contrast: '#2878e8' }, usage: 42, status: 'stable', description: '暗色主题主色' },
  { id: 'color.base.blue.800', name: '品牌蓝 800', category: 'color', kind: 'base', value: '#0b4dba', themes: { light: '#0b4dba', dark: '#9ab9ff', ops: '#145c51', contrast: '#06358a' }, usage: 31, status: 'stable', description: '高对比主题主色' },
  { id: 'color.base.green.600', name: '运营绿 600', category: 'color', kind: 'base', value: '#24786a', themes: { light: '#24786a', dark: '#54b2a0', ops: '#24786a', contrast: '#0d5a4d' }, usage: 67, status: 'proposed', description: '运营产品品牌替换色' },
  { id: 'color.text.primary', name: '正文主色', category: 'color', kind: 'semantic', value: '#17202b', themes: { light: '#17202b', dark: '#f5f7fa', ops: '#152a25', contrast: '#000000' }, usage: 293, status: 'stable', description: '主要正文和标题' },
  { id: 'color.text.secondary', name: '正文次色', category: 'color', kind: 'semantic', value: '#667582', themes: { light: '#667582', dark: '#a8b2bd', ops: '#62766f', contrast: '#303b46' }, usage: 211, status: 'stable', description: '辅助信息和说明' },
  { id: 'color.surface.canvas', name: '页面背景', category: 'color', kind: 'semantic', value: '#f2f5f7', themes: { light: '#f2f5f7', dark: '#121821', ops: '#f1f6f4', contrast: '#ffffff' }, usage: 54, status: 'stable', description: '应用一级背景' },
  { id: 'font.family.sans', name: '无衬线字体', category: 'font', kind: 'base', value: '"Noto Sans SC", sans-serif', themes: { light: '"Noto Sans SC", sans-serif', dark: '"Noto Sans SC", sans-serif', ops: '"Noto Sans SC", sans-serif', contrast: 'system-ui, sans-serif' }, usage: 388, status: 'stable', description: '产品界面默认真体' },
  { id: 'font.size.body', name: '正文字号', category: 'font', kind: 'base', value: '14px', themes: { light: '14px', dark: '14px', ops: '14px', contrast: '16px' }, usage: 255, status: 'stable', description: '正文与表单文本' },
  { id: 'spacing.base.2', name: '基础间距 2', category: 'spacing', kind: 'base', value: '8px', themes: { light: '8px', dark: '8px', ops: '8px', contrast: '8px' }, usage: 312, status: 'stable', description: '紧凑布局基础间距' },
  { id: 'radius.control', name: '控件圆角', category: 'radius', kind: 'base', value: '6px', themes: { light: '6px', dark: '6px', ops: '4px', contrast: '4px' }, usage: 167, status: 'stable', description: '按钮、输入框和卡片' },
  { id: 'shadow.raised', name: '浮层阴影', category: 'shadow', kind: 'base', value: '0 8px 28px rgba(22,35,48,.14)', themes: { light: '0 8px 28px rgba(22,35,48,.14)', dark: '0 0 0 2px #303b46' }, usage: 36, status: 'stable', description: '菜单、弹窗和浮层' },
  { id: 'component.button.primary.bg', name: '主按钮背景', category: 'component', kind: 'component', value: '{color.semantic.primary}', ref: 'color.semantic.primary', themes: { light: '{color.semantic.primary}', dark: '{color.semantic.primary}', ops: '{color.semantic.primary}', contrast: '{color.semantic.primary}' }, usage: 98, status: 'stable', description: '主要操作按钮' },
  { id: 'component.button.primary.text', name: '主按钮文字', category: 'component', kind: 'component', value: '#ffffff', themes: { light: '#ffffff', dark: '#ffffff', ops: '#ffffff', contrast: '#ffffff' }, usage: 98, status: 'stable', description: '主要操作按钮文字' }
];

const changes: ChangeRequest[] = [
  { id: 'CR-412', title: '运营产品切换语义主色', requester: '运营设计组', scope: '4 个产品 · 238 处引用', impact: 86, status: '待评审', diff: { token: 'color.semantic.primary', before: '{color.base.blue.600}', after: '{color.base.green.600}' } },
  { id: 'CR-418', title: '高对比度正文尺寸调整', requester: '无障碍专项组', scope: '2 个产品 · 74 处引用', impact: 42, status: '待评审', diff: { token: 'font.size.body', before: '14px', after: '16px' } },
  { id: 'CR-423', title: '统一浮层圆角', requester: '组件维护组', scope: '12 个组件 · 36 处引用', impact: 28, status: '待评审', diff: { token: 'radius.control', before: '8px', after: '6px' } }
];

const themes = ['light', 'dark', 'ops', 'contrast'];

// 历史发布（冻结快照）：即使后来基础令牌变化，查看历史仍按烘焙时的字面值
const historicalRelease: ReleaseSnapshot = {
  version: 'DS 4.5.2',
  createdAt: '2026-09-24T09:20:00.000Z',
  actor: '顾清',
  themes,
  tokens: [
    { id: 'color.base.blue.600', name: '品牌主色 600', category: 'color', resolved: { light: '#2b63d8', dark: '#6f96ff', ops: '#24786a', contrast: '#0b4dba' } },
    { id: 'color.semantic.primary', name: '语义主色', category: 'color', resolved: { light: '#2b63d8', dark: '#6f96ff', ops: '#24786a', contrast: '#0b4dba' } },
    { id: 'component.button.primary.bg', name: '主按钮背景', category: 'component', resolved: { light: '#2b63d8', dark: '#6f96ff', ops: '#24786a', contrast: '#0b4dba' } },
    { id: 'radius.control', name: '控件圆角', category: 'radius', resolved: { light: '8px', dark: '8px', ops: '6px', contrast: '6px' } },
    { id: 'font.size.body', name: '正文字号', category: 'font', resolved: { light: '13px', dark: '13px', ops: '13px', contrast: '15px' } }
  ]
};

const initialChannels: ProductChannel[] = [
  { id: 'ch-core', name: '组件库通道', capacity: 2, cost: 1 },
  { id: 'ch-ops', name: '运营后台通道', capacity: 0, cost: 1 }, // 容量不足 → 排队
  { id: 'ch-mobile', name: '移动端通道', capacity: 2, cost: 1 },
  { id: 'ch-data', name: '数据平台通道', capacity: 1, cost: 1 }
];

const storageKey = 'yy63-token-governance-v2';
const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(storageKey) : null;
const saved = raw ? JSON.parse(raw) : null;

export type ProcessRecord = { at: string; message: string; kind: 'migration' | 'conflict' | 'publish' | 'channel' | 'system' };

export const useTokenStore = defineStore('tokens', {
  state: () => ({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    tokens: (saved?.tokens as Token[]) ?? initialTokens,
    changes: (saved?.changes as ChangeRequest[]) ?? changes,
    activeTheme: (saved?.activeTheme as string) ?? 'light',
    selectedTokenId: (saved?.selectedTokenId as string) ?? 'color.semantic.primary',
    search: (saved?.search as string) ?? '',
    category: (saved?.category as string) ?? '全部',
    releaseVersion: '4.6.0',
    locked: (saved?.locked as boolean) ?? false,
    lastPublished: (saved?.lastPublished as string) ?? 'DS 4.5.2',
    baseline: initialTokens.map((token) => ({ id: token.id, value: token.value })),
    // —— 草稿升级与冲突裁决 ——
    legacyDraftImported: (saved?.legacyDraftImported as boolean) ?? false,
    migrationPlan: (saved?.migrationPlan as MigrationPlan | null) ?? null,
    conflicts: (saved?.conflicts as TokenConflict[]) ?? [],
    processLog: (saved?.processLog as ProcessRecord[]) ?? [],
    // —— 级联重算时间戳（未发布语义/组件别名在基础令牌变化时立即重算）——
    recomputedAt: (saved?.recomputedAt as Record<string, string>) ?? {},
    // —— 发布快照与产品通道 ——
    releases: (saved?.releases as ReleaseSnapshot[]) ?? [historicalRelease],
    channels: (saved?.channels as ProductChannel[]) ?? initialChannels.map((c) => ({ ...c })),
    dispatches: (saved?.dispatches as ChannelDispatch[]) ?? [],
    publishBatchNo: (saved?.publishBatchNo as number) ?? 0,
    viewedReleaseVersion: (saved?.viewedReleaseVersion as string | null) ?? null
  }),
  getters: {
    selectedToken(state): Token | undefined {
      return state.tokens.find((token) => token.id === state.selectedTokenId);
    },
    tokenIndex(state): Map<string, Token> {
      return new Map(state.tokens.map((token) => [token.id, token]));
    },
    pendingConflicts(state): TokenConflict[] {
      return state.conflicts.filter((item) => item.status === 'pending');
    },
    /** 未裁决冲突涉及的令牌 ID，发布包必须排除 */
    blockedTokenIds(): Set<string> {
      return new Set(this.pendingConflicts.map((item) => item.id));
    },
    filteredTokens(state): Token[] {
      const query = state.search.toLowerCase();
      return state.tokens.filter((token) => {
        const matchesSearch = !query || token.id.toLowerCase().includes(query) || token.name.includes(state.search);
        const matchesCategory = state.category === '全部' || token.category === state.category;
        return matchesSearch && matchesCategory;
      });
    },
    dependencyEdges(state) {
      return state.tokens.filter((token) => token.ref).map((token) => ({ from: token.ref!, to: token.id }));
    },
    cycleNodes(state): string[] {
      const graph = new Map<string, string>();
      state.tokens.filter((token) => token.ref).forEach((token) => graph.set(token.id, token.ref!));
      const cycle = new Set<string>();
      graph.forEach((_, start) => {
        const path: string[] = [];
        let current: string | undefined = start;
        while (current && !path.includes(current)) {
          path.push(current);
          current = graph.get(current);
        }
        if (current && path.includes(current)) path.slice(path.indexOf(current)).forEach((id) => cycle.add(id));
      });
      return [...cycle];
    },
    invalidReferences(state) {
      const ids = new Set(state.tokens.map((token) => token.id));
      return state.tokens.filter((token) => token.ref && !ids.has(token.ref));
    },
    contrastIssues(state) {
      const text = state.tokens.find((token) => token.id === 'color.text.primary');
      const surface = state.tokens.find((token) => token.id === 'color.surface.canvas');
      const textValue = text ? resolveTokenValue(text, this.tokenIndex, state.activeTheme).value : '';
      const surfaceValue = surface ? resolveTokenValue(surface, this.tokenIndex, state.activeTheme).value : '';
      if (!textValue || !surfaceValue) return [];
      const ratio = contrastRatio(textValue, surfaceValue);
      return ratio < 4.5 ? [{ title: '正文与页面背景对比度不足', detail: `当前 ${ratio.toFixed(2)}:1，要求至少 4.5:1。` }] : [];
    },
    diffRows(state) {
      return state.tokens.filter((token) => {
        const base = state.baseline.find((item) => item.id === token.id);
        return !base || base.value !== token.value;
      }).map((token) => {
        const base = state.baseline.find((item) => item.id === token.id);
        return { id: token.id, before: base?.value ?? '新增', after: token.value, name: token.name };
      });
    },
    queuedDispatches(state): ChannelDispatch[] {
      return state.dispatches.filter((item) => item.status === 'queued');
    },
    viewedRelease(state): ReleaseSnapshot | undefined {
      const version = state.viewedReleaseVersion ?? state.releases[0]?.version;
      return state.releases.find((release) => release.version === version);
    },
    releaseReadiness(): number {
      const base = 100 - this.cycleNodes.length * 25 - this.invalidReferences.length * 20 - this.contrastIssues.length * 15 - this.pendingConflicts.length * 10;
      return Math.max(0, base);
    }
  },
  actions: {
    selectToken(id: string) {
      this.selectedTokenId = id;
      this.persist();
    },
    updateTokenValue(id: string, value: string) {
      const token = this.tokens.find((item) => item.id === id);
      if (!token) return;
      token.value = value;
      token.themes[this.activeTheme] = value;
      if (value.startsWith('{') && value.endsWith('}')) token.ref = value.slice(1, -1);
      else delete token.ref;
      // 基础令牌一变化：未发布的语义令牌与组件别名立即重算
      if (token.kind === 'base' || (!token.ref && !id.startsWith('component.'))) {
        this.recomputeDownstream(id);
      }
      this.locked = false;
      this.persist();
    },
    /** 沿引用链找出下游语义/组件别名并标记重算时间；解析值由 resolveTokenValue 即时得到 */
    recomputeDownstream(rootId: string) {
      const stamp = new Date().toISOString();
      downstreamOf(rootId, this.tokenIndex).forEach((token) => {
        if (token.kind === 'semantic' || token.kind === 'component') {
          this.recomputedAt[token.id] = stamp;
        }
      });
    },
    resolvedValue(id: string, theme?: string): string {
      const token = this.tokenIndex.get(id);
      if (!token) return '';
      return resolveTokenValue(token, this.tokenIndex, theme ?? this.activeTheme).value;
    },
    addToken(token: Token) {
      if (!this.tokens.some((item) => item.id === token.id)) this.tokens.push(token);
      this.persist();
    },
    setTheme(theme: string) {
      this.activeTheme = theme;
      this.persist();
    },
    setSearch(value: string) { this.search = value; this.persist(); },
    setCategory(value: string) { this.category = value; this.persist(); },
    acceptChange(id: string) {
      const change = this.changes.find((item) => item.id === id);
      if (!change) return;
      const token = this.tokens.find((item) => item.id === change.diff.token);
      if (token) this.updateTokenValue(token.id, change.diff.after);
      change.status = '已接受';
      this.persist();
    },
    rejectChange(id: string) {
      const change = this.changes.find((item) => item.id === id);
      if (change) change.status = '已退回';
      this.persist();
    },
    rollback() {
      this.baseline.forEach((base) => {
        const token = this.tokens.find((item) => item.id === base.id);
        if (token) token.value = base.value;
      });
      this.persist();
    },

    // —— 草稿升级（模式迁移）——
    /**
     * 导入并迁移旧稿。
     * @param failBatchIndex 模拟第 N 批写入失败（按原批次恢复）；缺省全部成功
     */
    importLegacyDraft(draft = legacyDraftSeed, failBatchIndex?: number) {
      const baseline = Object.entries(legacyBaselineSeed).map(([id, value]) => ({ id, value }));
      const plan = buildMigrationPlan(draft, this.tokens, baseline);

      // 重复提交同一草稿：若计划批次均已应用，只补处理记录，不重复落库
      const alreadyApplied = this.migrationPlan?.batches.every((b) => b.status === 'applied' || b.status === 'recorded');
      if (this.legacyDraftImported && alreadyApplied && plan.source === this.migrationPlan?.source) {
        plan.batches.forEach((b) => { b.status = 'recorded'; b.attempts = 1; });
        this.migrationPlan = plan;
        this.appendLog('migration', `重复提交「${plan.source}」：命中幂等，仅补处理记录，未重复写入`);
        this.persist();
        return plan;
      }

      const outcome = applyMigrationBatches(
        plan,
        (incoming) => this.upsertToken(incoming),
        (id) => this.tokenIndex.get(id),
        (batch) => failBatchIndex === batch.index
      );

      plan.conflicts.forEach((conflict) => {
        if (!this.conflicts.some((item) => item.id === conflict.id)) this.conflicts.push(conflict);
      });
      this.migrationPlan = plan;
      if (outcome.restored) {
        this.appendLog('migration', `批次 ${(outcome.failedBatchIndex ?? 0) + 1} 写入失败，已按原批次恢复，前序批次保持，升级中止`);
      } else if (outcome.duplicated) {
        this.appendLog('migration', '重复批次命中幂等，仅补处理记录');
      } else {
        this.legacyDraftImported = true;
        this.appendLog('migration', `旧稿迁移完成：${plan.legacyOnly.length} 条独有记录并入，${plan.conflicts.length} 条双版本改动待裁决`);
      }
      this.persist();
      return plan;
    },
    /** 迁移失败后重试剩余批次（rolled-back 批次重新写入） */
    retryMigration() {
      if (!this.migrationPlan) return;
      const plan = this.migrationPlan;
      const outcome = applyMigrationBatches(
        plan,
        (incoming) => this.upsertToken(incoming),
        (id) => this.tokenIndex.get(id)
      );
      if (outcome.restored) {
        this.appendLog('migration', `批次 ${(outcome.failedBatchIndex ?? 0) + 1} 重试仍失败，再次按原批次恢复`);
      } else {
        this.legacyDraftImported = true;
        this.appendLog('migration', `迁移重试成功，批次全部写入；${plan.conflicts.length} 条冲突待裁决`);
      }
      this.persist();
    },
    upsertToken(incoming: Token) {
      const index = this.tokens.findIndex((item) => item.id === incoming.id);
      if (index === -1) this.tokens.push({ ...incoming });
      else this.tokens.splice(index, 1, { ...this.tokens[index], ...incoming });
    },
    resolveConflict(id: string, winner: 'draft' | 'current') {
      const conflict = this.conflicts.find((item) => item.id === id);
      if (!conflict || conflict.status !== 'pending') return;
      const chosen = winner === 'draft' ? conflict.draftToken : conflict.currentToken;
      conflict.status = 'resolved';
      conflict.winner = winner;
      conflict.resolvedToken = { ...chosen };
      conflict.resolvedAt = new Date().toISOString();
      this.upsertToken({ ...chosen });
      this.recomputeDownstream(id);
      this.appendLog('conflict', `冲突 ${id} 已裁决，采用${winner === 'draft' ? '旧稿' : '当前版本'}值 ${chosen.value}`);
      this.persist();
    },

    // —— 发布：未裁决冲突不进包；快照冻结；通道容量不足排队 ——
    canPublish(): { ok: boolean; reason?: string } {
      if (this.pendingConflicts.length) return { ok: false, reason: `仍有 ${this.pendingConflicts.length} 条双版本冲突未裁决，不进入发布包` };
      if (this.cycleNodes.length) return { ok: false, reason: '存在循环依赖' };
      if (this.invalidReferences.length) return { ok: false, reason: '存在无效引用' };
      return { ok: true };
    },
    publish(actor = '顾清'): { snapshot: ReleaseSnapshot; duplicated: boolean } | null {
      const guard = this.canPublish();
      if (!guard.ok) {
        this.appendLog('publish', `发布被阻止：${guard.reason}`);
        this.persist();
        return null;
      }
      const version = `DS ${this.releaseVersion}`;
      const existing = this.releases.find((release) => release.version === version);
      if (existing) {
        // 幂等：同一版本重复提交只补处理记录，不重复生成快照、不重复派发
        this.appendLog('publish', `重复提交 ${version}：已存在发布快照，仅补处理记录，未重复发布`);
        this.persist();
        return { snapshot: existing, duplicated: true };
      }
      const snapshot = bakeReleaseSnapshot(version, this.tokens, themes, actor);
      this.releases = [snapshot, ...this.releases];
      this.lastPublished = version;
      this.locked = true;

      // 通道派发：容量不足的通道排队，其余照常，批次不中断
      this.publishBatchNo += 1;
      const dispatch = dispatchToChannels(snapshot, this.channels, { batchNo: this.publishBatchNo });
      this.dispatches = [...dispatch.reverse(), ...this.dispatches];
      const queued = dispatch.filter((item) => item.status === 'queued').map((item) => item.name).join('、');
      this.appendLog('publish', `${version} 快照已锁定：${dispatch.filter((d) => d.status === 'delivered').length} 个通道投递成功${queued ? `，${queued}容量不足已排队，其余通道与批次照常` : ''}`);
      this.persist();
      return { snapshot, duplicated: false };
    },
    /** 容量补货后继续投递排队通道（批次可继续） */
    flushQueuedChannels(boost = 2) {
      const pending = this.dispatches.filter((item) => item.status === 'queued');
      if (!pending.length) return;
      const snapshot = this.releases[0];
      const channelsById = new Map(this.channels.map((channel) => [channel.id, channel]));
      const retryChannels = pending.map((item) => channelsById.get(item.channelId)!).filter(Boolean);
      const retried = dispatchToChannels(snapshot, retryChannels, { batchNo: this.publishBatchNo, capacityBoost: boost });
      retried.forEach((result) => {
        const target = this.dispatches.find((item) => item.channelId === result.channelId && item.status === 'queued');
        if (target) {
          target.attempts += 1;
          target.status = result.status;
          target.reason = result.status === 'delivered' ? undefined : target.reason;
        }
      });
      this.appendLog('channel', `容量补货后重试：${retried.filter((d) => d.status === 'delivered').map((d) => d.name).join('、') || '无'} 投递完成，其余继续排队`);
      this.persist();
    },
    viewRelease(version: string) {
      this.viewedReleaseVersion = version;
      this.persist();
    },
    appendLog(kind: ProcessRecord['kind'], message: string) {
      this.processLog = [{ at: new Date().toISOString(), message, kind }, ...this.processLog].slice(0, 60);
    },
    persist() {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(storageKey, JSON.stringify({
          schemaVersion: this.schemaVersion,
          tokens: this.tokens,
          changes: this.changes,
          activeTheme: this.activeTheme,
          selectedTokenId: this.selectedTokenId,
          search: this.search,
          category: this.category,
          locked: this.locked,
          lastPublished: this.lastPublished,
          legacyDraftImported: this.legacyDraftImported,
          migrationPlan: this.migrationPlan,
          conflicts: this.conflicts,
          processLog: this.processLog,
          recomputedAt: this.recomputedAt,
          releases: this.releases,
          channels: this.channels,
          dispatches: this.dispatches,
          publishBatchNo: this.publishBatchNo,
          viewedReleaseVersion: this.viewedReleaseVersion
        }));
      }
    }
  }
});

function contrastRatio(a: string, b: string) {
  const luminance = (hex: string) => {
    const clean = hex.replace('#', '');
    if (clean.length !== 6) return .5;
    const channels = [0, 2, 4].map((index) => parseInt(clean.slice(index, index + 2), 16) / 255).map((value) => value <= .03928 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
  };
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05);
}
