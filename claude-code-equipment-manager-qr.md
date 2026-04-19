# Claude Code Prompt — Equipment Manager Redesign + QR System

## Context
อ่าน index.html ก่อน
แก้ไข tab "อุปกรณ์" ของ Manager ให้เป็น Layout D (Split Panel)
พร้อมระบบ QR Code และ Unit Tracking
อย่าแตะ logic อื่น — แก้เฉพาะ tab อุปกรณ์และเพิ่ม features ใหม่

---

## Phase 1 — Database Migration (ทำก่อน)

### SQL ที่ต้องรันใน Supabase SQL Editor:

```sql
-- 1. สร้าง table equipment_units
CREATE TABLE equipment_units (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  equipment_id uuid REFERENCES equipment(id) ON DELETE CASCADE,
  unit_code text UNIQUE NOT NULL,
  status text DEFAULT 'available' 
    CHECK (status IN ('available','borrowed','damaged','lost')),
  qr_url text,
  notes text,
  created_at timestamptz DEFAULT now()
);

-- 2. เพิ่ม unit_id ใน borrowing_records (nullable — backward compatible)
ALTER TABLE borrowing_records
ADD COLUMN IF NOT EXISTS unit_id uuid REFERENCES equipment_units(id);

-- 3. RLS policies
CREATE POLICY "allow all equipment_units"
ON equipment_units FOR ALL USING (true) WITH CHECK (true);

-- 4. Index
CREATE INDEX idx_equipment_units_equipment_id 
ON equipment_units(equipment_id);
CREATE INDEX idx_equipment_units_status 
ON equipment_units(status);
```

---

## Phase 2 — Library (เพิ่มใน `<head>`)

```html
<!-- QR Code Generation -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
```

---

## Phase 3 — Layout D (Split Panel) ใน Tab อุปกรณ์

### HTML Structure

```html
<div id="equipmentTab" class="tab-content">

  <!-- Top bar -->
  <div class="eq-topbar">
    <div class="eq-search-wrap">
      <input id="eqSearch" placeholder="ค้นหาอุปกรณ์..." class="eq-search"/>
    </div>
    <div style="display:flex;gap:8px">
      <select id="eqCategoryFilter" class="eq-filter-select">
        <option value="all">ทุกหมวดหมู่</option>
        <!-- populate from categories -->
      </select>
      <button onclick="openAddEquipmentModal()" class="btn-primary-sm">
        + เพิ่มอุปกรณ์
      </button>
    </div>
  </div>

  <!-- Availability Legend -->
  <div class="availability-legend">
    <span><span class="leg-dot green"></span>ว่าง</span>
    <span><span class="leg-dot blue"></span>ยืมอยู่</span>
    <span><span class="leg-dot amber"></span>ชำรุด</span>
    <span><span class="leg-dot red"></span>สูญหาย</span>
  </div>

  <!-- Split Panel -->
  <div class="eq-split-panel">

    <!-- LEFT: Equipment List -->
    <div class="eq-left-panel" id="eqLeftPanel">
      <div id="eqListContainer">
        <!-- render by renderEquipmentList() -->
      </div>
      <!-- Category Management -->
      <div class="eq-category-section">
        <div class="eq-category-header">
          <span class="section-label">หมวดหมู่</span>
          <button onclick="openAddCategoryForm()" class="mini-btn-orange">
            + เพิ่มหมวดหมู่
          </button>
        </div>
        <div id="categoryList"></div>
      </div>
    </div>

    <!-- RIGHT: Unit Detail Panel -->
    <div class="eq-right-panel" id="eqRightPanel">
      <!-- Default: empty state -->
      <div class="eq-empty-detail" id="eqEmptyDetail">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" 
             stroke="#FDBA74" stroke-width="1.5">
          <path d="M20 7H4a2 2 0 00-2 2v6a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z"/>
          <path d="M12 12h.01"/>
        </svg>
        <p>เลือกอุปกรณ์เพื่อดูรายละเอียด</p>
      </div>
      <!-- Detail: shown when equipment selected -->
      <div id="eqDetailContent" style="display:none">
        <!-- render by renderUnitDetail() -->
      </div>
    </div>

  </div>
</div>
```

