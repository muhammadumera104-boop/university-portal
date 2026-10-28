// A small in-memory stand-in for the Supabase client: enough of the query builder for route tests.
// Embedded relations are not resolved; seed rows with any nested objects a route reads.
export function createFakeSupabase() {
  const tables = {};
  const tokens = new Map();
  const storage = [];

  function query(table) {
    const filters = []; let mode = 'select'; let payload = null; let single = null; let head = false; let wantCount = false; let upsertKey = null; let ignoreDuplicates = false;
    const rows = () => (tables[table] ||= []);
    const matches = (row) => filters.every((test) => test(row));
    const builder = {
      select(_columns, options = {}) { head = Boolean(options.head); wantCount = options.count === 'exact'; return builder; },
      eq(column, value) { filters.push((row) => row[column] === value); return builder; },
      neq(column, value) { filters.push((row) => row[column] !== value); return builder; },
      in(column, values) { filters.push((row) => values.includes(row[column])); return builder; },
      is(column, value) { filters.push((row) => (row[column] ?? null) === value); return builder; },
      lt() { return builder; }, lte() { return builder; }, ilike() { return builder; }, or() { return builder; },
      order() { return builder; }, range() { return builder; }, limit() { return builder; },
      insert(value) { mode = 'insert'; payload = value; return builder; },
      update(value) { mode = 'update'; payload = value; return builder; },
      upsert(value, options = {}) { mode = 'upsert'; payload = value; upsertKey = options.onConflict?.split(','); ignoreDuplicates = Boolean(options.ignoreDuplicates); return builder; },
      delete() { mode = 'delete'; return builder; },
      single() { single = 'single'; return builder; },
      maybeSingle() { single = 'maybe'; return builder; },
      then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); },
    };
    function run() {
      let data;
      if (mode === 'insert' || mode === 'upsert') {
        const items = (Array.isArray(payload) ? payload : [payload]).map((item) => ({ id: item.id || crypto.randomUUID(), created_at: new Date().toISOString(), ...item }));
        data = [];
        for (const item of items) {
          const existing = upsertKey && rows().find((row) => upsertKey.every((key) => row[key] === item[key]));
          if (existing) { if (!ignoreDuplicates) Object.assign(existing, item); data.push(existing); } else { rows().push(item); data.push(item); }
        }
      } else if (mode === 'update') {
        data = rows().filter(matches); data.forEach((row) => Object.assign(row, payload));
      } else if (mode === 'delete') {
        data = rows().filter(matches); tables[table] = rows().filter((row) => !matches(row));
      } else data = rows().filter(matches);
      const count = wantCount ? data.length : null;
      if (head) return { data: null, count, error: null };
      if (single) {
        if (data.length === 1) return { data: data[0], count, error: null };
        if (single === 'maybe' && !data.length) return { data: null, count, error: null };
        return { data: null, count, error: { code: 'PGRST116', message: 'No rows' } };
      }
      return { data, count, error: null };
    }
    return builder;
  }

  const client = {
    from: query,
    auth: {
      async getUser(token) { const user = tokens.get(token); return user ? { data: { user }, error: null } : { data: { user: null }, error: { message: 'invalid' } }; },
      admin: { async createUser({ email }) {
        // Mirrors the handle_new_user trigger: every auth user gets an inactive profile row.
        if ((tables.profiles ||= []).some((row) => row.email === email)) return { data: { user: null }, error: { message: 'already registered' } };
        const id = crypto.randomUUID(); tables.profiles.push({ id, email, is_active: false, role: 'student' });
        return { data: { user: { id } }, error: null };
      }, async deleteUser() { return { error: null }; }, async updateUserById() { return { error: null }; }, async signOut() { return { error: null }; } },
    },
    storage: { from: () => ({ async upload(path) { storage.push(path); return { error: null }; }, async remove() { return { error: null }; }, async createSignedUrl(path) { return { data: { signedUrl: `https://files.test/${path}` }, error: null }; } }) },
  };

  return {
    client,
    tables,
    storage,
    seed(table, ...rows) { (tables[table] ||= []).push(...rows); },
    // Registers a signed-in user: their bearer token is the user id.
    signIn(profile) { (tables.profiles ||= []).push({ is_active: true, must_change_password: false, ...profile }); tokens.set(profile.id, { id: profile.id, email: profile.email }); return profile.id; },
    reset() { for (const key of Object.keys(tables)) delete tables[key]; tokens.clear(); storage.length = 0; },
  };
}
