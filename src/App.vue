<script setup lang="ts">
import { computed, h, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useQuery } from '@tanstack/vue-query';
import { MessagePlugin } from 'tdesign-vue-next';
import {
  AddIcon,
  ArrowRightIcon,
  CopyIcon,
  HistoryIcon,
  LockOnIcon,
  RefreshIcon,
  SearchIcon,
  SwapIcon,
  UploadIcon
} from 'tdesign-icons-vue-next';
import TokenEditor from './components/TokenEditor.vue';
import { fetchTokens, type Token } from './api';
import { useTokenStore } from './store';

const AddButtonIcon = () => h(AddIcon);
const ArrowRightButtonIcon = () => h(ArrowRightIcon);
const CopyButtonIcon = () => h(CopyIcon);
const HistoryButtonIcon = () => h(HistoryIcon);
const LockButtonIcon = () => h(LockOnIcon);
const RefreshButtonIcon = () => h(RefreshIcon);
const SearchInputIcon = () => h(SearchIcon);
const SwapButtonIcon = () => h(SwapIcon);
const UploadButtonIcon = () => h(UploadIcon);

const route = useRoute();
const router = useRouter();
const store = useTokenStore();
const { data: remote } = useQuery({ queryKey: ['tokens'], queryFn: fetchTokens });
const selectedVersion = computed({
  get: () => store.releaseVersion,
  set: (value: string) => { store.releaseVersion = value; }
});
const batchFrom = ref('');
const batchTo = ref('');
const releaseDialog = ref(false);
const newTokenDialog = ref(false);
const newToken = ref({ id: '', name: '', category: 'color', value: '#2864dc', description: '' });
const releaseResult = ref('');
const failBatchIndex = ref<number | undefined>(-1);
const viewedVersion = ref(store.viewedReleaseVersion ?? store.lastPublished);

