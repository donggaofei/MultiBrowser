import { app } from 'electron';
import {
  promises as fsp,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  statSync,
  readdirSync
} from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';

const BOOTSTRAP_DIR = join(homedir(), '.multibrowser');
const BOOTSTRAP_FILE = join(BOOTSTRAP_DIR, 'config.json');

interface BootstrapConfig {
  dataDir?: string;
  pendingMigrationFrom?: string;
}

let defaultDataDir: string | null = null;

function readBootstrap(): BootstrapConfig {
  try {
    const raw = readFileSync(BOOTSTRAP_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as BootstrapConfig;
  } catch {
    // ignore — file missing or invalid; treat as empty
  }
  return {};
}

function writeBootstrap(cfg: BootstrapConfig): void {
  mkdirSync(BOOTSTRAP_DIR, { recursive: true });
  writeFileSync(BOOTSTRAP_FILE, JSON.stringify(cfg, null, 2), 'utf-8');
}

function migrateSync(from: string, to: string): void {
  if (!existsSync(from)) return;
  mkdirSync(to, { recursive: true });

  const accountsSrc = join(from, 'accounts.json');
  if (existsSync(accountsSrc)) {
    const dst = join(to, 'accounts.json');
    if (!existsSync(dst)) {
      writeFileSync(dst, readFileSync(accountsSrc));
    }
  }

  const partitionsSrc = join(from, 'Partitions');
  if (existsSync(partitionsSrc) && statSync(partitionsSrc).isDirectory()) {
    copyDirSync(partitionsSrc, join(to, 'Partitions'));
  }
}

function copyDirSync(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const s = join(src, entry.name);
    const d = join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(s, d);
    } else if (entry.isFile()) {
      if (!existsSync(d)) {
        writeFileSync(d, readFileSync(s));
      }
    }
    // 忽略 symlink / socket 等特殊文件
  }
}

/**
 * 必须在 app.whenReady() 之前调用。
 * 读取 bootstrap 配置，应用 userData 覆盖；如有 pending 迁移，在切换前完成。
 */
export function applyDataDirOverride(): void {
  defaultDataDir = app.getPath('userData');

  const cfg = readBootstrap();
  const target = cfg.dataDir ?? defaultDataDir;

  if (cfg.pendingMigrationFrom && cfg.pendingMigrationFrom !== target) {
    try {
      mkdirSync(target, { recursive: true });
      migrateSync(cfg.pendingMigrationFrom, target);
    } catch (err) {
      console.error('[data-dir] migration failed:', err);
    }
    delete cfg.pendingMigrationFrom;
    writeBootstrap(cfg);
  }

  if (cfg.dataDir) {
    try {
      mkdirSync(cfg.dataDir, { recursive: true });
      app.setPath('userData', cfg.dataDir);
    } catch (err) {
      console.error('[data-dir] override failed, falling back to default:', err);
    }
  }
}

export function getCurrentDataDir(): string {
  return app.getPath('userData');
}

export function getDefaultDataDir(): string {
  return defaultDataDir ?? app.getPath('userData');
}

export function getBootstrapPath(): string {
  return BOOTSTRAP_FILE;
}

/**
 * 校验目标目录是否可作为新数据目录。
 * 返回错误信息字符串，或 null 表示可用。
 */
export function validateNewDataDir(newDir: string): string | null {
  const target = resolve(newDir);
  const current = resolve(getCurrentDataDir());

  if (target === current) return '所选目录与当前数据目录相同。';

  // 不允许选当前目录的子目录或父目录（会造成递归复制）
  const targetWithSep = target + sep;
  const currentWithSep = current + sep;
  if (target.startsWith(currentWithSep)) {
    return '所选目录位于当前数据目录内部，不能作为新位置。';
  }
  if (current.startsWith(targetWithSep)) {
    return '当前数据目录位于所选目录内部，不能作为新位置。';
  }

  try {
    mkdirSync(target, { recursive: true });
  } catch (err) {
    return `无法创建目录：${(err as Error).message}`;
  }

  // 简单的可写探测
  try {
    const probe = join(target, '.multibrowser-write-test');
    writeFileSync(probe, '');
    void fsp.unlink(probe);
  } catch (err) {
    return `目录不可写：${(err as Error).message}`;
  }

  return null;
}

/**
 * 调度切换：写入 bootstrap 配置；下次启动生效。
 * @param newDir   新数据目录的绝对路径；传 null 表示恢复默认
 * @param migrate  是否在下次启动时把当前目录的数据迁移过去
 */
export function scheduleSwitch(newDir: string | null, migrate: boolean): void {
  const cfg = readBootstrap();
  const currentDir = getCurrentDataDir();

  if (newDir) {
    cfg.dataDir = resolve(newDir);
    if (migrate) cfg.pendingMigrationFrom = currentDir;
    else delete cfg.pendingMigrationFrom;
  } else {
    // 恢复默认：清除覆盖；如需迁移，把当前数据搬回默认目录
    delete cfg.dataDir;
    if (migrate) cfg.pendingMigrationFrom = currentDir;
    else delete cfg.pendingMigrationFrom;
  }

  writeBootstrap(cfg);
}
