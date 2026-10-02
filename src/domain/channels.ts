import type { Channel, QueueItem } from './types';

export const DEFAULT_CHANNELS: Channel[] = [
  { id: 'component-lib', name: '组件库', capacity: 2 },
  { id: 'ops-console', name: '运营后台', capacity: 1 },
  { id: 'mobile', name: '移动端组件', capacity: 2 },
  { id: 'data-platform', name: '数据平台', capacity: 1 }
];

export function channelLoad(queue: QueueItem[], channelId: string) {
  const items = queue.filter((q) => q.channelId === channelId);
  return {
    processing: items.filter((q) => q.status === 'processing').length,
    queued: items.filter((q) => q.status === 'queued').length,
    done: items.filter((q) => q.status === 'done').length
  };
}

/**
 * 按通道容量派发：容量内立即处理，容量不足进入排队，其余通道照常处理。
 */
export function dispatchRelease(
  queue: QueueItem[],
  channels: Channel[],
  releaseId: string,
  batchId: string,
  channelIds: string[],
  now: string
): QueueItem[] {
  const created: QueueItem[] = [];
  for (const channelId of channelIds) {
    const channel = channels.find((c) => c.id === channelId);
    if (!channel) continue;
    const load = channelLoad(queue, channelId);
    const item: QueueItem = {
      id: `${releaseId}-${channelId}-${now.slice(-6)}`,
      releaseId,
      channelId,
      batchId,
      status: load.processing < channel.capacity ? 'processing' : 'queued',
      enqueuedAt: now
    };
    queue.push(item);
    created.push(item);
  }
  return created;
}

/** 容量释放后继续处理排队中的批次条目，批次可继续。 */
export function pumpQueue(queue: QueueItem[], channels: Channel[]): string[] {
  const started: string[] = [];
  for (const channel of channels) {
    while (channelLoad(queue, channel.id).processing < channel.capacity) {
      const next = queue.find((q) => q.channelId === channel.id && q.status === 'queued');
      if (!next) break;
      next.status = 'processing';
      started.push(next.id);
    }
  }
  return started;
}

/** 一个条目处理完成，释放容量并自动继续排队条目。 */
export function completeItem(queue: QueueItem[], channels: Channel[], itemId: string): string[] {
  const item = queue.find((q) => q.id === itemId);
  if (item && item.status === 'processing') item.status = 'done';
  return pumpQueue(queue, channels);
}
