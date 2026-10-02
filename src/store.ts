import { defineStore } from 'pinia';
import { migrateEnvelope, CURRENT_SCHEMA_VERSION, validateTokenWrite } from './domain/migrate';
import { threeWayMerge } from './domain/merge';
import { recalculateAll, recalculateDependents, resolveThemeValue } from './domain/resolve';
import { DEFAULT_CHANNELS, dispatchRelease, pumpQueue, completeItem, channelLoad } from './domain/channels';
import { applyUpgradeBatch } from './domain/batch';
import type { BatchOp, BatchRecord, Channel, QueueItem, Token, TokenConflict, TokenSnapshot } from './domain/types';

export type { Token, TokenCategory, TokenStatus } from './domain/types';

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
  { id: 'color.base.blue.600', name: '品牌主色 600', category: 'color', value: '#2864dc', themes: { light: '#2864dc', dark: '#6f96ff', ops: '#24786a', contrast: '#0b4dba' }, usage: 184, status: 'stable', description: '主操作、链接和重点状态' },
  { id: 'color.semantic.primary', name: '语义主色', category: 'color', value: '{color.base.blue.600}', ref: 'color.base.blue.600', themes: { light: '{color.base.blue.600}', dark: '{color.base.blue.400}', ops: '{color.base.green.600}', contrast: '{color.base.blue.800}' }, usage: 126, status: 'stable', description: '组件库统一主色别名' },
  { id: 'color.base.blue.400', name: '品牌蓝 400', category: 'color', value: '#6f96ff', themes: { light: '#6f96ff', dark: '#6f96ff', ops: '#58a99a', contrast: '#2878e8' }, usage: 42, status: 'stable', description: '暗色主题主色' },
  { id: 'color.base.blue.800', name: '品牌蓝 800', category: 'color', value: '#0b4dba', themes: { light: '#0b4dba', dark: '#9ab9ff', ops: '#145c51', contrast: '#06358a' }, usage: 31, status: 'stable', description: '高对比主题主色' },
  { id: 'color.base.green.600', name: '运营绿 600', category: 'color', value: '#24786a', themes: { light: '#24786a', dark: '#54b2a0', ops: '#24786a', contrast: '#0d5a4d' }, usage: 67, status: 'proposed', description: '运营产品品牌替换色' },
  { id: 'color.text.primary', name: '正文主色', category: 'color', value: '#17202b', themes: { light: '#17202b', dark: '#f5f7fa', ops: '#152a25', contrast: '#000000' }, usage: 293, status: 'stable', description: '主要正文和标题' },
  { id: 'color.text.secondary', name: '正文次色', category: 'color', value: '#667582', themes: { light: '#667582', dark: '#a8b2bd', ops: '#62766f', contrast: '#303b46' }, usage: 211, status: 'stable', description: '辅助信息和说明' },
  { id: 'color.surface.canvas', name: '页面背景', category: 'color', value: '#f2f5f7', themes: { light: '#f2f5f7', dark: '#121821', ops: '#f1f6f4', contrast: '#ffffff' }, usage: 54, status: 'stable', description: '应用一级背景' },
  { id: 'font.family.sans', name: '无衬线字体', category: 'font', value: '"Noto Sans SC", sans-serif', themes: { light: '"Noto Sans SC", sans-serif', dark: '"Noto Sans SC", sans-serif', ops: '"Noto Sans SC", sans-serif', contrast: 'system-ui, sans-serif' }, usage: 388, status: 'stable', description: '产品界面默认真体' },
  { id: 'font.size.body', name: '正文字号', category: 'font', value: '14px', themes: { light: '14px', dark: '14px', ops: '14px', contrast: '16px' }, usage: 255, status: 'stable', description: '正文与表单文本' },
  { id: 'spacing.base.2', name: '基础间距 2', category: 'spacing', value: '8px', themes: { light: '8px', dark: '8px', ops: '8px', contrast: '8px' }, usage: 312, status: 'stable', description: '紧凑布局基础间距' },
  { id: 'radius.control', name: '控件圆角', category: 'radius', value: '6px', themes: { light: '6px', dark: '6px', ops: '4px', contrast: '4px' }, usage: 167, status: 'stable', description: '按钮、输入框和卡片' },
  { id: 'shadow.raised', name: '浮层阴影', category: 'shadow', value: '0 8px 28px rgba(22,35,48,.14)', themes: { light: '0 8px 28px rgba(22,35,48,.14)', dark: '0 8px 28px rgba(0,0,0,.42)', ops: '0 8px 28px rgba(21,54,45,.14)', contrast: '0 0 0 2px #303b46' }, usage: 36, status: 'stable', description: '菜单、弹窗和浮层' },
  { id: 'component.button.primary.bg', name: '主按钮背景', category: 'component', value: '{color.semantic.primary}', ref: 'color.semantic.primary', themes: { light: '{color.semantic.primary}', dark: '{color.semantic.primary}', ops: '{color.semantic.primary}', contrast: '{color.semantic.primary}' }, usage: 98, status: 'stable', description: '主要操作按钮' },
  { id: 'component.button.primary.text', name: '主按钮文字', category: 'component', value: '#ffffff', themes: { light: '#ffffff', dark: '#ffffff', ops: '#ffffff', contrast: '#ffffff' }, usage: 98, status: 'stable', description: '主要操作按钮文字' }
];

