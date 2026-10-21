import { backup } from 'node:sqlite';
import {
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  openSync,
  fsyncSync,
  closeSync,
} from 'node:fs';
import { chmod, copyFile, lstat, mkdtemp, open, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { WorkspaceStore } from './store.mjs';

const DATABASE_NAME = 'test-agent.sqlite';

export class StorageService {
  constructor(userData, { notify = () => {}, backupDatabase = backup, forbiddenRoots = [] } = {}) {
    this.userData = userData;
    this.defaultDirectory = path.join(userData, 'storage');
    this.configFile = path.join(userData, 'storage-location.json');
    this.notify = notify;
    this.backupDatabase = backupDatabase;
    this.forbiddenRoots = forbiddenRoots;
    this.activeOperations = 0;
    this.migrating = false;
    this.pending = null;
    let directory = this.defaultDirectory;
    if (existsSync(this.configFile)) {
      let config;
      try {
        config = JSON.parse(readFileSync(this.configFile, 'utf8'));
      } catch {
        throw new Error(`保存目录配置无法读取，请检查：${this.configFile}`);
      }
      if (
        config.version !== 1 ||
        typeof config.directory !== 'string' ||
        !path.isAbsolute(config.directory)
      )
        throw new Error(`保存目录配置无效，请检查：${this.configFile}`);
      directory = config.directory;
      if (!existsSync(path.join(directory, DATABASE_NAME)))
        throw new Error(
          `找不到已配置的数据文件：${path.join(directory, DATABASE_NAME)}。请恢复该目录或连接对应磁盘后重启，应用不会创建空库替代原数据。`,
        );
    }
    this.store = new WorkspaceStore(path.join(directory, DATABASE_NAME));
  }

  info() {
    return {
      directory: path.dirname(this.store.file),
      databasePath: this.store.file,
      defaultDirectory: this.defaultDirectory,
      migrating: this.migrating,
    };
  }

  async run(operation) {
    if (this.migrating) throw new Error('正在迁移本地数据，请稍候再操作。');
    this.activeOperations++;
    try {
      return await operation();
    } finally {
      this.activeOperations--;
    }
  }

  relocate(directory) {
    if (this.migrating) return Promise.reject(new Error('正在迁移本地数据，请稍候。'));
    if (this.activeOperations)
      return Promise.reject(new Error('请等待导入、分析或设置保存完成后，再更改保存目录。'));
    if (typeof directory !== 'string' || !path.isAbsolute(directory))
      return Promise.reject(new Error('请选择有效的本机文件夹。'));
    this.migrating = true;
    this.notify();
    this.pending = this.performRelocation(directory).finally(() => {
      this.migrating = false;
      this.pending = null;
      this.notify();
    });
    return this.pending;
  }

  persistDirectory(directory) {
    mkdirSync(this.userData, { recursive: true, mode: 0o700 });
    const temporary = `${this.configFile}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify({ version: 1, directory }), {
        flag: 'wx',
        mode: 0o600,
      });
      const fd = openSync(temporary, 'r');
      try {
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(temporary, this.configFile);
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
  }

  async performRelocation(directory) {
    const destination = await realpath(directory);
    if (!(await lstat(destination)).isDirectory()) throw new Error('保存位置必须是文件夹。');
    for (const root of this.forbiddenRoots) {
      const relative = path.relative(await realpath(root), destination);
      if (
        !relative ||
        (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
      )
        throw new Error('请选择应用安装目录或项目源码目录之外的文件夹。');
    }
    if (destination === (await realpath(path.dirname(this.store.file)))) return this.info();
    const file = path.join(destination, DATABASE_NAME);
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      try {
        await lstat(file + suffix);
        throw new Error('目标文件夹已有同名数据文件，请选择其他文件夹，避免覆盖已有数据。');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    const temporary = await mkdtemp(path.join(destination, '.test-agent-migration-'));
    let copied = false;
    let candidate;
    let switched = false;
    try {
      const snapshot = path.join(temporary, DATABASE_NAME);
      // SQLite 备份接口包含尚在 WAL 中的已提交数据，不能直接复制正在使用的主文件。
      await this.backupDatabase(this.store.db, snapshot);
      if (process.platform !== 'win32') await chmod(snapshot, 0o600);
      await copyFile(snapshot, file, constants.COPYFILE_EXCL);
      copied = true;
      if (process.platform !== 'win32') await chmod(file, 0o600);
      const handle = await open(file, 'r');
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
      candidate = new WorkspaceStore(file);
      if (candidate.db.prepare('PRAGMA quick_check').get().quick_check !== 'ok')
        throw new Error('迁移后的数据校验失败，继续使用原目录。');
      // 以下提交与连接切换不含 await，保证 UI 不会观察到半切换状态。
      this.persistDirectory(destination);
      const previous = this.store.db;
      this.store.db = candidate.db;
      this.store.file = file;
      switched = true;
      previous.close();
      return this.info();
    } finally {
      if (!switched) {
        candidate?.close();
        if (copied)
          for (const suffix of ['', '-wal', '-shm', '-journal'])
            await rm(file + suffix, { force: true }).catch(() => {});
      }
      await rm(temporary, { recursive: true, force: true }).catch(() => {});
    }
  }
}
