<script setup lang="ts">
import { computed, h, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useQuery, useMutation } from '@tanstack/vue-query';
import { MessagePlugin } from 'tdesign-vue-next';
import {
  AddIcon,
  ArrowRightIcon,
  CopyIcon,
  HistoryIcon,
  LockOnIcon,
  RefreshIcon,
  SearchIcon,
  SwapIcon
} from 'tdesign-icons-vue-next';
import TokenEditor from './components/TokenEditor.vue';
import { fetchTokens, submitRelease } from './api';
import { useTokenStore, type Token } from './store';
import type { BatchRecord } from './domain/types';

const AddButtonIcon = () => h(AddIcon);
const ArrowRightButtonIcon = () => h(ArrowRightIcon);
const CopyButtonIcon = () => h(CopyIcon);
const HistoryButtonIcon = () => h(HistoryIcon);
const LockButtonIcon = () => h(LockOnIcon);
const RefreshButtonIcon = () => h(RefreshIcon);
const SearchInputIcon = () => h(SearchIcon);
const SwapButtonIcon = () => h(SwapIcon);

const route = useRoute();
const router = useRouter();
const store = useTokenStore();
const { data: remote } = useQuery({ queryKey: ['tokens'], queryFn: fetchTokens });
const selectedVersion = ref(store.releaseVersion);
const batchFrom = ref('');
const batchTo = ref('');
const releaseDialog = ref(false);
const newTokenDialog = ref(false);
const newToken = ref({ id: '', name: '', category: 'color', value: '#2864dc', description: '' });
const releaseResult = ref('');
const importDialog = ref(false);
const importText = ref('');
const batchForm = ref({ batchId: '', tokenId: 'color.base.blue.600', value: '' });
const lastBatchRecord = ref<BatchRecord | null>(null);
const lastBatchDuplicate = computed(() => lastBatchRecord.value?.records.some((rec) => rec.message.includes('重复提交')) ?? false);
const snapshotDialogVisible = computed({
  get: () => !!store.viewingSnapshotVersion,
  set: (value: boolean) => { if (!value) store.closeSnapshot(); }
});

const nav = [
  { path: '/', label: '令牌工作区', icon: 'token' },
  { path: '/graph', label: '依赖与校验', icon: 'control-platform' },
  { path: '/review', label: '变更评审', icon: 'git-commit' },
  { path: '/publish', label: '主题发布', icon: 'send' }
];

const pageTitle = computed(() => nav.find((item) => item.path === route.path)?.label ?? '令牌工作区');
const selected = computed<Token | undefined>(() => store.selectedToken);
const selectedJson = computed(() => selected.value ? JSON.stringify({
  id: selected.value.id,
  name: selected.value.name,
  category: selected.value.category,
  value: selected.value.value,
  ref: selected.value.ref,
  themes: selected.value.themes,
  description: selected.value.description,
  status: selected.value.status
}, null, 2) : '{}');
const categories = computed(() => ['全部', ...new Set(store.tokens.map((token) => token.category))]);
const graphNodes = computed(() => {
  const nodes = store.tokens.filter((token) => token.ref || store.tokens.some((item) => item.ref === token.id));
  const grouped = ['color', 'font', 'spacing', 'radius', 'shadow', 'component'];
  return nodes.map((token, index) => ({
    ...token,
    x: 80 + grouped.indexOf(token.category) * 150,
    y: 70 + (index % 4) * 105
  }));
});
const graphEdges = computed(() => store.dependencyEdges.map((edge) => {
  const from = graphNodes.value.find((node) => node.id === edge.from);
  const to = graphNodes.value.find((node) => node.id === edge.to);
  return from && to ? { ...edge, from, to } : null;
}).filter(Boolean) as { from: Token & {x:number;y:number}; to: Token & {x:number;y:number} }[]);