### CSS

```css
/* Top bar */
.eq-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.eq-search {
  width: 100%;
  max-width: 280px;
}
.eq-filter-select {
  font-size: 13px;
  padding: 7px 10px;
  border-radius: 8px;
  border: 0.5px solid #e7e5e4;
  background: #fafaf9;
  font-family: 'Noto Sans Thai', sans-serif;
}

/* Split Panel */
.eq-split-panel {
  display: grid;
  grid-template-columns: 300px 1fr;
  gap: 16px;
  min-height: 500px;
}
@media (max-width: 767px) {
  .eq-split-panel { grid-template-columns: 1fr; }
  .eq-right-panel { display: none; }
  .eq-right-panel.mobile-open { display: block; }
}

/* Left Panel */
.eq-left-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* Equipment card in left panel */
.eq-list-item {
  background: #fff;
  border: 0.5px solid #e7e5e4;
  border-radius: 10px;
  padding: 12px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.eq-list-item:hover {
  border-color: #fed7aa;
  background: #fff7ed;
}
.eq-list-item.active {
  border: 1.5px solid #f97316;
  background: #fff7ed;
}
.eq-item-name {
  font-size: 13px;
  font-weight: 600;
  color: #1c1917;
  margin: 0 0 2px;
}
.eq-item-meta {
  font-size: 11px;
  color: #a8a29e;
  margin: 0 0 8px;
}
.eq-unit-dots {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}
.unit-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}
.unit-dot.available { background: #10b981; }
.unit-dot.borrowed  { background: #3b82f6; }
.unit-dot.damaged   { background: #f59e0b; }
.unit-dot.lost      { background: #ef4444; }

/* Right Panel */
.eq-right-panel {
  background: #fafaf9;
  border: 0.5px solid #e7e5e4;
  border-radius: 12px;
  padding: 16px;
  min-height: 400px;
}
.eq-empty-detail {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 300px;
  gap: 12px;
  color: #a8a29e;
  font-size: 13px;
}

/* Detail Panel Header */
.eq-detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 0.5px solid #e7e5e4;
}
.eq-detail-title {
  font-size: 15px;
  font-weight: 700;
  color: #1c1917;
}
.eq-detail-actions {
  display: flex;
  gap: 6px;
}

/* Unit row in detail panel */
.unit-row {
  background: #fff;
  border-radius: 8px;
  padding: 8px 12px;
  display: flex;
  align-items: center;
  gap: 10px;
  border: 0.5px solid #e7e5e4;
  margin-bottom: 6px;
  transition: box-shadow 0.15s;
}
.unit-row:hover {
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
}
.unit-row.borrowed { border-color: #bfdbfe; background: #f0f9ff; }
.unit-row.damaged  { border-color: #fde68a; background: #fffbeb; }
.unit-row.lost     { border-color: #fecaca; background: #fff5f5; }

.unit-code {
  font-size: 12px;
  font-weight: 600;
  color: #1c1917;
  flex: 1;
  font-family: 'Courier New', monospace;
}
.unit-borrower {
  font-size: 11px;
  color: #3b82f6;
  font-weight: 500;
}

/* Batch select checkbox */
.unit-checkbox {
  width: 16px;
  height: 16px;
  accent-color: #f97316;
  cursor: pointer;
}

/* Category section */
.eq-category-section {
  margin-top: 8px;
  background: #fff;
  border: 0.5px solid #e7e5e4;
  border-radius: 10px;
  padding: 12px;
}
.eq-category-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.section-label {
  font-size: 11px;
  font-weight: 600;
  color: #78716c;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.category-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px;
  border-radius: 6px;
  font-size: 12px;
  color: #1c1917;
}
.category-item:hover { background: #fafaf9; }

/* Buttons */
.btn-primary-sm {
  background: #f97316;
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 7px 14px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  font-family: 'Noto Sans Thai', sans-serif;
  white-space: nowrap;
}
.mini-btn-orange {
  background: #fff7ed;
  color: #c2410c;
  border: 0.5px solid #fed7aa;
  border-radius: 6px;
  padding: 3px 10px;
  font-size: 11px;
  cursor: pointer;
  font-family: 'Noto Sans Thai', sans-serif;
}
.mini-btn-gray {
  background: #fff;
  color: #78716c;
  border: 0.5px solid #e7e5e4;
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 11px;
  cursor: pointer;
  font-family: 'Noto Sans Thai', sans-serif;
}

/* Availability legend */
.availability-legend {
  display: flex;
  gap: 16px;
  font-size: 11px;
  color: #a8a29e;
  margin-bottom: 12px;
}
.leg-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
  margin-right: 4px;
}
.leg-dot.green { background: #10b981; }
.leg-dot.blue  { background: #3b82f6; }
.leg-dot.amber { background: #f59e0b; }
.leg-dot.red   { background: #ef4444; }
```

