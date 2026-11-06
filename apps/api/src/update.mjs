// 应用版本与在线更新：网页端查看当前/最新版本，一键更新 ——
// 下载发布包（exitcode.cn/releases）→ sha256 校验 → 换 src/dist/package.json/VERSION → 自动重启。
// 只允许在正式安装布局（安装目录含 VERSION + src）下更新；开发仓库直接运行时不提供更新。
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
// 发布包布局：<安装目录>/src/server.mjs，因此安装根目录是 src 的上一级；开发仓库则是 apps/api
// 仅测试用：EXITCODE_UPDATE_INSTALL_ROOT 可覆盖安装根目录（生产永远不要设置）
export const INSTALL_ROOT = process.env.EXITCODE_UPDATE_INSTALL_ROOT
  ? resolve(process.env.EXITCODE_UPDATE_INSTALL_ROOT)
  : resolve(here, '..')
const UPDATE_BASE = process.env.EXITCODE_UPDATE_BASE_URL || 'https://exitcode.cn/releases'
const DATA_DIR = process.env.EXITCODE_DATA_DIR || join(INSTALL_ROOT, 'data')
const CHECK_TTL_MS = 10 * 60 * 1000
const DOWNLOAD_TIMEOUT_MS = 120000
const UA = 'exitcode-web-updater'

const isWin = process.platform === 'win32'

function isReleaseInstall() {
  return existsSync(join(INSTALL_ROOT, 'VERSION')) && existsSync(join(INSTALL_ROOT, 'src'))
}

function currentVersion() {
  const versionFile = join(INSTALL_ROOT, 'VERSION')
  if (existsSync(versionFile)) return readFileSync(versionFile, 'utf8').trim()
  const pkgFile = join(INSTALL_ROOT, 'package.json')
  if (existsSync(pkgFile)) {
    try {
      const version = JSON.parse(readFileSync(pkgFile, 'utf8')).version
      if (typeof version === 'string' && version.trim()) return version.trim()
    } catch {
      // 解析失败走兜底
    }
  }
  return 'dev'
}

let manifestCache = { at: 0, value: null }

