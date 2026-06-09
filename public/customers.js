let _searchQuery = '';
let _saleFilter = '';
let _tierFilter = '';
let _industryFilter = '';
let _provinceFilter = '';
let _healthFilter = '';
let _currentPage = 1;
let _limit = 12;
let _viewMode = localStorage.getItem('cmb_view_mode') || 'grid';

let _customers = [];
let _totalRecords = 0;
let _totalPages = 1;
let _activeCustomerId = null;

// Chart instances
let chartTierCompliance = null;
let chartActivities = null;
let chartSalesLeaderboard = null;
let chartTierNeglect = null;

document.addEventListener('DOMContentLoaded', () => {
    setViewMode(_viewMode);
    tick();
    setInterval(tick, 1000);
    
    // Set default dates in drawer form inputs to today
    const todayStr = new Date().toISOString().split('T')[0];
    document.getElementById('act-date').value = todayStr;
    document.getElementById('plan-date').value = todayStr;

    refreshAll();
});

async function refreshAll() {
    await Promise.all([
        loadData(),
        loadSidebarFilters(),
        loadStats()
    ]);
}

// Switch main tabs (Database vs Stats)
function switchTab(tabId) {
    document.querySelectorAll('.tab-link').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    
    const activeBtn = Array.from(document.querySelectorAll('.tab-link')).find(btn => btn.getAttribute('onclick').includes(tabId));
    if (activeBtn) activeBtn.classList.add('active');
    
    document.getElementById(tabId).classList.add('active');
    
    if (tabId === 'tab-statistics') {
        loadStats();
    }
}

// Switch drawer sub-tabs (Log Activity vs Schedule Plan)
function switchDrawerTab(tabId) {
    document.querySelectorAll('.dt-tab').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.drawer-tab-content').forEach(c => c.classList.remove('active'));
    
    const activeBtn = Array.from(document.querySelectorAll('.dt-tab')).find(btn => btn.getAttribute('onclick').includes(tabId));
    if (activeBtn) activeBtn.classList.add('active');
    
    document.getElementById(tabId).classList.add('active');
}

// Toggle grid vs list view
function setViewMode(mode) {
    _viewMode = mode;
    localStorage.setItem('cmb_view_mode', mode);
    
    document.querySelectorAll('.view-btn').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.getElementById('view-' + mode);
    if (activeBtn) activeBtn.classList.add('active');
    
    const viewContainer = document.getElementById('customers-view');
    if (viewContainer) {
        viewContainer.className = mode === 'grid' ? 'grid-mode' : 'list-mode';
    }
    
    renderCustomers();
}

// Fetch list of customers from unified API
async function loadData() {
    const resultsCount = document.getElementById('results-count');
    if (resultsCount) resultsCount.textContent = 'กำลังดึงข้อมูลแผนการติดต่อ...';
    
    try {
        const queryParams = new URLSearchParams({
            page: _currentPage,
            limit: _limit,
            q: _searchQuery,
            sale: _saleFilter,
            tier: _tierFilter,
            industry: _industryFilter,
            province: _provinceFilter,
            health: _healthFilter
        });
        
        const res = await fetch(`/api/customers?${queryParams}`);
        const data = await res.json();
        
        _customers = data.data || [];
        _totalRecords = data.total || 0;
        _totalPages = data.totalPages || 1;
        _currentPage = data.page || 1;
        
        renderCustomers();
        renderPagination();
        updateActiveFiltersSummary();
        
        if (resultsCount) {
            resultsCount.textContent = `พบข้อมูลแผนการติดต่อทั้งหมด ${_totalRecords} รายการ`;
        }
    } catch (err) {
        console.error('Error fetching customers:', err);
        showToast('ไม่สามารถดึงข้อมูลรายชื่อลูกค้าได้', 'error');
    }
}

