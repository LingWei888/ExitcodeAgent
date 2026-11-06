#!/usr/bin/env node
// 构建发布包：把服务端源码(src) + 构建好的前端(dist) 打包成自包含 tar.gz（零 npm 依赖），
// 并生成 version.json 供一键安装脚本做在线更新比对。
// 用法: node tools/build-release.mjs [版本号]   （默认 0.1.0，可用 EXITCODE_RELEASE_VERSION 覆盖）
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const REPO = resolve(import.meta.dirname ?? '.', '..')
const VERSION = process.env.EXITCODE_RELEASE_VERSION || process.argv[2] || '0.1.0'
const OUT_DIR = resolve(REPO, 'tools', 'release')
const API_SRC = resolve(REPO, 'apps', 'api', 'src')
const WEB_DIST = resolve(REPO, 'apps', 'web', 'dist')

const fail = (msg) => {
  console.error('[build-release]', msg)
  process.exit(1)
}

if (!existsSync(WEB_DIST) || !existsSync(join(WEB_DIST, 'index.html'))) {
  fail('apps/web/dist 不存在，请先运行 pnpm build:web')
}

const name = `exitcode-${VERSION}.tar.gz`
const tmp = join(tmpdir(), `exitcode-release-${Date.now()}`)
const pkgRoot = join(tmp, 'exitcode')
await mkdir(pkgRoot, { recursive: true })

// 服务端源码 + 前端产物 + 元信息
await cp(API_SRC, join(pkgRoot, 'src'), { recursive: true })
await cp(WEB_DIST, join(pkgRoot, 'dist'), { recursive: true })
await writeFile(
  join(pkgRoot, 'package.json'),
  JSON.stringify(
    {
      name: 'exitcode-server',
      version: VERSION,
      private: true,
      type: 'module',
      engines: { node: '>=20' },
      scripts: { start: 'node src/server.mjs' }
    },
    null,
    2
  ) + '\n'
)
await writeFile(join(pkgRoot, 'VERSION'), VERSION + '\n')
await writeFile(join(pkgRoot, '.gitkeep'), '')

// 压缩
await mkdir(OUT_DIR, { recursive: true })
const tarPath = join(OUT_DIR, name)
try {
  // cwd=OUT_DIR + 裸文件名：避免 GNU tar 把带盘符的绝对路径当远程主机（C: -> host）
  execFileSync('tar', ['-czf', name, '-C', tmp, 'exitcode'], { cwd: OUT_DIR, stdio: 'ignore' })
} catch (error) {
  fail(`tar 打包失败：${error instanceof Error ? error.message : error}`)
}

// 校验与清单
const buf = await readFile(tarPath)
const sha256 = createHash('sha256').update(buf).digest('hex')
const manifest = {
  version: VERSION,
  file: name,
  sha256,
  node: '>=20',
  updatedAt: new Date().toISOString()
}
await writeFile(join(OUT_DIR, 'version.json'), JSON.stringify(manifest, null, 2) + '\n')
await rm(tmp, { recursive: true, force: true })

console.log('构建完成：')
console.log(`  包:    ${tarPath} (${(buf.length / 1024 / 1024).toFixed(1)} MB)`)
console.log(`  清单:  ${join(OUT_DIR, 'version.json')}`)
console.log(`  sha256: ${sha256}`)
console.log('\n上传到 https://exitcode.cn/releases/ 的文件：')
console.log(`  ${name}`)
console.log('  version.json')
console.log('（install.sh / install.ps1 请上传到 exitcode.cn 根目录：https://exitcode.cn/install.sh、/install.ps1）')
console.log('\n在线更新会自动校验 version.json 中的 sha256。')