import type { BatchOp, BatchRecord, ProcessingRecord, Token } from './types';
import { validateTokenWrite } from './migrate';

function record(level: ProcessingRecord['level'], message: string, at: string): ProcessingRecord {
  return { at, level, message };
}

/**
 * 升级批次写入：
 * - 幂等：batchId 已存在时不重复写入，只补充一条处理记录
 * - 类型校验：圆角/尺寸不能作为颜色写入；任一操作校验失败则整批按原批次回滚
 */
export function applyUpgradeBatch(
  tokens: Token[],
  batchId: string,
  ops: BatchOp[],
  history: BatchRecord[],
  now: string
): BatchRecord {
  const duplicate = history.find((h) => h.batchId === batchId);
  if (duplicate) {
    duplicate.records.push(record('info', `重复提交批次 ${batchId}：已存在处理记录，本次不重复写入，仅补充登记`, now));
    return duplicate;
  }

  const rec: BatchRecord = {
    batchId,
    kind: 'upgrade',
    status: 'applied',
    submittedAt: now,
    records: [],
    affectedTokenIds: []
  };
  history.push(rec);
  const before = new Map<string, Token>();

  const rollback = (reason: string) => {
    for (const [id, snap] of before) {
      const cur = tokens.find((t) => t.id === id);
      if (cur) {
        cur.value = snap.value;
        cur.themes = { ...snap.themes };
        if (snap.ref) cur.ref = snap.ref;
        else delete cur.ref;
      }
    }
    rec.status = 'failed';
    rec.records.push(record('error', `${reason}；已按原批次 ${batchId} 回滚 ${before.size} 个令牌`, now));
  };

  // 先校验整批，任一失败即回滚
  for (const op of ops) {
    const token = tokens.find((t) => t.id === op.tokenId);
    if (!token) {
      rec.records.push(record('warn', `令牌 ${op.tokenId} 不存在，已跳过`, now));
      continue;
    }
    if (!before.has(token.id)) {
      before.set(token.id, { ...token, themes: { ...token.themes } });
    }
    const err = validateTokenWrite(token, op.value);
    if (err) {
      rollback(err);
      return rec;
    }
  }

  for (const op of ops) {
    const token = tokens.find((t) => t.id === op.tokenId);
    if (!token) continue;
    token.value = op.value;
    if (op.theme) token.themes[op.theme] = op.value;
    rec.affectedTokenIds.push(token.id);
    rec.records.push(record('info', `写入 ${token.id}${op.theme ? ` @${op.theme}` : ''} = ${op.value}`, now));
  }
  rec.records.push(record('info', `批次 ${batchId} 升级完成，影响 ${rec.affectedTokenIds.length} 个令牌`, now));
  return rec;
}
