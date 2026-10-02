import type { LegacyDraft } from './migration';

// 模拟团队升级前遗留的 v1 草稿（schemaVersion: 1）。
// 刻意包含三类陷阱，验证迁移引擎：
// 1) radius.card.lg 在旧稿里被错标为 category: 'color'，值是 10px —— 迁移时必须修正为圆角，不能当颜色；
// 2) 旧稿用 group: 'size' 记录间距、用 aliasTo 记录别名，字段形态与当前版本不同，记录不能丢；
// 3) color.base.blue.600 与当前版本相对发布基线都改过（旧稿 #1f56c0 vs 当前 #2864dc vs 基线 #2b63d8），
//    迁移后应两版并存待裁决；font.size.body 两版也都改过。
export const legacyDraftSeed: LegacyDraft = {
  schemaVersion: 1,
  source: '设计系统组 · v1 本地草稿',
  savedAt: '2026-09-28T18:42:00.000Z',
  tokens: [
    {
      // 冲突 1：旧稿与当前版本都改了品牌主色
      id: 'color.base.blue.600',
      name: '品牌主色 600',
      category: 'color',
      value: '#1f56c0',
      themes: { light: '#1f56c0', dark: '#6f96ff', ops: '#24786a', contrast: '#0b4dba' },
      usage: 184,
      status: 'stable',
      description: '旧稿：主色加深以通过大色块对比'
    },
    {
      // 旧稿独有的语义颜色别名
      id: 'color.semantic.info',
      name: '语义信息色',
      category: 'alias',
      group: 'alias',
      value: '{color.base.blue.400}',
      aliasTo: 'color.base.blue.400',
      themes: { light: '{color.base.blue.400}', dark: '{color.base.blue.400}', ops: '{color.base.blue.400}', contrast: '{color.base.blue.800}' },
      usage: 53,
      status: 'proposed',
      desc: '旧稿新增：信息提示统一别名'
    },
    {
      // 关键陷阱：圆角被旧稿错标成颜色，取值 10px
      id: 'radius.card.lg',
      name: '大卡片圆角',
      category: 'color',
      value: '10px',
      themes: { light: '10px', dark: '10px', ops: '8px', contrast: '6px' },
      usage: 44,
      status: 'stable',
      desc: '旧稿分类字段不可信，迁移须修正为 radius'
    },
    {
      // 旧稿用 group=size 记录的间距，没有 category
      id: 'spacing.base.4',
      name: '基础间距 4',
      group: 'size',
      value: '16px',
      themes: { light: '16px', dark: '16px', ops: '16px', contrast: '16px' },
      usage: 201,
      status: 'stable',
      desc: '旧稿尺寸记录，迁移后保留'
    },
    {
      // 冲突 2：正文字号两版都改过（基线 14px，当前 14px? 见 store 基线）
      id: 'font.size.body',
      name: '正文字号',
      category: 'font',
      value: '15px',
      themes: { light: '15px', dark: '15px', ops: '15px', contrast: '17px' },
      usage: 255,
      status: 'stable',
      desc: '旧稿：正文字号上调半档'
    },
    {
      // 旧稿独有的组件别名（指向语义色），验证别名记录不丢、级联可达
      id: 'component.banner.info.bg',
      name: '信息横幅背景',
      group: 'alias',
      value: '{color.semantic.info}',
      aliasTo: 'color.semantic.info',
      themes: { light: '{color.semantic.info}', dark: '{color.semantic.info}', ops: '{color.semantic.info}', contrast: '{color.semantic.info}' },
      usage: 19,
      status: 'proposed',
      desc: '旧稿新增组件别名'
    }
  ]
};

// 上一发布基线（用于判定「旧稿 / 当前版本是否都改过」）
export const legacyBaselineSeed: Record<string, string> = {
  'color.base.blue.600': '#2b63d8',
  'font.size.body': '14px'
};