// Fetch sidebar categories & Top KPI numbers
async function loadSidebarFilters() {
    try {
        const queryParams = new URLSearchParams({
            q: _searchQuery,
            sale: _saleFilter,
            tier: _tierFilter,
            health: _healthFilter
        });
        
        const res = await fetch(`/api/cmb-stats?${queryParams}`);
        const stats = await res.json();
        
        // Render Industry list
        const indList = document.getElementById('industry-list');
        if (indList) {
            let html = `
                <button class="filter-item ${!_industryFilter ? 'active' : ''}" onclick="setIndustryFilter('')">
                    <span>ทั้งหมด</span>
                    <span class="filter-item-count">${stats.totalCustomers}</span>
                </button>
            `;
            (stats.industries || []).forEach(ind => {
                const name = ind.industry || 'ไม่ระบุประเภท';
                const activeClass = _industryFilter === ind.industry ? 'active' : '';
                html += `
                    <button class="filter-item ${activeClass}" onclick="setIndustryFilter('${ind.industry || ''}')">
                        <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${name}">${name}</span>
                        <span class="filter-item-count">${ind.count}</span>
                    </button>
                `;
            });
            indList.innerHTML = html;
        }

        // Render Province list
        const provList = document.getElementById('province-list');
        if (provList) {
            let html = `
                <button class="filter-item ${!_provinceFilter ? 'active' : ''}" onclick="setProvinceFilter('')">
                    <span>ทั้งหมด</span>
                    <span class="filter-item-count">${stats.totalCustomers}</span>
                </button>
            `;
            (stats.provinces || []).forEach(p => {
                const name = p.province || 'ไม่ระบุจังหวัด';
                const activeClass = _provinceFilter === p.province ? 'active' : '';
                html += `
                    <button class="filter-item ${activeClass}" onclick="setProvinceFilter('${p.province || ''}')">
                        <span>${name}</span>
                        <span class="filter-item-count">${p.count}</span>
                    </button>
                `;
            });
            provList.innerHTML = html;
        }

        // Update Top KPIs
        const totalCard = document.getElementById('kpi-total-cust');
        if (totalCard) totalCard.textContent = stats.totalCustomers.toLocaleString();
        
        const neglectedCard = document.getElementById('kpi-neglected-cust');
        if (neglectedCard) {
            neglectedCard.textContent = (stats.healthCounts.overdue || 0).toLocaleString();
        }
        
        const complianceCard = document.getElementById('kpi-compliance-rate');
        if (complianceCard) {
            const healthy = stats.healthCounts.healthy || 0;
            const total = stats.totalCustomers || 1;
            const rate = Math.round((healthy / total) * 100);
            complianceCard.textContent = `${rate}%`;
        }
    } catch (err) {
        console.error('Error loading filters stats:', err);
    }
}