const initialChanges: ChangeRequest[] = [
  { id: 'CR-412', title: '运营产品切换语义主色', requester: '运营设计组', scope: '4 个产品 · 238 处引用', impact: 86, status: '待评审', diff: { token: 'color.semantic.primary', before: '{color.base.blue.600}', after: '{color.base.green.600}' } },
  { id: 'CR-418', title: '高对比度正文尺寸调整', requester: '无障碍专项组', scope: '2 个产品 · 74 处引用', impact: 42, status: '待评审', diff: { token: 'font.size.body', before: '14px', after: '16px' } },
  { id: 'CR-423', title: '统一浮层圆角', requester: '组件维护组', scope: '12 个组件 · 36 处引用', impact: 28, status: '待评审', diff: { token: 'radius.control', before: '8px', after: '6px' } }
];

const storageKey = 'yy63-token-governance';

function loadState() {
  const fallback = {
    tokens: initialTokens,
    changes: initialChanges,
    conflicts: [] as TokenConflict[],
    snapshots: [] as TokenSnapshot[],
    queue: [] as QueueItem[],
    batches: [] as BatchRecord[],
    activeTheme: 'light',
    selectedTokenId: 'color.semantic.primary',
    search: '',
    category: '全部',
    locked: false,
    lastPublished: 'DS 4.5.2',
    releaseVersion: '4.6.0-rc.2',
    publishChannelIds: ['component-lib', 'ops-console', 'mobile'] as string[],
    draftNotice: '',
    viewingSnapshotVersion: null as string | null
  };
  if (typeof localStorage === 'undefined') {
    recalculateAll(fallback.tokens);
    return fallback;
  }
  const raw = localStorage.getItem(storageKey);
  if (!raw) {
    recalculateAll(fallback.tokens);
    return fallback;
  }
  try {
    const migrated = migrateEnvelope(JSON.parse(raw));
    const tokens = migrated.tokens.length ? migrated.tokens : initialTokens;
    recalculateAll(tokens);
    return {
      ...fallback,
      tokens,
      changes: migrated.changes.length ? migrated.changes : initialChanges,
      conflicts: migrated.conflicts as TokenConflict[],
      snapshots: migrated.snapshots as TokenSnapshot[],
      queue: migrated.queue as QueueItem[],
      batches: migrated.batches as BatchRecord[],
      activeTheme: (migrated.meta.activeTheme as string) ?? fallback.activeTheme,
      selectedTokenId: (migrated.meta.selectedTokenId as string) ?? fallback.selectedTokenId,
      search: (migrated.meta.search as string) ?? '',
      category: (migrated.meta.category as string) ?? '全部',
      locked: (migrated.meta.locked as boolean) ?? false,
      lastPublished: (migrated.meta.lastPublished as string) ?? fallback.lastPublished,
      releaseVersion: (migrated.meta.releaseVersion as string) ?? fallback.releaseVersion,
      publishChannelIds: (migrated.meta.publishChannelIds as string[]) ?? fallback.publishChannelIds,
      draftNotice: (migrated.meta.draftNotice as string) ?? ''
    };
  } catch {
    return fallback;
  }
}

