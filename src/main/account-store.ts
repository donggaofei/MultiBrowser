import { app } from 'electron';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Account } from '../shared/types';
import { DEFAULT_URL } from '../shared/types';

const FILE_NAME = 'accounts.json';

export class AccountStore {
  private accounts: Account[] = [];
  private filePath: string;
  private writeChain: Promise<void> = Promise.resolve();

  constructor() {
    this.filePath = join(app.getPath('userData'), FILE_NAME);
  }

  async load(): Promise<Account[]> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        this.accounts = parsed.filter(this.isValidAccount);
      }
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('[AccountStore] load failed:', err);
      }
      this.accounts = [];
    }
    return this.list();
  }

  list(): Account[] {
    return this.accounts.map((a) => ({ ...a }));
  }

  get(id: string): Account | undefined {
    const found = this.accounts.find((a) => a.id === id);
    return found ? { ...found } : undefined;
  }

  async add(name: string, url?: string): Promise<Account> {
    const account: Account = {
      id: randomUUID(),
      name: name.trim() || `账号 ${this.accounts.length + 1}`,
      url: url?.trim() || DEFAULT_URL,
      createdAt: Date.now()
    };
    this.accounts.push(account);
    await this.persist();
    return { ...account };
  }

  async rename(id: string, name: string): Promise<Account | undefined> {
    const account = this.accounts.find((a) => a.id === id);
    if (!account) return undefined;
    account.name = name.trim() || account.name;
    await this.persist();
    return { ...account };
  }

  async updateUrl(id: string, url: string): Promise<void> {
    const account = this.accounts.find((a) => a.id === id);
    if (!account) return;
    account.url = url;
    await this.persist();
  }

  async remove(id: string): Promise<boolean> {
    const idx = this.accounts.findIndex((a) => a.id === id);
    if (idx === -1) return false;
    this.accounts.splice(idx, 1);
    await this.persist();
    return true;
  }

  private isValidAccount(value: unknown): value is Account {
    if (!value || typeof value !== 'object') return false;
    const v = value as Record<string, unknown>;
    return (
      typeof v.id === 'string' &&
      typeof v.name === 'string' &&
      typeof v.url === 'string' &&
      typeof v.createdAt === 'number'
    );
  }

  private persist(): Promise<void> {
    const snapshot = JSON.stringify(this.accounts, null, 2);
    this.writeChain = this.writeChain
      .catch(() => undefined)
      .then(() => fs.writeFile(this.filePath, snapshot, 'utf-8'));
    return this.writeChain;
  }
}
