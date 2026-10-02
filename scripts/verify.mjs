// 运行时行为验证：用 typescript 编译器把 src/domain/*.ts 转译成临时 .mjs 后执行断言
import { transpileModule } from 'typescript';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const domainDir = new URL('../src/domain/', import.meta.url).pathname;
const outDir = join(tmpdir(), `yy63-verify-${Date.now()}`);
mkdirSync(outDir, { recursive: true });

const files = ['types.ts', 'migrate.ts', 'merge.ts', 'resolve.ts', 'channels.ts', 'batch.ts'];
for (const file of files) {
  const src = readFileSync(join(domainDir, file), 'utf8');
  let out = transpileModule(src, { compilerOptions: { module: 'ESNext', target: 'ES2022' } }).outputText;
  // Node ESM 需要显式扩展名：把 './migrate' 这类相对引用改写为 './migrate.mjs'
  out = out.replace(/(from\s+['"])(\.\/[^'"]+)(['"])/g, (_, a, spec, c) => `${a}${spec}.mjs${c}`);
  writeFileSync(join(outDir, file.replace(/\.ts$/, '.mjs')), out);
}

const { migrateEnvelope, validateTokenWrite, isColorValue } = await import(join(outDir, 'migrate.mjs'));
const { threeWayMerge } = await import(join(outDir, 'merge.mjs'));
const { recalculateDependents, recalculateAll, resolveRef, resolveThemeValue } = await import(join(outDir, 'resolve.mjs'));
const { DEFAULT_CHANNELS, dispatchRelease, pumpQueue, completeItem, channelLoad } = await import(join(outDir, 'channels.mjs'));
const { applyUpgradeBatch } = await import(join(outDir, 'batch.mjs'));

