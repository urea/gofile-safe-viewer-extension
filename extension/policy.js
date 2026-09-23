export const TOKENS = Object.freeze(['gofile', 'twimg', 'twitmg', 'mvfile']);
export const TOKEN_PATTERN = '^https://.*(gofile|twimg|twitmg|mvfile)';
export const HOST_PATTERN = '^https://([a-z0-9-]+\\.)*x\\.com(:[0-9]+)?/|^https://t\\.co(:[0-9]+)?/';
export const MEDIA_PATTERN = '^https://([a-z0-9-]+\\.)*fun800\\.click(:[0-9]+)?/';

// URL fragments are never sent over the network, so they cannot grant permission.
export function parseAllowedUrl(value) {
  if (typeof value !== 'string' || value.length > 8192) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    const networkUrl = url.href.split('#')[0].toLowerCase();
    if (TOKENS.some(token => networkUrl.includes(token)) || url.hostname === 'x.com'
        || url.hostname.endsWith('.x.com') || url.hostname === 't.co') return url.href;
  } catch { /* Invalid input is not navigable. */ }
  return null;
}

export function extractAllowedUrl(value) {
  if (typeof value !== 'string') return null;
  for (const candidate of value.match(/https?:\/\/[^\s<>"']+/gi) ?? []) {
    const url = parseAllowedUrl(candidate.replace(/[)\]},.、。]+$/, ''));
    if (url) return url;
  }
  return null;
}

export function buildRules(tabIds) {
  if (tabIds.length === 0) return [];
  if (tabIds.some(id => !Number.isInteger(id) || id < 0)) throw new Error('Invalid tab ID');
  const all = {tabIds: [...new Set(tabIds)], resourceTypes: [
    'main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object',
    'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'webtransport', 'webbundle', 'other'
  ]};
  return [
    {id: 1, priority: 1, action: {type: 'block'}, condition: {...all}},
    ...[TOKEN_PATTERN, HOST_PATTERN].map((regexFilter, i) => ({
      id: i + 2, priority: 2, action: {type: 'allow'},
      condition: {...all, regexFilter, isUrlFilterCaseSensitive: false}
    })),
    {id: 4, priority: 2, action: {type: 'allow'}, condition: {
      tabIds: all.tabIds, excludedResourceTypes: ['main_frame'],
      regexFilter: MEDIA_PATTERN, isUrlFilterCaseSensitive: false
    }},
    // The server has received the request by this stage; this suppresses saving,
    // not transmission. Blob downloads and missing headers need separate handling.
    {id: 5, priority: 3, action: {type: 'block'}, condition: {
      tabIds: all.tabIds, resourceTypes: ['main_frame'],
      responseHeaders: [{header: 'content-disposition', values: ['attachment*']}]
    }},
    {id: 6, priority: 4, action: {type: 'block'}, condition: {...all, regexFilter: '^https://[^/]*@'}}
  ];
}