// Render cards or table lines
function renderCustomers() {
    const viewContainer = document.getElementById('customers-view');
    if (!viewContainer) return;
    
    if (_customers.length === 0) {
        viewContainer.innerHTML = `
            <div class="empty-state">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><line x1="23" y1="11" x2="17" y2="11"></line></svg>
                <h4>ไม่พบข้อมูลการติดต่อลูกค้า</h4>
                <p>ลองปรับคำค้นหาหรือเปลี่ยนฟิลเตอร์กรองใหม่</p>
            </div>
        `;
        return;
    }
    
    const healthLabels = { healthy: 'ดูแลดี 🟢', attention: 'ใกล้กำหนด 🟡', overdue: 'เลยกำหนด 🔴' };
    const healthClasses = { healthy: 'cs-healthy', attention: 'cs-attention', overdue: 'cs-overdue' };

    if (_viewMode === 'grid') {
        let html = '';
        _customers.forEach(c => {
            const tierClass = c.tier ? `t-${c.tier}` : 't-empty';
            const tierLabel = c.tier ? `Tier ${c.tier}` : 'No Tier';
            
            const lastVisit = c.last_visit_date ? c.last_visit_date : '— ยังไม่เคยพบ';
            const lastCall = c.last_call_date ? c.last_call_date : '— ยังไม่เคยโทร';
            
            let planText = '— ยังไม่มีแผน';
            if (c.next_planned_date) {
                const planIcon = c.next_planned_type === 'Visit' ? '🚗' : c.next_planned_type === 'Call' ? '📞' : '💻';
                planText = `${planIcon} ${c.next_planned_date}`;
            }

            html += `
                <div class="ccard h-${c.care_health}" onclick="openDetailDrawer(${c.id})">
                    <div class="ccard-header">
                        <div class="ccard-name" title="${c.customer_name}">${c.customer_name}</div>
                        <span class="ccard-tier ${tierClass}">${tierLabel}</span>
                    </div>
                    <div class="ccard-meta">
                        <div class="ccard-meta-item">
                            <span>🆔 ID:</span> <span class="m-val">${c.wic_customer_id || '—'}</span>
                        </div>
                        <div class="ccard-meta-item">
                            <span>🚗 ล่าสุด:</span> <span>${lastVisit}</span>
                        </div>
                        <div class="ccard-meta-item">
                            <span>📞 โทรสุด:</span> <span>${lastCall}</span>
                        </div>
                        <div class="ccard-meta-item" style="border-top:1px dashed var(--bd2);padding-top:4px;margin-top:2px">
                            <span>📅 แผนถัดไป:</span> <span class="m-val" style="color:var(--blue2)">${planText}</span>
                        </div>
                    </div>
                    <div class="ccard-footer">
                        <span class="ccard-sale">${c.sale_code || '—'}</span>
                        <span class="ccard-status-badge ${healthClasses[c.care_health]}">${healthLabels[c.care_health]}</span>
                    </div>
                </div>
            `;
        });
        viewContainer.innerHTML = html;
    } else {
        // Table view
        let rowsHtml = '';
        _customers.forEach(c => {
            const tierClass = c.tier ? `t-${c.tier}` : 't-empty';
            const tierLabel = c.tier ? `${c.tier}` : '—';
            
            const lastVisit = c.last_visit_date ? c.last_visit_date : '—';
            const lastCall = c.last_call_date ? c.last_call_date : '—';
            
            let planText = '—';
            if (c.next_planned_date) {
                const planIcon = c.next_planned_type === 'Visit' ? '🚗' : c.next_planned_type === 'Call' ? '📞' : '💻';
                planText = `${planIcon} ${c.next_planned_date}`;
            }

            rowsHtml += `
                <tr onclick="openDetailDrawer(${c.id})">
                    <td class="table-name" title="${c.customer_name}">${c.customer_name}</td>
                    <td>${c.wic_customer_id || '—'}</td>
                    <td><span class="ccard-tier ${tierClass}" style="padding:2px 6px">${tierLabel}</span></td>
                    <td><span class="ccard-sale">${c.sale_code || '—'}</span></td>
                    <td>${c.province || '—'}</td>
                    <td><span class="ccard-status-badge ${healthClasses[c.care_health]}">${healthLabels[c.care_health]}</span></td>
                    <td>${lastVisit}</td>
                    <td>${lastCall}</td>
                    <td class="m-val" style="color:var(--blue2)">${planText}</td>
                </tr>
            `;
        });
        
        viewContainer.innerHTML = `
            <div class="list-table-container">
                <table class="list-table">
                    <thead>
                        <tr>
                            <th>ชื่อลูกค้า / บริษัท</th>
                            <th>WIC ID</th>
                            <th>Tier</th>
                            <th>Sales</th>
                            <th>จังหวัด</th>
                            <th>สถานะการดูแล</th>
                            <th>เข้าพบล่าสุด</th>
                            <th>โทรคุยล่าสุด</th>
                            <th>แผนการรอบหน้า</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rowsHtml}
                    </tbody>
                </table>
            </div>
        `;
    }
}

// Render pagination buttons
function renderPagination() {
    const pag = document.getElementById('pagination');
    if (!pag) return;
    
    if (_totalPages <= 1) {
        pag.innerHTML = `
            <div class="pg-info">แสดงทั้งหมด ${_totalRecords} รายการ</div>
            <div class="pg-controls"></div>
        `;
        return;
    }
    
    const startIdx = (_currentPage - 1) * _limit + 1;
    const endIdx = Math.min(_currentPage * _limit, _totalRecords);
    const info = `แสดง ${startIdx}-${endIdx} จาก ${_totalRecords} รายการ`;
    
    let buttonsHtml = '';
    buttonsHtml += `<button class="pg-btn" onclick="changePage(1)" ${_currentPage === 1 ? 'disabled' : ''}>«</button>`;
    buttonsHtml += `<button class="pg-btn" onclick="changePage(${_currentPage - 1})" ${_currentPage === 1 ? 'disabled' : ''}>‹</button>`;
    
    let startPage = Math.max(1, _currentPage - 2);
    let endPage = Math.min(_totalPages, startPage + 4);
    if (endPage - startPage < 4) {
        startPage = Math.max(1, endPage - 4);
    }
    
    for (let p = startPage; p <= endPage; p++) {
        const activeClass = _currentPage === p ? 'active' : '';
        buttonsHtml += `<button class="pg-btn ${activeClass}" onclick="changePage(${p})">${p}</button>`;
    }
    
    buttonsHtml += `<button class="pg-btn" onclick="changePage(${_currentPage + 1})" ${_currentPage === _totalPages ? 'disabled' : ''}>›</button>`;
    buttonsHtml += `<button class="pg-btn" onclick="changePage(${_totalPages})" ${_currentPage === _totalPages ? 'disabled' : ''}>»</button>`;
    
    pag.innerHTML = `
        <div class="pg-info">${info}</div>
        <div class="pg-controls">${buttonsHtml}</div>
    `;
}