---

## Phase 4 — JavaScript Functions

### Render Equipment List (Left Panel)

```javascript
let selectedEquipmentId = null;
let equipmentUnitsCache = {};

async function renderEquipmentTab() {
  await renderEquipmentList();
  await renderCategoryList();
}

async function renderEquipmentList(searchTerm = '', categoryFilter = 'all') {
  let query = supabase
    .from('equipment')
    .select('*, categories(name)')
    .eq('is_active', true)
    .order('name');

  if (categoryFilter !== 'all') {
    query = query.eq('category_id', categoryFilter);
  }

  const { data: equipments } = await query;
  const filtered = searchTerm
    ? equipments.filter(e => 
        e.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        e.serial_no?.toLowerCase().includes(searchTerm.toLowerCase()))
    : equipments;

  // Load units for all equipment
  const { data: allUnits } = await supabase
    .from('equipment_units')
    .select('*')
    .in('equipment_id', filtered.map(e => e.id));

  // Group units by equipment
  const unitsByEquipment = {};
  allUnits?.forEach(u => {
    if (!unitsByEquipment[u.equipment_id]) 
      unitsByEquipment[u.equipment_id] = [];
    unitsByEquipment[u.equipment_id].push(u);
  });

  const container = document.getElementById('eqListContainer');
  if (!filtered?.length) {
    container.innerHTML = `
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" 
             stroke="#FDBA74" stroke-width="1.5">
          <path d="M20 7H4a2 2 0 00-2 2v6a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z"/>
        </svg>
        <p>ไม่พบอุปกรณ์</p>
        <button onclick="openAddEquipmentModal()" class="btn-primary-sm">
          + เพิ่มอุปกรณ์
        </button>
      </div>`;
    return;
  }

  container.innerHTML = filtered.map(eq => {
    const units = unitsByEquipment[eq.id] || [];
    const dots = units.map(u => 
      `<span class="unit-dot ${u.status}"></span>`
    ).join('');
    const availCount = units.filter(u => u.status === 'available').length;
    const borrowedCount = units.filter(u => u.status === 'borrowed').length;
    const isActive = selectedEquipmentId === eq.id;

    return `
      <div class="eq-list-item ${isActive ? 'active' : ''}" 
           onclick="selectEquipment('${eq.id}')">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:36px;height:36px;background:#fff7ed;border-radius:8px;
                      display:flex;align-items:center;justify-content:center;
                      flex-shrink:0;overflow:hidden">
            ${eq.image_url 
              ? `<img src="${eq.image_url}" style="width:100%;height:100%;object-fit:cover;border-radius:8px">`
              : `<span style="font-size:18px">📦</span>`}
          </div>
          <div style="flex:1;min-width:0">
            <p class="eq-item-name">${eq.name}</p>
            <p class="eq-item-meta">
              ${eq.categories?.name || ''} 
              ${eq.serial_no ? `· ${eq.serial_no}` : ''}
              · ${units.length} หน่วย
            </p>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <span style="font-size:11px;color:#10b981;font-weight:500">
              ${availCount} ว่าง
            </span>
            ${borrowedCount > 0 
              ? `<br><span style="font-size:10px;color:#3b82f6">${borrowedCount} ยืม</span>` 
              : ''}
          </div>
        </div>
        ${units.length > 0 
          ? `<div class="eq-unit-dots" style="margin-top:8px">${dots}</div>` 
          : ''}
      </div>`;
  }).join('');
}

async function selectEquipment(equipmentId) {
  selectedEquipmentId = equipmentId;
  
  // Update active state
  document.querySelectorAll('.eq-list-item').forEach(el => 
    el.classList.remove('active'));
  event.currentTarget?.classList.add('active');

  // Load and render units
  const { data: equipment } = await supabase
    .from('equipment')
    .select('*, categories(name)')
    .eq('id', equipmentId)
    .single();

  const { data: units } = await supabase
    .from('equipment_units')
    .select('*, borrowing_records(borrower_name, borrow_date, due_date)')
    .eq('equipment_id', equipmentId)
    .order('unit_code');

  renderUnitDetail(equipment, units || []);

  // Mobile: show right panel
  document.getElementById('eqRightPanel').classList.add('mobile-open');
}
```

