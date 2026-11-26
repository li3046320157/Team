// 仅供 Node 契约测试使用的内存数据库，模拟平台数据客户端的查询语义。
const UNIQUE_KEYS = {
  users: [['username_lower'], ['phone']],
  sessions: [['token_digest']],
  auth_limiter: [['key']],
  auth_events: [['id']],
  usage_daily: [['user_id', 'day']],
};

const clone = (row) => ({ ...row });

function project(row, columns) {
  if (!columns || columns === '*') return clone(row);
  const picked = {};
  for (const column of String(columns).split(',').map((item) => item.trim()).filter(Boolean)) {
    picked[column] = row[column] ?? null;
  }
  return picked;
}

function sameValue(left, right) {
  if (left == null && right == null) return true;
  return String(left) === String(right);
}

function conflict(table, candidate, rows) {
  for (const key of UNIQUE_KEYS[table] ?? []) {
    if (key.every((column) => candidate[column] == null)) continue;
    if (rows.some((row) => key.every((column) => sameValue(row[column], candidate[column])))) return true;
  }
  return false;
}

function wildcard(pattern) {
  const source = [...String(pattern)].map((char) => {
    if (char === '*' || char === '%') return '.*';
    if (char === '_') return '.';
    return /[.*+?^${}()|[\]\\]/.test(char) ? `\\${char}` : char;
  }).join('');
  return new RegExp(`^${source}$`, 'i');
}

export class FakeDb {
  constructor(seed = {}) {
    this.tables = new Map();
    for (const [table, rows] of Object.entries(seed)) {
      this.tables.set(table, rows.map(clone));
    }
  }

  rowsOf(table) {
    return this.tables.get(table) ?? [];
  }

  from(table) {
    if (!this.tables.has(table)) this.tables.set(table, []);
    return new Query(this, table);
  }
}

class Query {
  constructor(db, table) {
    this.db = db;
    this.table = table;
    this.operation = 'select';
    this.payload = null;
    this.options = {};
    this.columns = '*';
    this.countExact = false;
    this.filters = [];
    this.orderings = [];
    this.limitValue = null;
    this.rangeValue = null;
  }

  select(columns = '*', options = {}) {
    this.columns = columns;
    this.countExact = options?.count === 'exact';
    return this;
  }

  insert(row) {
    this.operation = 'insert';
    this.payload = row;
    return this;
  }

  insertIfAbsent(row, options = {}) {
    this.operation = 'insertIfAbsent';
    this.payload = row;
    this.options = options;
    return this;
  }

  update(patch) {
    this.operation = 'update';
    this.payload = patch;
    return this;
  }

  delete() {
    this.operation = 'delete';
    return this;
  }

  eq(column, value) {
    this.filters.push((row) => sameValue(row[column], value));
    return this;
  }

  gte(column, value) {
    this.filters.push((row) => row[column] != null && String(row[column]) >= String(value));
    return this;
  }

  lte(column, value) {
    this.filters.push((row) => row[column] != null && String(row[column]) <= String(value));
    return this;
  }

  ilike(column, pattern) {
    const regex = wildcard(pattern);
    this.filters.push((row) => typeof row[column] === 'string' && regex.test(row[column]));
    return this;
  }

  order(column, options = {}) {
    this.orderings.push({ column, ascending: options?.ascending !== false });
    return this;
  }

  limit(value) {
    this.limitValue = value;
    return this;
  }

  range(from, to) {
    this.rangeValue = [from, to];
    return this;
  }

  matches(row) {
    return this.filters.every((filter) => filter(row));
  }

  sorted(rows) {
    const list = [...rows];
    for (const { column, ascending } of [...this.orderings].reverse()) {
      list.sort((left, right) => {
        const a = left[column];
        const b = right[column];
        if (a == null && b == null) return 0;
        if (a == null) return 1;
        if (b == null) return -1;
        const result = String(a).localeCompare(String(b));
        return ascending ? result : -result;
      });
    }
    return list;
  }

  windowed(rows) {
    if (this.rangeValue) {
      const [from, to] = this.rangeValue;
      return rows.slice(from, to + 1);
    }
    return this.limitValue == null ? rows : rows.slice(0, this.limitValue);
  }

  executeSelect() {
    const all = this.db.rowsOf(this.table);
    const matched = all.filter((row) => this.matches(row));
    const rows = this.windowed(this.sorted(matched));
    return {
      data: rows.map((row) => project(row, this.columns)),
      error: null,
      count: this.countExact ? matched.length : null,
    };
  }

  executeInsert() {
    const all = this.db.rowsOf(this.table);
    const candidate = clone(this.payload);
    if (conflict(this.table, candidate, all)) {
      if (this.operation === 'insertIfAbsent') return { data: [], error: null, count: null };
      return { data: null, error: { message: 'duplicate key' }, count: null };
    }
    all.push(candidate);
    return { data: [project(candidate, this.columns)], error: null, count: null };
  }

  executeUpdate() {
    const all = this.db.rowsOf(this.table);
    const matched = all.filter((row) => this.matches(row));
    const next = matched.map((row) => ({ ...row, ...this.payload }));
    for (const row of next) {
      if (conflict(this.table, row, all.filter((existing) => !matched.includes(existing)))) {
        return { data: null, error: { message: 'duplicate key' }, count: null };
      }
    }
    for (const row of matched) Object.assign(row, this.payload);
    return { data: next.map((row) => project(row, this.columns)), error: null, count: null };
  }

  executeDelete() {
    const all = this.db.rowsOf(this.table);
    const keep = all.filter((row) => !this.matches(row));
    this.db.tables.set(this.table, keep);
    return { data: [], error: null, count: null };
  }

  execute() {
    if (this.operation === 'insert' || this.operation === 'insertIfAbsent') return this.executeInsert();
    if (this.operation === 'update') return this.executeUpdate();
    if (this.operation === 'delete') return this.executeDelete();
    return this.executeSelect();
  }

  then(onFulfilled, onRejected) {
    try {
      const result = this.execute();
      return Promise.resolve(onFulfilled ? onFulfilled(result) : result);
    } catch (error) {
      return onRejected ? Promise.resolve(onRejected(error)) : Promise.reject(error);
    }
  }
}