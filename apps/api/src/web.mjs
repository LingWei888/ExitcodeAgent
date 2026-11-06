import process from 'node:process'

const FETCH_TIMEOUT_MS = 15000
const FETCH_MAX_BYTES = 512 * 1024
const SEARCH_TIMEOUT_MS = 12000
// 部分站点会拒绝无 UA 的请求；用通用浏览器 UA 而非自报智能体
const WEB_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
// 可选：指向 SearXNG 等兼容 JSON API（?q=&format=json → results[{title,url,content}]），未设置时用 DuckDuckGo Lite
const SEARXNG_ENDPOINT = process.env.EXITCODE_WEB_SEARCH_URL?.trim() || ''

function decodeEntities(text) {
  return String(text)
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

export function htmlToText(html) {
  return decodeEntities(
    String(html)
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6]|tr|td|pre|blockquote|section|article)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n+/g, '\n')
      .trim()
  )
}

function titleFromHtml(html) {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  return match ? decodeEntities(match[1].trim()).slice(0, 200) : ''
}

// 抓取 http/https 网页正文（转成纯文本）。只允许 http/https，杜绝 file:// 等非网络协议注入
export async function fetchWebPage(rawUrl, { timeoutMs = FETCH_TIMEOUT_MS, maxBytes = FETCH_MAX_BYTES } = {}) {
  let url
  try {
    url = new URL(String(rawUrl || '').trim())
  } catch {
    throw new Error('网址无效，请给出完整的 http/https URL。')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`不支持的协议：${url.protocol}（仅允许 http/https）。`)
  }
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'user-agent': WEB_UA, accept: 'text/html,application/xhtml+xml,application/json,text/plain,*/*' }
  })
  if (!response.ok) throw new Error(`抓取失败：HTTP ${response.status} ${response.statusText}`)
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`页面过大（${declared} 字节 > 512KB），未下载。`)
  }
  const raw = Buffer.from(await response.arrayBuffer())
  const truncated = raw.length > maxBytes
  const text = raw.toString('utf8').replace(/^﻿/, '').slice(0, maxBytes)
  const contentType = response.headers.get('content-type') || ''
  let body
  let title = ''
  if (/html/i.test(contentType) || /<html[\s>]/i.test(text.slice(0, 300))) {
    title = titleFromHtml(text)
    body = htmlToText(text)
  } else {
    body = text
  }
  if (!body.trim()) throw new Error('页面没有可读文本内容。')
  return { url: url.href, finalUrl: response.url, title, contentType, truncated, text: body.slice(0, maxBytes) }
}

function cleanSearchItem(text) {
  return htmlToText(text).replace(/\s+/g, ' ').trim().slice(0, 240)
}

async function searchBing(host, query, maxResults) {
  const base = host === 'cn' ? 'https://cn.bing.com/search' : 'https://www.bing.com/search'
  const url = `${base}?q=${encodeURIComponent(query)}&setlang=zh-hans`
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    headers: { 'user-agent': WEB_UA, 'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8' }
  })
  if (!response.ok) throw new Error(`搜索失败：HTTP ${response.status}`)
  const html = (await response.text()).slice(0, 2 * 1024 * 1024)
  const blocks = html.split('<li class="b_algo"').slice(1)
  const results = []
  for (const block of blocks) {
    const link = /<h2[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block)
    if (!link || !/^https?:/i.test(link[1])) continue
    const snippetMatch = /<p[^>]*>([\s\S]*?)<\/p>/.exec(block)
    results.push({
      title: cleanSearchItem(link[2]),
      url: link[1],
      snippet: snippetMatch ? cleanSearchItem(snippetMatch[1]) : ''
    })
    if (results.length >= maxResults) break
  }
  return results
}

async function searchDuckDuckGo(query, maxResults) {
  const searchUrl = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`
  const response = await fetch(searchUrl, {
    redirect: 'follow',
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    headers: { 'user-agent': WEB_UA }
  })
  if (!response.ok) throw new Error(`搜索失败：HTTP ${response.status}`)
  const html = (await response.text()).slice(0, 1024 * 1024)
  const found = []
  for (const match of html.matchAll(/<a rel="nofollow" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = match[1] ?? ''
    const title = cleanSearchItem(match[2] ?? '')
    if (!title || !href.startsWith('/link')) continue
    const encoded = /[?&]uddg=([^&]+)/.exec(href)
    let target = ''
    if (encoded) {
      try {
        target = decodeURIComponent(encoded[1])
      } catch {
        target = ''
      }
    }
    if (!/^https?:/i.test(target)) continue
    found.push({ title, url: target })
    if (found.length >= maxResults) break
  }
  const snippets = []
  for (const match of html.matchAll(/class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/gi)) {
    snippets.push(cleanSearchItem(match[1] ?? ''))
  }
  return found.map((item, index) => ({ ...item, snippet: snippets[index] ?? '' }))
}

async function searchSearxng(endpoint, query, maxResults) {
  const url = new URL(endpoint)
  url.searchParams.set('q', query)
  url.searchParams.set('format', 'json')
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    headers: { 'user-agent': WEB_UA }
  })
  if (!response.ok) throw new Error(`搜索接口失败：HTTP ${response.status}`)
  const data = await response.json()
  return (Array.isArray(data.results) ? data.results : [])
    .filter((item) => item?.url && item?.title)
    .slice(0, maxResults)
    .map((item) => ({ title: cleanSearchItem(item.title), url: item.url, snippet: cleanSearchItem(item.content ?? '') }))
}

export async function searchWebPages(query, { maxResults = 8 } = {}) {
  const rawQuery = String(query || '').trim()
  if (!rawQuery) throw new Error('搜索关键词不能为空。')
  const cap = Math.min(10, Math.max(1, Number(maxResults) || 8))
  if (SEARXNG_ENDPOINT) {
    return { query: rawQuery, results: await searchSearxng(SEARXNG_ENDPOINT, rawQuery, cap) }
  }
  // 国内网络 DuckDuckGo 常不可达，并行尝试 Bing（含 cn.bing）与 DDG，谁先出结果用谁
  const attempts = await Promise.all(
    [searchBing('www', rawQuery, cap), searchBing('cn', rawQuery, cap), searchDuckDuckGo(rawQuery, cap)].map((promise) =>
      promise.then((results) => ({ ok: true, results }), (error) => ({ ok: false, error }))
    )
  )
  const winner = attempts.find((attempt) => attempt.ok && attempt.results.length)
  if (winner) return { query: rawQuery, results: winner.results }
  const errors = attempts.filter((attempt) => !attempt.ok).map((attempt) => attempt.error?.message ?? '未知错误')
  const note = attempts.some((attempt) => attempt.ok) ? '（搜索源有响应但无结果）' : `（${errors.join('；')}）`
  throw new Error(`web_search 暂不可用${note}`)
}