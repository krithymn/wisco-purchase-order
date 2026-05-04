const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');

const app = express();
const PORT = process.env.PORT || 80;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'wisco_orders.db');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let db;

const DEFAULT_STEPS = [
  { name: "รับ PR",                               defaultDays: 1  },
  { name: "หา SUP",                               defaultDays: 3  },
  { name: "เทียบ SUP",                            defaultDays: 2  },
  { name: "รับ Drawing",                          defaultDays: 3  },
  { name: "ลูกค้า Approve Drawing",               defaultDays: 5  },
  { name: "ขอ Approve Nameplate",                 defaultDays: 3  },
  { name: "เปิด POI",                             defaultDays: 1  },
  { name: "Approve POI",                          defaultDays: 1  },
  { name: "ส่ง POI / Drawing / Nameplate ให้ SUP", defaultDays: 1 },
  { name: "รับ PI",                               defaultDays: 3  },
  { name: "แจ้งบัญชี",                            defaultDays: 1  },
  { name: "เริ่มผลิต",                            defaultDays: 30 },
  { name: "ตรวจสอบก่อนแพ็คสินค้า",              defaultDays: 2  },
  { name: "จ่ายเงิน SUP",                         defaultDays: 2  },
  { name: "ติดตามการขนส่ง",                       defaultDays: 7  },
  { name: "แจ้งสินค้าเข้า",                       defaultDays: 1  },
  { name: "ส่งเอกสาร CER/DRAWING",               defaultDays: 1  },
  { name: "ตรวจสอบสินค้าเข้า",                   defaultDays: 2  },
  { name: "รับสินค้าเข้าระบบ",                   defaultDays: 1  }
];

