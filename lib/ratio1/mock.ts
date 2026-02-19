type CStoreValue = string | undefined;

class MockCStore {
  private kv = new Map<string, string>();
  private hashes = new Map<string, Map<string, string>>();

  async getStatus(): Promise<boolean> {
    return true;
  }

  async setValue({ key, value }: { key: string; value: string }): Promise<boolean> {
    this.kv.set(key, value);
    return true;
  }

  async getValue({ key }: { key: string }): Promise<CStoreValue | null> {
    if (!this.kv.has(key)) return null;
    return this.kv.get(key) ?? null;
  }

  private ensureHash(hkey: string) {
    if (!this.hashes.has(hkey)) {
      this.hashes.set(hkey, new Map<string, string>());
    }
    return this.hashes.get(hkey)!;
  }

  async hset({
    hkey,
    key,
    value,
  }: {
    hkey: string;
    key: string;
    value: string;
  }): Promise<boolean> {
    const hash = this.ensureHash(hkey);
    hash.set(key, value);
    return true;
  }

  async hget({
    hkey,
    key,
  }: {
    hkey: string;
    key: string;
  }): Promise<CStoreValue | null> {
    const hash = this.hashes.get(hkey);
    if (!hash || !hash.has(key)) return null;
    return hash.get(key) ?? null;
  }

  async hgetall({ hkey }: { hkey: string }): Promise<Record<string, string>> {
    const hash = this.hashes.get(hkey);
    if (!hash) return {};
    return Object.fromEntries(hash.entries());
  }
}

export const mockCStore = new MockCStore();

type MockR1File = {
  filename?: string;
  data: Buffer;
};

class MockR1fs {
  private files = new Map<string, MockR1File>();
  private cidCounter = 0;

  private nextCid() {
    this.cidCounter += 1;
    return `mock_cid_${this.cidCounter.toString(16)}`;
  }

  async addJson({ data }: { data: Record<string, any> }) {
    const cid = this.nextCid();
    const payload = Buffer.from(JSON.stringify(data, null, 2), "utf8");
    this.files.set(cid, { data: payload, filename: "data.json" });
    return { cid };
  }

  async addFile({
    file,
    filename,
  }: {
    file?: Buffer | string;
    filename?: string;
  }) {
    const cid = this.nextCid();
    let payload = Buffer.alloc(0);
    if (Buffer.isBuffer(file)) {
      payload = Buffer.from(file);
    } else if (typeof file === "string") {
      payload = Buffer.from(file, "utf8");
    }
    this.files.set(cid, { data: payload, filename });
    return { cid, message: "ok" };
  }

  async addFileBase64({
    file_base64_str,
    filename,
  }: {
    file_base64_str: string;
    filename?: string;
  }) {
    const cid = this.nextCid();
    const payload = Buffer.from(file_base64_str, "base64");
    this.files.set(cid, { data: payload, filename });
    return { cid, message: "ok" };
  }

  async getFile({ cid }: { cid: string }) {
    const file = this.files.get(cid);
    if (!file) return {};
    return {
      file_data: file.data.toString("utf8"),
      filename: file.filename,
    };
  }

  async getFileBase64({ cid }: { cid: string }) {
    const file = this.files.get(cid);
    if (!file) return {};
    return {
      file_base64_str: file.data.toString("base64"),
      filename: file.filename,
    };
  }
}

export const mockR1fs = new MockR1fs();

type MockUser = {
  username: string;
  password: string;
  role: "admin" | "user";
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

const mockUsers = new Map<string, MockUser>([
  [
    "admin",
    {
      username: "admin",
      password: "admin",
      role: "admin",
      metadata: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ],
  [
    "test_user",
    {
      username: "test_user",
      password: "testtest",
      role: "user",
      metadata: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ],
]);

function toPublic(user: MockUser) {
  return {
    username: user.username,
    role: user.role,
    metadata: { ...user.metadata },
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    type: "simple",
  };
}

class MockAuth {
  simple = {
    init: async () => {},
    authenticate: async (username: string, password: string) => {
      const key = username.trim().toLowerCase();
      const user = mockUsers.get(key);
      if (!user || user.password !== password) {
        const err = new Error("Invalid credentials");
        (err as any).code = "INVALID_CREDENTIALS";
        err.name = "InvalidCredentialsError";
        throw err;
      }
      return toPublic(user);
    },
    createUser: async (
      username: string,
      password: string,
      opts?: { role?: "admin" | "user"; metadata?: Record<string, unknown> },
    ) => {
      const key = username.trim().toLowerCase();
      if (mockUsers.has(key)) {
        const err = new Error("User exists");
        (err as any).code = "USER_EXISTS";
        err.name = "UserExistsError";
        throw err;
      }
      const now = new Date().toISOString();
      const record: MockUser = {
        username: key,
        password,
        role: opts?.role === "admin" ? "admin" : "user",
        metadata: opts?.metadata ?? {},
        createdAt: now,
        updatedAt: now,
      };
      mockUsers.set(key, record);
      return toPublic(record);
    },
    getUser: async (username: string) => {
      const user = mockUsers.get(username.trim().toLowerCase());
      return user ? toPublic(user) : null;
    },
    getAllUsers: async () => Array.from(mockUsers.values()).map(toPublic),
    updateUser: async (
      username: string,
      opts: { role?: "admin" | "user"; metadata?: Record<string, unknown> },
    ) => {
      const key = username.trim().toLowerCase();
      const existing = mockUsers.get(key);
      if (!existing) {
        const err = new Error("User not found");
        (err as any).code = "USER_NOT_FOUND";
        err.name = "UserNotFoundError";
        throw err;
      }
      const updated: MockUser = {
        ...existing,
        role: opts.role ?? existing.role,
        metadata: opts.metadata ?? existing.metadata,
        updatedAt: new Date().toISOString(),
      };
      mockUsers.set(key, updated);
      return toPublic(updated);
    },
    changePassword: async (
      username: string,
      currentPassword: string,
      newPassword: string,
    ) => {
      const key = username.trim().toLowerCase();
      const existing = mockUsers.get(key);
      if (!existing || existing.password !== currentPassword) {
        const err = new Error("Invalid credentials");
        (err as any).code = "INVALID_CREDENTIALS";
        err.name = "InvalidCredentialsError";
        throw err;
      }
      existing.password = newPassword;
      existing.updatedAt = new Date().toISOString();
      mockUsers.set(key, existing);
    },
  };
}

export const mockAuth = new MockAuth();
