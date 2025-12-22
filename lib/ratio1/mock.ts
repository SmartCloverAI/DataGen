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

export type MockUser = {
  username: string;
  password: string;
  role: string;
};

const mockUsers: MockUser[] = [
  { username: "admin", password: "admin", role: "admin" },
  { username: "test_user", password: "testtest", role: "user" },
];

class MockAuth {
  simple = {
    init: async () => {},
    authenticate: async (username: string, password: string) => {
      const user = mockUsers.find(
        (u) => u.username === username && u.password === password,
      );
      if (!user) {
        const err = new Error("Invalid credentials");
        // mimic cstore-auth-ts error shape loosely
        (err as any).code = "INVALID_CREDENTIALS";
        throw err;
      }
      return {
        username: user.username,
        role: user.role,
        metadata: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        type: "simple",
      };
    },
  };
}

export const mockAuth = new MockAuth();
