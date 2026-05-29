function ensureHeaders(requestDetails) {
  if (!requestDetails.request.header) {
    requestDetails.request.header = [];
  }
  return requestDetails.request.header;
}

function upsertHeader(requestDetails, key, value) {
  if (!key || !value) return;

  const headers = ensureHeaders(requestDetails);
  const index = headers.findIndex((header) => header.key?.toLowerCase() === key.toLowerCase());
  if (index >= 0) {
    headers[index] = { ...headers[index], key, value };
    return;
  }

  headers.push({ key, value });
}

function encodeBasic(username, password) {
  const input = `${username}:${password}`;
  if (typeof btoa === 'function') {
    return btoa(input);
  }
  return Buffer.from(input, 'utf8').toString('base64');
}

function getRawUrl(requestDetails) {
  const url = requestDetails.request.url;
  if (typeof url === 'string') return url;
  return url?.raw || '';
}

function setRawUrl(requestDetails, rawUrl) {
  if (typeof requestDetails.request.url === 'string') {
    requestDetails.request.url = rawUrl;
    return;
  }

  requestDetails.request.url = {
    ...(requestDetails.request.url || {}),
    raw: rawUrl,
  };
}

function upsertQueryParam(requestDetails, key, value) {
  if (!key || !value) return;

  const rawUrl = getRawUrl(requestDetails);
  try {
    const url = new URL(rawUrl);
    url.searchParams.set(key, value);
    setRawUrl(requestDetails, url.toString());
  } catch {
    const separator = rawUrl.includes('?') ? '&' : '?';
    setRawUrl(requestDetails, `${rawUrl}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  }
}

export function applyApiAuthentication(requestDetails, auth) {
  const next = JSON.parse(JSON.stringify(requestDetails));

  switch (auth?.type) {
    case 'bearer':
      if (auth.bearerToken) {
        upsertHeader(next, 'Authorization', `Bearer ${auth.bearerToken}`);
      }
      return next;
    case 'apiKey':
      if (auth.apiKey?.placement === 'query') {
        upsertQueryParam(next, auth.apiKey.key, auth.apiKey.value);
      } else {
        upsertHeader(next, auth.apiKey?.key, auth.apiKey?.value);
      }
      return next;
    case 'basic':
      if (auth.basic?.username && auth.basic?.password) {
        upsertHeader(next, 'Authorization', `Basic ${encodeBasic(auth.basic.username, auth.basic.password)}`);
      }
      return next;
    case 'aws':
    case 'none':
    default:
      return next;
  }
}