async function fetchManifest(force = false) {
  const fresh = force || Date.now() - manifestCache.at >= CHECK_TTL_MS
  if (!fresh && manifestCache.value) return manifestCache.value
  try {
    const response = await fetch(`${UPDATE_BASE}/version.json`, {
      signal: AbortSignal.timeout(10000),
      headers: { 'user-agent': UA }
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json()
    if (!data || typeof data.version !== 'string' || typeof data.file !== 'string' || typeof data.sha256 !== 'string') {
      throw new Error('版本清单字段不完整。')
    }
    manifestCache = { at: Date.now(), value: data }
    return data
  } catch {
    return null
  }
}

export async function getVersionStatus(force = false) {
  const current = currentVersion()
  const canUpdate = isReleaseInstall()
  const manifest = await fetchManifest(force)
  return {
    current,
    mode: canUpdate ? 'release' : 'dev',
    canUpdate,
    updateUrl: UPDATE_BASE,
    latest: manifest?.version ?? null,
    updatedAt: manifest?.updatedAt ?? null,
    updateAvailable: Boolean(manifest && manifest.version !== current),
    checkedAt: manifestCache.at || null,
    checkFailed: !manifest
  }
}

function escSingle(text) {
  return String(text).replace(/'/g, "''")
}

function escSh(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$')
}

// 生成“换文件并重启”的脱离脚本：服务端返回后自行退出，脚本等几秒再动手，避开旧进程占用的文件
export function buildUpdaterScript(platform, installRoot, stage) {
  if (platform === 'win32') {
    return [
      "$ErrorActionPreference = 'Stop'",
      'Start-Sleep -Seconds 4',
      `$install = '${escSingle(installRoot)}'`,
      `$pkg = '${escSingle(join(stage, 'pkg', 'exitcode'))}'`,
      '$done = $false',
      'foreach ($attempt in 1..3) {',
      '  try {',
      "    foreach ($f in @('src','dist','package.json','VERSION')) {",
      '      $dst = Join-Path $install $f',
      '      if (Test-Path $dst) { Remove-Item -Recurse -Force $dst }',
      '      $from = Join-Path $pkg $f',
      '      if (Test-Path $from) { Move-Item $from $dst }',
      '    }',
      '    $done = $true',
      '    break',
      '  } catch { Start-Sleep -Seconds 2 }',
      '}',
      "if (-not $done) { Write-Output 'update failed: 文件替换失败'; exit 1 }",
      "Remove-Item (Join-Path $install 'server.pid') -ErrorAction SilentlyContinue",
      `Remove-Item -Recurse -Force '${escSingle(stage)}' -ErrorAction SilentlyContinue`,
      "Start-Process powershell -ArgumentList '-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $install 'start.ps1') -WorkingDirectory $install"
    ].join('\n')
  }
  return [
    '#!/usr/bin/env bash',
    'sleep 4',
    `install="${escSh(installRoot)}"`,
    `pkg="${escSh(join(stage, 'pkg', 'exitcode'))}"`,
    `stage="${escSh(stage)}"`,
    'ok=0',
    'for attempt in 1 2 3; do',
    '  if {',
    '    for f in src dist package.json VERSION; do',
    '      rm -rf "$install/$f"',
    '      [ -e "$pkg/$f" ] && mv "$pkg/$f" "$install/$f"',
    '    done',
    '  } 2>/dev/null; then ok=1; break; fi',
    '  sleep 2',
    'done',
    'if [ "$ok" != 1 ]; then echo "update failed: 文件替换失败" >&2; exit 1; fi',
    'rm -f "$install/server.pid"',
    'rm -rf "$stage"',
    'if [ -d /run/systemd/system ]; then systemctl restart exitcode 2>/dev/null || true',
    'elif [ -f "$install/start.sh" ]; then nohup bash "$install/start.sh" >/dev/null 2>&1 &',
    'fi'
  ].join('\n')
}

let updating = false

export async function performUpdate() {
  if (updating) throw new Error('正在更新中，请稍候。')
  if (!isReleaseInstall()) {
    throw new Error('当前是开发模式（缺少正式安装的 VERSION/发布文件），不支持网页端在线更新，请用安装脚本 install.ps1 update / install.sh update。')
  }
  const manifest = await fetchManifest(true)
  if (!manifest) throw new Error(`无法获取版本信息（${UPDATE_BASE}/version.json），请稍后重试。`)
  const current = currentVersion()
  if (manifest.version === current) return { updated: false, message: `已是最新版本（${current}）。` }

  updating = true
  try {
    const stage = join(DATA_DIR, '.update')
    mkdirSync(stage, { recursive: true })
    const archive = join(stage, manifest.file)
    const response = await fetch(`${UPDATE_BASE}/${manifest.file}`, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      headers: { 'user-agent': UA }
    })
    if (!response.ok) throw new Error(`下载发布包失败（HTTP ${response.status}）。`)
    const buf = Buffer.from(await response.arrayBuffer())
    writeFileSync(archive, buf)
    const actual = createHash('sha256').update(buf).digest('hex')
    if (actual !== String(manifest.sha256).toLowerCase()) {
      rmSync(archive, { force: true })
      throw new Error('sha256 校验失败，已中止更新。')
    }
    const pkgDir = join(stage, 'pkg')
    rmSync(pkgDir, { recursive: true, force: true })
    mkdirSync(pkgDir, { recursive: true })
    // GNU tar 会把盘符路径（C:\...）当远程主机，必须 cwd 到归档所在目录 + 裸文件名
    execFileSync('tar', ['-xzf', manifest.file, '-C', pkgDir], { cwd: stage, stdio: 'ignore', windowsHide: true })
    if (!existsSync(join(pkgDir, 'exitcode', 'src'))) throw new Error('发布包内容不完整，已中止更新。')

    const scriptName = isWin ? 'apply-and-restart.ps1' : 'apply-and-restart.sh'
    writeFileSync(join(stage, scriptName), buildUpdaterScript(process.platform, INSTALL_ROOT, stage), 'utf8')

    // Windows：子进程默认独立存活，且 detached+stdio:ignore 会让 powershell 不执行脚本，绝不能用 detached；
    // POSIX：detached 建立新会话，脱离父进程与终端存活
    const child = isWin
      ? spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(stage, scriptName)], {
          stdio: 'ignore',
          windowsHide: true
        })
      : spawn('/bin/sh', [join(stage, scriptName)], { detached: true, stdio: 'ignore' })
    child.unref()
    return { updated: true, message: `已下载 v${manifest.version} 并通过 sha256 校验，应用将在几秒后自动重启。` }
  } finally {
    updating = false
  }
}