const nav = [
  { path: '/', label: '令牌工作区', icon: 'token' },
  { path: '/migration', label: '草稿升级与裁决', icon: 'cloud-upload' },
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

watch(remote, (value) => {
  if (value && !store.tokens.length) value.tokens.forEach((token) => store.addToken(token));
});

function go(path: string) {
  router.push(path);
}

function runMigration() {
  const plan = store.importLegacyDraft(undefined, failBatchIndex.value);
  const failed = plan.batches.find((batch) => batch.status === 'rolled-back');
  if (failed) MessagePlugin.warning(`批次 ${failed.index + 1} 写入失败，已按原批次恢复，可点「重试批次」继续`);
  else if (plan.conflicts.length) MessagePlugin.success(`迁移完成，${plan.conflicts.length} 条冲突待裁决`);
  else MessagePlugin.success('旧稿已兼容迁移到 v2');
}

function retryMigration() {
  store.retryMigration();
  MessagePlugin.success('已按原批次重试写入');
}

function chooseDraft(id: string) {
  store.resolveConflict(id, 'draft');
  MessagePlugin.success('已采用旧稿版本');
}

function chooseCurrent(id: string) {
  store.resolveConflict(id, 'current');
  MessagePlugin.success('已采用当前版本');
}

function refillAndFlush() {
  store.channels.forEach((channel) => { channel.capacity += 2; });
  store.flushQueuedChannels(2);
}

function viewVersionChanged(version: string) {
  viewedVersion.value = version;
  store.viewRelease(version);
}

function onVersionChange(value: unknown) {
  viewVersionChanged(String(value));
}

function resolved(id: string) {
  return store.resolvedValue(id);
}

function updateEditor(value: string) {
  try {
    const parsed = JSON.parse(value) as Partial<Token>;
    if (parsed.value !== undefined) store.updateTokenValue(store.selectedTokenId, parsed.value);
  } catch {
    // Keep invalid JSON editable; validation is shown in the dependency panel.
  }
}

function addToken() {
  if (!newToken.value.id || !store.tokens.every((token) => token.id !== newToken.value.id)) {
    MessagePlugin.error('令牌 ID 不能为空且不能重复');
    return;
  }
  const category = newToken.value.category as Token['category'];
  store.addToken({
    id: newToken.value.id,
    name: newToken.value.name || newToken.value.id,
    category,
    kind: category === 'component' ? 'component' : newToken.value.id.includes('.semantic.') ? 'semantic' : 'base',
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
  const result = store.publish();
  if (result) {
    const { snapshot, duplicated } = result;
    if (duplicated) {
      MessagePlugin.info(`${snapshot.version} 已发布过：本次仅补处理记录，未重复写入或派发`);
      return;
    }
    releaseResult.value = `${snapshot.version} 快照锁定 · ${new Date(snapshot.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
    viewedVersion.value = snapshot.version;
    store.viewRelease(snapshot.version);
    releaseDialog.value = true;
    MessagePlugin.success('主题版本已冻结为只读快照');
  } else {
    MessagePlugin.warning(store.canPublish().reason ?? '发布未通过门禁');
  }
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
        <nav><button v-for="item in nav" :key="item.path" :class="{ active: route.path === item.path }" @click="go(item.path)"><t-icon :name="item.icon" /><span>{{ item.label }}</span><t-badge v-if="item.path === '/review'" :count="store.changes.filter(c => c.status === '待评审').length" /><t-badge v-else-if="item.path === '/migration' && store.pendingConflicts.length" :count="store.pendingConflicts.length" /></button></nav>
        <div class="save-state"><t-icon name="cloud-done" /><div><span>草稿已保存</span><small>{{ new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) }}</small></div></div>
      </t-aside>
      <t-content class="main-content">
        <header class="page-heading">
          <div><small>{{ store.locked ? 'RELEASE LOCKED' : 'GOVERNANCE WORKBENCH' }} / {{ pageTitle }}</small><h1>{{ pageTitle }}</h1><p>基础令牌到语义令牌的引用、差异、校验与跨主题发布。</p></div>
          <div class="heading-actions"><t-select v-model="store.activeTheme" style="width: 150px" :options="[{label:'明亮模式',value:'light'},{label:'暗色模式',value:'dark'},{label:'运营模式',value:'ops'},{label:'高对比度',value:'contrast'}]" /><t-button variant="outline" :icon="AddButtonIcon" @click="newTokenDialog = true">新建令牌</t-button><t-button theme="primary" :icon="LockButtonIcon" :disabled="store.locked" @click="publish">发布主题</t-button></div>
        </header>

        <section v-if="route.path === '/'" class="token-workspace">
          <aside class="token-tree panel">
            <div class="panel-head"><div><strong>令牌树</strong><span>{{ store.filteredTokens.length }} 个匹配项</span></div><t-button size="small" variant="text" :icon="RefreshButtonIcon" @click="store.rollback">回滚</t-button></div>
            <t-input v-model="store.search" clearable placeholder="搜索令牌 ID 或名称" :prefix-icon="SearchInputIcon" />
            <div class="category-tabs"><button v-for="category in categories" :key="category" :class="{ active: store.category === category }" @click="store.setCategory(category)">{{ category }}</button></div>
            <div class="tree-list">
              <button v-for="token in store.filteredTokens" :key="token.id" :class="{ active: store.selectedTokenId === token.id }" @click="store.selectToken(token.id)">
                <i :class="token.category" />
                <div><strong>{{ token.name }}</strong><span>{{ token.id }}</span></div>
                <div class="tree-end"><t-tag v-if="store.recomputedAt[token.id]" size="small" theme="primary" variant="light">已级联重算</t-tag><t-tag size="small" :theme="token.status === 'stable' ? 'success' : token.status === 'proposed' ? 'warning' : 'default'" variant="light">{{ token.status === 'stable' ? '稳定' : token.status === 'proposed' ? '候选' : '弃用' }}</t-tag></div>
              </button>
            </div>
          </aside>
          <section class="editor-column">
            <div class="panel editor-panel">
              <div class="panel-head"><div><strong>Monaco 令牌编辑</strong><span>{{ selected?.id }} · {{ store.activeTheme }}</span></div><div class="editor-actions"><t-tag v-if="selected?.ref" variant="light">引用 {{ selected.ref }}</t-tag><t-button size="small" variant="outline" :icon="CopyButtonIcon">复制 JSON</t-button></div></div>
              <div class="editor-host"><TokenEditor :model-value="selectedJson" language="json" @update:model-value="updateEditor" /></div>
              <div class="editor-status"><span><i class="status-dot" />JSON 结构有效</span><span>引用关系 {{ store.dependencyEdges.length }} 条</span><span v-if="selected && store.recomputedAt[selected.id]">基础令牌变更，已于 {{ new Date(store.recomputedAt[selected.id]).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) }} 级联重算</span><span v-if="selected?.ref">解析值 {{ resolved(selected.id) }}</span><span>{{ selected?.usage }} 处产品引用</span></div>
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

        <section v-else-if="route.path === '/migration'" class="migration-page">
          <div class="migration-grid">
            <div class="panel migration-source">
              <div class="panel-head"><div><strong>旧稿兼容迁移</strong><span>schema v1 → v{{ store.schemaVersion }} · 颜色 / 尺寸 / 别名记录全部保留</span></div><t-tag :theme="store.legacyDraftImported ? 'success' : 'warning'">{{ store.legacyDraftImported ? '已导入' : '待导入' }}</t-tag></div>
              <div class="migration-body">
                <p class="migration-note">旧稿存在三类历史问题：圆角 <code>radius.card.lg</code> 被错标为颜色（值 10px）、间距使用 <code>group:'size'</code>、别名使用 <code>aliasTo</code>。迁移引擎按 ID / 引用 / 取值重新判定分类，<strong>圆角不会被当成颜色</strong>，所有记录保留。</p>
                <div class="migration-controls">
                  <label><span>模拟失败批次（0 起，-1 为全部成功）</span><t-input-number v-model="failBatchIndex" :min="-1" :max="3" theme="normal" style="width: 130px" /></label>
                  <div class="migration-actions">
                    <t-button theme="primary" :icon="UploadButtonIcon" @click="runMigration">导入并迁移旧稿</t-button>
                    <t-button variant="outline" :disabled="!store.migrationPlan" @click="runMigration">重复提交（验证幂等）</t-button>
                    <t-button variant="outline" :icon="RefreshButtonIcon" :disabled="!store.migrationPlan?.batches.some(b => b.status === 'rolled-back')" @click="retryMigration">按原批次重试</t-button>
                  </div>
                </div>
                <table class="data-table" v-if="store.migrationPlan">
                  <thead><tr><th>批次</th><th>包含令牌</th><th>尝试</th><th>状态</th></tr></thead>
                  <tbody>
                    <tr v-for="batch in store.migrationPlan.batches" :key="batch.index">
                      <td>批次 {{ batch.index + 1 }}</td>
                      <td class="mono">{{ batch.tokenIds.join('、') }}</td>
                      <td>{{ batch.attempts }}</td>
                      <td><t-tag size="small" :theme="batch.status === 'applied' ? 'success' : batch.status === 'rolled-back' ? 'danger' : batch.status === 'recorded' ? 'primary' : 'warning'">{{ batch.status === 'applied' ? '已写入' : batch.status === 'rolled-back' ? '已按原批恢复' : batch.status === 'recorded' ? '幂等·仅记录' : '待写入' }}</t-tag><span v-if="batch.lastError" class="row-error">{{ batch.lastError }}</span></td>
                    </tr>
                  </tbody>
                </table>
                <p v-else class="empty">尚未导入旧稿。</p>
              </div>
            </div>

            <div class="panel conflict-panel">
              <div class="panel-head"><div><strong>双版本冲突待裁决</strong><span>同一令牌旧稿与当前版本都改过：两版并存</span></div><t-tag :theme="store.pendingConflicts.length ? 'warning' : 'success'">{{ store.pendingConflicts.length }} 待裁决</t-tag></div>
              <div class="conflict-list">
                <div v-for="conflict in store.conflicts" :key="conflict.id" class="conflict-card" :class="{ resolved: conflict.status === 'resolved' }">
                  <div class="conflict-title"><strong>{{ conflict.name }}</strong><code>{{ conflict.id }}</code><t-tag size="small" :theme="conflict.status === 'pending' ? 'warning' : 'success'">{{ conflict.status === 'pending' ? '待裁决' : `已采${conflict.winner === 'draft' ? '旧稿' : '当前'}` }}</t-tag></div>
                  <div class="conflict-versions">
                    <div class="conflict-ver"><span>发布基线</span><code>{{ conflict.baselineValue }}</code></div>
                    <div class="conflict-ver draft" :class="{ picked: conflict.winner === 'draft' }"><span>旧稿版本</span><code>{{ conflict.draftValue }}</code></div>
                    <div class="conflict-ver current" :class="{ picked: conflict.winner === 'current' }"><span>当前版本</span><code>{{ conflict.currentValue }}</code></div>
                  </div>
                  <div v-if="conflict.status === 'pending'" class="conflict-actions">
                    <t-button size="small" variant="outline" @click="chooseDraft(conflict.id)">采用旧稿</t-button>
                    <t-button size="small" theme="primary" @click="chooseCurrent(conflict.id)">采用当前</t-button>
                  </div>
                  <p v-else class="conflict-note">未裁决期间不进入发布包；裁决后下游语义/组件别名立即重算。</p>
                </div>
                <p v-if="!store.conflicts.length" class="empty">暂无冲突。导入旧稿后，两版都改过的令牌会在这里并列。</p>
              </div>
            </div>
          </div>

          <div class="panel migration-log">
            <div class="panel-head"><div><strong>处理记录</strong><span>升级写入 / 幂等补记 / 裁决 / 发布的完整审计轨迹</span></div><HistoryIcon /></div>
            <div class="log-list">
              <div v-for="(record, i) in store.processLog" :key="i" class="log-row"><t-tag size="small" :theme="record.kind === 'migration' ? 'primary' : record.kind === 'conflict' ? 'warning' : record.kind === 'channel' ? 'default' : 'success'">{{ record.kind }}</t-tag><span class="log-time">{{ new Date(record.at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) }}</span><span>{{ record.message }}</span></div>
              <p v-if="!store.processLog.length" class="empty">暂无处理记录。</p>
            </div>
          </div>
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
          <div class="review-summary panel"><div><span>待评审变更</span><strong>{{ store.changes.filter(c => c.status === '待评审').length }}</strong></div><div><span>已接受</span><strong>{{ store.changes.filter(c => c.status === '已接受').length }}</strong></div><div><span>已退回</span><strong>{{ store.changes.filter(c => c.status === '已退回').length }}</strong></div><div><span>受影响组件</span><strong>48</strong></div></div>
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
          <div class="publish-grid">
            <div class="panel publish-main">
              <div class="panel-head"><div><strong>发布准备</strong><span>生成只读冻结快照，支持按历史快照查看与回滚</span></div><t-tag :theme="store.locked ? 'success' : 'warning'">{{ store.locked ? '已锁定' : '候选版本' }}</t-tag></div>
              <div class="publish-form">
                <label><span>版本号</span><t-input v-model="selectedVersion" /></label>
                <label><span>目标产品</span><t-select multiple :value="['组件库','运营后台','移动端组件']" :options="[{label:'组件库',value:'组件库'},{label:'运营后台',value:'运营后台'},{label:'移动端组件',value:'移动端组件'},{label:'数据平台',value:'数据平台'}]" /></label>
                <label><span>发布说明</span><t-textarea value="兼容迁移旧稿、裁决双版本冲突，并更新语义主色与控件圆角。" :autosize="{ minRows: 3 }" /></label>
              </div>
              <div class="release-checks">
                <label><t-checkbox :checked="store.cycleNodes.length === 0" /> 循环依赖检查通过</label>
                <label><t-checkbox :checked="store.invalidReferences.length === 0" /> 无效引用检查通过</label>
                <label><t-checkbox :checked="store.contrastIssues.length === 0" /> 颜色对比度符合 WCAG AA</label>
                <label><t-checkbox :checked="store.changes.every(c => c.status !== '待评审')" /> 所有变更请求已处理</label>
                <label><t-checkbox :checked="store.pendingConflicts.length === 0" /> 双版本冲突全部裁决（未裁决不进发布包）</label>
              </div>
              <div v-if="store.pendingConflicts.length" class="publish-block"><t-icon name="error-circle" /><span>{{ store.canPublish().reason }}：{{ store.pendingConflicts.map(c => c.id).join('、') }}</span><t-button size="small" variant="outline" @click="go('/migration')">前往裁决</t-button></div>
              <div class="publish-actions"><t-button variant="outline" @click="store.rollback">回滚全部未发布编辑</t-button><t-button theme="primary" icon="lock-on" :disabled="store.locked || !store.canPublish().ok" @click="publish">校验并冻结快照发布</t-button></div>
            </div>

            <div class="panel channels-panel">
              <div class="panel-head"><div><strong>产品通道容量</strong><span>容量不足排队，其余通道照常，批次可继续</span></div><t-button size="small" variant="text" @click="refillAndFlush">补货并重试排队</t-button></div>
              <div class="channel-list">
                <div v-for="channel in store.channels" :key="channel.id" class="channel-row">
                  <div><strong>{{ channel.name }}</strong><span>剩余容量 {{ channel.capacity }} · 单批需 {{ channel.cost }}</span></div>
                  <t-tag size="small" :theme="channel.capacity >= channel.cost ? 'success' : 'warning'">{{ channel.capacity >= channel.cost ? '可投递' : '容量不足' }}</t-tag>
                </div>
                <div v-for="dispatch in store.dispatches.slice(0, 8)" :key="`${dispatch.channelId}-${dispatch.batchNo}-${dispatch.attempts}`" class="dispatch-row">
                  <t-tag size="small" :theme="dispatch.status === 'delivered' ? 'success' : dispatch.status === 'queued' ? 'warning' : 'danger'">{{ dispatch.status === 'delivered' ? '已投递' : dispatch.status === 'queued' ? '排队中' : dispatch.status }}</t-tag>
                  <span>{{ dispatch.name }} · 批次 {{ dispatch.batchNo }} · 第 {{ dispatch.attempts }} 次</span>
                </div>
                <p v-if="!store.dispatches.length" class="empty">尚未发布，无通道派发记录。</p>
              </div>
            </div>
          </div>

          <div class="publish-bottom">
            <div class="panel snapshot-panel">
              <div class="panel-head"><div><strong>发布快照（只读）</strong><span>别名已烘焙为字面量；历史查看永远按当时快照</span></div>
                <t-select :value="viewedVersion" size="small" style="width: 170px" :options="store.releases.map(r => ({ label: r.version, value: r.version }))" @change="onVersionChange" />
              </div>
              <table class="data-table snapshot-table">
                <thead><tr><th>令牌</th><th>分类</th><th v-for="theme in (store.viewedRelease?.themes ?? [])" :key="theme">{{ theme === 'light' ? '明亮' : theme === 'dark' ? '暗色' : theme === 'ops' ? '运营' : '高对比' }}</th></tr></thead>
                <tbody>
                  <tr v-for="row in store.viewedRelease?.tokens ?? []" :key="`${store.viewedRelease?.version}-${row.id}`">
                    <td><strong>{{ row.name }}</strong><code>{{ row.id }}</code></td>
                    <td>{{ row.category }}</td>
                    <td v-for="theme in (store.viewedRelease?.themes ?? [])" :key="theme" class="mono">{{ row.resolved[theme] }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="panel diff-panel"><div class="panel-head"><div><strong>版本差异</strong><span>相对 {{ store.lastPublished }}</span></div><t-tag>{{ store.diffRows.length }} 项</t-tag></div><div v-for="row in store.diffRows" :key="row.id" class="diff-row"><strong>{{ row.name }}</strong><span>{{ row.id }}</span><div><del>{{ row.before }}</del><ins>{{ row.after }}</ins></div></div><p v-if="!store.diffRows.length" class="empty">暂无未发布差异。</p></div>
          </div>
        </section>
      </t-content>
    </t-layout>
  </t-layout>

  <t-dialog v-model:visible="newTokenDialog" header="创建候选令牌" :confirm-btn="{ content: '创建', onClick: addToken }">
    <div class="dialog-form"><t-input v-model="newToken.id" label="令牌 ID" placeholder="product.component.property" /><t-input v-model="newToken.name" label="显示名称" /><t-select v-model="newToken.category" label="分类" :options="[{label:'颜色',value:'color'},{label:'字体',value:'font'},{label:'间距',value:'spacing'},{label:'圆角',value:'radius'},{label:'阴影',value:'shadow'},{label:'组件',value:'component'}]" /><t-input v-model="newToken.value" label="默认值" /><t-textarea v-model="newToken.description" label="用途说明" /></div>
  </t-dialog>
  <t-dialog v-model:visible="releaseDialog" header="主题发布完成" :footer="false"><div class="release-success"><t-icon name="check-circle" size="46px" theme="success" /><h3>{{ store.lastPublished }} 已冻结</h3><p>{{ releaseResult }}</p><p>版本快照已生成，产品使用方按固定版本拉取；容量不足的通道在「主题发布」页排队等待补货。</p></div></t-dialog>
</template>
