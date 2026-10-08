export const conversationListPath = '/admin/conversations';
export const conversationUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Query = Record<string, string | null | (string | null)[] | undefined>;
export type ConversationListState = {
  query: string;
  visitorId: string;
  device: string;
  timeRange: string;
  offset: number;
  applicationId?: string;
};

export function queryString(value: Query[string]) {
  return typeof value === 'string' ? value : '';
}

export function readConversationListState(query: Query): ConversationListState {
  const page = Number(queryString(query.page));
  const offset = (page - 1) * 30;
  const visitor = queryString(query.visitor);
  const device = queryString(query.device);
  const range = queryString(query.range);
  return {
    query: queryString(query.q),
    visitorId: conversationUuid.test(visitor) ? visitor : '',
    device: ['browser', 'mobile', 'wechat', 'feishu', 'api'].includes(device) ? device : 'all',
    timeRange: ['24h', '7d', '30d'].includes(range) ? range : 'all',
    offset: Number.isSafeInteger(page) && page > 0 && Number.isSafeInteger(offset) ? offset : 0,
    ...(conversationUuid.test(queryString(query.app)) ? { applicationId: queryString(query.app) } : {}),
  };
}

export function conversationListQuery(state: ConversationListState) {
  const query: Record<string, string> = {};
  if (state.query.trim()) query.q = state.query.trim();
  if (state.visitorId) query.visitor = state.visitorId;
  if (state.applicationId) query.app = state.applicationId;
  if (state.device !== 'all') query.device = state.device;
  if (state.timeRange !== 'all') query.range = state.timeRange;
  if (state.offset > 0) query.page = String(Math.floor(state.offset / 30) + 1);
  return query;
}

export function conversationDetailLocation(id: string, traceId?: string, state?: ConversationListState) {
  if (!conversationUuid.test(id)) throw new Error('会话 ID 必须是完整 UUID');
  return {
    path: `${conversationListPath}/${id}`,
    query: {
      ...(state ? conversationListQuery(state) : {}),
      ...(traceId && conversationUuid.test(traceId) ? { traceId } : {}),
    },
  };
}