// Search timeout triggering
let searchTimeout;
function triggerSearch(val) {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
        _searchQuery = val;
        _currentPage = 1;
        
        const clearBtn = document.getElementById('search-clear');
        if (clearBtn) clearBtn.style.display = val ? 'block' : 'none';
        
        refreshAll();
    }, 300);
}

function clearSearch() {
    const input = document.getElementById('search-input');
    if (input) input.value = '';
    
    const clearBtn = document.getElementById('search-clear');
    if (clearBtn) clearBtn.style.display = 'none';
    
    _searchQuery = '';
    _currentPage = 1;
    refreshAll();
}

function setHealthFilter(val, el) {
    _healthFilter = val;
    _currentPage = 1;
    
    if (el) {
        document.querySelectorAll('#health-filter .capsule').forEach(c => c.classList.remove('active'));
        el.classList.add('active');
    }
    refreshAll();
}

function setSaleFilter(val, el) {
    _saleFilter = val;
    _currentPage = 1;
    
    if (el) {
        document.querySelectorAll('#sale-filter .capsule').forEach(c => c.classList.remove('active'));
        el.classList.add('active');
    }
    refreshAll();
}

function setTierFilter(val, el) {
    _tierFilter = val;
    _currentPage = 1;
    
    if (el) {
        document.querySelectorAll('#tier-filter .capsule').forEach(c => c.classList.remove('active'));
        el.classList.add('active');
    }
    refreshAll();
}

function setIndustryFilter(val) {
    _industryFilter = val;
    _currentPage = 1;
    refreshAll();
}

function setProvinceFilter(val) {
    _provinceFilter = val;
    _currentPage = 1;
    refreshAll();
}

function changePage(p) {
    _currentPage = p;
    loadData();
}

// Active badges rendering
function updateActiveFiltersSummary() {
    const container = document.getElementById('active-filters-summary');
    if (!container) return;
    
    let html = '';
    if (_industryFilter) {
        html += `
            <div class="active-badge">
                <span>🏭 ${truncateString(_industryFilter, 12)}</span>
                <span class="active-badge-close" onclick="removeActiveFilter('industry')">✕</span>
            </div>
        `;
    }
    if (_provinceFilter) {
        html += `
            <div class="active-badge">
                <span>📍 ${truncateString(_provinceFilter, 12)}</span>
                <span class="active-badge-close" onclick="removeActiveFilter('province')">✕</span>
            </div>
        `;
    }
    container.innerHTML = html;
}

function removeActiveFilter(type) {
    if (type === 'industry') _industryFilter = '';
    if (type === 'province') _provinceFilter = '';
    _currentPage = 1;
    refreshAll();
}

