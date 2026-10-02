# pair-wise-yy-63 跨产品设计令牌治理与主题发布平台

维护基础令牌、语义令牌和组件别名，支持品牌主题、明暗模式与平台变体继承覆盖。包含令牌树、Monaco JSON 编辑、依赖图、循环引用与对比度校验、批量替换、变更评审、版本差异和发布锁定。

## 草稿升级（v1 → v2）与治理规则

- **旧稿兼容读取**：`src/migration.ts` 规范化 v1 草稿（`type/group/aliasTo/desc` 等旧字段），颜色、尺寸（字号/间距/圆角/阴影）与别名记录全部保留；分类按 ID / 引用 / 取值重新推断，旧稿错标的圆角（如 `radius.card.lg` 值 `10px` 自报 color）不会被当成颜色。
- **双版本冲突待裁决**：同一令牌在旧稿和当前版本相对发布基线都改过，则两版并存于「草稿升级与裁决」页；未裁决的令牌不进入发布包，裁决后下游别名立即重算。
- **级联重算**：基础令牌一变化，未发布的语义令牌与组件别名沿引用链立即重算（工作区显示「已级联重算」标记与解析值）。
- **历史快照**：发布时把别名烘焙为逐主题字面量冻结；之后基础令牌再变化，历史版本仍按旧快照查看。
- **产品通道容量**：容量不足的通道进入排队，其余通道照常投递、批次不中断；补货后可继续投递排队通道。
- **批次与幂等**：迁移分批写入，单批写入失败按原批次恢复（前序批次保留），可重试；重复提交只追加处理记录，不重复落库；同一版本重复发布同样只补记录。

## 技术栈

Vue 3、TDesign、Pinia、Vue Router、TanStack Query、Axios、Monaco Editor、Vite、TypeScript。

## 运行

```bash
npm install
npm run dev
```

访问 `http://localhost:62063`。草稿、变更评审、迁移计划、冲突裁决、发布快照与通道状态保存在 `localStorage`（键 `yy63-token-governance-v2`）。迁移引擎的纯逻辑断言见 31 条用例（`inferCategory` / `buildMigrationPlan` / `applyMigrationBatches` / `resolveTokenValue` / `bakeReleaseSnapshot` / `dispatchToChannels`）。

```bash
npm run build
```