let passed = 0;
function assert(cond, message) {
  if (!cond) {
    console.error(`✗ ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`✓ ${message}`);
    passed += 1;
  }
}

const now = '2026-10-02T10:00:00.000Z';

// ---------- R1 旧草稿兼容读取 ----------
const v1Draft = [
  { id: 'color.base.blue.600', name: '品牌主色', type: 'color', default: '#2864dc', value: '#2864dc', usage: 10, status: 'stable' },
  { id: 'color.semantic.primary', name: '语义主色', type: 'color', value: '{color.base.blue.600}', alias: '{color.base.blue.600}', usage: 5, status: 'stable' },
  { id: 'radius.control', name: '控件圆角', type: 'radius', value: '6px', usage: 8, status: 'stable' },
  { id: 'font.size.body', name: '正文字号', type: 'font', value: '14px', usage: 3, status: 'proposed' }
];
const migrated = migrateEnvelope(v1Draft);
assert(migrated.fromVersion === 1 && migrated.schemaVersion === 3, 'R1: v1 草稿迁移到 schema v3');
assert(migrated.tokens.length === 4, 'R1: 颜色、尺寸、别名记录不丢（4 个令牌全部保留）');
const radius = migrated.tokens.find((t) => t.id === 'radius.control');
assert(radius.category === 'radius' && radius.value === '6px', 'R1: 圆角令牌仍是 radius 类型，不会被当成颜色');
const semantic = migrated.tokens.find((t) => t.id === 'color.semantic.primary');
assert(semantic.ref === 'color.base.blue.600', 'R1: v1 alias 别名记录保留为 ref');
assert(semantic.themes.light === '{color.base.blue.600}', 'R1: 主题别名引用保留');
assert(isColorValue('#2864dc') && !isColorValue('6px'), 'R1: 颜色值识别正确，尺寸值不是颜色');

const v2Envelope = { schemaVersion: 2, tokens: v1Draft.map((t) => ({ id: t.id, name: t.name, value: t.value, usage: t.usage, status: t.status })) };
const migrated2 = migrateEnvelope(v2Envelope);
assert(migrated2.tokens.every((t) => t.category), 'R1: v2 草稿补全分类（按 ID 前缀推断）');

// 类型化写入校验
const colorToken = { id: 'color.base.blue.600', category: 'color', value: '#2864dc', themes: {} };
const radiusToken = { id: 'radius.control', category: 'radius', value: '6px', themes: {} };
assert(validateTokenWrite(colorToken, '8px') !== null, 'R1: 圆角/尺寸值不能写入颜色令牌');
assert(validateTokenWrite(radiusToken, '#1a56db') !== null, 'R1: 颜色值不能写入尺寸令牌');
assert(validateTokenWrite(colorToken, '#1a56db') === null, 'R1: 合法颜色值允许写入');
assert(validateTokenWrite(radiusToken, '8px') === null, 'R1: 合法尺寸值允许写入');

// ---------- R2 双方改动保留两版待裁决 ----------
const base = [
  { id: 'color.base.blue.600', category: 'color', value: '#2864dc', themes: { light: '#2864dc' } },
  { id: 'radius.control', category: 'radius', value: '6px', themes: { light: '6px' } },
  { id: 'font.size.body', category: 'font', value: '14px', themes: { light: '14px' } }
];
const oldDraft = [
  { id: 'color.base.blue.600', category: 'color', value: '#1a56db', themes: { light: '#1a56db' } }, // 旧稿改了
  { id: 'radius.control', category: 'radius', value: '8px', themes: { light: '8px' } },           // 旧稿改了
  { id: 'font.size.body', category: 'font', value: '14px', themes: { light: '14px' } }
];
const current = [
  { id: 'color.base.blue.600', category: 'color', value: '#2864dc', themes: { light: '#2864dc' } },
  { id: 'radius.control', category: 'radius', value: '4px', themes: { light: '4px' } },           // 当前也改了
  { id: 'font.size.body', category: 'font', value: '16px', themes: { light: '16px' } }            // 仅当前改了
];
const merged = threeWayMerge(base, oldDraft, current);
const conflict = merged.conflicts.find((c) => c.tokenId === 'radius.control');
assert(conflict && conflict.status === '待裁决', 'R2: 双方都改过的令牌保留两版，状态待裁决');
assert(conflict.oldVersion.value === '8px' && conflict.currentVersion.value === '4px', 'R2: 旧稿版本与当前版本各自保留');
const blueConflict = merged.conflicts.find((c) => c.tokenId === 'color.base.blue.600');
assert(!blueConflict, 'R2: 仅旧稿改过的令牌直接采用，不构成冲突');
assert(merged.tokens.find((t) => t.id === 'color.base.blue.600').value === '#1a56db', 'R2: 仅旧稿改过 → 采用旧稿');
assert(merged.tokens.find((t) => t.id === 'font.size.body').value === '16px', 'R2: 仅当前改过 → 采用当前');
assert(merged.tokens.find((t) => t.id === 'radius.control').pending === true, 'R2: 冲突令牌标记 pending，不进发布包');
assert(merged.tokens.filter((t) => t.pending).length === 1, 'R2: 未裁决时只有冲突令牌被排除');

// 双方改后一致 → 不冲突
const sameChange = threeWayMerge(
  base,
  [{ id: 'radius.control', category: 'radius', value: '8px', themes: { light: '8px' } }],
  [{ id: 'radius.control', category: 'radius', value: '8px', themes: { light: '8px' } }]
);
assert(sameChange.conflicts.length === 0, 'R2: 双方改后一致不构成冲突');

// ---------- R3 基础令牌变化立即重算，历史按旧快照 ----------
const tokens = [
  { id: 'color.base.blue.600', category: 'color', value: '#2864dc', ref: undefined, themes: { light: '#2864dc' } },
  { id: 'color.semantic.primary', category: 'color', value: '{color.base.blue.600}', ref: 'color.base.blue.600', themes: { light: '{color.base.blue.600}' } },
  { id: 'component.button.primary.bg', category: 'component', value: '{color.semantic.primary}', ref: 'color.semantic.primary', themes: { light: '{color.semantic.primary}' } }
];
const affected = recalculateDependents(tokens, 'color.base.blue.600');
assert(affected.includes('color.semantic.primary') && affected.includes('component.button.primary.bg'), 'R3: 基础令牌变化，语义令牌与组件别名立即重算');
tokens[0].value = '#1a56db';
recalculateDependents(tokens, 'color.base.blue.600');
assert(resolveThemeValue(tokens, tokens[1], 'light') === '#1a56db' && resolveThemeValue(tokens, tokens[2], 'light') === '#1a56db', 'R3: 基础变化后别名主题立即解析到新基础值');
assert(tokens[1].value === '#1a56db' && tokens[2].value === '#1a56db', 'R3: 别名 value 立即重算');
assert(tokens[1].themes.light === '{color.base.blue.600}', 'R3: 主题别名引用串保留不丢');
assert(resolveRef(tokens, 'component.button.primary.bg') === '#1a56db', 'R3: 多层引用链解析正确');

// 历史快照不受基础变化影响：快照按自身令牌解析
const snapshotTokens = tokens.map((t) => ({ ...t, themes: { ...t.themes } }));
tokens[0].value = '#000000';
recalculateAll(tokens);
assert(resolveThemeValue(snapshotTokens, snapshotTokens[1], 'light') === '#1a56db', 'R3: 历史发布快照保持旧值，不随工作稿重算');

// ---------- R4 通道容量排队 ----------
const queue = [];
const channels = DEFAULT_CHANNELS;
// 第一次发布：component-lib 容量 2，ops-console 容量 1
const first = dispatchRelease(queue, channels, 'DS-4.6.0-rc.2', 'BATCH-1', ['component-lib', 'ops-console', 'mobile', 'data-platform'], now);
assert(first.filter((i) => i.status === 'processing').length === 4, 'R4: 容量内 4 个通道条目立即处理');
// 第二次发布：component-lib 与 mobile 容量已满 → 排队；ops-console 也满；data-platform 满
const second = dispatchRelease(queue, channels, 'DS-4.6.1', 'BATCH-2', ['component-lib', 'ops-console', 'mobile', 'data-platform'], now);
assert(second.filter((i) => i.status === 'queued').length === 2, 'R4: 容量不足时容量 1 的 2 个通道条目排队，容量 2 的通道照常处理');
// 再来一次：component-lib/mobile 仍满，ops/data 也满 → 其余通道照常（各自独立排队）
const third = dispatchRelease(queue, channels, 'DS-4.6.2', 'BATCH-3', ['component-lib', 'ops-console'], now);
assert(third.every((i) => i.status === 'queued'), 'R4: 其余通道不受影响，各自排队');
// 完成一个 component-lib 条目 → 释放容量，排队条目自动继续
const doneId = queue.find((q) => q.channelId === 'component-lib' && q.status === 'processing').id;
const started = completeItem(queue, channels, doneId);
assert(started.length === 1 && started[0].startsWith('DS-4.6.0-rc.2-component-lib') === false, 'R4: 容量释放后排队条目继续处理，批次可继续');
assert(channelLoad(queue, 'component-lib').processing === 2, 'R4: 通道容量始终不超限');
// 手动继续批次
const beforeQueued = queue.filter((q) => q.status === 'queued').length;
pumpQueue(queue, channels);
assert(queue.filter((q) => q.status === 'queued').length <= beforeQueued, 'R4: 继续批次后排队数不增加');

// ---------- R5 批次回滚与幂等 ----------
const batchTokens = [
  { id: 'color.base.blue.600', category: 'color', value: '#2864dc', themes: { light: '#2864dc' } },
  { id: 'radius.control', category: 'radius', value: '6px', themes: { light: '6px' } }
];
const history = [];
// 失败批次：把圆角值写入颜色令牌 → 整批回滚
const failed = applyUpgradeBatch(batchTokens, 'UP-1001', [
  { tokenId: 'color.base.blue.600', value: '#1a56db' },
  { tokenId: 'radius.control', value: '8px' },
  { tokenId: 'color.base.blue.600', value: '6px' } // 类型错误：尺寸值写入颜色令牌
], history, now);
assert(failed.status === 'failed', 'R5: 类型校验失败，批次标记 failed');
assert(batchTokens[0].value === '#2864dc' && batchTokens[1].value === '6px', 'R5: 写入失败后按原批次回滚');
assert(failed.records.some((r) => r.level === 'error'), 'R5: 批次记录包含回滚说明');

// 成功批次
const ok = applyUpgradeBatch(batchTokens, 'UP-1002', [
  { tokenId: 'color.base.blue.600', value: '#1a56db' },
  { tokenId: 'radius.control', value: '8px' }
], history, now);
assert(ok.status === 'applied' && batchTokens[0].value === '#1a56db' && batchTokens[1].value === '8px', 'R5: 合法批次升级成功');

// 重复提交同一批次号 → 不重复写入，只补记录
const recordsBefore = ok.records.length;
const dup = applyUpgradeBatch(batchTokens, 'UP-1002', [
  { tokenId: 'color.base.blue.600', value: '#000000' }
], history, now);
assert(dup.status === 'applied', 'R5: 重复提交不改变原批次状态');
assert(batchTokens[0].value === '#1a56db', 'R5: 重复提交不重复写入，值保持不变');
assert(dup.records.length === recordsBefore + 1 && dup.records[dup.records.length - 1].message.includes('重复提交'), 'R5: 重复提交只补充处理记录');

rmSync(outDir, { recursive: true, force: true });

if (process.exitCode) {
  console.error(`\n${passed} 项断言通过，存在失败项`);
} else {
  console.log(`\n全部 ${passed} 项行为断言通过`);
}