async function initDB() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    db = new SQL.Database(fs.readFileSync(DB_PATH));
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS orders (
      id              TEXT PRIMARY KEY,
      customer        TEXT DEFAULT '',
      factory         TEXT DEFAULT '',
      product         TEXT DEFAULT '',
      quantity        TEXT DEFAULT '',
      customer_po     TEXT DEFAULT '',
      prepayment      INTEGER DEFAULT 0,
      prepayment_done INTEGER DEFAULT 0,
      start_date      TEXT DEFAULT '',
      due_date        TEXT DEFAULT '',
      notes           TEXT DEFAULT '',
      items           TEXT DEFAULT '[]',
      is_partial      INTEGER DEFAULT 0,
      delivery_date_sup     TEXT DEFAULT '',
      delivery_date_cust    TEXT DEFAULT '',
      po_open_date         TEXT DEFAULT '',
      production_finish_date TEXT DEFAULT '',
      created_at      TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS order_steps (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id      TEXT NOT NULL,
      step_index    INTEGER NOT NULL,
      responsible   TEXT DEFAULT '—',
      planned_days  INTEGER DEFAULT 0,
      is_special    INTEGER DEFAULT 0,
      special_reason TEXT DEFAULT '',
      planned_date  TEXT DEFAULT '',
      done_date     TEXT DEFAULT '',
      notes         TEXT DEFAULT '',
      is_skipped    INTEGER DEFAULT 0,
      mfg_steps     TEXT DEFAULT '[]',
      UNIQUE(order_id, step_index)
    );
    CREATE TABLE IF NOT EXISTS config (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  const teamRow = query("SELECT value FROM config WHERE key='team'");
  if (!teamRow.length) {
    db.run("INSERT OR IGNORE INTO config(key,value) VALUES('team',?)",
      [JSON.stringify(["WR-CEO","Hard-Marketing","Ziea-Purchasing officer",
        "Fast-Proposal Engineer","Fah-Proposal Engineer","วี-SA Director",
        "นิล-SA Manager","เสมียน-Warehouse"])]);
  }
  const custRow = query("SELECT value FROM config WHERE key='customers'");
  if (!custRow.length) {
    db.run("INSERT OR IGNORE INTO config(key,value) VALUES('customers',?)",
      [JSON.stringify([])]);
  }
  const supRow = query("SELECT value FROM config WHERE key='suppliers'");
  if (!supRow.length) {
    db.run("INSERT OR IGNORE INTO config(key,value) VALUES('suppliers',?)",
      [JSON.stringify(["Allto","ANIX","KINETROL","RICK VALVE","HOFMANN","WATTS","XIAO VALVE","EMICO","HERO","TECO","AIV SINGAPORE"])]);
  }
  // Always update steps to latest version (19 steps)
  db.run("INSERT OR REPLACE INTO config(key,value) VALUES('steps',?)",
    [JSON.stringify(DEFAULT_STEPS)]);
  // Migration: add mfg_steps column if it doesn't exist (for existing databases)
  try { db.run("ALTER TABLE order_steps ADD COLUMN mfg_steps TEXT DEFAULT '[]'"); } catch(e) { /* already exists */ }
  try { db.run("ALTER TABLE orders ADD COLUMN items TEXT DEFAULT '[]'"); } catch(e) { /* already exists */ }
  try { db.run("ALTER TABLE orders ADD COLUMN po_open_date TEXT DEFAULT ''"); } catch(e) { /* already exists */ }
  try { db.run("ALTER TABLE order_steps ADD COLUMN is_skipped INTEGER DEFAULT 0"); } catch(e) { /* already exists */ }
  try { db.run("ALTER TABLE orders ADD COLUMN production_finish_date TEXT DEFAULT ''"); } catch(e) { /* already exists */ }
  try { db.run("ALTER TABLE orders ADD COLUMN is_partial INTEGER DEFAULT 0"); } catch(e) { /* already exists */ }
  try { db.run("ALTER TABLE orders ADD COLUMN delivery_date_sup TEXT DEFAULT ''"); } catch(e) { /* already exists */ }
  try { db.run("ALTER TABLE orders ADD COLUMN delivery_date_cust TEXT DEFAULT ''"); } catch(e) { /* already exists */ }

  saveDB();
  console.log('  ✅ Database ready.');
}

function saveDB() {
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
}
function query(sql, params=[]) {
  const res = db.exec(sql, params);
  if (!res.length) return [];
  const {columns, values} = res[0];
  return values.map(row => { const o={}; columns.forEach((c,i)=>o[c]=row[i]); return o; });
}
function run(sql, params=[]) { db.run(sql, params); saveDB(); }

function getSteps() {
  const r = query("SELECT value FROM config WHERE key='steps'");
  return r.length ? JSON.parse(r[0].value) : DEFAULT_STEPS;
}

function buildOrder(row) {
  const steps = getSteps();
  const totalSteps = steps.length + (row.prepayment ? 1 : 0);
  const stepRows = query("SELECT * FROM order_steps WHERE order_id=? ORDER BY step_index", [row.id]);

  const responsible   = Array(totalSteps).fill('—');
  const plannedDays   = Array(totalSteps).fill(0);
  const isSpecial     = Array(totalSteps).fill(false);
  const specialReason = Array(totalSteps).fill('');
  const plannedDates  = Array(totalSteps).fill('');
  const doneDates     = Array(totalSteps).fill('');
  const stepNotes     = Array(totalSteps).fill('');
  const mfgSteps      = Array(totalSteps).fill(null).map(()=>[]);
  const skippedSteps  = Array(totalSteps).fill(false);
  let completedSteps  = 0;

  stepRows.forEach(s => {
    const i = s.step_index;
    if (i >= totalSteps) return;
    responsible[i]   = s.responsible   || '—';
    plannedDays[i]   = s.planned_days  || 0;
    isSpecial[i]     = !!s.is_special;
    specialReason[i] = s.special_reason|| '';
    plannedDates[i]  = s.planned_date  || '';
    doneDates[i]     = s.done_date     || '';
    stepNotes[i]     = s.notes         || '';
    try { mfgSteps[i] = JSON.parse(s.mfg_steps||'[]'); } catch(e){ mfgSteps[i]=[]; }
    skippedSteps[i] = !!s.is_skipped;
    if (s.done_date) completedSteps = Math.max(completedSteps, i + 1);
  });

  return {
    id: row.id, customer: row.customer||'', factory: row.factory||'',
    product: row.product||'', quantity: row.quantity||'',
    customerPO: row.customer_po||'', notes: row.notes||'',
    isPartial: !!row.is_partial,
    deliveryDateSup: row.delivery_date_sup||'',
    deliveryDateCust: row.delivery_date_cust||'',
    poOpenDate: row.po_open_date||'',
    productionFinishDate: row.production_finish_date||'',
    items: (() => { try { return JSON.parse(row.items||'[]'); } catch(e) { return []; } })(),
    prepayment: !!row.prepayment, prepaymentDone: !!row.prepayment_done,
    startDate: row.start_date||'', dueDate: row.due_date||'',
    completedSteps, totalSteps,
    responsible, plannedDays, isSpecial, specialReason,
    plannedDates, doneDates, stepNotes, mfgSteps, skippedSteps
  };
}

// ── ROUTES ──────────────────────────────────────────────────
app.get('/api/orders', (req, res) => {
  try {
    res.json(query("SELECT * FROM orders ORDER BY created_at DESC").map(buildOrder));
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.post('/api/orders', (req, res) => {
  try {
    const {id,customer,factory,product,quantity,customerPO,prepayment,startDate,dueDate,notes} = req.body;
    if (!id) return res.status(400).json({error:'id required'});
    if (query("SELECT id FROM orders WHERE id=?",[id]).length)
      return res.status(409).json({error:'Order ID already exists'});
    const itemsJson = JSON.stringify(req.body.items||[]);
    const poOpenDate=req.body.poOpenDate||''; const prodFinish=req.body.productionFinishDate||'';
    const isPartial=req.body.isPartial?1:0;
    const delSup=req.body.deliveryDateSup||''; const delCust=req.body.deliveryDateCust||'';
    run("INSERT INTO orders(id,customer,factory,product,quantity,customer_po,prepayment,start_date,due_date,notes,items,po_open_date,production_finish_date,is_partial,delivery_date_sup,delivery_date_cust) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [id,customer||'',factory||'',product||'',quantity||'',customerPO||'',prepayment?1:0,startDate||'',dueDate||'',notes||'',itemsJson,poOpenDate,prodFinish,isPartial,delSup,delCust]);
    const steps = getSteps();
    const total = steps.length + (prepayment?1:0);
    for (let i=0;i<total;i++) run("INSERT OR IGNORE INTO order_steps(order_id,step_index,planned_days) VALUES(?,?,?)",[id,i,0]);
    res.status(201).json(buildOrder(query("SELECT * FROM orders WHERE id=?",[id])[0]));
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.put('/api/orders/:id', (req, res) => {
  try {
    const {customer,factory,product,quantity,customerPO,prepayment,startDate,dueDate,notes} = req.body;
    run("UPDATE orders SET customer=?,factory=?,product=?,quantity=?,customer_po=?,prepayment=?,start_date=?,due_date=?,notes=?,items=?,po_open_date=?,production_finish_date=?,is_partial=?,delivery_date_sup=?,delivery_date_cust=? WHERE id=?",
      [customer||'',factory||'',product||'',quantity||'',customerPO||'',prepayment?1:0,startDate||'',dueDate||'',notes||'',JSON.stringify(req.body.items||[]),req.body.poOpenDate||'',req.body.productionFinishDate||'',req.body.isPartial?1:0,req.body.deliveryDateSup||'',req.body.deliveryDateCust||'',req.params.id]);
    res.json(buildOrder(query("SELECT * FROM orders WHERE id=?",[req.params.id])[0]));
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.delete('/api/orders/:id', (req, res) => {
  try {
    run("DELETE FROM order_steps WHERE order_id=?",[req.params.id]);
    run("DELETE FROM orders WHERE id=?",[req.params.id]);
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.patch('/api/orders/:id/steps/:si', (req, res) => {
  try {
    const {responsible,plannedDays,isSpecial,specialReason,plannedDate,doneDate,notes} = req.body;
    const si=parseInt(req.params.si), oid=req.params.id;
    run("INSERT OR IGNORE INTO order_steps(order_id,step_index) VALUES(?,?)",[oid,si]);
    if (responsible  !==undefined) run("UPDATE order_steps SET responsible=?   WHERE order_id=? AND step_index=?",[responsible,oid,si]);
    if (plannedDays  !==undefined) run("UPDATE order_steps SET planned_days=?  WHERE order_id=? AND step_index=?",[plannedDays,oid,si]);
    if (isSpecial    !==undefined) run("UPDATE order_steps SET is_special=?    WHERE order_id=? AND step_index=?",[isSpecial?1:0,oid,si]);
    if (specialReason!==undefined) run("UPDATE order_steps SET special_reason=? WHERE order_id=? AND step_index=?",[specialReason,oid,si]);
    if (plannedDate  !==undefined) run("UPDATE order_steps SET planned_date=?  WHERE order_id=? AND step_index=?",[plannedDate,oid,si]);
    if (doneDate     !==undefined) run("UPDATE order_steps SET done_date=?     WHERE order_id=? AND step_index=?",[doneDate,oid,si]);
    if (notes        !==undefined) run("UPDATE order_steps SET notes=?         WHERE order_id=? AND step_index=?",[notes,oid,si]);
    if (req.body.mfgSteps!==undefined) run("UPDATE order_steps SET mfg_steps=? WHERE order_id=? AND step_index=?",[JSON.stringify(req.body.mfgSteps),oid,si]);
    if (req.body.isSkipped!==undefined) run("UPDATE order_steps SET is_skipped=? WHERE order_id=? AND step_index=?",[req.body.isSkipped?1:0,oid,si]);
    res.json(buildOrder(query("SELECT * FROM orders WHERE id=?",[oid])[0]));
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.patch('/api/orders/:id/prepayment', (req, res) => {
  try {
    const val = req.body.undo ? 0 : 1;
    run("UPDATE orders SET prepayment_done=? WHERE id=?",[val, req.params.id]);
    res.json(buildOrder(query("SELECT * FROM orders WHERE id=?",[req.params.id])[0]));
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.get('/api/config', (req, res) => {
  try {
    const team  = query("SELECT value FROM config WHERE key='team'");
    const steps = query("SELECT value FROM config WHERE key='steps'");
    const suppliers = query("SELECT value FROM config WHERE key='suppliers'");
    res.json({
      team:      team.length      ? JSON.parse(team[0].value)      : [],
      steps:     steps.length     ? JSON.parse(steps[0].value)     : DEFAULT_STEPS,
      suppliers: suppliers.length ? JSON.parse(suppliers[0].value) : []
    });
  } catch(e) { res.status(500).json({error:e.message}); }
});
app.put('/api/config/team', (req, res) => {
  try { run("INSERT OR REPLACE INTO config(key,value) VALUES('team',?)",[JSON.stringify(req.body.team)]); res.json({ok:true}); }
  catch(e) { res.status(500).json({error:e.message}); }
});
app.put('/api/config/steps', (req, res) => {
  try { run("INSERT OR REPLACE INTO config(key,value) VALUES('steps',?)",[JSON.stringify(req.body.steps)]); res.json({ok:true}); }
  catch(e) { res.status(500).json({error:e.message}); }
});
app.put('/api/config/suppliers', (req, res) => {
  try {
    run("INSERT OR REPLACE INTO config(key,value) VALUES('suppliers',?)",[JSON.stringify(req.body.suppliers)]);
    console.log('Suppliers saved:', req.body.suppliers);
    res.json({ok:true});
  }
  catch(e) { console.error('Supplier save error:',e); res.status(500).json({error:e.message}); }
});

// ── MIGRATE ORDERS TO NEW STEPS ─────────────────────────────
app.post('/api/migrate-steps', (req, res) => {
  try {
    const orders = query("SELECT * FROM orders");
    const steps = DEFAULT_STEPS;
    let migrated = 0;
    orders.forEach(o => {
      const totalSteps = steps.length + (o.prepayment ? 1 : 0);
      const existing = query("SELECT step_index FROM order_steps WHERE order_id=?", [o.id]);
      const existingIdx = existing.map(r => r.step_index);
      // Add missing step rows (new steps that don't exist yet)
      for (let i = 0; i < totalSteps; i++) {
        if (!existingIdx.includes(i)) {
          db.run("INSERT OR IGNORE INTO order_steps(order_id,step_index,responsible,planned_days,done_date) VALUES(?,?,?,?,?)",
            [o.id, i, '—', 0, '']);
        }
      }
      // Update completedSteps logic - recalculate from done_dates
      migrated++;
    });
    saveDB();
    res.json({ ok: true, migrated, newStepCount: steps.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── BACKUP DOWNLOAD (protected by BACKUP_TOKEN env var) ──────
const BACKUP_TOKEN = process.env.BACKUP_TOKEN || 'wisco-admin-2026';
function checkToken(req, res) {
  const token = req.query.token;
  if (!token || token !== BACKUP_TOKEN) {
    res.status(401).json({ error: 'Unauthorized — invalid token' });
    return false;
  }
  return true;
}

app.get('/api/backup', (req, res) => {
  if (!checkToken(req, res)) return;
  try {
    const data = db.export();
    const buf = Buffer.from(data);
    const date = new Date().toISOString().split('T')[0];
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="wisco_orders_backup_${date}.db"`);
    res.send(buf);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ── EXPORT JSON (protected) ───────────────────────────────────
app.get('/api/export-json', (req, res) => {
  if (!checkToken(req, res)) return;
  try {
    const orders = query("SELECT * FROM orders ORDER BY created_at").map(buildOrder);
    const config = {
      team: JSON.parse(query("SELECT value FROM config WHERE key='team'")[0]?.value||'[]'),
      suppliers: JSON.parse(query("SELECT value FROM config WHERE key='suppliers'")[0]?.value||'[]'),
      steps: JSON.parse(query("SELECT value FROM config WHERE key='steps'")[0]?.value||'[]'),
    };
    res.json({ exportDate: new Date().toISOString(), totalOrders: orders.length, orders, config });
  } catch(e) { res.status(500).json({error:e.message}); }
});

initDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n  ✅ Wisco Order Tracker running!\n`);
    console.log(`  📊 Dashboard → http://localhost:${PORT}/dashboard.html`);
    console.log(`  ✏️  Edit      → http://localhost:${PORT}/edit.html\n`);
  });
});