// Open Detail Drawer panel (read-only baseline + logging inputs + history timeline)
async function openDetailDrawer(id) {
    _activeCustomerId = id;
    switchDrawerTab('tab-log-activity');
    
    try {
        const res = await fetch(`/api/customers/${id}`);
        if (!res.ok) throw new Error('Customer fetch failed');
        const c = await res.json();
        
        // Fill read-only metadata
        document.getElementById('drawer-name').textContent = c.customer_name || 'ชื่อบริษัท';
        document.getElementById('drawer-name').title = c.customer_name || '';
        document.getElementById('drawer-id-badge').textContent = 'WIC-' + c.id;
        
        const healthLabels = { healthy: 'ดูแลสม่ำเสมอ 🟢', attention: 'ใกล้ครบกำหนด 🟡', overdue: 'เลยกำหนดดูแล 🔴' };
        const healthClasses = { healthy: 'cs-healthy', attention: 'cs-attention', overdue: 'cs-overdue' };
        
        const healthBadge = document.getElementById('drawer-health-badge');
        healthBadge.textContent = healthLabels[c.care_health];
        healthBadge.className = `ccard-tier ${healthClasses[c.care_health]}`;
        
        document.getElementById('m-wic-id').textContent = c.wic_customer_id || '—';
        document.getElementById('m-tier').textContent = c.tier ? 'Tier ' + c.tier : '—';
        document.getElementById('m-sale').textContent = c.sale_code || '—';
        document.getElementById('m-industry').textContent = c.industry || '—';
        document.getElementById('m-zone').textContent = c.zone || '—';
        document.getElementById('m-contact').textContent = c.contact_name || '—';
        document.getElementById('m-tel').textContent = c.tel || '—';
        document.getElementById('m-mobile').textContent = c.mobile || '—';
        document.getElementById('m-line').textContent = c.line_id || '—';
        document.getElementById('m-email').textContent = c.email || '—';
        document.getElementById('m-address').textContent = c.address || '—';
        
        // Reset logging forms
        document.getElementById('activity-form').reset();
        document.getElementById('plan-form').reset();
        const todayStr = new Date().toISOString().split('T')[0];
        document.getElementById('act-date').value = todayStr;
        document.getElementById('plan-date').value = todayStr;
        
        // Auto-fill sales code from Mworks record as default
        if (c.sale_code) {
            document.getElementById('act-by').value = c.sale_code;
        }
        
        // Pre-fill contact person
        if (c.contact_name) {
            document.getElementById('act-person').value = c.contact_name;
        }

        // Fetch and load timeline logs
        await loadTimeline(id);
        
        // Open Slide panel
        document.getElementById('drawer-overlay').classList.add('open');
        document.getElementById('detail-drawer').classList.add('open');
    } catch (err) {
        console.error('Error opening detail drawer:', err);
        showToast('ไม่สามารถดึงข้อมูลประวัติลูกค้าได้', 'error');
    }
}

// Fetch activities & plans, render vertical timeline
async function loadTimeline(id) {
    try {
        const res = await fetch(`/api/customers/${id}/visits`);
        const data = await res.json();
        
        // 1. Render next planned contact banner if available
        const planStrip = document.getElementById('planned-next-strip');
        if (data.plans && data.plans.length > 0) {
            const p = data.plans[0];
            const planIcon = p.plan_type === 'Visit' ? '🚗' : p.plan_type === 'Call' ? '📞' : '💻';
            const planTypeLabel = p.plan_type === 'Visit' ? 'เข้าพบ' : p.plan_type === 'Call' ? 'โทรศัพท์' : 'ประชุมออนไลน์';
            
            planStrip.innerHTML = `
                <div>
                    <strong>📅 แผนถัดไป:</strong> ${planIcon} ${planTypeLabel} วันที่ <strong>${p.planned_date}</strong> <br>
                    <span style="font-size:11px;opacity:0.8;margin-top:2px;display:block">เป้าหมาย: "${p.objective}"</span>
                </div>
                <div style="font-size:10px;background:rgba(255,255,255,0.08);padding:2px 6px;border-radius:4px">โดย Sales ${p.created_by || '—'}</div>
            `;
            planStrip.style.display = 'flex';
        } else {
            planStrip.style.display = 'none';
        }
        
        // 2. Render Timeline logs
        const timeline = document.getElementById('visit-timeline');
        if (!data.visits || data.visits.length === 0) {
            timeline.innerHTML = '<div style="font-size:12px;color:var(--mu);text-align:center;padding:20px 0">ยังไม่มีบันทึกประวัติการติดต่อสำหรับลูกค้ารายนี้</div>';
            return;
        }
        
        let html = '';
        data.visits.forEach(v => {
            const actTypeClass = v.activity_type === 'Visit' ? 't-visit' : v.activity_type === 'Call' ? 't-call' : 't-online';
            const actTypeIcon = v.activity_type === 'Visit' ? '🚗' : v.activity_type === 'Call' ? '📞' : '💻';
            const actTypeLabel = v.activity_type === 'Visit' ? 'Onsite Visit' : v.activity_type === 'Call' ? 'Phone Call' : 'Online Meeting';
            
            html += `
                <div class="timeline-item ${actTypeClass}">
                    <div class="timeline-icon">${actTypeIcon}</div>
                    <div class="timeline-content">
                        <div class="t-header">
                            <span class="t-date">${v.activity_date} · <span style="font-weight:500;opacity:0.7">${actTypeLabel}</span></span>
                            <span class="t-by">${v.created_by || '—'}</span>
                        </div>
                        <div class="t-summary">"${v.summary}"</div>
                        ${v.contact_person ? `<div class="t-person">👥 ผู้ติดต่อสื่่อสาร: ${v.contact_person}</div>` : ''}
                    </div>
                </div>
            `;
        });
        timeline.innerHTML = html;
    } catch (err) {
        console.error('Error loading timeline:', err);
    }
}