### Render Unit Detail (Right Panel)

```javascript
function renderUnitDetail(equipment, units) {
  document.getElementById('eqEmptyDetail').style.display = 'none';
  const content = document.getElementById('eqDetailContent');
  content.style.display = 'block';

  const availCount = units.filter(u => u.status === 'available').length;
  const borrowedCount = units.filter(u => u.status === 'borrowed').length;
  const damagedCount = units.filter(u => u.status === 'damaged').length;

  content.innerHTML = `
    <!-- Header -->
    <div class="eq-detail-header">
      <div>
        <p class="eq-detail-title">${equipment.name}</p>
        <div style="display:flex;gap:6px;margin-top:4px">
          <span class="tag t-green">${availCount} ว่าง</span>
          ${borrowedCount > 0 
            ? `<span class="tag t-blue">${borrowedCount} ยืม</span>` : ''}
          ${damagedCount > 0 
            ? `<span class="tag t-amber">${damagedCount} ชำรุด</span>` : ''}
        </div>
      </div>
      <div class="eq-detail-actions">
        <button onclick="openAddUnitModal('${equipment.id}','${equipment.name}')" 
                class="btn-primary-sm">+ เพิ่ม unit</button>
        <button onclick="batchPrintSelected('${equipment.id}')" 
                class="mini-btn-gray" id="batchPrintBtn" style="display:none">
          พิมพ์ที่เลือก
        </button>
        <button onclick="printAllUnits('${equipment.id}')" 
                class="mini-btn-gray">พิมพ์ทั้งหมด</button>
        <button onclick="openEditEquipmentModal('${equipment.id}')" 
                class="mini-btn-gray">แก้ไข</button>
        <button onclick="confirmDeleteEquipment('${equipment.id}','${equipment.name}')" 
                class="mini-btn-gray" style="color:#ef4444">ลบ</button>
      </div>
    </div>

    <!-- Batch select bar -->
    <div id="batchBar" style="display:none;background:#fff7ed;border-radius:8px;
         padding:8px 12px;margin-bottom:10px;display:none;align-items:center;gap:8px">
      <input type="checkbox" id="selectAllUnits" 
             onchange="toggleSelectAll(this.checked)">
      <span style="font-size:12px;color:#c2410c" id="selectedCount">เลือก 0 รายการ</span>
      <button onclick="batchPrintSelected('${equipment.id}')" 
              class="mini-btn-orange">พิมพ์ที่เลือก</button>
      <button onclick="batchUpdateStatus()" 
              class="mini-btn-gray">เปลี่ยนสถานะ</button>
    </div>

    <!-- Unit list -->
    <div id="unitList">
      ${units.length === 0 
        ? `<div class="empty-state" style="min-height:200px">
             <p style="color:#a8a29e;font-size:13px">ยังไม่มี unit</p>
             <button onclick="openAddUnitModal('${equipment.id}','${equipment.name}')" 
                     class="btn-primary-sm">+ เพิ่ม unit แรก</button>
           </div>`
        : units.map(unit => renderUnitRow(unit)).join('')
      }
    </div>
  `;
}

function renderUnitRow(unit) {
  const borrowRecord = unit.borrowing_records?.[0];
  const statusLabels = {
    available: '<span class="tag t-green">ว่าง</span>',
    borrowed: `<span class="tag t-blue">ยืม${borrowRecord ? ` — ${borrowRecord.borrower_name}` : ''}</span>`,
    damaged: '<span class="tag t-amber">ชำรุด</span>',
    lost: '<span class="tag t-red">สูญหาย</span>'
  };

  const actionBtns = {
    available: `<button onclick="openQRModal('${unit.id}','${unit.unit_code}')" 
                        class="mini-btn-gray">QR</button>
                <button onclick="openUnitHistory('${unit.id}')" 
                        class="mini-btn-gray">ประวัติ</button>
                <button onclick="openEditUnitModal('${unit.id}')" 
                        class="mini-btn-gray">แก้ไข</button>`,
    borrowed: `<button onclick="openQRModal('${unit.id}','${unit.unit_code}')" 
                       class="mini-btn-gray">QR</button>
               <button onclick="openUnitHistory('${unit.id}')" 
                       class="mini-btn-gray">ประวัติ</button>
               <button onclick="returnByManager('${unit.id}')" 
                       class="mini-btn-orange">คืน</button>`,
    damaged: `<button onclick="openQRModal('${unit.id}','${unit.unit_code}')" 
                      class="mini-btn-gray">QR</button>
              <button onclick="openEditUnitModal('${unit.id}')" 
                      class="mini-btn-orange">แก้ไข</button>`,
    lost: `<button onclick="openEditUnitModal('${unit.id}')" 
                   class="mini-btn-orange">แก้ไข</button>`
  };

  return `
    <div class="unit-row ${unit.status}" data-unit-id="${unit.id}">
      <input type="checkbox" class="unit-checkbox" 
             onchange="onUnitCheckChange()" value="${unit.id}">
      <span class="unit-dot ${unit.status}"></span>
      <span class="unit-code">${unit.unit_code}</span>
      ${statusLabels[unit.status] || ''}
      <div style="display:flex;gap:4px;margin-left:auto">
        ${actionBtns[unit.status] || ''}
      </div>
    </div>`;
}
```

