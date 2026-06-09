let _activeCustomerId = null;
let _searchTimeout = null;

document.addEventListener('DOMContentLoaded', () => {
    tick();
    setInterval(tick, 1000);
    
    // Set default dates to today
    const todayStr = new Date().toISOString().split('T')[0];
    document.getElementById('act-date').value = todayStr;
    document.getElementById('plan-date').value = todayStr;

    const searchInput = document.getElementById('customer-search');
    const dropdown = document.getElementById('autocomplete-list');

    // Event listener for search input autocomplete
    searchInput.addEventListener('input', () => {
        const query = searchInput.value.trim();
        clearTimeout(_searchTimeout);

        if (!query) {
            dropdown.style.display = 'none';
            return;
        }

        _searchTimeout = setTimeout(async () => {
            try {
                const res = await fetch(`/api/customers?q=${encodeURIComponent(query)}&limit=10`);
                const data = await res.json();
                const customers = data.data || [];

                if (customers.length === 0) {
                    dropdown.innerHTML = '<div class="autocomplete-item" style="color:var(--mu); cursor:default;">ไม่พบข้อมูลบริษัทนี้</div>';
                } else {
                    let html = '';
                    customers.forEach(c => {
                        const tierStr = c.tier ? `Tier ${c.tier}` : 'No Tier';
                        html += `
                            <div class="autocomplete-item" onclick="selectCustomer(${c.id})">
                                <div class="autocomplete-item-name">${c.customer_name}</div>
                                <div class="autocomplete-item-meta">
                                    <span>🆔 WIC: ${c.wic_customer_id || '—'}</span>
                                    <span>⭐ ${tierStr}</span>
                                    <span>👤 Sales: ${c.sale_code || '—'}</span>
                                    <span>📍 จังหวัด: ${c.province || '—'}</span>
                                </div>
                            </div>
                        `;
                    });
                    dropdown.innerHTML = html;
                }
                dropdown.style.display = 'block';
            } catch (err) {
                console.error(err);
            }
        }, 200);
    });

    // Close autocomplete dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !dropdown.contains(e.target)) {
            dropdown.style.display = 'none';
        }
    });
});

// Autocomplete customer selection
async function selectCustomer(id) {
    _activeCustomerId = id;
    document.getElementById('autocomplete-list').style.display = 'none';
    document.getElementById('customer-search').value = '';

    try {
        const res = await fetch(`/api/customers/${id}`);
        if (!res.ok) throw new Error('Customer fetch failed');
        const c = await res.json();

        // Render customer card
        document.getElementById('selected-name').textContent = c.customer_name;
        document.getElementById('selected-wic-id').textContent = c.wic_customer_id || '—';
        document.getElementById('selected-tier').textContent = c.tier ? 'Tier ' + c.tier : '—';
        document.getElementById('selected-sale').textContent = c.sale_code || '—';
        document.getElementById('selected-industry').textContent = c.industry || '—';
        document.getElementById('selected-zone').textContent = c.zone || '—';
        document.getElementById('selected-contact').textContent = c.contact_name || '—';
        document.getElementById('selected-mobile').textContent = c.mobile || '—';
        document.getElementById('selected-line').textContent = c.line_id || '—';
        document.getElementById('selected-address').textContent = c.address || '—';

        // Update health status badge
        const healthLabels = { healthy: 'ดูแลสม่ำเสมอ 🟢', attention: 'ใกล้ครบกำหนด 🟡', overdue: 'เลยกำหนดดูแล 🔴' };
        const healthClasses = { healthy: 'cs-healthy', attention: 'cs-attention', overdue: 'cs-overdue' };
        const healthBadge = document.getElementById('selected-health-badge');
        healthBadge.textContent = healthLabels[c.care_health];
        healthBadge.className = `ccard-tier ${healthClasses[c.care_health]}`;

        // Reset and prefill form defaults
        document.getElementById('activity-form').reset();
        document.getElementById('plan-form').reset();
        const todayStr = new Date().toISOString().split('T')[0];
        document.getElementById('act-date').value = todayStr;
        document.getElementById('plan-date').value = todayStr;

        if (c.sale_code) {
            document.getElementById('act-by').value = c.sale_code;
        }
        if (c.contact_name) {
            document.getElementById('act-person').value = c.contact_name;
        }

        // Load history timeline
        await loadTimeline(id);

        // Toggle workspace views
        document.getElementById('empty-workspace').style.display = 'none';
        document.getElementById('sales-workspace').style.display = 'block';

    } catch (err) {
        console.error(err);
        showToast('ไม่สามารถดึงข้อมูลประวัติลูกค้าได้', 'error');
    }
}

// Load activity logs and scheduled plans
async function loadTimeline(id) {
    try {
        const res = await fetch(`/api/customers/${id}/visits`);
        const data = await res.json();
        
        // 1. Next Planned indicator
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
        
        // 2. Timeline logs
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
                        ${v.contact_person ? `<div class="t-person">👥 ผู้ติดต่อ: ${v.contact_person}</div>` : ''}
                    </div>
                </div>
            `;
        });
        timeline.innerHTML = html;
    } catch (err) {
        console.error('Error loading timeline:', err);
    }
}

// Log interaction form submission
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
        
        showToast('บันทึกประวัติการติดต่อสำเร็จ', 'success');
        document.getElementById('act-summary').value = '';
        
        // Reload timeline and update details
        await loadTimeline(_activeCustomerId);
        
        // Live update health status badge
        const checkRes = await fetch(`/api/customers/${_activeCustomerId}`);
        const c = await checkRes.json();
        const healthLabels = { healthy: 'ดูแลสม่ำเสมอ 🟢', attention: 'ใกล้ครบกำหนด 🟡', overdue: 'เลยกำหนดดูแล 🔴' };
        const healthClasses = { healthy: 'cs-healthy', attention: 'cs-attention', overdue: 'cs-overdue' };
        const healthBadge = document.getElementById('selected-health-badge');
        healthBadge.textContent = healthLabels[c.care_health];
        healthBadge.className = `ccard-tier ${healthClasses[c.care_health]}`;

    } catch (err) {
        console.error(err);
        showToast('บันทึกกิจกรรมไม่สำเร็จ', 'error');
    }
}

// Schedule plan form submission
async function schedulePlan(e) {
    e.preventDefault();
    if (!_activeCustomerId) return;
    
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
        
        showToast('บันทึกแผนงานถัดไปสำเร็จ', 'success');
        document.getElementById('plan-objective').value = '';
        
        await loadTimeline(_activeCustomerId);
    } catch (err) {
        console.error(err);
        showToast('บันทึกแผนงานไม่สำเร็จ', 'error');
    }
}

// Modal Toggle functions
function openAddCustomerModal() {
    document.getElementById('new-customer-form').reset();
    document.getElementById('add-customer-modal').classList.add('open');
}

function closeAddCustomerModal() {
    document.getElementById('add-customer-modal').classList.remove('open');
}

// Save new customer profile form submission
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
        
        // Autoselect the newly created customer
        selectCustomer(data.id);
        
    } catch (err) {
        console.error(err);
        showToast('ไม่สามารถสร้างรายชื่อลูกค้าได้: ' + err.message, 'error');
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
