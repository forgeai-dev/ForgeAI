import { createLogger } from '@forgeai/shared';

const logger = createLogger('Security:GDPR');

export interface GDPRUserData {
  userId: string;
  exportedAt: number;
  sessions: unknown[];
  messages: unknown[];
  auditLogs: unknown[];
  preferences: Record<string, unknown>;
  apiKeys: unknown[];
  memories: unknown[];
}

export interface GDPRDeleteResult {
  userId: string;
  deletedAt: number;
  itemsDeleted: {
    sessions: number;
    messages: number;
    auditLogs: number;
    preferences: number;
    apiKeys: number;
    memories: number;
  };
}

export interface DataStore {
  getUserSessions(userId: string): Promise<unknown[]>;
  getUserMessages(userId: string): Promise<unknown[]>;
  getUserAuditLogs(userId: string): Promise<unknown[]>;
  getUserPreferences(userId: string): Promise<Record<string, unknown>>;
  getUserAPIKeys(userId: string): Promise<unknown[]>;
  getUserMemories(userId: string): Promise<unknown[]>;
  deleteUserData(userId: string): Promise<GDPRDeleteResult['itemsDeleted']>;
}

export class GDPRManager {
  private dataStore: DataStore | null = null;
  private exportHistory: Map<string, { exportedAt: number; size: number }[]> = new Map();
  private deleteHistory: Map<string, GDPRDeleteResult> = new Map();

  constructor() {
    logger.info('GDPR manager initialized');
  }

  setDataStore(store: DataStore): void {
    this.dataStore = store;
  }

  async exportUserData(userId: string): Promise<GDPRUserData> {
    logger.info('GDPR data export requested', { userId });

    const data: GDPRUserData = {
      userId,
      exportedAt: Date.now(),
      sessions: [],
      messages: [],
      auditLogs: [],
      preferences: {},
      apiKeys: [],
      memories: [],
    };

    if (this.dataStore) {
      try {
        data.sessions = await this.dataStore.getUserSessions(userId);
        data.messages = await this.dataStore.getUserMessages(userId);
        data.auditLogs = await this.dataStore.getUserAuditLogs(userId);
        data.preferences = await this.dataStore.getUserPreferences(userId);
        data.apiKeys = await this.dataStore.getUserAPIKeys(userId);
        data.memories = await this.dataStore.getUserMemories(userId);
      } catch (err) {
        logger.error('Error exporting user data', { userId, error: String(err) });
      }
    }

    // Track export history
    const history = this.exportHistory.get(userId) ?? [];
    const jsonSize = JSON.stringify(data).length;
    history.push({ exportedAt: data.exportedAt, size: jsonSize });
    this.exportHistory.set(userId, history);

    logger.info('GDPR data exported', { userId, size: jsonSize });
    return data;
  }

  async deleteUserData(userId: string): Promise<GDPRDeleteResult> {
    logger.info('GDPR data deletion requested', { userId });

    const result: GDPRDeleteResult = {
      userId,
      deletedAt: Date.now(),
      itemsDeleted: {
        sessions: 0,
        messages: 0,
        auditLogs: 0,
        preferences: 0,
        apiKeys: 0,
        memories: 0,
      },
    };

    if (this.dataStore) {
      try {
        result.itemsDeleted = await this.dataStore.deleteUserData(userId);
      } catch (err) {
        logger.error('Error deleting user data', { userId, error: String(err) });
      }
    }

    // Track deletion
    this.deleteHistory.set(userId, result);
    this.exportHistory.delete(userId);

    logger.info('GDPR data deleted', { userId, items: result.itemsDeleted });
    return result;
  }

  getExportHistory(userId: string): Array<{ exportedAt: number; size: number }> {
    return this.exportHistory.get(userId) ?? [];
  }

  getDeleteHistory(userId: string): GDPRDeleteResult | undefined {
    return this.deleteHistory.get(userId);
  }

  getStatus(): { totalExports: number; totalDeletions: number; usersWithData: number } {
    let totalExports = 0;
    for (const history of this.exportHistory.values()) {
      totalExports += history.length;
    }
    return {
      totalExports,
      totalDeletions: this.deleteHistory.size,
      usersWithData: this.exportHistory.size,
    };
  }
}

export function createGDPRManager(): GDPRManager {
  return new GDPRManager();
}