function closeDrawer() {
    document.getElementById('drawer-overlay').classList.remove('open');
    document.getElementById('detail-drawer').classList.remove('open');
    _activeCustomerId = null;
}

// Log a completed activity
async function logActivity(e) {
    e.preventDefault();
    if (!_activeCustomerId) return;
    
    const payload = {
        activity_type: document.getElementById('act-type').value,
        activity_date: document.getElementById('act-date').value,
        contact_person: document.getElementById('act-person').value,
        created_by: document.getElementById('act-by').value,
        summary: document.getElementById('act-summary').value
    };
    
    try {
        const res = await fetch(`/api/customers/${_activeCustomerId}/visits`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if (!res.ok) throw new Error('API logging failed');
        
        showToast('บันทึกรายงานการติดต่อเรียบร้อยแล้ว', 'success');
        
        // Reset summary notes input
        document.getElementById('act-summary').value = '';
        
        // Reload timeline & refresh stats
        await loadTimeline(_activeCustomerId);
        
        // Update drawer header health badge dynamically
        const checkRes = await fetch(`/api/customers/${_activeCustomerId}`);
        const c = await checkRes.json();
        const healthLabels = { healthy: 'ดูแลสม่ำเสมอ 🟢', attention: 'ใกล้ครบกำหนด 🟡', overdue: 'เลยกำหนดดูแล 🔴' };
        const healthClasses = { healthy: 'cs-healthy', attention: 'cs-attention', overdue: 'cs-overdue' };
        const healthBadge = document.getElementById('drawer-health-badge');
        healthBadge.textContent = healthLabels[c.care_health];
        healthBadge.className = `ccard-tier ${healthClasses[c.care_health]}`;

        refreshAll();
    } catch (err) {
        console.error(err);
        showToast('ไม่สามารถบันทึกกิจกรรมได้', 'error');
    }
}

// Schedule future planned activity
async function schedulePlan(e) {
    e.preventDefault();
    if (!_activeCustomerId) return;
    
    // Grab the logged by sales value as planner author
    const saleBy = document.getElementById('act-by').value || '—';
    
    const payload = {
        plan_type: document.getElementById('plan-type').value,
        planned_date: document.getElementById('plan-date').value,
        objective: document.getElementById('plan-objective').value,
        created_by: saleBy
    };
    
    try {
        const res = await fetch(`/api/customers/${_activeCustomerId}/schedule`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if (!res.ok) throw new Error('API scheduling failed');
        
        showToast('บันทึกแผนการเข้าพบรอบถัดไปสำเร็จ', 'success');
        document.getElementById('plan-objective').value = '';
        
        await loadTimeline(_activeCustomerId);
        refreshAll();
    } catch (err) {
        console.error(err);
        showToast('ไม่สามารถบันทึกแผนงานได้', 'error');
    }
}

// Excel Sync execution
async function syncExcel() {
    const btn = document.querySelector('.btn-sync');
    if (btn) btn.disabled = true;
    
    try {
        const useLocal = confirm("คุณต้องการเลือกไฟล์ Excel (.xlsx) จากเครื่องของคุณเพื่ออัปโหลดและซิงค์ใช่หรือไม่?\n\n(กด 'ตกลง' เพื่อเลือกไฟล์ใหม่จากเครื่องคอมพิวเตอร์ของคุณ หรือกด 'ยกเลิก' เพื่อให้ระบบใช้ไฟล์ Excel ที่อยู่บนเซิร์ฟเวอร์อยู่แล้ว)");
        
        if (useLocal) {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.xlsx';
            input.onchange = async (e) => {
                const file = e.target.files[0];
                if (!file) {
                    if (btn) btn.disabled = false;
                    return;
                }
                
                showToast('กำลังอัปโหลดและซิงค์ข้อมูลลูกค้าจากไฟล์... โปรดรอสักครู่', 'success');
                if (btn) btn.disabled = true;
                
                try {
                    const res = await fetch('/api/cmb-sync', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/octet-stream'
                        },
                        body: file
                    });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error || 'Sync failed');
                    
                    showToast('อัปโหลดและซิงค์ข้อมูลลูกค้าสำเร็จ! (พบข้อมูล ' + data.message + ')', 'success');
                    refreshAll();
                } catch (err) {
                    console.error(err);
                    showToast('ซิงค์ข้อมูลล้มเหลว: ' + err.message, 'error');
                } finally {
                    if (btn) btn.disabled = false;
                }
            };
            input.click();
        } else {
            showToast('กำลังซิงค์ลูกค้าใหม่จากไฟล์ Excel บนเซิร์ฟเวอร์... โปรดรอสักครู่', 'success');
            const res = await fetch('/api/cmb-sync', { method: 'POST' });
            const data = await res.json();
            
            if (!res.ok) throw new Error(data.error || 'Sync failed');
            
            showToast('ซิงค์ฐานลูกค้าสำเร็จ! (พบข้อมูล ' + data.message + ')', 'success');
            refreshAll();
            if (btn) btn.disabled = false;
        }
    } catch (err) {
        console.error(err);
        showToast('ซิงค์ข้อมูลล้มเหลว: ' + err.message, 'error');
        if (btn) btn.disabled = false;
    }
}

