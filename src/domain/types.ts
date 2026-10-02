export type TokenCategory = 'color' | 'font' | 'spacing' | 'radius' | 'shadow' | 'component';
export type TokenStatus = 'stable' | 'deprecated' | 'proposed';

export type Token = {
  id: string;
  name: string;
  category: TokenCategory;
  value: string;
  ref?: string;
  themes: Record<string, string>;
  usage: number;
  status: TokenStatus;
  description: string;
  /** 待裁决标记：旧稿与当前版本都改过、尚未裁决的令牌，不进入发布包 */
  pending?: boolean;
};

export type ConflictStatus = '待裁决' | '已采用旧稿' | '已采用当前';

export type TokenConflict = {
  id: string;
  tokenId: string;
  base: Token | null;
  oldVersion: Token;
  currentVersion: Token;
  status: ConflictStatus;
};

export type TokenSnapshot = {
  version: string;
  releasedAt: string;
  actor: string;
  note?: string;
  tokens: Token[];
};

export type Channel = { id: string; name: string; capacity: number };
export type QueueItemStatus = 'queued' | 'processing' | 'done';
export type QueueItem = {
  id: string;
  releaseId: string;
  channelId: string;
  batchId: string;
  status: QueueItemStatus;
  enqueuedAt: string;
};

export type BatchOp = { tokenId: string; value: string; theme?: string };
export type ProcessingLevel = 'info' | 'warn' | 'error';
export type ProcessingRecord = { at: string; level: ProcessingLevel; message: string };
export type BatchRecord = {
  batchId: string;
  kind: 'upgrade';
  status: 'applied' | 'failed' | 'duplicate';
  submittedAt: string;
  records: ProcessingRecord[];
  affectedTokenIds: string[];
};
