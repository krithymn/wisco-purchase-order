const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

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
  { name: "รับเอกสารจาก SUP",                    defaultDays: 2  },
  { name: "จ่ายเงิน SUP",                         defaultDays: 2  },
  { name: "ติดตามการขนส่ง",                       defaultDays: 7  },
  { name: "แจ้งสินค้าเข้า",                       defaultDays: 1  },
  { name: "ตรวจสอบสินค้าเข้า",                   defaultDays: 2  },
  { name: "รับสินค้าเข้าระบบ",                   defaultDays: 1  }
];

function addBusinessDaysHelper(startDateStr, days) {
  if (!startDateStr || isNaN(days)) return '';
  let date = new Date(startDateStr);
  let count = 0;
  while (count < days) {
    date.setDate(date.getDate() + 1);
    const day = date.getDay(); // 0: Sunday, 6: Saturday
    if (day !== 0 && day !== 6) {
      count++;
    }
  }
  return date.toISOString().split('T')[0];
}

async function initDB() {
  const dbDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  try {
    const Database = require('better-sqlite3');
    db = new Database(DB_PATH);
    db.run = function(sql, params = []) {
      if (params && params.length > 0) {
        return this.prepare(sql).run(params);
      } else {
        return this.exec(sql);
      }
    };
  } catch (err) {
    console.error(`\n  ❌ ERROR: Failed to open SQLite database at ${DB_PATH}`);
    console.error(`  Details: ${err.message}`);
    process.exit(1);
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
      eta_wisco             TEXT DEFAULT '',
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
    CREATE TABLE IF NOT EXISTS quotations (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      start_date      TEXT DEFAULT '',
      quotation_type  TEXT DEFAULT '',
      completed_date  TEXT DEFAULT '',
      due_date        TEXT DEFAULT '',
      ld_no           TEXT DEFAULT '',
      quotation_no    TEXT DEFAULT '',
      sale_team       TEXT DEFAULT '',
      sale            TEXT DEFAULT '',
      customer        TEXT DEFAULT '',
      customer_type   TEXT DEFAULT '',
      pr_no           TEXT DEFAULT '',
      po_no           TEXT DEFAULT '',
      product         TEXT DEFAULT '',
      responsible     TEXT DEFAULT '',
      progress_status TEXT DEFAULT 'ตรวจสอบข้อมูล',
      status          TEXT DEFAULT 'PENDING',
      offer_date      TEXT DEFAULT '',
      total_offer     REAL DEFAULT 0.0,
      brand           TEXT DEFAULT '',
      valve_type      TEXT DEFAULT '',
      remark          TEXT DEFAULT '',
      created_at      TEXT DEFAULT (datetime('now','localtime'))
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
  
  // Seed Quotation Types & Customer Map configs
  const qTypeRow = query("SELECT value FROM config WHERE key='quotationTypes'");
  if (!qTypeRow.length) {
    db.run("INSERT OR IGNORE INTO config(key,value) VALUES('quotationTypes',?)",
      [JSON.stringify([
        { name: "Proposal Standard", days: 3 },
        { name: "Proposal Urgent", days: 1 }
      ])]);
  }
  const cMapRow = query("SELECT value FROM config WHERE key='customerMap'");
  if (!cMapRow.length) {
    db.run("INSERT OR IGNORE INTO config(key,value) VALUES('customerMap',?)", [JSON.stringify({})]);
  }
  // Migration: add mfg_steps column if it doesn't exist (for existing databases)
  try { db.run("ALTER TABLE order_steps ADD COLUMN mfg_steps TEXT DEFAULT '[]'"); } catch(e) { /* already exists */ }
  try { db.run("ALTER TABLE orders ADD COLUMN items TEXT DEFAULT '[]'"); } catch(e) { /* already exists */ }
  try { db.run("ALTER TABLE orders ADD COLUMN po_open_date TEXT DEFAULT ''"); } catch(e) { /* already exists */ }
  try { db.run("ALTER TABLE order_steps ADD COLUMN is_skipped INTEGER DEFAULT 0"); } catch(e) { /* already exists */ }
  try { db.run("ALTER TABLE orders ADD COLUMN production_finish_date TEXT DEFAULT ''"); } catch(e) { /* already exists */ }
  try { db.run("ALTER TABLE orders ADD COLUMN is_partial INTEGER DEFAULT 0"); } catch(e) { /* already exists */ }
  try { db.run("ALTER TABLE orders ADD COLUMN delivery_date_sup TEXT DEFAULT ''"); } catch(e) { /* already exists */ }
  try { db.run("ALTER TABLE orders ADD COLUMN delivery_date_cust TEXT DEFAULT ''"); } catch(e) { /* already exists */ }
  try { db.run("ALTER TABLE orders ADD COLUMN eta_wisco TEXT DEFAULT ''"); } catch(e) { /* already exists */ }
  try { db.run("ALTER TABLE orders ADD COLUMN is_cancelled INTEGER DEFAULT 0"); } catch(e) { /* already exists */ }
  try { db.run("ALTER TABLE orders ADD COLUMN cancel_reason TEXT DEFAULT ''"); } catch(e) { /* already exists */ }
  try { db.run("ALTER TABLE purchase_requests ADD COLUMN is_cancelled INTEGER DEFAULT 0"); } catch(e) { /* already exists */ }
  try { db.run("ALTER TABLE purchase_requests ADD COLUMN cancel_reason TEXT DEFAULT ''"); } catch(e) { /* already exists */ }
  // Create purchase_requests table if not exists
  db.run(`CREATE TABLE IF NOT EXISTS purchase_requests (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    pr_no         TEXT UNIQUE NOT NULL,
    open_date     TEXT DEFAULT '',
    customer_name TEXT DEFAULT '',
    customer_po   TEXT DEFAULT '',
    po_value      TEXT DEFAULT '',
    fine_yn       TEXT DEFAULT 'no',
    fine_pct      TEXT DEFAULT '',
    due_date      TEXT DEFAULT '',
    sale_team     TEXT DEFAULT '',
    sale          TEXT DEFAULT '',
    quotation_no  TEXT DEFAULT '',
    ld_no         TEXT DEFAULT '',
    domestic      TEXT DEFAULT '',
    po_no         TEXT DEFAULT '',
    items         TEXT DEFAULT '[]',
    linked_poi    TEXT DEFAULT '',
    created_at    TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_name TEXT NOT NULL,
      wic_customer_id TEXT,
      tier TEXT,
      status TEXT,
      registration_date TEXT,
      sale_code TEXT,
      team TEXT,
      month_forecast REAL DEFAULT 0,
      year_forecast REAL DEFAULT 0,
      zone TEXT,
      industry TEXT,
      product_service TEXT,
      contact_name TEXT,
      position TEXT,
      tel TEXT,
      mobile TEXT,
      line_id TEXT,
      email TEXT,
      address TEXT,
      subdistrict TEXT,
      district TEXT,
      province TEXT,
      zipcode TEXT,
      last_visit_date TEXT DEFAULT '',
      last_call_date TEXT DEFAULT '',
      last_contact_date TEXT DEFAULT '',
      next_planned_date TEXT DEFAULT '',
      next_planned_type TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      activity_type TEXT NOT NULL,
      activity_date TEXT NOT NULL,
      contact_person TEXT DEFAULT '',
      summary TEXT DEFAULT '',
      created_by TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      plan_type TEXT NOT NULL,
      planned_date TEXT NOT NULL,
      objective TEXT DEFAULT '',
      created_by TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE CASCADE
    );
  `);
  try { db.run("ALTER TABLE customers ADD COLUMN last_visit_date TEXT DEFAULT ''"); } catch(e) {}
  try { db.run("ALTER TABLE customers ADD COLUMN last_call_date TEXT DEFAULT ''"); } catch(e) {}
  try { db.run("ALTER TABLE customers ADD COLUMN last_contact_date TEXT DEFAULT ''"); } catch(e) {}
  try { db.run("ALTER TABLE customers ADD COLUMN next_planned_date TEXT DEFAULT ''"); } catch(e) {}
  try { db.run("ALTER TABLE customers ADD COLUMN next_planned_type TEXT DEFAULT ''"); } catch(e) {}
  
  // Safe column migrations for quotations
  try { db.run("ALTER TABLE quotations ADD COLUMN brand TEXT DEFAULT ''"); } catch(e) {}
  try { db.run("ALTER TABLE quotations ADD COLUMN valve_type TEXT DEFAULT ''"); } catch(e) {}
  try { db.run("ALTER TABLE quotations ADD COLUMN remark TEXT DEFAULT ''"); } catch(e) {}
  // Migration for empty brand/valve_type in quotations
  try {
    db.run(`
      UPDATE quotations
      SET brand = 'Platinum brand'
      WHERE brand IS NULL OR brand = ''
    `);
    db.run(`
      UPDATE quotations
      SET valve_type = 'Manual valve & Accessory'
      WHERE valve_type IS NULL OR valve_type = ''
    `);

    // Recalculate due dates if they are empty
    const emptyQuotes = db.prepare("SELECT id, start_date, quotation_type, brand, valve_type FROM quotations WHERE due_date IS NULL OR due_date = ''").all();
    for (const q of emptyQuotes) {
      if (!q.start_date) continue;
      
      let days = 0;
      const jobType = q.quotation_type || 'MRO';
      const brand = q.brand || 'Platinum brand';
      const valveType = q.valve_type || 'Manual valve & Accessory';
      
      const isPlatinum = brand === 'Platinum brand' || brand === 'Platinum & Golden brand';
      const isGolden = brand === 'Golden brand';
      
      if (jobType === 'MRO') {
        if (isPlatinum) {
          days = (valveType === 'Manual valve & Accessory') ? 3 : 7;
        } else if (isGolden) {
          days = (valveType === 'Manual valve & Accessory') ? 2 : 5;
        }
      } else if (jobType === 'Project') {
        if (isPlatinum) {
          days = (valveType === 'Manual valve & Accessory') ? 10 : 15;
        } else if (isGolden) {
          days = (valveType === 'Manual valve & Accessory') ? 5 : 10;
        }
      } else if (jobType === 'STOCK') {
        days = (valveType === 'Manual valve & Accessory') ? 0 : 2;
      }
      
      const calculatedDue = addBusinessDaysHelper(q.start_date, days);
      if (calculatedDue) {
        db.prepare("UPDATE quotations SET due_date=? WHERE id=?").run([calculatedDue, q.id]);
      }
    }
  } catch(e) {
    console.error('Migration for brand/valve_type/due_date failed:', e.message);
  }

  saveDB();
  console.log('  ✅ Database ready.');
}

function saveDB() {
  // No-op: better-sqlite3 writes directly to disk on run/exec
}
function query(sql, params=[]) {
  try {
    return db.prepare(sql).all(params);
  } catch (err) {
    console.error(`Query failed: ${sql}`, err);
    throw err;
  }
}
function run(sql, params=[]) {
  try {
    db.run(sql, params);
  } catch (err) {
    console.error(`Run failed: ${sql}`, err);
    throw err;
  }
}

function getSteps() {
  const r = query("SELECT value FROM config WHERE key='steps'");
  return r.length ? JSON.parse(r[0].value) : DEFAULT_STEPS;
}

function getStepName(o, i) {
  const steps = getSteps();
  if (!o.prepayment) return (steps[i] && steps[i].name) || 'Step ' + (i + 1);
  if (i < 10) return (steps[i] && steps[i].name) || 'Step ' + (i + 1);
  if (i === 10) return '💳 จ่ายเงินล่วงหน้า';
  return (steps[i - 1] && steps[i - 1].name) || 'Step ' + i;
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
  });

  // completedSteps = longest consecutive run of done/skipped steps from index 0
  let completedSteps = 0;
  for (let i = 0; i < totalSteps; i++) {
    if (doneDates[i] || skippedSteps[i]) completedSteps = i + 1;
    else break;
  }

  return {
    id: row.id, customer: row.customer||'', factory: row.factory||'',
    product: row.product||'', quantity: row.quantity||'',
    customerPO: row.customer_po||'', notes: row.notes||'',
    isPartial: !!row.is_partial,
    isCancelled: !!row.is_cancelled,
    cancelReason: row.cancel_reason||'',
    deliveryDateSup: row.delivery_date_sup||'',
    deliveryDateCust: row.delivery_date_cust||'',
    etaWisco: row.eta_wisco||'',
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

// ── SYNC: auto-create PR records when workers add prNumbers in orders ──
function syncPRsFromOrderItems(orderId, items) {
  try {
    for (const item of (items||[])) {
      const prNo = (item.prNumber||'').trim();
      if (!prNo) continue;
      const exists = query("SELECT id FROM purchase_requests WHERE LOWER(pr_no)=LOWER(?)", [prNo]);
      if (exists.length > 0) {
        // Already exists — just make sure it's linked
        run("UPDATE purchase_requests SET linked_poi=? WHERE LOWER(pr_no)=LOWER(?) AND (linked_poi IS NULL OR linked_poi='')",
          [orderId, prNo]);
        continue;
      }
      // Create new PR record from order item data
      run(`INSERT INTO purchase_requests(pr_no,open_date,customer_name,customer_po,po_value,fine_yn,fine_pct,due_date,sale_team,sale,quotation_no,ld_no,domestic,po_no,items,linked_poi)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [prNo, '', item.customer||'', '', '', item.fine==='yes'?'yes':'no', '',
         item.sendDate||'', '', '', '', '', '', '',
         JSON.stringify((item.subItems||[]).map(s=>({product:s.product||'',quantity:s.quantity||''}))),
         orderId]);
    }
  } catch(e) { console.error('syncPRsFromOrderItems error:', e.message); }
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
    run("INSERT INTO orders(id,customer,factory,product,quantity,customer_po,prepayment,start_date,due_date,notes,items,po_open_date,production_finish_date,is_partial,delivery_date_sup,delivery_date_cust,eta_wisco) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [id,customer||'',factory||'',product||'',quantity||'',customerPO||'',prepayment?1:0,startDate||'',dueDate||'',notes||'',itemsJson,poOpenDate,prodFinish,isPartial,delSup,delCust,req.body.etaWisco||'']);
    const steps = getSteps();
    const total = steps.length + (prepayment?1:0);
    for (let i=0;i<total;i++) run("INSERT OR IGNORE INTO order_steps(order_id,step_index,planned_days) VALUES(?,?,?)",[id,i,0]);
    syncPRsFromOrderItems(id, req.body.items||[]);
    saveDB();
    const createdOrder = buildOrder(query("SELECT * FROM orders WHERE id=?",[id])[0]);
    res.status(201).json(createdOrder);
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.put('/api/orders/:id', (req, res) => {
  try {
    const {customer,factory,product,quantity,customerPO,prepayment,startDate,dueDate,notes} = req.body;
    run("UPDATE orders SET customer=?,factory=?,product=?,quantity=?,customer_po=?,prepayment=?,start_date=?,due_date=?,notes=?,items=?,po_open_date=?,production_finish_date=?,is_partial=?,delivery_date_sup=?,delivery_date_cust=?,eta_wisco=? WHERE id=?",
      [customer||'',factory||'',product||'',quantity||'',customerPO||'',prepayment?1:0,startDate||'',dueDate||'',notes||'',JSON.stringify(req.body.items||[]),req.body.poOpenDate||'',req.body.productionFinishDate||'',req.body.isPartial?1:0,req.body.deliveryDateSup||'',req.body.deliveryDateCust||'',req.body.etaWisco||'',req.params.id]);
    syncPRsFromOrderItems(req.params.id, req.body.items||[]);
    saveDB();
    res.json(buildOrder(query("SELECT * FROM orders WHERE id=?",[req.params.id])[0]));
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.delete('/api/orders/:id', (req, res) => {
  try {
    const id = req.params.id;
    // Unlink any PRs that were linked to this order
    run("UPDATE purchase_requests SET linked_poi='' WHERE linked_poi=?", [id]);
    run("DELETE FROM order_steps WHERE order_id=?", [id]);
    run("DELETE FROM orders WHERE id=?", [id]);
    saveDB();
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
    const updatedOrder = buildOrder(query("SELECT * FROM orders WHERE id=?",[oid])[0]);
    res.json(updatedOrder);
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
    const team           = query("SELECT value FROM config WHERE key='team'");
    const steps          = query("SELECT value FROM config WHERE key='steps'");
    const suppliers      = query("SELECT value FROM config WHERE key='suppliers'");
    const customers      = query("SELECT value FROM config WHERE key='customers'");
    const saleTeams      = query("SELECT value FROM config WHERE key='saleTeams'");
    const sales          = query("SELECT value FROM config WHERE key='sales'");
    const quotationTypes = query("SELECT value FROM config WHERE key='quotationTypes'");
    const customerMap    = query("SELECT value FROM config WHERE key='customerMap'");
    res.json({
      team:      team.length      ? JSON.parse(team[0].value)      : [],
      steps:     steps.length     ? JSON.parse(steps[0].value)     : DEFAULT_STEPS,
      suppliers: suppliers.length ? JSON.parse(suppliers[0].value) : [],
      customers: customers.length ? JSON.parse(customers[0].value) : [],
      saleTeams: saleTeams.length ? JSON.parse(saleTeams[0].value) : [],
      sales:     sales.length     ? JSON.parse(sales[0].value)     : [],
      quotationTypes: quotationTypes.length ? JSON.parse(quotationTypes[0].value) : [],
      customerMap:    customerMap.length    ? JSON.parse(customerMap[0].value)    : {},
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

app.put('/api/config/customers', (req, res) => {
  try { run("INSERT OR REPLACE INTO config(key,value) VALUES('customers',?)",[JSON.stringify(req.body.customers)]); res.json({ok:true}); }
  catch(e) { res.status(500).json({error:e.message}); }
});
app.put('/api/config/saleTeams', (req, res) => {
  try { run("INSERT OR REPLACE INTO config(key,value) VALUES('saleTeams',?)",[JSON.stringify(req.body.saleTeams)]); res.json({ok:true}); }
  catch(e) { res.status(500).json({error:e.message}); }
});
app.put('/api/config/sales', (req, res) => {
  try { run("INSERT OR REPLACE INTO config(key,value) VALUES('sales',?)",[JSON.stringify(req.body.sales)]); res.json({ok:true}); }
  catch(e) { res.status(500).json({error:e.message}); }
});
app.put('/api/config/quotationTypes', (req, res) => {
  try { run("INSERT OR REPLACE INTO config(key,value) VALUES('quotationTypes',?)",[JSON.stringify(req.body.quotationTypes)]); res.json({ok:true}); }
  catch(e) { res.status(500).json({error:e.message}); }
});
app.put('/api/config/customerMap', (req, res) => {
  try { run("INSERT OR REPLACE INTO config(key,value) VALUES('customerMap',?)",[JSON.stringify(req.body.customerMap)]); res.json({ok:true}); }
  catch(e) { res.status(500).json({error:e.message}); }
});

// ── CANCEL / UNCANCEL ORDER ──────────────────────────────────
app.patch('/api/orders/:id/cancel', (req, res) => {
  try {
    const cancel = req.body.cancel !== false; // default true
    const reason = req.body.reason || '';
    run("UPDATE orders SET is_cancelled=?, cancel_reason=? WHERE id=?",
      [cancel?1:0, reason, req.params.id]);
    saveDB();
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
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

// ── DEBUG: check step dates ──────────────────────────────────
app.get('/api/orders/:id/steps-debug', (req, res) => {
  try {
    const rows = query("SELECT step_index, done_date, is_skipped FROM order_steps WHERE order_id=? ORDER BY step_index", [req.params.id]);
    res.json(rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ── CLEAR a specific step's done_date ─────────────────────────
app.delete('/api/orders/:id/steps/:step/done', (req, res) => {
  try {
    run("UPDATE order_steps SET done_date='' WHERE order_id=? AND step_index=?", [req.params.id, parseInt(req.params.step)]);
    res.json(buildOrder(query("SELECT * FROM orders WHERE id=?",[req.params.id])[0]));
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ── PR (Purchase Request) ENDPOINTS ─────────────────────────
// Bulk auto-link: scan all unlinked PRs and match against existing order items
app.post('/api/prs/auto-link-all', (req, res) => {
  try {
    const unlinked = query("SELECT id, pr_no FROM purchase_requests WHERE linked_poi IS NULL OR linked_poi=''");
    const allOrders = query("SELECT id, items FROM orders");
    let linked = 0;
    for (const pr of unlinked) {
      for (const order of allOrders) {
        try {
          const items = JSON.parse(order.items || '[]');
          const prKey = (pr.pr_no||'').trim().toLowerCase();
          const found = items.some(it => (it.prNumber||'').trim().toLowerCase() === prKey);
          if (found) {
            run("UPDATE purchase_requests SET linked_poi=? WHERE id=?", [order.id, pr.id]);
            // Sync PR items into the order item row if subItems are empty
            const matchedItem = items.find(it => (it.prNumber||'').trim().toLowerCase() === prKey);
            if (matchedItem && (!matchedItem.subItems || !matchedItem.subItems.some(s=>s.product))) {
              let prItems = [];
              try { prItems = JSON.parse(pr.items || '[]'); } catch(e) {}
              if (prItems.length) {
                const idx = items.indexOf(matchedItem);
                items[idx].subItems = prItems.map(i=>({product:i.product||'',quantity:i.quantity||''}));
                run("UPDATE orders SET items=? WHERE id=?", [JSON.stringify(items), order.id]);
              }
            }
            linked++;
            break;
          }
        } catch(e) {}
      }
    }
    saveDB();
    res.json({ok: true, linked, total: unlinked.length});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ── BACKFILL: create PR records from existing order items ────
// ── ONE-TIME DATA MIGRATION: inject missing pre-admin PRs ────
const MISSING_PRS = [
  {pr_no:"PR6903-0022",customer_name:"ฟินิกซ์ เอ็นจิเนียริ่ง",fine_yn:"no",due_date:"2026-03-18",items:'[{"product":"2-Way Pneumatic Control Valve DN32","quantity":"1"}]',linked_poi:"POI6904-0002"},
  {pr_no:"PR6903-0027",customer_name:"ฟินิกซ์ เอ็นจิเนียริ่ง",fine_yn:"no",due_date:"2026-03-19",items:'[{"product":"2-Way Pneumatic Control Valve DN32","quantity":"1"}]',linked_poi:"POI6904-0002"},
  {pr_no:"PR6904-0009",customer_name:"WISCO",fine_yn:"no",due_date:"2026-04-08",items:'[{"product":"VOCESTER KW-1 KNIFE GATE VALVE SIZE 3\"","quantity":"5"},{"product":"VOCESTER KW-1 KNIFE GATE VALVE SIZE 6\"","quantity":"4"},{"product":"VOCESTER KW-1 KNIFE GATE VALVE SIZE 8\"","quantity":"5"},{"product":"VOCESTER KW-1 KNIFE GATE VALVE SIZE 4\" FL.10K","quantity":"8"},{"product":"VOCESTER KW-1 CF8 SIZE 4\"","quantity":"6"},{"product":"VOCESTER KW-1 CF8 SIZE 6\"","quantity":"2"}]',linked_poi:"POI6904-0003"},
  {pr_no:"PR6903-0035",customer_name:"WISCO SERVICE",fine_yn:"no",due_date:"2026-03-26",items:'[{"product":"Diaphragm Assembly - Viton Part no. SPV501","quantity":"1"}]',linked_poi:"POI6904-0004"},
  {pr_no:"PR6904-0008",customer_name:"TPI POLENE",fine_yn:"no",due_date:"2026-04-08",items:'[{"product":"07 EL Positioner CW with Angle Retransmit and Din Plug Part no. 074-070EL10C0","quantity":"2"}]',linked_poi:"POI6904-0004"},
  {pr_no:"PR6904-0013",customer_name:"AKWEL RAYONG",fine_yn:"no",due_date:"2026-04-08",items:'[{"product":"Seal Kit for Actuator Model : 10 Part no. SP056","quantity":"1"}]',linked_poi:"POI6904-0004"},
  {pr_no:"PR6904-0015",customer_name:"A.E.C",fine_yn:"no",due_date:"2026-04-16",items:'[{"product":"VOCESTER MODEL: DCV DUAL PLATE CHECK VALVE PN16 SIZE DN250 (10\")","quantity":"1"}]',linked_poi:"POI6904-0006"},
  {pr_no:"PR6904-0016",customer_name:"ไทยเบฟเวอเรจ",fine_yn:"no",due_date:"2026-04-16",items:'[{"product":"VOCESTER V680-N-5-600 GLOBE VALVE SIZE 3/4\"","quantity":"10"},{"product":"VOCESTER V680-N-5-600 GLOBE VALVE SIZE 1-1/2\"","quantity":"6"},{"product":"VOCESTER V680-N-5-600 GLOBE VALVE SIZE 2\"","quantity":"3"}]',linked_poi:"POI6904-0008"},
  {pr_no:"PR6904-0005",customer_name:"VALVES-MART",fine_yn:"no",due_date:"2026-04-08",items:'[{"product":"YORK BUTTERFLY VALVE SIZE 2\"","quantity":"20"},{"product":"YORK BUTTERFLY VALVE SIZE 2.5\"","quantity":"50"},{"product":"YORK BUTTERFLY VALVE SIZE 3\"","quantity":"150"},{"product":"YORK BUTTERFLY VALVE SIZE 4\"","quantity":"150"},{"product":"YORK BUTTERFLY VALVE SIZE 6\"","quantity":"100"}]',linked_poi:"POI6904-0001 VM"},
  {pr_no:"PR6901-0017",customer_name:"ไทยออยส์",fine_yn:"yes",due_date:"2026-05-15",items:'[{"product":"VOCESTER STRAINER SINGLE BASKET SIZE 6\" BW SCH.40","quantity":"1"}]',linked_poi:"POI6905-0003"},
  {pr_no:"PR6902-0028",customer_name:"อัครา รีซอร์สเซส",fine_yn:"no",due_date:"2026-04-08",items:'[{"product":"DIAPHRAGM VALVE CON: THREADED NPT SIZE: 2\"","quantity":"2"}]',linked_poi:"POI6903-0001"},
  {pr_no:"PR6903-0015",customer_name:"อัครา รีซอร์สเซส",fine_yn:"no",due_date:"2026-04-08",items:'[{"product":"DIAPHRAGM VALVE CON: FL.PN16#RF SIZE: 3","quantity":"1"}]',linked_poi:"POI6903-0001"},
  {pr_no:"PR6902-0030",customer_name:"บุญเยี่ยมและสหาย",fine_yn:"no",due_date:"",items:'[{"product":"WEKSLER MODEL: BY4C 0-60PSI 100mm x 1/4\"NPT","quantity":"7"}]',linked_poi:"POI6903-0002"},
  {pr_no:"PR6901-0020",customer_name:"อิเดมิตสึ อพอลโล (ประเทศไทย)",fine_yn:"no",due_date:"2026-03-18",items:'[{"product":"BALL VALVE FIRE SAFE 2PC SIZE: 3\"","quantity":"1"},{"product":"BALL VALVE FIRE SAFE 2PC SIZE: 3","quantity":"3"},{"product":"BALL VALVE FIRE SAFE 2PC SIZE: 4","quantity":"8"}]',linked_poi:"POI6901-0011"},
  {pr_no:"PR6902-0025",customer_name:"อิเดมิตสึ อพอลโล (ประเทศไทย)",fine_yn:"no",due_date:"2026-03-24",items:'[{"product":"BALL VALVE FIRE SAFE 2PC SIZE: 3\"","quantity":"1"}]',linked_poi:"POI6901-0011"},
  {pr_no:"PR6903-0038",customer_name:"อิเดมิตสึ อพอลโล (ประเทศไทย)",fine_yn:"no",due_date:"2026-05-15",items:'[{"product":"BALL VALVE FIRE SAFE 2PC SIZE: 3","quantity":"1"}]',linked_poi:"POI6901-0011"},
  {pr_no:"PR6905-0026",customer_name:"บุญเยี่ยมและสหาย",fine_yn:"no",due_date:"2026-06-15",items:'[{"product":"PRESSURE GAUGE BAYONET 0-2bar 100mm x 1/4\"NPT","quantity":"5"},{"product":"PRESSURE GAUGE BAYONET 0-2bar 100mm x 1/4 FOR STOCK","quantity":"45"}]',linked_poi:"POI6905-0007"},
];

// Migration runs after server starts (see app.listen block)

// Debug: see all prNumbers found in orders without creating anything
app.get('/api/prs/backfill-preview', (req, res) => {
  try {
    const allOrders = query("SELECT id, items FROM orders");
    const found = [];
    for (const order of allOrders) {
      let items = [];
      try { items = JSON.parse(order.items || '[]'); } catch(e) { continue; }
      for (const item of items) {
        const prNo = (item.prNumber || '').trim();
        if (!prNo) continue;
        const existing = query("SELECT id FROM purchase_requests WHERE LOWER(pr_no)=LOWER(?)", [prNo]);
        found.push({ orderId: order.id, prNo, customer: item.customer||'', alreadyExists: existing.length > 0 });
      }
    }
    res.json({ total: found.length, items: found });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/prs/backfill-from-orders', (req, res) => {
  try {
    const allOrders = query("SELECT * FROM orders");
    let created = 0;
    let skipped = 0;

    for (const order of allOrders) {
      let items = [];
      try { items = JSON.parse(order.items || '[]'); } catch(e) { continue; }

      for (const item of items) {
        const prNo = (item.prNumber || '').trim();
        if (!prNo) continue;

        // Check if PR record already exists
        const existing = query("SELECT id FROM purchase_requests WHERE LOWER(pr_no)=LOWER(?)", [prNo]);
        if (existing.length > 0) {
          // Just make sure it's linked to this order
          run("UPDATE purchase_requests SET linked_poi=? WHERE LOWER(pr_no)=LOWER(?) AND (linked_poi IS NULL OR linked_poi='')",
            [order.id, prNo]);
          skipped++;
          continue;
        }

        // Create a new PR record from the order item data
        run(`INSERT INTO purchase_requests(pr_no, open_date, customer_name, customer_po, po_value,
             fine_yn, fine_pct, due_date, sale_team, sale, quotation_no, ld_no, domestic, po_no, items, linked_poi)
             VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            prNo,
            order.open_date || '',
            item.customer || '',
            order.customer_po || '',
            order.po_value || '',
            item.fine === 'yes' ? 'yes' : 'no',
            '',
            item.sendDate || order.due_date || '',
            order.sale_team || '',
            order.sale || '',
            '', '', '', '',
            JSON.stringify((item.subItems || []).map(s => ({product: s.product||'', quantity: s.quantity||''}))),
            order.id  // auto-link to this order
          ]
        );
        created++;
      }
    }

    saveDB();
    res.json({ ok: true, created, skipped, message: `สร้าง PR ใหม่ ${created} รายการ, ข้าม ${skipped} รายการที่มีอยู่แล้ว` });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/prs', (req, res) => {
  try {
    const rows = query("SELECT * FROM purchase_requests ORDER BY pr_no DESC");
    // Build a map: prNumber -> [orderId, ...] from all order items
    const allOrders = query("SELECT id, items FROM orders");
    const prToOrders = {};
    for (const o of allOrders) {
      try {
        const items = JSON.parse(o.items || '[]');
        for (const it of items) {
          const prNum = (it.prNumber||'').trim().toLowerCase();
          if (prNum) {
            if (!prToOrders[prNum]) prToOrders[prNum] = [];
            if (!prToOrders[prNum].includes(o.id)) prToOrders[prNum].push(o.id);
          }
        }
      } catch(e) {}
    }
    res.json(rows.map(r => {
      const key = (r.pr_no||'').trim().toLowerCase();
      const matchedOrders = prToOrders[key] || [];
      // linkedPOI: prefer DB value, but also check live scan; join multiple with ', '
      const linkedPOI = matchedOrders.length > 0
        ? matchedOrders.join(', ')
        : (r.linked_poi || '');
      // Also update DB if we found a link that wasn't stored
      if (matchedOrders.length > 0 && !r.linked_poi) {
        try { run("UPDATE purchase_requests SET linked_poi=? WHERE id=?", [matchedOrders[0], r.id]); } catch(e) {}
      }
      // Pull product items from the linked order's matching item row (single source of truth)
      let displayItems = [];
      try { displayItems = JSON.parse(r.items||'[]'); } catch(e) {}
      if (matchedOrders.length > 0) {
        // Gather subItems from all matching order item rows
        const mergedSubItems = [];
        for (const oid of matchedOrders) {
          const orderRow = allOrders.find(o => o.id === oid);
          if (!orderRow) continue;
          try {
            const orderItems = JSON.parse(orderRow.items || '[]');
            const matched = orderItems.find(it => (it.prNumber||'').trim().toLowerCase() === key);
            if (matched && matched.subItems && matched.subItems.length) {
              matched.subItems.forEach(s => mergedSubItems.push(s));
            }
          } catch(e) {}
        }
        if (mergedSubItems.length > 0) displayItems = mergedSubItems;
      }
      return {
        id: r.id, prNo: r.pr_no, openDate: r.open_date,
        customerName: r.customer_name, customerPO: r.customer_po,
        poValue: r.po_value, fineYN: r.fine_yn, finePct: r.fine_pct,
        dueDate: r.due_date, saleTeam: r.sale_team, sale: r.sale,
        quotationNo: r.quotation_no, ldNo: r.ld_no, domestic: r.domestic,
        poNo: r.po_no, items: displayItems,
        linkedPOI: linkedPOI,
        linkedPOIs: matchedOrders,
        isCancelled: !!r.is_cancelled,
        cancelReason: r.cancel_reason||''
      };
    }));
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.post('/api/prs', (req, res) => {
  try {
    const b = req.body;
    // Check for duplicate PR number first
    const existing = query("SELECT id FROM purchase_requests WHERE LOWER(pr_no)=LOWER(?)", [b.prNo||'']);
    if (existing.length > 0) {
      return res.status(409).json({error: 'PR number already exists'});
    }
    run(`INSERT INTO purchase_requests(pr_no,open_date,customer_name,customer_po,po_value,fine_yn,fine_pct,due_date,sale_team,sale,quotation_no,ld_no,domestic,po_no,items)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [b.prNo||'',b.openDate||'',b.customerName||'',b.customerPO||'',b.poValue||'',
       b.fineYN||'no',b.finePct||'',b.dueDate||'',b.saleTeam||'',b.sale||'',
       b.quotationNo||'',b.ldNo||'',b.domestic||'',b.poNo||'',JSON.stringify(b.items||[])]);

    // Auto-link: if any existing order already has this PR number in its items, link immediately
    let autoLinkedPOI = '';
    if (b.prNo) {
      const allOrders = query("SELECT id, items FROM orders");
      for (const order of allOrders) {
        try {
          const items = JSON.parse(order.items || '[]');
          const found = items.some(it => (it.prNumber||'').trim().toLowerCase() === b.prNo.trim().toLowerCase());
          if (found) { autoLinkedPOI = order.id; break; }
        } catch(e) {}
      }
      if (autoLinkedPOI) {
        run("UPDATE purchase_requests SET linked_poi=? WHERE pr_no=?", [autoLinkedPOI, b.prNo]);
      }
    }

    saveDB();
    res.json({ok: true, autoLinkedPOI: autoLinkedPOI || null});
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.put('/api/prs/:id', (req, res) => {
  try {
    const b = req.body;
    run(`UPDATE purchase_requests SET pr_no=?,open_date=?,customer_name=?,customer_po=?,po_value=?,fine_yn=?,fine_pct=?,due_date=?,sale_team=?,sale=?,quotation_no=?,ld_no=?,domestic=?,po_no=?,items=? WHERE id=?`,
      [b.prNo||'',b.openDate||'',b.customerName||'',b.customerPO||'',b.poValue||'',
       b.fineYN||'no',b.finePct||'',b.dueDate||'',b.saleTeam||'',b.sale||'',
       b.quotationNo||'',b.ldNo||'',b.domestic||'',b.poNo||'',JSON.stringify(b.items||[]),req.params.id]);

    // Sync updated PR items into the linked order's item row
    const prRec = query("SELECT linked_poi, pr_no, fine_yn FROM purchase_requests WHERE id=?", [req.params.id]);
    if (prRec.length && prRec[0].linked_poi) {
      const poiId = prRec[0].linked_poi;
      const prKey = (prRec[0].pr_no||'').trim().toLowerCase();
      const orderRow = query("SELECT items FROM orders WHERE id=?", [poiId]);
      if (orderRow.length) {
        let orderItems = [];
        try { orderItems = JSON.parse(orderRow[0].items || '[]'); } catch(e) {}
        const idx = orderItems.findIndex(it => (it.prNumber||'').trim().toLowerCase() === prKey);
        const newSubItems = (b.items||[]).map(i => ({product: i.product||'', quantity: i.quantity||''}));
        if (idx >= 0) {
          // Update existing row
          orderItems[idx].subItems = newSubItems.length ? newSubItems : [{product:'',quantity:''}];
          orderItems[idx].fine = b.fineYN==='yes'?'yes':'';
        } else {
          // Add new row
          orderItems.push({customer: b.customerName||'', prNumber: b.prNo||'', sendDate:'',
            fine: b.fineYN==='yes'?'yes':'',
            subItems: newSubItems.length ? newSubItems : [{product:'',quantity:''}]});
        }
        run("UPDATE orders SET items=? WHERE id=?", [JSON.stringify(orderItems), poiId]);
      }
    }

    saveDB();
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.patch('/api/prs/:id/cancel', (req, res) => {
  try {
    const cancel = req.body.cancel !== false;
    const reason = req.body.reason || '';
    run("UPDATE purchase_requests SET is_cancelled=?, cancel_reason=? WHERE id=?",
      [cancel?1:0, reason, req.params.id]);
    saveDB();
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.delete('/api/prs/:id', (req, res) => {
  try {
    // Before deleting, remove this PR's item row from any linked order
    const prRec = query("SELECT pr_no, linked_poi FROM purchase_requests WHERE id=?", [req.params.id]);
    if (prRec.length && prRec[0].linked_poi && prRec[0].pr_no) {
      const poiId = prRec[0].linked_poi;
      const prKey = (prRec[0].pr_no||'').trim().toLowerCase();
      const orderRow = query("SELECT items FROM orders WHERE id=?", [poiId]);
      if (orderRow.length) {
        try {
          let items = JSON.parse(orderRow[0].items || '[]');
          items = items.filter(it => (it.prNumber||'').trim().toLowerCase() !== prKey);
          run("UPDATE orders SET items=? WHERE id=?", [JSON.stringify(items), poiId]);
        } catch(e) {}
      }
    }
    run("DELETE FROM purchase_requests WHERE id=?", [req.params.id]);
    saveDB();
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.patch('/api/prs/:id/link', (req, res) => {
  try {
    const poiId = req.body.poiId || '';
    run("UPDATE purchase_requests SET linked_poi=? WHERE id=?", [poiId, req.params.id]);

    // Sync: if the order doesn't already have this PR as an item row, add it
    if (poiId) {
      const prRow = query("SELECT * FROM purchase_requests WHERE id=?", [req.params.id]);
      const orderRow = query("SELECT items FROM orders WHERE id=?", [poiId]);
      if (prRow.length && orderRow.length) {
        const pr = prRow[0];
        let orderItems = [];
        try { orderItems = JSON.parse(orderRow[0].items || '[]'); } catch(e) {}
        const prKey = (pr.pr_no||'').trim().toLowerCase();
        const alreadyIn = orderItems.some(it => (it.prNumber||'').trim().toLowerCase() === prKey);
        if (!alreadyIn) {
          let prItems = [];
          try { prItems = JSON.parse(pr.items || '[]'); } catch(e) {}
          const newItem = {
            customer: pr.customer_name || '',
            prNumber: pr.pr_no || '',
            sendDate: '',
            fine: pr.fine_yn === 'yes' ? 'yes' : '',
            subItems: prItems.length ? prItems.map(i => ({product: i.product||'', quantity: i.quantity||''}))
                                     : [{product: '', quantity: ''}]
          };
          orderItems.push(newItem);
          run("UPDATE orders SET items=? WHERE id=?", [JSON.stringify(orderItems), poiId]);
        }
      }
    }

    saveDB();
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ── QUOTATION MANAGEMENT SYNC & ROUTES ────────────────────────

function calculateOverallStatus(items) {
  if (!Array.isArray(items) || items.length === 0) return 'PENDING';
  const statuses = items.map(it => (it.status || 'PENDING').toUpperCase());
  if (statuses.includes('WIN')) return 'WIN';
  if (statuses.includes('PENDING')) return 'PENDING';
  if (statuses.includes('HOLD')) return 'HOLD';
  if (statuses.includes('CANCEL')) return 'CANCEL';
  return 'LOST';
}


function syncPRFromQuotation(qId) {
  try {
    const qRow = query("SELECT * FROM quotations WHERE id=?", [qId]);
    if (!qRow.length) return;
    const q = qRow[0];

    // Parse items
    let items = [];
    try {
      items = JSON.parse(q.product || '[]');
      if (!Array.isArray(items)) items = [];
    } catch(e) {
      if (q.status === 'WIN' && q.pr_no) {
        items = [{ product: q.product || '', quantity: '1', status: 'WIN', pr_no: q.pr_no, po_no: q.po_no }];
      }
    }

    // Group won items by pr_no
    const wonGroups = {};
    for (const it of items) {
      if (it.status === 'WIN' && it.pr_no && it.pr_no.trim()) {
        const prNo = it.pr_no.trim();
        if (!wonGroups[prNo]) {
          wonGroups[prNo] = [];
        }
        wonGroups[prNo].push(it);
      }
    }

    // Synchronize each group
    for (const prNo in wonGroups) {
      const groupItems = wonGroups[prNo];
      const prItems = groupItems.map(it => ({
        product: it.product || '',
        quantity: it.quantity || '1'
      }));
      const poNos = [...new Set(groupItems.map(it => it.po_no).filter(Boolean))];
      const poNo = poNos.join(', ');

      const exists = query("SELECT id FROM purchase_requests WHERE LOWER(pr_no)=LOWER(?)", [prNo]);
      if (exists.length > 0) {
        run("UPDATE purchase_requests SET customer_name=?, customer_po=?, po_value=?, sale_team=?, sale=?, quotation_no=?, ld_no=?, po_no=?, items=? WHERE LOWER(pr_no)=LOWER(?)",
          [
            q.customer || '',
            poNo || '',
            q.total_offer ? q.total_offer + ' บาท' : '',
            q.sale_team || '',
            q.sale || '',
            q.quotation_no || '',
            q.ld_no || '',
            poNo || '',
            JSON.stringify(prItems),
            prNo.toLowerCase()
          ]
        );
        console.log(`Auto-updated PR ${prNo} from won items in Quotation ${q.quotation_no}`);
      } else {
        run(`INSERT INTO purchase_requests(pr_no, open_date, customer_name, customer_po, po_value, fine_yn, fine_pct, due_date, sale_team, sale, quotation_no, ld_no, domestic, po_no, items)
             VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            prNo,
            q.start_date ? q.start_date.split('T')[0] : '',
            q.customer || '',
            poNo || '',
            q.total_offer ? q.total_offer + ' บาท' : '',
            'no', '',
            q.due_date || '',
            q.sale_team || '',
            q.sale || '',
            q.quotation_no || '',
            q.ld_no || '',
            '', // domestic
            poNo || '',
            JSON.stringify(prItems)
          ]
        );
        console.log(`Auto-created PR ${prNo} from won items in Quotation ${q.quotation_no}`);
      }
    }
  } catch(e) { console.error('syncPRFromQuotation error:', e.message); }
}

app.get('/api/quotations', (req, res) => {
  try {
    res.json(query("SELECT * FROM quotations ORDER BY created_at DESC"));
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.post('/api/quotations', (req, res) => {
  try {
    const {startDate, quotationType, completedDate, dueDate, ldNo, quotationNo, saleTeam, sale, customer, customerType, prNo, poNo, product, responsible, progressStatus, status, offerDate, totalOffer, brand, valveType, remark} = req.body;
    if (!quotationNo) return res.status(400).json({error:'Quotation No. required'});
    const dup = query("SELECT id FROM quotations WHERE LOWER(quotation_no)=LOWER(?)", [quotationNo]);
    if (dup.length) return res.status(409).json({error:'Quotation No. already exists'});

    const finalBrand = brand || 'Platinum brand';
    const finalValveType = valveType || 'Manual valve & Accessory';
    let finalDueDate = dueDate;
    if (!finalDueDate && startDate) {
      let days = 0;
      const isPlatinum = finalBrand === 'Platinum brand' || finalBrand === 'Platinum & Golden brand';
      const isGolden = finalBrand === 'Golden brand';
      
      if ((quotationType || 'MRO') === 'MRO') {
        if (isPlatinum) {
          days = (finalValveType === 'Manual valve & Accessory') ? 3 : 7;
        } else if (isGolden) {
          days = (finalValveType === 'Manual valve & Accessory') ? 2 : 5;
        }
      } else if ((quotationType || 'MRO') === 'Project') {
        if (isPlatinum) {
          days = (finalValveType === 'Manual valve & Accessory') ? 10 : 15;
        } else if (isGolden) {
          days = (finalValveType === 'Manual valve & Accessory') ? 5 : 10;
        }
      } else if ((quotationType || 'MRO') === 'STOCK') {
        days = (finalValveType === 'Manual valve & Accessory') ? 0 : 2;
      }
      finalDueDate = addBusinessDaysHelper(startDate, days);
    }

    let finalStatus = status || 'PENDING';
    let finalPrNo = prNo || '';
    let finalPoNo = poNo || '';
    if (product) {
      try {
        const parsed = JSON.parse(product);
        finalStatus = calculateOverallStatus(parsed);
        const wonItem = parsed.find(it => it.status === 'WIN');
        if (wonItem) {
          finalPrNo = wonItem.pr_no || finalPrNo;
          finalPoNo = wonItem.po_no || finalPoNo;
        }
      } catch(e) {}
    }

    run(`INSERT INTO quotations(start_date, quotation_type, completed_date, due_date, ld_no, quotation_no, sale_team, sale, customer, customer_type, pr_no, po_no, product, responsible, progress_status, status, offer_date, total_offer, brand, valve_type, remark)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [startDate||'', quotationType||'', completedDate||'', finalDueDate||'', ldNo||'', quotationNo, saleTeam||'', sale||'', customer||'', customerType||'', finalPrNo, finalPoNo, product||'', responsible||'', progressStatus||'ตรวจสอบข้อมูล', finalStatus, offerDate||'', parseFloat(totalOffer)||0.0, finalBrand, finalValveType, remark||'']);
    
    const inserted = query("SELECT * FROM quotations WHERE quotation_no=?", [quotationNo])[0];
    if (inserted && inserted.status === 'WIN') {
      syncPRFromQuotation(inserted.id);
    }
    res.status(201).json(inserted);
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.put('/api/quotations/:id', (req, res) => {
  try {
    const {startDate, quotationType, completedDate, dueDate, ldNo, quotationNo, saleTeam, sale, customer, customerType, prNo, poNo, product, responsible, progressStatus, status, offerDate, totalOffer, brand, valveType, remark} = req.body;
    
    const finalBrand = brand || 'Platinum brand';
    const finalValveType = valveType || 'Manual valve & Accessory';
    let finalDueDate = dueDate;
    if (!finalDueDate && startDate) {
      let days = 0;
      const isPlatinum = finalBrand === 'Platinum brand' || finalBrand === 'Platinum & Golden brand';
      const isGolden = finalBrand === 'Golden brand';
      
      if ((quotationType || 'MRO') === 'MRO') {
        if (isPlatinum) {
          days = (finalValveType === 'Manual valve & Accessory') ? 3 : 7;
        } else if (isGolden) {
          days = (finalValveType === 'Manual valve & Accessory') ? 2 : 5;
        }
      } else if ((quotationType || 'MRO') === 'Project') {
        if (isPlatinum) {
          days = (finalValveType === 'Manual valve & Accessory') ? 10 : 15;
        } else if (isGolden) {
          days = (finalValveType === 'Manual valve & Accessory') ? 5 : 10;
        }
      } else if ((quotationType || 'MRO') === 'STOCK') {
        days = (finalValveType === 'Manual valve & Accessory') ? 0 : 2;
      }
      finalDueDate = addBusinessDaysHelper(startDate, days);
    }

    let finalStatus = status || 'PENDING';
    let finalPrNo = prNo || '';
    let finalPoNo = poNo || '';
    if (product) {
      try {
        const parsed = JSON.parse(product);
        finalStatus = calculateOverallStatus(parsed);
        const wonItem = parsed.find(it => it.status === 'WIN');
        if (wonItem) {
          finalPrNo = wonItem.pr_no || finalPrNo;
          finalPoNo = wonItem.po_no || finalPoNo;
        }
      } catch(e) {}
    }

    run(`UPDATE quotations SET start_date=?, quotation_type=?, completed_date=?, due_date=?, ld_no=?, quotation_no=?, sale_team=?, sale=?, customer=?, customer_type=?, pr_no=?, po_no=?, product=?, responsible=?, progress_status=?, status=?, offer_date=?, total_offer=?, brand=?, valve_type=?, remark=? WHERE id=?`,
      [startDate||'', quotationType||'', completedDate||'', finalDueDate||'', ldNo||'', quotationNo||'', saleTeam||'', sale||'', customer||'', customerType||'', finalPrNo, finalPoNo, product||'', responsible||'', progressStatus||'ตรวจสอบข้อมูล', finalStatus, offerDate||'', parseFloat(totalOffer)||0.0, finalBrand, finalValveType, remark||'', req.params.id]);
    
    if (finalStatus === 'WIN') {
      syncPRFromQuotation(req.params.id);
    }
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.patch('/api/quotations/:id/progress', (req, res) => {
  try {
    const {progressStatus, completedDate, responsible, offerDate, remark, totalOffer} = req.body;
    if (progressStatus !== undefined) run("UPDATE quotations SET progress_status=? WHERE id=?", [progressStatus, req.params.id]);
    if (completedDate !== undefined) run("UPDATE quotations SET completed_date=? WHERE id=?", [completedDate, req.params.id]);
    if (responsible !== undefined) run("UPDATE quotations SET responsible=? WHERE id=?", [responsible, req.params.id]);
    if (offerDate !== undefined) run("UPDATE quotations SET offer_date=? WHERE id=?", [offerDate, req.params.id]);
    if (remark !== undefined) run("UPDATE quotations SET remark=? WHERE id=?", [remark, req.params.id]);
    if (totalOffer !== undefined) run("UPDATE quotations SET total_offer=? WHERE id=?", [parseFloat(totalOffer)||0.0, req.params.id]);
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.patch('/api/quotations/:id/status', (req, res) => {
  try {
    const {status, prNo, poNo} = req.body;
    if (status !== undefined) run("UPDATE quotations SET status=? WHERE id=?", [status, req.params.id]);
    if (prNo !== undefined) run("UPDATE quotations SET pr_no=? WHERE id=?", [prNo, req.params.id]);
    if (poNo !== undefined) run("UPDATE quotations SET po_no=? WHERE id=?", [poNo, req.params.id]);
    
    const qRow = query("SELECT status FROM quotations WHERE id=?", [req.params.id]);
    if (qRow.length && qRow[0].status === 'WIN') {
      syncPRFromQuotation(req.params.id);
    }
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.post('/api/quotations/:id/item-statuses', (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'items must be an array' });
    }
    
    const overallStatus = calculateOverallStatus(items);
    
    let mainPrNo = '';
    let mainPoNo = '';
    const wonItem = items.find(it => it.status === 'WIN');
    if (wonItem) {
      mainPrNo = wonItem.pr_no || '';
      mainPoNo = wonItem.po_no || '';
    }
    
    run("UPDATE quotations SET product=?, status=?, pr_no=?, po_no=? WHERE id=?", [JSON.stringify(items), overallStatus, mainPrNo, mainPoNo, req.params.id]);
    
    if (overallStatus === 'WIN') {
      syncPRFromQuotation(req.params.id);
    }
    
    res.json({ ok: true, status: overallStatus });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/quotations/:id', (req, res) => {
  try {
    run("DELETE FROM quotations WHERE id=?", [req.params.id]);
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.get('/api/export-quotations-csv', (req, res) => {
  try {
    const list = query("SELECT * FROM quotations ORDER BY created_at DESC");
    let csv = '\ufeff'; // UTF-8 BOM
    csv += 'ID,Start Date,Job Type,Completed Date,Due Date,LD No,Quotation No,Sale Team,Sale,Customer,Customer Type,PR No,PO No,Product,Responsible,Progress Status,Status,Offer Date,Total Offer,Brand,Valve Type,Remark\n';
    for (const q of list) {
      const escape = (val) => `"${(val || '').toString().replace(/"/g, '""')}"`;
      csv += `${q.id},${escape(q.start_date)},${escape(q.quotation_type)},${escape(q.completed_date)},${escape(q.due_date)},${escape(q.ld_no)},${escape(q.quotation_no)},${escape(q.sale_team)},${escape(q.sale)},${escape(q.customer)},${escape(q.customer_type)},${escape(q.pr_no)},${escape(q.po_no)},${escape(q.product)},${escape(q.responsible)},${escape(q.progress_status)},${escape(q.status)},${escape(q.offer_date)},${q.total_offer},${escape(q.brand)},${escape(q.valve_type)},${escape(q.remark)}\n`;
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="wisco_quotations.csv"');
    res.send(csv);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ── CSV EXPORT ───────────────────────────────────────────────
app.get('/api/export-orders-csv', (req, res) => {
  try {
    const orders = query("SELECT * FROM orders ORDER BY created_at DESC").map(buildOrder);
    let csv = '\ufeff'; // UTF-8 BOM
    csv += 'POI Number,Supplier,Customer(s),Start Date,Due Date,Prepayment,Prepayment Status,Progress %,Current Step,Responsible,ETA Wisco,Items\n';
    for (const o of orders) {
      const customers = o.items.map(it => it.customer).filter(Boolean).join('; ');
      const itemsStr = o.items.flatMap(it => (it.subItems || []).map(si => `${si.product} (${si.quantity})`)).join('; ');
      const pct = Math.round((o.completedSteps / o.totalSteps) * 100);
      const si = Math.min(o.completedSteps, o.totalSteps - 1);
      const curStep = o.completedSteps >= o.totalSteps ? 'เสร็จสมบูรณ์' : getStepName(o, si);
      const resp = o.completedSteps >= o.totalSteps ? '' : o.responsible[si] || '';
      
      const escape = (val) => `"${(val || '').toString().replace(/"/g, '""')}"`;
      
      csv += `${escape(o.id)},${escape(o.factory)},${escape(customers)},${escape(o.startDate)},${escape(o.dueDate)},${o.prepayment ? 'Yes' : 'No'},${o.prepaymentDone ? 'Done' : 'Pending'},${pct}%,${escape(curStep)},${escape(resp)},${escape(o.etaWisco)},${escape(itemsStr)}\n`;
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="wisco_orders.csv"');
    res.send(csv);
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.get('/api/export-prs-csv', (req, res) => {
  try {
    const prs = query("SELECT * FROM purchase_requests ORDER BY pr_no DESC");
    let csv = '\ufeff'; // UTF-8 BOM
    csv += 'PR Number,Open Date,Customer,Customer PO,Due Date,PO Value,Fine,Fine %,Sale Team,Sale,Quotation No.,LD No.,Domestic/Overseas,PO No.,Cancel Status,Cancel Reason,Linked POI,Items\n';
    for (const p of prs) {
      let itemsArr = [];
      try { itemsArr = JSON.parse(p.items || '[]'); } catch(e) {}
      const itemsStr = itemsArr.map(i => `${i.product} (${i.quantity})`).join('; ');
      
      const escape = (val) => `"${(val || '').toString().replace(/"/g, '""')}"`;
      const cancelStatus = p.is_cancelled ? 'Cancelled' : 'Active';
      
      csv += `${escape(p.pr_no)},${escape(p.open_date)},${escape(p.customer_name)},${escape(p.customer_po)},${escape(p.due_date)},${escape(p.po_value)},${p.fine_yn === 'yes' ? 'Yes' : 'No'},${escape(p.fine_pct)},${escape(p.sale_team)},${escape(p.sale)},${escape(p.quotation_no)},${escape(p.ld_no)},${escape(p.domestic)},${escape(p.po_no)},${cancelStatus},${escape(p.cancel_reason)},${escape(p.linked_poi)},${escape(itemsStr)}\n`;
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="wisco_purchase_requests.csv"');
    res.send(csv);
  } catch(e) { res.status(500).json({error:e.message}); }
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
    const buf = fs.readFileSync(DB_PATH);
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

// ── CUSTOMER MANAGEMENT BOOK (CMB) APIs ──────────────────────────

// API: Get Customers list (paginated, searched, filtered)
app.get('/api/customers', (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 12;
    
    const q = req.query.q || '';
    const sale = req.query.sale || '';
    const tier = req.query.tier || '';
    const industry = req.query.industry || '';
    const province = req.query.province || '';
    const health = req.query.health || '';

    let sql = `SELECT * FROM customers WHERE 1=1`;
    const params = [];

    if (q) {
      const likeParam = `%${q}%`;
      sql += ` AND (customer_name LIKE ? OR wic_customer_id LIKE ? OR contact_name LIKE ? OR mobile LIKE ? OR email LIKE ? OR product_service LIKE ?)`;
      params.push(likeParam, likeParam, likeParam, likeParam, likeParam, likeParam);
    }
    if (sale) {
      sql += ` AND sale_code = ?`;
      params.push(sale);
    }
    if (tier) {
      sql += ` AND tier = ?`;
      params.push(tier);
    }
    if (industry) {
      sql += ` AND industry = ?`;
      params.push(industry);
    }
    if (province) {
      sql += ` AND province = ?`;
      params.push(province);
    }

    sql += ` ORDER BY customer_name ASC`;
    let rows = query(sql, params);

    // Compute care health in JS
    const today = new Date();
    today.setHours(0,0,0,0);

    const dataWithHealth = rows.map(r => {
      let care_health = 'healthy';
      let days_elapsed = null;
      
      const last_contact = r.last_contact_date;
      if (!last_contact) {
        care_health = 'overdue';
      } else {
        const contactDate = new Date(last_contact);
        contactDate.setHours(0,0,0,0);
        days_elapsed = Math.floor((today - contactDate) / (1000 * 60 * 60 * 24));
        
        const tierGuideline = r.tier === 'A' ? 30 : r.tier === 'B' ? 60 : r.tier === 'C' ? 90 : r.tier === 'D' ? 180 : 90;
        
        if (days_elapsed >= tierGuideline) {
          care_health = 'overdue';
        } else if (days_elapsed >= (tierGuideline - 7)) {
          care_health = 'attention';
        }
      }
      
      return { ...r, care_health, days_elapsed };
    });

    // Apply care health filter in memory
    let filtered = dataWithHealth;
    if (health) {
      filtered = dataWithHealth.filter(c => c.care_health === health);
    }

    const total = filtered.length;
    const offset = (page - 1) * limit;
    const pageItems = filtered.slice(offset, offset + limit);

    res.json({
      data: pageItems,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Get single customer detail
app.get('/api/customers/:id', (req, res) => {
  try {
    const row = query(`SELECT * FROM customers WHERE id = ?`, [req.params.id])[0];
    if (!row) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    const today = new Date();
    today.setHours(0,0,0,0);
    let care_health = 'healthy';
    let days_elapsed = null;
    if (!row.last_contact_date) {
      care_health = 'overdue';
    } else {
      const contactDate = new Date(row.last_contact_date);
      contactDate.setHours(0,0,0,0);
      days_elapsed = Math.floor((today - contactDate) / (1000 * 60 * 60 * 24));
      const tierGuideline = row.tier === 'A' ? 30 : row.tier === 'B' ? 60 : row.tier === 'C' ? 90 : row.tier === 'D' ? 180 : 90;
      if (days_elapsed >= tierGuideline) {
        care_health = 'overdue';
      } else if (days_elapsed >= (tierGuideline - 7)) {
        care_health = 'attention';
      }
    }
    res.json({ ...row, care_health, days_elapsed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Create new customer profile
app.post('/api/customers', (req, res) => {
  try {
    const c = req.body;
    if (!c.customer_name) {
      return res.status(400).json({ error: 'Customer name is required' });
    }

    run(`
      INSERT INTO customers (
        customer_name, wic_customer_id, tier, status, registration_date,
        sale_code, team, month_forecast, year_forecast, zone,
        industry, product_service, contact_name, position, tel,
        mobile, line_id, email, address, subdistrict,
        district, province, zipcode
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      c.customer_name, c.wic_customer_id || '', c.tier || '', c.status || 'ฐานข้อมูลรายใหม่', c.registration_date || '',
      c.sale_code || '', c.team || 'TSK', parseFloat(c.month_forecast) || 0, parseFloat(c.year_forecast) || 0, c.zone || '',
      c.industry || '', c.product_service || '', c.contact_name || '', c.position || '', c.tel || '',
      c.mobile || '', c.line_id || '', c.email || '', c.address || '', c.subdistrict || '',
      c.district || '', c.province || '', c.zipcode || ''
    ]);

    const row = query("SELECT last_insert_rowid() as id")[0];
    res.status(201).json({ id: row.id, message: 'Customer profile created successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Update customer profile
app.put('/api/customers/:id', (req, res) => {
  try {
    const c = req.body;
    const check = query(`SELECT id FROM customers WHERE id = ?`, [req.params.id])[0];
    if (!check) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    run(`
      UPDATE customers SET
        customer_name = ?, wic_customer_id = ?, tier = ?, status = ?, registration_date = ?,
        sale_code = ?, team = ?, month_forecast = ?, year_forecast = ?, zone = ?,
        industry = ?, product_service = ?, contact_name = ?, position = ?, tel = ?,
        mobile = ?, line_id = ?, email = ?, address = ?, subdistrict = ?,
        district = ?, province = ?, zipcode = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [
      c.customer_name, c.wic_customer_id || '', c.tier || '', c.status || '', c.registration_date || '',
      c.sale_code || '', c.team || '', parseFloat(c.month_forecast) || 0, parseFloat(c.year_forecast) || 0, c.zone || '',
      c.industry || '', c.product_service || '', c.contact_name || '', c.position || '', c.tel || '',
      c.mobile || '', c.line_id || '', c.email || '', c.address || '', c.subdistrict || '',
      c.district || '', c.province || '', c.zipcode || '', req.params.id
    ]);

    res.json({ message: 'Customer profile updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Delete customer profile
app.delete('/api/customers/:id', (req, res) => {
  try {
    const check = query(`SELECT id FROM customers WHERE id = ?`, [req.params.id])[0];
    if (!check) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    run(`DELETE FROM customers WHERE id = ?`, [req.params.id]);
    res.json({ message: 'Customer profile deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Get customer visits/calls timeline
app.get('/api/customers/:id/visits', (req, res) => {
  try {
    const visits = query(`SELECT * FROM activities WHERE customer_id = ? ORDER BY activity_date DESC, id DESC`, [req.params.id]);
    const plans = query(`SELECT * FROM plans WHERE customer_id = ? ORDER BY planned_date ASC`, [req.params.id]);
    res.json({ visits, plans });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Log completed visit or call
app.post('/api/customers/:id/visits', (req, res) => {
  try {
    const { activity_type, activity_date, contact_person, summary, created_by } = req.body;
    if (!activity_type || !activity_date) {
      return res.status(400).json({ error: 'Activity type and date are required' });
    }
    
    run(`
      INSERT INTO activities (customer_id, activity_type, activity_date, contact_person, summary, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [req.params.id, activity_type, activity_date, contact_person || '', summary || '', created_by || '']);
    
    const c = query(`SELECT last_visit_date, last_call_date FROM customers WHERE id = ?`, [req.params.id])[0];
    if (!c) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    
    let last_visit = c.last_visit_date || '';
    let last_call = c.last_call_date || '';
    
    if (activity_type === 'Visit' || activity_type === 'Online') {
      if (!last_visit || activity_date > last_visit) last_visit = activity_date;
    } else if (activity_type === 'Call') {
      if (!last_call || activity_date > last_call) last_call = activity_date;
    }
    
    const last_contact = last_visit && last_call ? (last_visit > last_call ? last_visit : last_call) : (last_visit || last_call);
    
    run(`
      UPDATE customers 
      SET last_visit_date = ?, last_call_date = ?, last_contact_date = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [last_visit, last_call, last_contact, req.params.id]);
    
    res.json({ message: 'Activity logged successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Schedule next planned activity
app.post('/api/customers/:id/schedule', (req, res) => {
  try {
    const { plan_type, planned_date, objective, created_by } = req.body;
    if (!plan_type || !planned_date) {
      return res.status(400).json({ error: 'Plan type and date are required' });
    }
    
    run(`DELETE FROM plans WHERE customer_id = ?`, [req.params.id]);
    
    run(`
      INSERT INTO plans (customer_id, plan_type, planned_date, objective, created_by)
      VALUES (?, ?, ?, ?, ?)
    `, [req.params.id, plan_type, planned_date, objective || '', created_by || '']);
    
    run(`
      UPDATE customers 
      SET next_planned_date = ?, next_planned_type = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [planned_date, plan_type, req.params.id]);
    
    res.json({ message: 'Next step scheduled successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Get CMB dashboard stats
app.get('/api/cmb-stats', (req, res) => {
  try {
    const q = req.query.q || '';
    const sale = req.query.sale || '';
    const tier = req.query.tier || '';
    const industry = req.query.industry || '';
    const province = req.query.province || '';
    
    let sql = `SELECT * FROM customers WHERE 1=1`;
    const params = [];
    if (q) {
      const likeParam = `%${q}%`;
      sql += ` AND (customer_name LIKE ? OR wic_customer_id LIKE ? OR contact_name LIKE ? OR mobile LIKE ? OR email LIKE ? OR product_service LIKE ?)`;
      params.push(likeParam, likeParam, likeParam, likeParam, likeParam, likeParam);
    }
    if (sale) {
      sql += ` AND sale_code = ?`;
      params.push(sale);
    }
    if (tier) {
      sql += ` AND tier = ?`;
      params.push(tier);
    }
    if (industry) {
      sql += ` AND industry = ?`;
      params.push(industry);
    }
    if (province) {
      sql += ` AND province = ?`;
      params.push(province);
    }

    const rows = query(sql, params);
    const totalCustomers = rows.length;

    const today = new Date();
    today.setHours(0,0,0,0);

    const healthCounts = { healthy: 0, attention: 0, overdue: 0 };
    const tierHealth = {
      A: { healthy: 0, attention: 0, overdue: 0, total: 0 },
      B: { healthy: 0, attention: 0, overdue: 0, total: 0 },
      C: { healthy: 0, attention: 0, overdue: 0, total: 0 },
      D: { healthy: 0, attention: 0, overdue: 0, total: 0 },
      other: { healthy: 0, attention: 0, overdue: 0, total: 0 }
    };
    
    let totalForecast = 0;

    rows.forEach(r => {
      totalForecast += (r.year_forecast || 0);
      
      let care_health = 'healthy';
      const last_contact = r.last_contact_date;
      if (!last_contact) {
        care_health = 'overdue';
      } else {
        const contactDate = new Date(last_contact);
        contactDate.setHours(0,0,0,0);
        const days = Math.floor((today - contactDate) / (1000 * 60 * 60 * 24));
        const tierGuideline = r.tier === 'A' ? 30 : r.tier === 'B' ? 60 : r.tier === 'C' ? 90 : r.tier === 'D' ? 180 : 90;
        if (days >= tierGuideline) {
          care_health = 'overdue';
        } else if (days >= (tierGuideline - 7)) {
          care_health = 'attention';
        }
      }

      healthCounts[care_health]++;
      
      const t = r.tier || 'other';
      if (tierHealth[t]) {
        tierHealth[t][care_health]++;
        tierHealth[t].total++;
      } else {
        tierHealth.other[care_health]++;
        tierHealth.other.total++;
      }
    });

    const indRows = query(`SELECT industry, COUNT(*) as count FROM customers GROUP BY industry ORDER BY count DESC LIMIT 15`);
    const provRows = query(`SELECT province, COUNT(*) as count FROM customers GROUP BY province ORDER BY count DESC LIMIT 15`);
    
    const totalVisitsCount = query(`SELECT COUNT(*) as count FROM activities WHERE activity_type = 'Visit'`)[0].count;
    const totalCallsCount = query(`SELECT COUNT(*) as count FROM activities WHERE activity_type = 'Call'`)[0].count;
    
    const salesStats = query(`SELECT created_by as sale_code, COUNT(*) as count FROM activities WHERE created_by != '' GROUP BY created_by`);

    res.json({
      totalCustomers,
      totalForecast,
      healthCounts,
      tierHealth,
      industries: indRows,
      provinces: provRows,
      totalVisitsCount,
      totalCallsCount,
      sales: salesStats
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Re-sync CMB database from Excel file (supports local file on server OR direct binary upload)
app.post('/api/cmb-sync', express.raw({ type: '*/*', limit: '10mb' }), (req, res) => {
  try {
    const XLSX = require('xlsx');
    let workbook;
    
    // Check if client uploaded raw binary data
    if (Buffer.isBuffer(req.body) && req.body.length > 0) {
      workbook = XLSX.read(req.body, { type: 'buffer' });
    } else {
      // Otherwise, try reading the local file on the server
      const excelPath = path.join(__dirname, '5.6.2569  อาจารย์  ส่งมาให้ล่าสุด WIC TSK Team.xlsx');
      if (!fs.existsSync(excelPath)) {
        return res.status(404).json({ error: 'Excel file not found on server. Please upload it via browser instead.' });
      }
      workbook = XLSX.readFile(excelPath);
    }
    
    const sheetName = 'รวม TSK ';
    if (!workbook.SheetNames.includes(sheetName)) {
      return res.status(400).json({ error: `Sheet '${sheetName}' not found in the Excel workbook.` });
    }
    
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
    const dataRows = rows.slice(2);
    
    const insertStmt = db.prepare(`
      INSERT INTO customers (
        customer_name, wic_customer_id, tier, status, registration_date,
        sale_code, team, month_forecast, year_forecast, zone,
        industry, product_service, contact_name, position, tel,
        mobile, line_id, email, address, subdistrict,
        district, province, zipcode
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `);
    
    const cleanStr = (val) => {
      if (val === undefined || val === null) return "";
      let s = String(val).trim();
      s = s.replace(/\u00a0/g, ' ');
      return s;
    };
    
    const cleanFloat = (val) => {
      if (val === undefined || val === null) return 0.0;
      let s = String(val).trim();
      s = s.replace(/[^\d.-]/g, '');
      const f = parseFloat(s);
      return isNaN(f) ? 0.0 : f;
    };
    
    const cleanedRows = [];
    
    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const custName = row[1] ? cleanStr(row[1]) : '';
      if (!custName) continue;
      
      const wicId = row[2] ? cleanStr(row[2]) : '';
      const tier = row[3] ? cleanStr(row[3]) : '';
      const status = row[4] ? cleanStr(row[4]) : '';
      const regDate = row[5] ? cleanStr(row[5]) : '';
      const saleCode = row[6] ? cleanStr(row[6]) : '';
      const team = row[7] ? cleanStr(row[7]) : '';
      const monthFc = row[8] ? cleanFloat(row[8]) : 0.0;
      const yearFc = row[9] ? cleanFloat(row[9]) : 0.0;
      const zone = row[10] ? cleanStr(row[10]) : '';
      const industry = row[11] ? cleanStr(row[11]) : '';
      const prodSvc = row[12] ? cleanStr(row[12]) : '';
      const contact = row[13] ? cleanStr(row[13]) : '';
      const pos = row[14] ? cleanStr(row[14]) : '';
      const tel = row[15] ? cleanStr(row[15]) : '';
      const mobile = row[16] ? cleanStr(row[16]) : '';
      
      const lid1 = row[17] ? cleanStr(row[17]) : '';
      const lid2 = row[18] ? cleanStr(row[18]) : '';
      const lineId = lid1 ? lid1 : lid2;
      
      const email = row[19] ? cleanStr(row[19]) : '';
      const addr = row[21] ? cleanStr(row[21]) : '';
      const subdist = row[22] ? cleanStr(row[22]) : '';
      const dist = row[23] ? cleanStr(row[23]) : '';
      let prov = row[24] ? cleanStr(row[24]) : '';
      const zipc = row[25] ? cleanStr(row[25]) : '';
      
      if (prov) {
        prov = prov.replace("จ.", "").trim();
      }
      if (!prov && zone) {
        const zClean = zone.replace("จ.", "").trim();
        const validProvinces = ["กรุงเทพ", "กทม.", "สมุทรปราการ", "นนทบุรี", "นครปฐม", "สมุทรสาคร", "ระยอง", "ฉะเชิงเทรา", "ชลบุรี", "ปราจีนบุรี", "ปทุมธานี", "สระบุรี"];
        if (validProvinces.includes(zClean)) {
          prov = zClean;
        }
      }
      if (prov === "กทม.") {
        prov = "กรุงเทพ";
      }
      
      cleanedRows.push([
        custName, wicId, tier, status, regDate,
        saleCode, team, monthFc, yearFc, zone,
        industry, prodSvc, contact, pos, tel,
        mobile, lineId, email, addr, subdist,
        dist, prov, zipc
      ]);
    }
    
    // DB transaction: recreate table, insert rows
    db.run("DROP TABLE IF EXISTS customers;");
    db.run(`
      CREATE TABLE IF NOT EXISTS customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_name TEXT NOT NULL,
        wic_customer_id TEXT,
        tier TEXT,
        status TEXT,
        registration_date TEXT,
        sale_code TEXT,
        team TEXT,
        month_forecast REAL DEFAULT 0,
        year_forecast REAL DEFAULT 0,
        zone TEXT,
        industry TEXT,
        product_service TEXT,
        contact_name TEXT,
        position TEXT,
        tel TEXT,
        mobile TEXT,
        line_id TEXT,
        email TEXT,
        address TEXT,
        subdistrict TEXT,
        district TEXT,
        province TEXT,
        zipcode TEXT,
        last_visit_date TEXT DEFAULT '',
        last_call_date TEXT DEFAULT '',
        last_contact_date TEXT DEFAULT '',
        next_planned_date TEXT DEFAULT '',
        next_planned_type TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now','localtime')),
        updated_at TEXT DEFAULT (datetime('now','localtime'))
      );
    `);
    
    db.run(`
      CREATE TABLE IF NOT EXISTS activities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER NOT NULL,
        activity_type TEXT NOT NULL,
        activity_date TEXT NOT NULL,
        contact_person TEXT DEFAULT '',
        summary TEXT DEFAULT '',
        created_by TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now','localtime')),
        FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE CASCADE
      );
    `);
    
    db.run(`
      CREATE TABLE IF NOT EXISTS plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER NOT NULL,
        plan_type TEXT NOT NULL,
        planned_date TEXT NOT NULL,
        objective TEXT DEFAULT '',
        created_by TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now','localtime')),
        FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE CASCADE
      );
    `);
    
    const insertMany = db.transaction((rowsToInsert) => {
      for (const r of rowsToInsert) {
        insertStmt.run(r);
      }
    });
    
    insertMany(cleanedRows);
    res.json({ message: `seeded database with ${cleanedRows.length} customers!` });
  } catch (err) {
    console.error('CMB Sync failed:', err);
    res.status(500).json({ error: `Sync failed: ${err.message}` });
  }
});


// API: Export filtered CMB data to Excel CSV
app.get('/api/cmb-export-csv', (req, res) => {
  try {
    const q = req.query.q || '';
    const sale = req.query.sale || '';
    const tier = req.query.tier || '';
    const industry = req.query.industry || '';
    const province = req.query.province || '';

    let sql = `SELECT * FROM customers WHERE 1=1`;
    const params = [];
    if (q) {
      const likeParam = `%${q}%`;
      sql += ` AND (customer_name LIKE ? OR wic_customer_id LIKE ? OR contact_name LIKE ? OR mobile LIKE ? OR email LIKE ? OR product_service LIKE ?)`;
      params.push(likeParam, likeParam, likeParam, likeParam, likeParam, likeParam);
    }
    if (sale) {
      sql += ` AND sale_code = ?`;
      params.push(sale);
    }
    if (tier) {
      sql += ` AND tier = ?`;
      params.push(tier);
    }
    if (industry) {
      sql += ` AND industry = ?`;
      params.push(industry);
    }
    if (province) {
      sql += ` AND province = ?`;
      params.push(province);
    }

    sql += ` ORDER BY customer_name ASC`;
    const rows = query(sql, params);

    const headers = [
      'ID', 'Customer Name', 'WIC Customer ID', 'Grade Tier', 'Status',
      'Sale Code', 'Zone', 'Industry Type', 'Contact Person', 'Mobile', 'E-mail',
      'Last Visit Date', 'Last Call Date', 'Last Contact Date', 'Next Planned Contact Date', 'Next Planned Type'
    ];

    let csvContent = '\ufeff'; // UTF-8 BOM
    csvContent += headers.map(h => `"${h.replace(/"/g, '""')}"`).join(',') + '\n';

    rows.forEach(r => {
      const dataRow = [
        r.id, r.customer_name, r.wic_customer_id, r.tier, r.status,
        r.sale_code, r.zone, r.industry, r.contact_name, r.mobile, r.email,
        r.last_visit_date, r.last_call_date, r.last_contact_date, r.next_planned_date, r.next_planned_type
      ];
      csvContent += dataRow.map(cell => {
        const cleanCell = cell === null || cell === undefined ? '' : String(cell);
        return `"${cleanCell.replace(/"/g, '""')}"`;
      }).join(',') + '\n';
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="cmb_care_export.csv"');
    res.status(200).send(csvContent);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

initDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n  ✅ Wisco Order Tracker running!\n`);
    console.log(`  📊 Dashboard → http://localhost:${PORT}/dashboard.html`);
    console.log(`  ✏️  Edit      → http://localhost:${PORT}/edit.html\n`);

    // Run migration now — DB is fully loaded
    try {
      let created = 0;
      for (const p of MISSING_PRS) {
        const exists = query("SELECT id FROM purchase_requests WHERE LOWER(pr_no)=LOWER(?)", [p.pr_no]);
        if (exists.length > 0) continue;
        run(`INSERT INTO purchase_requests(pr_no,open_date,customer_name,customer_po,po_value,fine_yn,fine_pct,due_date,sale_team,sale,quotation_no,ld_no,domestic,po_no,items,linked_poi)
             VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [p.pr_no,'',p.customer_name,'','',p.fine_yn,'',p.due_date,'','','','','','',p.items,p.linked_poi]);
        created++;
      }
      if (created > 0) { saveDB(); console.log(`  ✅ Migration: inserted ${created} missing PR records`); }
      else { console.log('  ✅ Migration: all PRs already present'); }
    } catch(e) { console.error('  ❌ Migration error:', e.message); }
  });
});