export const useTokenStore = defineStore('tokens', {
  state: () => ({
    ...loadState(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    channels: DEFAULT_CHANNELS as Channel[],
    lastDispatch: null as { processed: number; queued: number } | null,
    baseline: initialTokens.map((token) => ({ id: token.id, value: token.value }))
  }),
  getters: {
    selectedToken(state): Token | undefined {
      return state.tokens.find((token) => token.id === state.selectedTokenId);
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
      const values = [text, surface]
        .map((token) => (token ? resolveThemeValue(state.tokens, token, state.activeTheme) : null))
        .filter(Boolean) as string[];
      if (values.length < 2) return [];
      const ratio = contrastRatio(values[0], values[1]);
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
    releaseReadiness(state): number {
      const base = 100 - this.cycleNodes.length * 25 - this.invalidReferences.length * 20 - this.contrastIssues.length * 15;
      return Math.max(0, base);
    },
    pendingConflicts(state): TokenConflict[] {
      return state.conflicts.filter((c) => c.status === '待裁决');
    },
    hasPendingConflicts(state): boolean {
      return state.conflicts.some((c) => c.status === '待裁决');
    },
    channelLoads(state) {
      return state.channels.map((channel) => ({ channel, ...channelLoad(state.queue, channel.id) }));
    },
    viewingSnapshot(state): TokenSnapshot | undefined {
      return state.snapshots.find((s) => s.version === state.viewingSnapshotVersion);
    }
  },
  actions: {
    selectToken(id: string) {
      this.selectedTokenId = id;
      this.persist();
    },
    updateTokenValue(id: string, value: string): { ok: boolean; error?: string } {
      const token = this.tokens.find((item) => item.id === id);
      if (!token) return { ok: false, error: '令牌不存在' };
      const err = validateTokenWrite(token, value);
      if (err) return { ok: false, error: err };
      token.value = value;
      token.themes[this.activeTheme] = value;
      if (value.startsWith('{') && value.endsWith('}')) token.ref = value.slice(1, -1);
      else delete token.ref;
      // 基础令牌变化，未发布的语义令牌与组件别名立即重算
      recalculateDependents(this.tokens, id);
      this.persist();
      return { ok: true };
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
      if (token) {
        const result = this.updateTokenValue(token.id, change.diff.after);
        if (!result.ok) return;
      }
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
    /**
     * 旧草稿兼容读取：迁移后与当前版本三方合并。
     * 仅旧稿改过的令牌直接采用；双方都改过的令牌保留两版待裁决，不进发布包。
     */
    importDraft(text: string): { ok: boolean; error?: string; adopted: number; conflicts: number } {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return { ok: false, error: '草稿不是有效 JSON，已保留当前工作区', adopted: 0, conflicts: 0 };
      }
      const migrated = migrateEnvelope(parsed);
      const { tokens: merged, conflicts: incoming } = threeWayMerge(initialTokens, migrated.tokens, this.tokens);
      this.tokens = merged;
      const unresolved = this.conflicts.filter((c) => c.status === '待裁决');
      this.conflicts = [...unresolved, ...incoming];
      recalculateAll(this.tokens);
      this.draftNotice = `已兼容读取旧草稿（schema v${migrated.fromVersion} → v${migrated.schemaVersion}）：保留 ${migrated.tokens.length} 个令牌的颜色、尺寸与别名引用；${incoming.length} 项双方改动待裁决`;
      this.persist();
      return { ok: true, adopted: migrated.tokens.length, conflicts: incoming.length };
    },
    adjudicateConflict(conflictId: string, choice: 'old' | 'current') {
      const conflict = this.conflicts.find((c) => c.id === conflictId);
      if (!conflict || conflict.status !== '待裁决') return;
      const version = choice === 'old' ? conflict.oldVersion : conflict.currentVersion;
      const idx = this.tokens.findIndex((t) => t.id === conflict.tokenId);
      const resolved: Token = { ...version, themes: { ...version.themes }, pending: false };
      if (idx >= 0) this.tokens[idx] = resolved;
      else this.tokens.push(resolved);
      conflict.status = choice === 'old' ? '已采用旧稿' : '已采用当前';
      recalculateAll(this.tokens);
      this.persist();
    },
    lockRelease() {
      const ready = this.cycleNodes.length === 0
        && this.invalidReferences.length === 0
        && this.contrastIssues.length === 0
        && this.changes.every((item) => item.status !== '待评审')
        && !this.hasPendingConflicts;
      if (!ready) return;
      this.locked = true;
      this.lastPublished = `DS ${this.releaseVersion}`;
      // 历史发布按旧快照查看：冻结当前工作稿为不可变快照
      this.snapshots.unshift({
        version: this.releaseVersion,
        releasedAt: new Date().toISOString(),
        actor: '设计系统维护员',
        tokens: this.tokens.map((t) => ({ ...t, themes: { ...t.themes } }))
      });
      // 按通道容量派发：容量内处理，容量外排队，其余通道照常
      const now = new Date().toISOString();
      const items = dispatchRelease(this.queue, this.channels, this.releaseVersion, `BATCH-${Date.now()}`, this.publishChannelIds, now);
      this.lastDispatch = {
        processed: items.filter((i) => i.status === 'processing').length,
        queued: items.filter((i) => i.status === 'queued').length
      };
      this.persist();
    },
    pumpChannelQueue() {
      pumpQueue(this.queue, this.channels);
      this.persist();
    },
    completeQueueItem(itemId: string) {
      completeItem(this.queue, this.channels, itemId);
      this.persist();
    },
    applyUpgradeBatchAction(batchId: string, ops: BatchOp[]): BatchRecord {
      const now = new Date().toISOString();
      const record = applyUpgradeBatch(this.tokens, batchId, ops, this.batches, now);
      if (record.status === 'applied') recalculateAll(this.tokens);
      this.persist();
      return record;
    },
    viewSnapshot(version: string) {
      this.viewingSnapshotVersion = version;
    },
    closeSnapshot() {
      this.viewingSnapshotVersion = null;
      this.persist();
    },
    persist() {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(storageKey, JSON.stringify({
        schemaVersion: CURRENT_SCHEMA_VERSION,
        tokens: this.tokens,
        changes: this.changes,
        conflicts: this.conflicts,
        snapshots: this.snapshots,
        queue: this.queue,
        batches: this.batches,
        activeTheme: this.activeTheme,
        selectedTokenId: this.selectedTokenId,
        search: this.search,
        category: this.category,
        locked: this.locked,
        lastPublished: this.lastPublished,
        releaseVersion: this.releaseVersion,
        publishChannelIds: this.publishChannelIds,
        draftNotice: this.draftNotice
      }));
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