const releaseMutation = useMutation({
  mutationFn: (payload: { version: string; accepted: string[]; actor: string }) => submitRelease(payload),
  onSuccess: (data) => {
    releaseResult.value = `发布标识 ${data.releaseId} · ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
    MessagePlugin.success('主题版本已锁定并生成发布记录');
  }
});

watch(remote, (value) => {
  if (value && !store.tokens.length) value.tokens.forEach((token) => store.addToken(token));
});

function go(path: string) {
  router.push(path);
}

function updateEditor(value: string) {
  try {
    const parsed = JSON.parse(value) as Partial<Token>;
    if (parsed.value !== undefined) {
      const result = store.updateTokenValue(store.selectedTokenId, parsed.value);
      if (!result.ok) MessagePlugin.warning(result.error ?? '写入被拒绝');
    }
  } catch {
    // Keep invalid JSON editable; validation is shown in the dependency panel.
  }
}

function addToken() {
  if (!newToken.value.id || !store.tokens.every((token) => token.id !== newToken.value.id)) {
    MessagePlugin.error('令牌 ID 不能为空且不能重复');
    return;
  }
  store.addToken({
    id: newToken.value.id,
    name: newToken.value.name || newToken.value.id,
    category: newToken.value.category as Token['category'],
    value: newToken.value.value,
    themes: { light: newToken.value.value, dark: newToken.value.value, ops: newToken.value.value, contrast: newToken.value.value },
    usage: 0,
    status: 'proposed',
    description: newToken.value.description
  });
  store.selectToken(newToken.value.id);
  newTokenDialog.value = false;
  newToken.value = { id: '', name: '', category: 'color', value: '#2864dc', description: '' };
  MessagePlugin.success('已创建候选令牌');
}

function batchReplace() {
  if (!batchFrom.value || !batchTo.value) return;
  let count = 0;
  store.tokens.forEach((token) => {
    Object.keys(token.themes).forEach((theme) => {
      if (token.themes[theme] === batchFrom.value) {
        token.themes[theme] = batchTo.value;
        count += 1;
      }
    });
    if (token.value === batchFrom.value) {
      token.value = batchTo.value;
      count += 1;
    }
  });
  store.persist();
  MessagePlugin.success(`已替换 ${count} 处引用`);
}

function publish() {
  const accepted = store.changes.filter((item) => item.status === '已接受').map((item) => item.id);
  releaseMutation.mutate({ version: selectedVersion.value, accepted, actor: '设计系统维护员' });
  store.lockRelease();
  releaseDialog.value = true;
}

function loadSampleDraft() {
  // 以当前工作稿为分支基础构造 v1 旧稿：使用 type/default/alias 等旧字段名，
  // 并在旧稿侧修改圆角与主色别名，用于演示兼容读取与双方改动裁决。
  const branch = store.tokens.map((token) => ({ ...token, themes: { ...token.themes } }));
  const patch = (id: string, value: string, theme?: string) => {
    const token = branch.find((item) => item.id === id);
    if (!token) return;
    token.value = value;
    if (theme) token.themes[theme] = value;
  };
  patch('color.base.blue.600', '#1a56db', 'light');
  patch('radius.control', '8px', 'light');
  patch('radius.control', '8px', 'dark');
  patch('color.semantic.primary', '{color.base.green.600}', 'light');
  patch('color.semantic.primary', '{color.base.green.600}', 'dark');
  const v1 = branch.map((token) => ({
    id: token.id,
    name: token.name,
    type: token.category,
    default: token.value,
    value: token.value,
    alias: token.ref ? `{${token.ref}}` : undefined,
    themes: token.themes,
    usage: token.usage,
    status: token.status,
    description: token.description
  }));
  importText.value = JSON.stringify(v1, null, 2);
}

function confirmImport() {
  const result = store.importDraft(importText.value);
  if (!result.ok) {
    MessagePlugin.error(result.error ?? '旧稿读取失败');
    return;
  }
  importDialog.value = false;
  MessagePlugin.success(`已兼容读取旧稿：采纳 ${result.adopted} 项，${result.conflicts} 项待裁决`);
}

function adjudicate(conflictId: string, choice: 'old' | 'current') {
  store.adjudicateConflict(conflictId, choice);
  MessagePlugin.success(choice === 'old' ? '已采用旧稿版本' : '已采用当前版本');
}

function pumpQueue() {
  const before = store.queue.filter((item) => item.status === 'queued').length;
  store.pumpChannelQueue();
  const after = store.queue.filter((item) => item.status === 'queued').length;
  if (before === after) MessagePlugin.info('暂无可继续的排队条目');
  else MessagePlugin.success(`已继续 ${before - after} 个排队批次条目`);
}

function completeItem(itemId: string) {
  store.completeQueueItem(itemId);
}

function submitUpgradeBatch() {
  if (!batchForm.value.batchId.trim()) {
    MessagePlugin.warning('请填写批次号');
    return;
  }
  const record = store.applyUpgradeBatchAction(batchForm.value.batchId.trim(), [
    { tokenId: batchForm.value.tokenId, value: batchForm.value.value }
  ]);
  lastBatchRecord.value = record;
  const isDuplicate = record.records.some((rec) => rec.message.includes('重复提交'));
  if (record.status === 'applied' && !isDuplicate) MessagePlugin.success(`批次 ${record.batchId} 升级完成`);
  else if (isDuplicate) MessagePlugin.info(`批次 ${record.batchId} 已存在：仅补充处理记录`);
  else MessagePlugin.error(`批次 ${record.batchId} 写入失败，已按原批次回滚`);
}

function onNewCategoryChange(category: string) {
  const defaults: Record<string, string> = {
    color: '#2864dc',
    font: '14px',
    spacing: '8px',
    radius: '6px',
    shadow: '0 8px 28px rgba(22,35,48,.14)',
    component: '{color.semantic.primary}'
  };
  newToken.value.value = defaults[category] ?? '';
}
</script>

<template>
  <t-layout class="app-shell">
    <t-header class="app-header">
      <div class="brand"><span class="brand-mark">DS</span><div><strong>设计令牌治理台</strong><small>Cross-product Token Governance</small></div></div>
      <div class="release-chip"><span>当前候选</span><strong>DS {{ store.releaseVersion }}</strong></div>
      <div class="header-spacer" />
      <t-tag theme="success" variant="light-outline">校验通过 {{ store.releaseReadiness }}%</t-tag>
      <div class="operator"><span>设计系统维护员</span><strong>顾清 · Core DS</strong></div>
    </t-header>
    <t-layout class="body-layout">
      <t-aside class="side-nav">
        <div class="workspace-card"><t-icon name="layers" /><div><span>当前工作区</span><strong>通用组件库 · 品牌主题</strong><small>15 个令牌 · 4 个主题变体</small></div></div>
        <nav><button v-for="item in nav" :key="item.path" :class="{ active: route.path === item.path }" @click="go(item.path)"><t-icon :name="item.icon" /><span>{{ item.label }}</span><t-badge v-if="item.path === '/review'" :count="store.changes.filter(c => c.status === '待评审').length" /></button></nav>
        <div class="save-state"><t-icon name="cloud-done" /><div><span>草稿已保存</span><small>{{ new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) }}</small></div></div>
      </t-aside>
      <t-content class="main-content">
        <header class="page-heading">
          <div><small>{{ store.locked ? 'RELEASE LOCKED' : 'GOVERNANCE WORKBENCH' }} / {{ pageTitle }}</small><h1>{{ pageTitle }}</h1><p>基础令牌到语义令牌的引用、差异、校验与跨主题发布。</p></div>
          <div class="heading-actions"><t-select v-model="store.activeTheme" style="width: 150px" :options="[{label:'明亮模式',value:'light'},{label:'暗色模式',value:'dark'},{label:'运营模式',value:'ops'},{label:'高对比度',value:'contrast'}]" /><t-button variant="outline" :icon="AddButtonIcon" @click="newTokenDialog = true">新建令牌</t-button><t-button theme="primary" :icon="LockButtonIcon" :disabled="store.locked || store.hasPendingConflicts" @click="publish">发布主题</t-button></div>
        </header>

        <section v-if="route.path === '/'" class="token-workspace">
          <aside class="token-tree panel">
            <div class="panel-head"><div><strong>令牌树</strong><span>{{ store.filteredTokens.length }} 个匹配项</span></div><div class="panel-head-actions"><t-button size="small" variant="text" @click="importDialog = true">导入旧稿</t-button><t-button size="small" variant="text" :icon="RefreshButtonIcon" @click="store.rollback">回滚</t-button></div></div>
            <t-input v-model="store.search" clearable placeholder="搜索令牌 ID 或名称" :prefix-icon="SearchInputIcon" />
            <div class="category-tabs"><button v-for="category in categories" :key="category" :class="{ active: store.category === category }" @click="store.setCategory(category)">{{ category }}</button></div>
            <div class="tree-list">
              <button v-for="token in store.filteredTokens" :key="token.id" :class="{ active: store.selectedTokenId === token.id, pending: token.pending }" @click="store.selectToken(token.id)">
                <i :class="token.category" />
                <div><strong>{{ token.name }}</strong><span>{{ token.id }}</span></div>
                <t-tag v-if="token.pending" size="small" theme="warning" variant="light">待裁决</t-tag>
                <t-tag v-else size="small" :theme="token.status === 'stable' ? 'success' : token.status === 'proposed' ? 'warning' : 'default'" variant="light">{{ token.status === 'stable' ? '稳定' : token.status === 'proposed' ? '候选' : '弃用' }}</t-tag>
              </button>
            </div>
          </aside>
          <section class="editor-column">
            <div v-if="store.draftNotice" class="notice-banner"><t-icon name="info-circle" /><span>{{ store.draftNotice }}</span><t-button size="small" variant="text" @click="store.draftNotice = ''">知道了</t-button></div>
            <div v-if="store.hasPendingConflicts" class="notice-banner conflict"><t-icon name="error-circle" /><span>{{ store.pendingConflicts.length }} 项双方改动待裁决，未裁决令牌不进入发布包</span><t-button size="small" variant="text" @click="go('/review')">去裁决</t-button></div>
            <div class="panel editor-panel">
              <div class="panel-head"><div><strong>Monaco 令牌编辑</strong><span>{{ selected?.id }} · {{ store.activeTheme }}</span></div><div class="editor-actions"><t-tag v-if="selected?.ref" variant="light">引用 {{ selected.ref }}</t-tag><t-button size="small" variant="outline" :icon="CopyButtonIcon">复制 JSON</t-button></div></div>
              <div class="editor-host"><TokenEditor :model-value="selectedJson" language="json" @update:model-value="updateEditor" /></div>
              <div class="editor-status"><span><i class="status-dot" />JSON 结构有效</span><span>引用关系 {{ store.dependencyEdges.length }} 条</span><span>{{ selected?.usage }} 处产品引用</span></div>
            </div>
            <div class="panel batch-panel"><div class="panel-head"><div><strong>批量替换</strong><span>跨主题替换相同原始值</span></div><SwapIcon /></div><div class="batch-form"><t-input v-model="batchFrom" placeholder="原始值，如 #2864dc" /><ArrowRightIcon /><t-input v-model="batchTo" placeholder="新值" /><t-button theme="primary" :disabled="!batchFrom || !batchTo" @click="batchReplace">执行替换</t-button></div></div>
          </section>
          <aside class="preview-column">
            <div class="panel preview-panel">
              <div class="panel-head"><div><strong>组件预览</strong><span>实时应用当前主题</span></div><t-tag theme="success" variant="light">可渲染</t-tag></div>
              <div class="component-preview" :style="{ background: selected?.category === 'color' ? selected.value : undefined }">
                <div class="mock-app"><div class="mock-sidebar"><i /><i /><i /></div><div class="mock-content"><div class="mock-title" /><div class="mock-card"><span /><span /><span /></div><div class="mock-buttons"><button>取消</button><button>确认提交</button></div></div></div>
              </div>
              <div class="token-detail"><div><span>当前值</span><strong>{{ selected?.value }}</strong></div><div><span>使用量</span><strong>{{ selected?.usage }} 处</strong></div><div><span>状态</span><strong>{{ selected?.status }}</strong></div><div><span>说明</span><strong>{{ selected?.description }}</strong></div></div>
            </div>
            <div class="panel validation-summary"><div class="panel-head"><div><strong>快速校验</strong><span>发布前门禁摘要</span></div><strong class="score">{{ store.releaseReadiness }}%</strong></div><div class="summary-row" :class="{ bad: store.cycleNodes.length }"><span>循环依赖</span><strong>{{ store.cycleNodes.length ? `${store.cycleNodes.length} 个节点` : '未发现' }}</strong></div><div class="summary-row" :class="{ bad: store.invalidReferences.length }"><span>无效引用</span><strong>{{ store.invalidReferences.length || '未发现' }}</strong></div><div class="summary-row" :class="{ bad: store.contrastIssues.length }"><span>对比度</span><strong>{{ store.contrastIssues.length ? '需调整' : '符合 AA' }}</strong></div><div class="summary-row"><span>命名冲突</span><strong>未发现</strong></div></div>
          </aside>
        </section>

        <section v-else-if="route.path === '/graph'" class="graph-page panel">
          <div class="panel-head"><div><strong>令牌依赖图</strong><span>基础令牌 → 语义令牌 → 组件别名</span></div><div class="graph-legend"><span><i class="color" />颜色</span><span><i class="component" />组件</span><span><i class="error" />错误</span></div></div>
          <div class="graph-canvas">
            <svg viewBox="0 0 820 520" preserveAspectRatio="xMidYMid meet">
              <defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="8" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="#7c8c98" /></marker></defs>
              <path v-for="edge in graphEdges" :key="`${edge.from.id}-${edge.to.id}`" :d="`M ${edge.from.x} ${edge.from.y} C ${edge.from.x + 70} ${edge.from.y}, ${edge.to.x - 70} ${edge.to.y}, ${edge.to.x} ${edge.to.y}`" fill="none" stroke="#8b9aa5" stroke-width="1.5" marker-end="url(#arrow)" />
              <g v-for="node in graphNodes" :key="node.id" :transform="`translate(${node.x},${node.y})`" class="graph-node" :class="{ cycle: store.cycleNodes.includes(node.id), selected: node.id === store.selectedTokenId }" @click="store.selectToken(node.id)">
                <rect x="-60" y="-24" width="120" height="48" rx="5" />
                <text x="0" y="-3" text-anchor="middle">{{ node.name }}</text>
                <text x="0" y="13" text-anchor="middle">{{ node.category }}</text>
              </g>
            </svg>
          </div>
          <div class="validation-strip"><div class="validation-card"><t-icon name="check-circle" theme="success" /><div><strong>循环依赖</strong><span>{{ store.cycleNodes.length ? store.cycleNodes.join(' → ') : '未发现循环引用路径' }}</span></div></div><div class="validation-card"><t-icon :name="store.invalidReferences.length ? 'error-circle' : 'check-circle'" :theme="store.invalidReferences.length ? 'danger' : 'success'" /><div><strong>引用完整性</strong><span>{{ store.invalidReferences.length ? store.invalidReferences.map(t => t.ref).join('、') : '所有引用均指向已发布令牌' }}</span></div></div><div class="validation-card"><t-icon :name="store.contrastIssues.length ? 'error-circle' : 'check-circle'" :theme="store.contrastIssues.length ? 'danger' : 'success'" /><div><strong>对比度检查</strong><span>{{ store.contrastIssues[0]?.detail ?? '正文与背景对比度 13.8:1' }}</span></div></div></div>
        </section>

        <section v-else-if="route.path === '/review'" class="review-page">
          <div class="review-summary panel"><div><span>待评审变更</span><strong>{{ store.changes.filter(c => c.status === '待评审').length }}</strong></div><div><span>已接受</span><strong>{{ store.changes.filter(c => c.status === '已接受').length }}</strong></div><div><span>已退回</span><strong>{{ store.changes.filter(c => c.status === '已退回').length }}</strong></div><div><span>待裁决冲突</span><strong>{{ store.pendingConflicts.length }}</strong></div><div><span>受影响组件</span><strong>48</strong></div></div>

          <div v-if="store.conflicts.length" class="conflict-block">
            <div class="panel-head"><div><strong>旧稿 / 当前版本冲突</strong><span>同一令牌两边都改过，保留两版待裁决；未裁决不进发布包</span></div></div>
            <div class="review-grid">
              <div v-for="conflict in store.conflicts" :key="conflict.id" class="panel change-card conflict-card">
                <div class="change-head"><div><t-tag size="small" theme="warning" variant="light">{{ conflict.status }}</t-tag><strong>{{ conflict.tokenId }}</strong><span>{{ conflict.id }}</span></div></div>
                <div class="conflict-versions">
                  <div class="version-col"><span class="version-tag old">旧稿版本</span><code>{{ conflict.oldVersion.value }}</code></div>
                  <t-icon name="swap" />
                  <div class="version-col"><span class="version-tag current">当前版本</span><code>{{ conflict.currentVersion.value }}</code></div>
                </div>
                <div v-if="conflict.base" class="conflict-base"><span>共同祖先</span><code>{{ conflict.base.value }}</code></div>
                <div class="change-actions"><t-button variant="outline" :disabled="conflict.status !== '待裁决'" @click="adjudicate(conflict.id, 'old')">采用旧稿</t-button><t-button theme="primary" :disabled="conflict.status !== '待裁决'" @click="adjudicate(conflict.id, 'current')">采用当前</t-button></div>
              </div>
            </div>
          </div>

          <div class="review-grid">
            <div v-for="change in store.changes" :key="change.id" class="panel change-card">
              <div class="change-head"><div><t-tag size="small">{{ change.id }}</t-tag><strong>{{ change.title }}</strong><span>{{ change.requester }} · {{ change.scope }}</span></div><t-tag :theme="change.status === '已接受' ? 'success' : change.status === '已退回' ? 'danger' : 'warning'" variant="light">{{ change.status }}</t-tag></div>
              <div class="diff-box"><div><span>修改前</span><code>{{ change.diff.before }}</code></div><t-icon name="arrow-right" /><div><span>修改后</span><code>{{ change.diff.after }}</code></div></div>
              <div class="impact"><span>影响评分</span><t-progress :percentage="change.impact" :theme="change.impact > 70 ? 'danger' : 'warning'" /></div>
              <div class="change-actions"><t-button variant="outline" :disabled="change.status !== '待评审'" @click="store.rejectChange(change.id)">退回并说明</t-button><t-button theme="primary" :disabled="change.status !== '待评审'" @click="store.acceptChange(change.id)">接受变更</t-button></div>
            </div>
          </div>
        </section>

        <section v-else class="publish-page">
          <div class="panel publish-main">
            <div class="panel-head"><div><strong>发布准备</strong><span>生成只读版本，支持回滚到历史基线</span></div><t-tag :theme="store.locked ? 'success' : 'warning'">{{ store.locked ? '已锁定' : '候选版本' }}</t-tag></div>
            <div class="publish-form">
              <label><span>版本号</span><t-input v-model="selectedVersion" /></label>
              <label><span>目标产品通道</span><t-select v-model="store.publishChannelIds" multiple :options="store.channels.map(c => ({ label: `${c.name}（容量 ${c.capacity}）`, value: c.id }))" /></label>
              <label><span>发布说明</span><t-textarea value="更新语义主色、统一控件圆角，并修复暗色主题正文对比度。" :autosize="{ minRows: 3 }" /></label>
            </div>
            <div class="release-checks">
              <label><t-checkbox checked /> 循环依赖检查通过</label>
              <label><t-checkbox checked /> 无效引用检查通过</label>
              <label><t-checkbox :checked="store.contrastIssues.length === 0" /> 颜色对比度符合 WCAG AA</label>
              <label><t-checkbox :checked="store.changes.every(c => c.status !== '待评审')" /> 所有变更请求已处理</label>
              <label><t-checkbox :checked="!store.hasPendingConflicts" /> 无旧稿/当前版本待裁决冲突</label>
            </div>
            <div class="publish-actions"><t-button variant="outline" @click="store.rollback">回滚全部未发布编辑</t-button><t-button theme="primary" icon="lock-on" :disabled="store.locked || store.changes.some(c => c.status === '待评审') || store.hasPendingConflicts" @click="publish">校验并锁定发布</t-button></div>
          </div>
          <aside class="publish-side">
            <div class="panel queue-panel">
              <div class="panel-head"><div><strong>产品通道队列</strong><span>容量不足进入排队，其余通道照常</span></div><t-button size="small" variant="outline" @click="pumpQueue">继续批次</t-button></div>
              <div v-for="load in store.channelLoads" :key="load.channel.id" class="channel-row">
                <div class="channel-name"><strong>{{ load.channel.name }}</strong><span>容量 {{ load.channel.capacity }}</span></div>
                <div class="channel-slots">
                  <i v-for="n in load.channel.capacity" :key="n" :class="{ busy: n <= load.processing }" />
                </div>
                <div class="channel-counts"><t-tag size="small" theme="primary" variant="light">处理中 {{ load.processing }}</t-tag><t-tag size="small" :theme="load.queued ? 'warning' : 'default'" variant="light">排队 {{ load.queued }}</t-tag></div>
              </div>
              <div v-for="item in store.queue.filter(q => q.status !== 'done')" :key="item.id" class="queue-item">
                <span class="queue-dot" :class="item.status" />
                <code>{{ item.releaseId }} · {{ store.channels.find(c => c.id === item.channelId)?.name }}</code>
                <t-tag size="small" :theme="item.status === 'processing' ? 'primary' : 'warning'" variant="light">{{ item.status === 'processing' ? '处理中' : '排队中' }}</t-tag>
                <t-button v-if="item.status === 'processing'" size="small" variant="text" @click="completeItem(item.id)">完成</t-button>
              </div>
              <p v-if="!store.queue.some(q => q.status !== 'done')" class="empty">所有通道条目均已处理。</p>
            </div>
            <div class="panel upgrade-panel">
              <div class="panel-head"><div><strong>升级批次写入</strong><span>类型校验失败按批次回滚，重复提交仅补记录</span></div></div>
              <div class="upgrade-form">
                <t-input v-model="batchForm.batchId" placeholder="批次号，如 UP-1001" />
                <t-select v-model="batchForm.tokenId" :options="store.tokens.map(t => ({ label: `${t.id}（${t.category}）`, value: t.id }))" />
                <t-input v-model="batchForm.value" placeholder="写入值，如 8px 或 #1a56db" />
                <t-button size="small" theme="primary" @click="submitUpgradeBatch">提交批次</t-button>
              </div>
              <div v-if="lastBatchRecord" class="batch-record">
                <div class="batch-record-head"><t-tag size="small" :theme="lastBatchRecord.status === 'applied' ? (lastBatchDuplicate ? 'default' : 'success') : 'danger'" variant="light">{{ lastBatchRecord.status === 'applied' ? (lastBatchDuplicate ? '重复提交' : '已应用') : '已回滚' }}</t-tag><code>{{ lastBatchRecord.batchId }}</code></div>
                <div v-for="(rec, i) in lastBatchRecord.records" :key="i" class="batch-record-line" :class="rec.level"><t-icon :name="rec.level === 'error' ? 'error-circle' : rec.level === 'warn' ? 'info-circle' : 'check-circle'" />{{ rec.message }}</div>
              </div>
            </div>
            <div class="panel diff-panel"><div class="panel-head"><div><strong>版本差异</strong><span>相对 {{ store.lastPublished }}</span></div><t-tag>{{ store.diffRows.length }} 项</t-tag></div><div v-for="row in store.diffRows" :key="row.id" class="diff-row"><strong>{{ row.name }}</strong><span>{{ row.id }}</span><div><del>{{ row.before }}</del><ins>{{ row.after }}</ins></div></div><p v-if="!store.diffRows.length" class="empty">暂无未发布差异。</p></div>
            <div class="panel history-panel"><div class="panel-head"><div><strong>发布历史</strong><span>历史发布按旧快照查看</span></div><HistoryIcon /></div><div v-for="snap in store.snapshots" :key="snap.version" class="history-row"><t-tag theme="success" variant="light">快照</t-tag><div><strong>DS {{ snap.version }}</strong><span>{{ snap.actor }} · {{ new Date(snap.releasedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) }}</span></div><t-button size="small" variant="text" @click="store.viewSnapshot(snap.version)">查看</t-button></div><div class="history-row"><t-tag>历史</t-tag><div><strong>DS 4.5.1</strong><span>周序 · 09-12 11:04</span></div><t-button size="small" variant="text">回滚</t-button></div><div class="history-row"><t-tag>历史</t-tag><div><strong>DS 4.5.0</strong><span>顾清 · 08-28 15:42</span></div><t-button size="small" variant="text">回滚</t-button></div></div>
          </aside>
        </section>
      </t-content>
    </t-layout>
  </t-layout>

  <t-dialog v-model:visible="newTokenDialog" header="创建候选令牌" :confirm-btn="{ content: '创建', onClick: addToken }">
    <div class="dialog-form"><t-input v-model="newToken.id" label="令牌 ID" placeholder="product.component.property" /><t-input v-model="newToken.name" label="显示名称" /><t-select v-model="newToken.category" label="分类" :options="[{label:'颜色',value:'color'},{label:'字体',value:'font'},{label:'间距',value:'spacing'},{label:'圆角',value:'radius'},{label:'阴影',value:'shadow'},{label:'组件',value:'component'}]" @change="onNewCategoryChange" /><t-input v-model="newToken.value" label="默认值" /><t-textarea v-model="newToken.description" label="用途说明" /></div>
  </t-dialog>
  <t-dialog v-model:visible="importDialog" header="导入旧稿并兼容读取" :confirm-btn="{ content: '合并读取', onClick: confirmImport }" width="640px">
    <div class="dialog-form">
      <div class="import-hint"><t-icon name="info-circle" /><span>支持 v1（type/alias/default 旧字段）与 v2 草稿：颜色、尺寸、别名记录不丢，圆角不会被当成颜色；双方都改过的令牌保留两版待裁决。</span></div>
      <t-textarea v-model="importText" placeholder="粘贴旧稿 JSON，或点击下方按钮载入示例旧稿" :autosize="{ minRows: 8, maxRows: 14 }" />
      <t-button size="small" variant="outline" @click="loadSampleDraft">载入示例旧稿（v1）</t-button>
    </div>
  </t-dialog>
  <t-dialog v-model:visible="releaseDialog" header="主题发布完成" :footer="false"><div class="release-success"><t-icon name="check-circle" size="46px" theme="success" /><h3>DS {{ store.releaseVersion }} 已锁定</h3><p>{{ releaseResult }}</p><p v-if="store.lastDispatch">通道派发：{{ store.lastDispatch.processed }} 项立即处理，{{ store.lastDispatch.queued }} 项容量不足进入排队，其余通道照常。</p><p>版本快照已生成，历史发布按旧快照查看；产品使用方可以按固定版本拉取令牌。</p></div></t-dialog>
  <t-dialog v-model:visible="snapshotDialogVisible" :header="`历史快照 DS ${store.viewingSnapshotVersion ?? ''}`" :footer="false" width="720px">
    <div v-if="store.viewingSnapshot" class="snapshot-view">
      <p class="snapshot-meta">{{ store.viewingSnapshot.actor }} · {{ new Date(store.viewingSnapshot.releasedAt).toLocaleString('zh-CN') }} · {{ store.viewingSnapshot.tokens.length }} 个令牌（只读快照）</p>
      <div class="snapshot-rows">
        <div v-for="token in store.viewingSnapshot.tokens" :key="token.id" class="snapshot-row">
          <i :class="token.category" />
          <div><strong>{{ token.name }}</strong><span>{{ token.id }}</span></div>
          <code>{{ token.value }}</code>
        </div>
      </div>
    </div>
  </t-dialog>
</template>
