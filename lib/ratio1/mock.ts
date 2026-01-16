type Success<T> = { success: true; result: T };
type Failure = { success: false; error: string };

type CStoreValue = string | undefined;

class MockCStore {
  private kv = new Map<string, string>();
  private hashes = new Map<string, Map<string, string>>();

  async getStatus(): Promise<Success<boolean>> {
    return { success: true, result: true };
  }

  async setValue({ key, value }: { key: string; value: string }): Promise<Success<boolean>> {
    this.kv.set(key, value);
    return { success: true, result: true };
  }

  async getValue({ key }: { key: string }): Promise<Success<CStoreValue> | Failure> {
    if (!this.kv.has(key)) return { success: false, error: "missing" };
    return { success: true, result: this.kv.get(key) };
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
  }): Promise<Success<boolean>> {
    const hash = this.ensureHash(hkey);
    hash.set(key, value);
    return { success: true, result: true };
  }

  async hget({
    hkey,
    key,
  }: {
    hkey: string;
    key: string;
  }): Promise<Success<CStoreValue> | Failure> {
    const hash = this.hashes.get(hkey);
    if (!hash || !hash.has(key)) return { success: false, error: "missing" };
    return { success: true, result: hash.get(key) };
  }

  async hgetall({ hkey }: { hkey: string }): Promise<Success<{ keys: string[] }> | Failure> {
    const hash = this.hashes.get(hkey);
    if (!hash) return { success: true, result: { keys: [] } };
    return { success: true, result: { keys: Array.from(hash.keys()) } };
  }
}

export const mockCStore = new MockCStore();

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