### QR Modal

```javascript
async function openQRModal(unitId, unitCode) {
  const equipment = await supabase
    .from('equipment_units')
    .select('*, equipment(name)')
    .eq('id', unitId)
    .single();

  const qrUrl = `${window.location.origin}${window.location.pathname}?unit=${unitCode}`;
  const equipName = equipment.data?.equipment?.name || '';

  // Create modal
  const modal = document.createElement('div');
  modal.id = 'qrModal';
  modal.style.cssText = `
    position:fixed;inset:0;z-index:1000;
    display:flex;align-items:center;justify-content:center;
    background:rgba(0,0,0,0.5);backdrop-filter:blur(4px)`;
  modal.innerHTML = `
    <div style="background:#fff;border-radius:20px;padding:28px;
                width:320px;text-align:center;
                box-shadow:0 20px 60px rgba(0,0,0,0.3)">
      <h3 style="font-size:16px;font-weight:700;margin:0 0 4px;color:#1c1917">
        QR Code
      </h3>
      <p style="font-size:13px;color:#a8a29e;margin:0 0 16px">${equipName}</p>
      
      <!-- QR Code -->
      <div id="qrCodeDisplay" style="display:flex;justify-content:center;
           margin-bottom:12px;padding:16px;background:#f9f9f9;border-radius:12px"></div>
      
      <!-- Unit code -->
      <div style="background:#fafaf9;border-radius:8px;padding:8px 12px;
                  margin-bottom:20px">
        <p style="font-size:11px;color:#a8a29e;margin:0 0 2px">Unit Code</p>
        <p style="font-size:14px;font-weight:600;color:#1c1917;
                  font-family:'Courier New',monospace;margin:0">${unitCode}</p>
      </div>
      
      <!-- Actions -->
      <div style="display:flex;gap:8px">
        <button onclick="printQRLabel('${unitCode}','${equipName}')" 
                class="btn-primary-sm" style="flex:1">🖨️ พิมพ์ label</button>
        <button onclick="downloadQRPng('${unitCode}')" 
                class="mini-btn-gray" style="flex:1">⬇️ Download PNG</button>
      </div>
      <button onclick="document.getElementById('qrModal').remove()" 
              style="margin-top:12px;background:none;border:none;
                     color:#a8a29e;font-size:13px;cursor:pointer;
                     font-family:'Noto Sans Thai',sans-serif">
        ปิด
      </button>
    </div>`;

  document.body.appendChild(modal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });

  // Generate QR
  new QRCode(document.getElementById('qrCodeDisplay'), {
    text: qrUrl,
    width: 200,
    height: 200,
    colorDark: '#1c1917',
    colorLight: '#ffffff',
    correctLevel: QRCode.CorrectLevel.H
  });
}
```