// CSV Export execution
function exportCSV() {
    const queryParams = new URLSearchParams({
        q: _searchQuery,
        sale: _saleFilter,
        tier: _tierFilter,
        industry: _industryFilter,
        province: _provinceFilter,
        health: _healthFilter
    });
    window.location.href = `/api/cmb-export-csv?${queryParams}`;
    showToast('ดาวน์โหลดตารางกิจกรรม CSV เรียบร้อยแล้ว', 'success');
}

// Chart.js reports
async function loadStats() {
    const tabActive = document.getElementById('tab-statistics').classList.contains('active');
    if (!tabActive) return;
    
    try {
        const queryParams = new URLSearchParams({
            q: _searchQuery,
            sale: _saleFilter,
            tier: _tierFilter,
            industry: _industryFilter,
            province: _provinceFilter,
            health: _healthFilter
        });
        
        const res = await fetch(`/api/cmb-stats?${queryParams}`);
        const stats = await res.json();
        
        if (chartTierCompliance) chartTierCompliance.destroy();
        if (chartActivities) chartActivities.destroy();
        if (chartSalesLeaderboard) chartSalesLeaderboard.destroy();
        if (chartTierNeglect) chartTierNeglect.destroy();
        
        Chart.defaults.color = 'rgba(255,255,255,0.6)';
        Chart.defaults.borderColor = 'rgba(255,255,255,0.06)';
        Chart.defaults.font.family = "'Sarabun', 'Inter', sans-serif";
        
        // 1. Chart: Tier Compliance ratios
        const th = stats.tierHealth || {};
        const getRate = (tierKey) => {
            const data = th[tierKey];
            if (!data || data.total === 0) return 0;
            return Math.round((data.healthy / data.total) * 100);
        };
        
        chartTierCompliance = new Chart(document.getElementById('chart-tier-compliance'), {
            type: 'bar',
            data: {
                labels: ['Tier A (ทุก 30 วัน)', 'Tier B (ทุก 60 วัน)', 'Tier C (ทุก 90 วัน)', 'Tier D (ทุก 180 วัน)'],
                datasets: [{
                    label: 'เปอร์เซ็นต์ความครอบคลุมในการดูแล (%)',
                    data: [getRate('A'), getRate('B'), getRate('C'), getRate('D')],
                    backgroundColor: [
                        'rgba(244, 63, 94, 0.75)',  // Rose
                        'rgba(139, 92, 246, 0.75)', // Violet
                        'rgba(16, 185, 129, 0.75)', // Emerald
                        'rgba(234, 179, 8, 0.75)'   // Amber
                    ],
                    borderWidth: 0,
                    borderRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { beginAtZero: true, max: 100 }
                }
            }
        });

        // 2. Chart: Visits vs Calls counts
        chartActivities = new Chart(document.getElementById('chart-activities'), {
            type: 'doughnut',
            data: {
                labels: ['🚗 Onsite Visits (เยี่ยมหน้างาน)', '📞 Phone Calls (โทรศัพท์ติดต่อ)'],
                datasets: [{
                    data: [stats.totalVisitsCount || 0, stats.totalCallsCount || 0],
                    backgroundColor: ['rgba(16, 185, 129, 0.75)', 'rgba(59, 130, 246, 0.75)'],
                    borderWidth: 1,
                    borderColor: 'rgba(20,25,38,1)'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom' }
                }
            }
        });

        // 3. Chart: Sales leaderboard
        const salesStats = stats.sales || [];
        chartSalesLeaderboard = new Chart(document.getElementById('chart-sales-leaderboard'), {
            type: 'bar',
            data: {
                labels: salesStats.map(s => s.sale_code || 'ไม่ระบุ'),
                datasets: [{
                    label: 'จำนวนการ Log กิจกรรมสะสม (ครั้ง)',
                    data: salesStats.map(s => s.count),
                    backgroundColor: 'rgba(59, 130, 246, 0.65)',
                    borderColor: 'rgb(59, 130, 246)',
                    borderWidth: 1,
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: { y: { beginAtZero: true } }
            }
        });

        // 4. Chart: Neglect count per tier
        const getNeglect = (tierKey) => {
            const data = th[tierKey];
            return data ? data.overdue : 0;
        };
        chartTierNeglect = new Chart(document.getElementById('chart-tier-neglect'), {
            type: 'bar',
            data: {
                labels: ['Tier A (วิกฤต)', 'Tier B (ต้องดูแล)', 'Tier C (ทั่วไป)', 'Tier D (เฝ้าระวัง)'],
                datasets: [{
                    label: 'จำนวนลูกค้าที่เลยกำหนดติดต่อ (ราย)',
                    data: [getNeglect('A'), getNeglect('B'), getNeglect('C'), getNeglect('D')],
                    backgroundColor: 'rgba(239, 68, 68, 0.65)',
                    borderColor: 'rgb(239, 68, 68)',
                    borderWidth: 1,
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: { y: { beginAtZero: true } }
            }
        });
    } catch (err) {
        console.error('Error drawing compliance stats:', err);
    }
}

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = `toast t-${type}`;
    
    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'error') icon = '❌';
    
    toast.innerHTML = `
        <span>${icon}</span>
        <span>${message}</span>
    `;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

function tick() {
    const n = new Date();
    const dateEl = document.getElementById('clk-date');
    const timeEl = document.getElementById('clk-time');
    
    if (dateEl) {
        dateEl.textContent = n.toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    }
    if (timeEl) {
        timeEl.textContent = n.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
}

function truncateString(str, len) {
    if (!str) return '';
    return str.length > len ? str.substring(0, len) + '...' : str;
}

function openAddCustomerModal() {
    document.getElementById('new-customer-form').reset();
    document.getElementById('add-customer-modal').classList.add('open');
}

function closeAddCustomerModal() {
    document.getElementById('add-customer-modal').classList.remove('open');
}

async function saveNewCustomer(e) {
    e.preventDefault();
    const payload = {
        customer_name: document.getElementById('new-cust-name').value,
        wic_customer_id: document.getElementById('new-wic-id').value,
        tier: document.getElementById('new-tier').value,
        sale_code: document.getElementById('new-sale').value,
        industry: document.getElementById('new-industry').value,
        zone: document.getElementById('new-zone').value,
        product_service: document.getElementById('new-product').value,
        contact_name: document.getElementById('new-contact').value,
        position: document.getElementById('new-position').value,
        mobile: document.getElementById('new-mobile').value,
        tel: document.getElementById('new-tel').value,
        line_id: document.getElementById('new-line').value,
        email: document.getElementById('new-email').value,
        address: document.getElementById('new-address').value,
        subdistrict: document.getElementById('new-subdistrict').value,
        district: document.getElementById('new-district').value,
        province: document.getElementById('new-province').value,
        zipcode: document.getElementById('new-zipcode').value
    };
    
    try {
        const res = await fetch('/api/customers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to save customer');
        
        showToast('เพิ่มลูกค้าใหม่สำเร็จ!', 'success');
        closeAddCustomerModal();
        
        _currentPage = 1;
        refreshAll();
    } catch (err) {
        console.error(err);
        showToast('ไม่สามารถสร้างรายชื่อลูกค้าได้: ' + err.message, 'error');
    }
}