### Print Functions

```javascript
// Print single label
function printQRLabel(unitCode, equipName) {
  const printWindow = window.open('', '_blank');
  const qrUrl = `${window.location.origin}${window.location.pathname}?unit=${unitCode}`;
  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>QR Label — ${unitCode}</title>
      <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js">
      </script>
      <style>
        @page { size: 60mm 40mm; margin: 0; }
        body { margin: 0; padding: 4mm; font-family: sans-serif;
               display: flex; flex-direction: column; align-items: center;
               justify-content: center; height: 40mm; }
        #qr canvas, #qr img { width: 24mm !important; height: 24mm !important; }
        .label-name { font-size: 8pt; font-weight: bold; margin: 1mm 0 0; 
                      text-align: center; }
        .label-code { font-size: 7pt; color: #666; font-family: monospace; }
        .label-brand { font-size: 6pt; color: #999; margin-top: 1mm; }
      </style>
    </head>
    <body>
      <div id="qr"></div>
      <p class="label-name">${equipName}</p>
      <p class="label-code">${unitCode}</p>
      <p class="label-brand">GA Equipment Control</p>
      <script>
        new QRCode(document.getElementById('qr'), {
          text: '${qrUrl}',
          width: 91, height: 91,
          colorDark: '#000000',
          correctLevel: QRCode.CorrectLevel.H
        });
        setTimeout(() => { window.print(); window.close(); }, 500);
      </script>
    </body>
    </html>`);
  printWindow.document.close();
}

// Batch print (selected units)
async function batchPrintSelected(equipmentId) {
  const checked = [...document.querySelectorAll('.unit-checkbox:checked')]
    .map(cb => cb.value);
  if (checked.length === 0) {
    showToast('เลือก unit ที่ต้องการพิมพ์ก่อน', 'warning');
    return;
  }
  const { data: units } = await supabase
    .from('equipment_units')
    .select('unit_code, equipment(name)')
    .in('id', checked);
  batchPrintLabels(units);
}

// Print all units
async function printAllUnits(equipmentId) {
  const { data: units } = await supabase
    .from('equipment_units')
    .select('unit_code, equipment(name)')
    .eq('equipment_id', equipmentId);
  batchPrintLabels(units);
}

function batchPrintLabels(units) {
  const baseUrl = `${window.location.origin}${window.location.pathname}`;
  const printWindow = window.open('', '_blank');
  const labelsHTML = units.map(u => `
    <div class="label">
      <div id="qr-${u.unit_code}"></div>
      <p class="label-name">${u.equipment?.name || ''}</p>
      <p class="label-code">${u.unit_code}</p>
      <p class="label-brand">GA Equipment Control</p>
    </div>`).join('');

  const qrScripts = units.map(u => `
    new QRCode(document.getElementById('qr-${u.unit_code}'), {
      text: '${baseUrl}?unit=${u.unit_code}',
      width: 91, height: 91,
      colorDark: '#000000',
      correctLevel: QRCode.CorrectLevel.H
    });`).join('\n');

  printWindow.document.write(`
    <!DOCTYPE html><html><head>
    <title>Batch Print QR Labels</title>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js">
    </script>
    <style>
      @page { margin: 5mm; }
      body { margin: 0; font-family: sans-serif; }
      .grid { display: flex; flex-wrap: wrap; gap: 2mm; }
      .label { width: 60mm; height: 40mm; padding: 3mm;
               display: flex; flex-direction: column; align-items: center;
               justify-content: center; border: 0.5px solid #ddd;
               page-break-inside: avoid; }
      .label div canvas, .label div img { 
        width: 22mm !important; height: 22mm !important; }
      .label-name { font-size: 7pt; font-weight: bold; margin: 1mm 0 0; 
                    text-align: center; }
      .label-code { font-size: 6.5pt; color: #555; font-family: monospace; }
      .label-brand { font-size: 5.5pt; color: #999; }
    </style>
    </head><body>
    <div class="grid">${labelsHTML}</div>
    <script>
      ${qrScripts}
      setTimeout(() => { window.print(); }, 800);
    </script>
    </body></html>`);
  printWindow.document.close();
}

// Download QR as PNG
function downloadQRPng(unitCode) {
  const canvas = document.querySelector('#qrCodeDisplay canvas');
  if (!canvas) {
    showToast('ไม่พบ QR Code', 'error');
    return;
  }
  const link = document.createElement('a');
  link.download = `QR-${unitCode}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}
```

### Add Unit Modal

```javascript
function openAddUnitModal(equipmentId, equipmentName) {
  showConfirm({
    title: `เพิ่ม unit — ${equipmentName}`,
    message: 'กรอกจำนวน unit ที่ต้องการเพิ่ม',
    icon: '📦',
    confirmText: 'สร้าง unit',
    confirmColor: 'bg-orange-500 hover:bg-orange-600',
    // ใช้ input แทน confirm ปกติ
    // สร้าง modal แยกสำหรับ input จำนวน
    onConfirm: () => createUnitsModal(equipmentId, equipmentName)
  });
}

async function createUnitsModal(equipmentId, equipmentName) {
  // Modal ให้กรอกจำนวน unit + prefix
  // เช่น prefix "NB-001" จำนวน 3 → สร้าง NB-001-01, NB-001-02, NB-001-03
  // หลังสร้างเสร็จ → reload unit detail + showToast success
  // บันทึก audit log: UNIT_CREATE
}

// Checkbox batch select
function onUnitCheckChange() {
  const checked = document.querySelectorAll('.unit-checkbox:checked').length;
  const batchBar = document.getElementById('batchBar');
  const countEl = document.getElementById('selectedCount');
  if (countEl) countEl.textContent = `เลือก ${checked} รายการ`;
  if (batchBar) batchBar.style.display = checked > 0 ? 'flex' : 'none';
}

function toggleSelectAll(checked) {
  document.querySelectorAll('.unit-checkbox')
    .forEach(cb => cb.checked = checked);
  onUnitCheckChange();
}
```

### Search & Filter

```javascript
// เพิ่ม event listeners
document.getElementById('eqSearch')?.addEventListener('input', (e) => {
  const cat = document.getElementById('eqCategoryFilter')?.value || 'all';
  renderEquipmentList(e.target.value, cat);
});

document.getElementById('eqCategoryFilter')?.addEventListener('change', (e) => {
  const search = document.getElementById('eqSearch')?.value || '';
  renderEquipmentList(search, e.target.value);
});
```

---

## Phase 5 — Audit Log

เพิ่ม logAction() ใน operations เหล่านี้:
- สร้าง units: `UNIT_CREATE`
- แก้ไข unit status: `UNIT_STATUS_UPDATE`  
- ลบ unit: `UNIT_DELETE`
- พิมพ์ label: `UNIT_PRINT`

---

## Implementation Notes

1. **ทำ SQL migration ก่อนเสมอ**
2. **Backward compatible** — borrowing_records เก่าที่ไม่มี unit_id ยังทำงานได้
3. **Mobile** — บน mobile ให้แสดง left panel ก่อน กด card แล้วค่อยแสดง right panel เต็มหน้าจอ
4. **QR URL format**: `?unit=NB-001-01` — handle ใน `init()` function
5. **Commit แยก**: SQL → HTML layout → CSS → JS render → QR modal → Print
