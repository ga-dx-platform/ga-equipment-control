    // ===== CONFIG =====
    // SECURITY NOTE: Supabase anon key is a publishable key (safe to expose in client).
    // Real protection comes from Row Level Security (RLS) policies on the Supabase project.
    // For production: inject via window.__SUPABASE_URL__ and window.__SUPABASE_ANON_KEY__
    // to avoid hardcoded values in source. Ensure RLS is enforced on all tables.
    const SUPABASE_URL = window.__SUPABASE_URL__ || 'https://varwpgmppjamaxpjgxja.supabase.co';
    const SUPABASE_ANON_KEY = window.__SUPABASE_ANON_KEY__ || 'sb_publishable_KDARMx5ViP3-bTDu3sMnZg_ZGbv_ZFN';
    if (!window.__SUPABASE_URL__ || !window.__SUPABASE_ANON_KEY__) {
      console.warn('[Security] Using hardcoded Supabase credentials. Inject via window.__SUPABASE_URL__ and window.__SUPABASE_ANON_KEY__ in production.');
    }
    const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // ===== STATE =====
    let AU = { ga: [], mgr: [], user: [] }, CU = null, SU = null, PB = '';
    let _cpStep = 0, _cpOld = '', _cpNew = '', _cpConf = ''; // change-PIN modal state
    let _catRealtimeChannel = null; // Supabase Realtime channel for category changes
    let AUTH_MODE = 'demo'; // users_with_pin | demo
    const FALLBACK_PIN = ''; // intentionally empty — demo login is disabled for security
    const FALLBACK_USERS = {
      ga: [{ name: 'GA Staff Demo', role: 'ga' }],
      mgr: [{ name: 'Admin Access', role: 'mgr' }]
    };
    let EQ = [], BORROWS = [], CATS = []; // CATS = [{id,name,is_active,created_at}]
    let _addCatMode = false; // toggle inline add-category input in equipment tab
    // Per-user PIN rate limiter: counters + lock timestamp persisted to localStorage so
    // refreshing or closing the tab does not reset the counter. Key = user full_name.
    const PIN_MAX_ATTEMPTS = 5, PIN_LOCK_MS = 60000;
    const PIN_STORE_KEY = 'ga_pin_attempts_v1';
    function _pinStoreRead() {
      try { return JSON.parse(localStorage.getItem(PIN_STORE_KEY) || '{}') || {}; } catch (e) { return {}; }
    }
    function _pinStoreWrite(s) { try { localStorage.setItem(PIN_STORE_KEY, JSON.stringify(s)); } catch (e) {} }
    function pinGetAttempts(name) { return _pinStoreRead()[name] || { count: 0, lockedUntil: 0 }; }
    function pinRecordFail(name) {
      const s = _pinStoreRead();
      const cur = s[name] || { count: 0, lockedUntil: 0 };
      cur.count = (cur.count || 0) + 1;
      // Progressive lockout: 60s after 5 failures, doubled each additional batch of 5.
      if (cur.count >= PIN_MAX_ATTEMPTS) {
        const overflow = Math.floor(cur.count / PIN_MAX_ATTEMPTS);
        cur.lockedUntil = Date.now() + PIN_LOCK_MS * Math.pow(2, overflow - 1);
      }
      s[name] = cur; _pinStoreWrite(s);
      return cur;
    }
    function pinReset(name) {
      const s = _pinStoreRead();
      delete s[name]; _pinStoreWrite(s);
    }
    let _alTimer = null, _alWarnTimer = null;
    const AUTO_LOGOUT_MS = 15 * 60 * 1000;
    let drawing = false, sctx = null, hasSignatureStroke = false;
    let signatureCanvasEl = null, signatureListenersCleanup = null;
    let _editEqId = null;
    let RECIPIENTS = [];
    let currentBorrowEq = null, currentReturnRecord = null;
    let returnCondition = '';
    let serviceRating = 0;
    let borrowSearchQ = '', borrowCatFilter = '';
    let borrowViewMode = localStorage.getItem('equipmentViewMode') || 'list';
    let historyFilter = '';
    let gaHistorySearch = '';
    let mgrHistorySearch = '', mgrHistoryGa = '', mgrHistoryFrom = '', mgrHistoryTo = '';
    let AUDIT_LOGS = [], auditFilter = '', auditSearch = '', auditDateFrom = '', auditDateTo = '';
    let eqSearch = '', eqCatFilter = '';
    let selectedEquipmentId = null;
    let _qrModalCtx = {};
    let _pendingUnitCode = null;
    let SETTINGS = { require_borrow_signature: false, require_return_rating: false };

    // ===== AUDIT LOG HELPER =====
    async function logAction(action_type, target_table, target_id, old_data, new_data) {
      try {
        await sb.from('app_audit_logs').insert([{
          action_type,
          target_table: target_table || null,
          target_id: target_id ? String(target_id) : null,
          actor_name: CU?.name || null,
          old_data: old_data || null,
          new_data: new_data || null
        }]);
      } catch(e) { console.warn('[logAction]', e); } // non-blocking
    }

    // ===== AVATAR COLORS =====
    function getAvatarColor(name) {
      let hash = 0;
      if (!name) return 'hsl(215, 14%, 47%)';
      for(let i=0; i<name.length; i++) {
        hash = name.charCodeAt(i) + ((hash<<5) - hash);
      }
      const hue = Math.abs(hash) % 360;
      return `hsl(${hue}, 65%, 55%)`;
    }

    function eqIconSvg(sz = 20, stroke = '#94A3B8') {
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${sz}" height="${sz}" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16.5 9.4l-9-5.19M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/></svg>`;
    }

    function catAccentColor(cat) {
      if (!cat) return '#E2E8F0';
      const palette = ['#f97316','#3b82f6','#10b981','#8b5cf6','#ec4899','#f59e0b','#06b6d4','#84cc16'];
      let hash = 0;
      for (let i = 0; i < cat.length; i++) hash = cat.charCodeAt(i) + ((hash << 5) - hash);
      return palette[Math.abs(hash) % palette.length];
    }

    function avc(name, role) {
      if (role === 'manager' || role === 'mgr') return '#2563EB';
      if (role === 'admin') return '#7C3AED';
      return getAvatarColor(name);
    }
    
    /** Render a unified GA avatar component */
    function avEl(name, role) {
      return `<div class="ga-avatar" style="background:${avc(name, role)};">${he(ini(name))}</div>`;
    }
    function ini(n) { const p = (n || '').trim().split(' '); return p.length >= 2 ? p[0][0] + p[1][0] : (n || '').slice(0, 2); }

    // ===== UTILS =====
    function he(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    // Only allow safe image URL schemes; blocks javascript:, vbscript:, data:text/html, etc.
    function safeImgUrl(u) {
      if (!u) return '';
      const s = String(u).trim();
      if (/^https?:\/\//i.test(s)) return he(s);
      if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml);/i.test(s)) return he(s);
      return '';
    }
    async function sha256(str) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
      return Array.from(new Uint8Array(buf)).map(x => x.toString(16).padStart(2, '0')).join('');
    }
    // Debounce helper: collapses rapid calls (e.g. per-keystroke re-renders) into one.
    const _debounceTimers = {};
    function debounce(key, fn, ms = 200) {
      clearTimeout(_debounceTimers[key]);
      _debounceTimers[key] = setTimeout(fn, ms);
    }
    function fd(d) {
      if (!d) return '-';
      try { const dt = new Date(d); if (isNaN(dt)) return d; return `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()+543}`; } catch(e) { return d; }
    }
    function fdFull(d) {
      if (!d) return '-';
      try { const dt = new Date(d); if (isNaN(dt)) return d; return `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()+543} ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`; } catch(e) { return d; }
    }
    function daysUntil(dateStr) {
      if (!dateStr) return 999;
      const now = new Date(); now.setHours(0,0,0,0);
      const d = new Date(dateStr); d.setHours(0,0,0,0);
      return Math.ceil((d - now) / 86400000);
    }
    function syncBottomNavVisibility(activeScreenName = '') {
      const bn = document.getElementById('bottom-nav');
      if (!bn) return;
      const current = activeScreenName || (document.querySelector('.screen.active')?.id || '').replace('screen-', '');
      const canShowBottomNav = !!CU && current === 'main' && window.innerWidth < 768;
      bn.style.display = canShowBottomNav ? 'flex' : 'none';
    }
    window.addEventListener('resize', () => syncBottomNavVisibility());
    function goScreen(name) {
      document.querySelectorAll('.screen').forEach(s => { s.classList.remove('active'); s.style.display = 'none'; });
      const t = document.getElementById('screen-' + name);
      if (!t) return;
      t.classList.add('active'); t.style.display = 'flex';
      syncBottomNavVisibility(name);
      const sb = document.getElementById('desktop-sidebar');
      if (sb) sb.classList.toggle('sb-visible', name === 'main');
    }
    function showModal(id) {
      const m = document.getElementById(id);
      if (!m) return;
      m.classList.remove('pointer-events-none','opacity-0');
      m.classList.add('pointer-events-auto','opacity-100');
      const backdrop = m.querySelector('.absolute.inset-0');
      if (backdrop && !backdrop.dataset.outsideCloseBound) {
        backdrop.dataset.outsideCloseBound = '1';
        backdrop.addEventListener('click', (e) => {
          if (e.target !== backdrop) return;
          const closeName = `close${id.charAt(0).toUpperCase()}${id.slice(1)}`;
          if (typeof window[closeName] === 'function') window[closeName]();
          else hideModal(id);
        });
      }
      lucide.createIcons({'stroke-width': 1.5});
    }
    function hideModal(id) { const m = document.getElementById(id); if(m) { m.classList.add('pointer-events-none','opacity-0'); m.classList.remove('pointer-events-auto','opacity-100'); } }
    function closeTopModal() {
      const modalOrder = [
        ['record-detail-modal', closeRecordDetail],
        ['confirm-dialog', () => document.getElementById('confirm-dialog')?.classList.add('hidden')],
        ['changePinModal', closeChangePinModal],
        ['logoutModal', closeLogoutModal],
        ['catModal', closeCatModal],
        ['recipientModal', closeRecipientModal],
        ['userModal', closeUserModal],
        ['equipModal', closeEquipModal]
      ];
      for (const [id, closeFn] of modalOrder) {
        const el = document.getElementById(id);
        if (!el) continue;
        const visible = id === 'record-detail-modal' || id === 'confirm-dialog'
          ? !el.classList.contains('hidden')
          : !el.classList.contains('pointer-events-none');
        if (!visible) continue;
        closeFn();
        return;
      }
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeTopModal();
    });
    function showToast(msg, type='info') {
      const container = document.getElementById('toast-container');
      if (!container) return;
      const icons = { success:'check-circle-2', error:'x-circle', warning:'alert-triangle', info:'info' };
      const bg = { success:'bg-emerald-700', error:'bg-red-700', warning:'bg-amber-700', info:'bg-slate-800' };
      const el = document.createElement('div');
      el.className = `flex items-center gap-2.5 px-4 py-3 text-white text-base font-medium rounded-xl shadow-lg ${bg[type]||bg.info} translate-x-full opacity-0 transition-all duration-300 pointer-events-auto`;
      el.innerHTML = `<i data-lucide="${icons[type]||'info'}" class="w-[18px] h-[18px] shrink-0"></i><p class="leading-tight">${he(msg)}</p>`;
      container.appendChild(el);
      lucide.createIcons({'stroke-width': 1.5});
      requestAnimationFrame(() => { el.classList.remove('translate-x-full','opacity-0'); });
      setTimeout(() => { el.classList.add('translate-x-full','opacity-0'); setTimeout(() => el.remove(), 300); }, 3000);
    }
    function toast(msg, tone='info') { showToast(msg, tone); }
    function showConfirm({ title, message, icon = '❓', iconBg = '#F1F5F9', confirmText = 'ยืนยัน', confirmColor = '#F97316', onConfirm }) {
      const dialog = document.getElementById('confirm-dialog');
      document.getElementById('confirm-title').textContent = title;
      document.getElementById('confirm-message').textContent = message;
      const iconWrap = document.getElementById('confirm-icon-wrap');
      iconWrap.textContent = icon;
      iconWrap.style.background = iconBg;
      const okBtn = document.getElementById('confirm-ok');
      okBtn.textContent = confirmText;
      okBtn.style.background = confirmColor;
      dialog.classList.remove('hidden');
      const close = () => dialog.classList.add('hidden');
      okBtn.onclick = () => { close(); onConfirm(); };
      document.getElementById('confirm-cancel').onclick = close;
    }
    function emptyState(title, sub, type='list', ctaLabel='', ctaAction='') {
      const paths = {
        search: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z',
        list:   'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2',
        check:  'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
        users:  'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75',
      };
      if (type === 'search') {
        const term = title.replace(/^ไม่พบ\\s*/,'').replaceAll('\"','').trim();
        return `<div class="empty-search" style="display:flex;flex-direction:column;align-items:center;padding:40px 24px;text-align:center;">
          <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#A8A29E" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <p style="font-size:14px;font-weight:600;color:#0F172A;margin:10px 0 2px;">ไม่พบ \"<span id="searchTerm">${he(term || sub || '')}</span>\"</p>
          <small style="font-size:12px;color:#9CA3AF;">ลองค้นหาด้วยคำอื่น</small>
          ${ctaLabel && ctaAction ? `<button onclick="${ctaAction}" class="gd-btn-primary !w-auto !px-4 !py-2 text-base font-semibold" style="margin-top:10px;">${he(ctaLabel)}</button>` : ''}
        </div>`;
      }
      return `<div style="display:flex;flex-direction:column;align-items:center;padding:40px 24px;text-align:center;">
        <div class="empty-state-icon-wrap">
          <svg class="empty-state-icon" xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="${paths[type]||paths.list}"/></svg>
        </div>
        <p style="font-size:14px;font-weight:600;color:#0F172A;margin:0 0 4px;">${he(title)}</p>
        <p class="empty-state-text">${he(sub)}</p>
        ${ctaLabel && ctaAction ? `<button onclick="${ctaAction}" class="gd-btn-primary !w-auto !px-4 !py-2 text-base font-semibold">${he(ctaLabel)}</button>` : ''}
      </div>`;
    }

    function countUp(el, target, dur = 600) {
      if (!el) return;
      const raw = el.textContent;
      const start = (raw === '-' || raw === '') ? 0 : (parseInt(raw) || 0);
      if (start === target) { el.textContent = target; return; }
      const t0 = performance.now();
      function tick(now) {
        const p = Math.min((now - t0) / dur, 1);
        const ease = 1 - Math.pow(1 - p, 3); // easeOutCubic
        el.textContent = Math.round(start + (target - start) * ease);
        if (p < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    }

    function skeletonCards(n) {
      return Array(n).fill(0).map(()=>`<div class="gd-card p-5 mb-3"><div class="flex justify-between mb-2"><div><div class="h-3.5 skeleton rounded w-36 mb-1.5"></div><div class="h-3 skeleton rounded w-24"></div></div><div class="h-5 skeleton rounded-full w-14"></div></div></div>`).join('');
    }

    // ===== CACHE =====
    const CACHE_TTL = 10*60*1000;
    function cacheSet(k,v) { try { localStorage.setItem(k, JSON.stringify({t:Date.now(),v})); } catch(e){} }
    function cacheGet(k) { try { const c=JSON.parse(localStorage.getItem(k)||'null'); if(c&&Date.now()-c.t<CACHE_TTL) return c.v; } catch(e){} return null; }
    function cacheDel(k) { try { localStorage.removeItem(k); } catch(e){} }

    // ===== STATUS HELPERS =====
    function statusMeta(s) {
      return {
        borrowed: { th:'กำลังยืม', style:'status-borrowed', dot:'bg-amber-500', icon:'clock-3' },
        returned: { th:'คืนแล้ว', style:'status-returned', dot:'bg-emerald-500', icon:'check-circle-2' },
        overdue:  { th:'เกินกำหนด', style:'status-overdue', dot:'bg-red-500', icon:'alert-triangle' },
      }[s] || { th:s||'-', style:'status-borrowed', dot:'bg-slate-400', icon:'help-circle' };
    }
    function statusBadge(s) {
      const m = statusMeta(s);
      return `<span class="status-badge ${m.style}"><span class="status-dot ${m.dot}"></span>${m.th}</span>`;
    }
    function conditionBadge(c) {
      if (!c) return '';
      const map = { normal: ['bg-green-50 text-green-700','ปกติ'], damaged: ['bg-amber-50 text-amber-700','ชำรุด'], lost: ['bg-red-50 text-red-700','สูญหาย'] };
      const [cls, label] = map[c] || ['bg-gray-50 text-gray-500', c];
      return `<span class="text-[10px] px-2 py-0.5 rounded-full font-semibold ${cls}">${label}</span>`;
    }
    function detectOverdue(records) {
      const today = new Date(); today.setHours(0,0,0,0);
      return records.map(r => {
        if (r.status === 'borrowed' && r.due_date) {
          const d = new Date(r.due_date); d.setHours(0,0,0,0);
          if (d < today) r.status = 'overdue';
        }
        return r;
      });
    }
    function getAvailabilityClass(available, total) {
      const pct = total ? (available / total) * 100 : 0;
      if (pct > 50) return 'high';
      if (pct > 20) return 'medium';
      return 'low';
    }

    // ===== API =====
    async function api(action, params = {}) {
      try {
        if (action === 'getUsers') {
          const { data: users, error: usersErr } = await sb.from('users').select('full_name, role, is_active, allowed_categories').eq('is_active', true);
          if (!usersErr && Array.isArray(users)) {
            const mapped = {
              ga: users.filter(u=>u.role==='ga').map(u=>({name:u.full_name,role:'ga',allowed_categories:u.allowed_categories??null})),
              mgr: users.filter(u=>u.role==='mgr').map(u=>({name:u.full_name,role:'mgr',allowed_categories:null})),
              user: users.filter(u=>u.role==='user').map(u=>({name:u.full_name,role:'user',allowed_categories:u.allowed_categories??null}))
            };
            if (mapped.ga.length || mapped.mgr.length || mapped.user.length) {
              AUTH_MODE = 'users_with_pin';
              return mapped;
            }
          }
          AUTH_MODE = 'demo';
          return FALLBACK_USERS;
        }
        if (action === 'verifyPin') {
          if (AUTH_MODE === 'demo') {
            return { ok: String(params.pin).padStart(6,'0') === FALLBACK_PIN };
          }
          // AUTH_MODE === 'users_with_pin': verify against users.pin_hash
          const { data } = await sb.from('users').select('id, pin_hash, allowed_categories').eq('full_name', params.name).eq('is_active', true).single();
          if (!data) return { ok: false };
          const stored = String(data.pin_hash), input = String(params.pin).padStart(6,'0'), hInput = await sha256(input);
          const ac = data.allowed_categories ?? null;
          if (stored === hInput) return { ok: true, allowed_categories: ac };
          if (stored === input) { await sb.rpc('update_user_pin', { p_user_id: data.id, p_new_hash: hInput }); return { ok: true, allowed_categories: ac }; }
          return { ok: false };
        }
        if (action === 'changePin') {
          // Resolve primary key first so the UPDATE targets exactly one row (name+role is not unique enough).
          const { data: target, error: selErr } = await sb.from('users')
            .select('id').eq('full_name', params.name).eq('role', params.role).eq('is_active', true).single();
          if (selErr || !target) throw new Error('User not found');
          const h = await sha256(String(params.newPin).padStart(6,'0'));
          const { data: ok, error } = await sb.rpc('update_user_pin', { p_user_id: target.id, p_new_hash: h });
          if (error) throw error;
          if (!ok) throw new Error('PIN update failed — RPC returned false');
          await logAction('MEMBER_RESET_PIN','users',params.name,null,{name:params.name,role:params.role});
          return { ok: true };
        }
        if (action === 'selfChangePin') {
          // Fetch user's id + pin_hash by name (always fresh — no pin_hash cached in memory)
          const { data: u, error: selErr } = await sb.from('users')
            .select('id, pin_hash')
            .eq('full_name', params.name)
            .eq('is_active', true)
            .single();
          if (selErr || !u) return { ok: false, error: 'user_not_found' };
          const stored = String(u.pin_hash);
          const oldInput = String(params.oldPin).padStart(6,'0');
          const hOld = await sha256(oldInput);
          if (stored !== hOld && stored !== oldInput) return { ok: false, error: 'wrong_old_pin' };
          // Hash new PIN and prevent reuse
          const hNew = await sha256(String(params.newPin).padStart(6,'0'));
          if (hNew === hOld || hNew === stored) return { ok: false, error: 'same_pin' };
          const { data: ok, error } = await sb.rpc('update_user_pin', { p_user_id: u.id, p_new_hash: hNew });
          if (error) throw error;
          if (!ok) throw new Error('PIN update failed — RPC returned false');
          await logAction('CHANGE_PIN','users',params.name,null,{name:params.name,role:params.role});
          return { ok: true };
        }
        if (action === 'getCategories') {
          const { data, error } = await sb.from('categories').select('*').eq('is_active', true).order('name');
          if (error) throw error;
          return data || [];
        }
        if (action === 'addCategory') {
          const { data, error } = await sb.from('categories').insert([{ name: params.name, is_active: true }]).select().single();
          if (error) throw error;
          await logAction('CATEGORY_CREATE','categories',data.id,null,{name:params.name});
          return data;
        }
        if (action === 'deleteCategory') {
          const { error } = await sb.from('categories').delete().eq('id', params.id);
          if (error) throw error;
          await logAction('CATEGORY_DELETE','categories',params.id,{name:params.name},null);
          return { ok: true };
        }
        if (action === 'getEquipment') {
          const { data } = await sb.from('equipment').select('*').order('name');
          return (data || []).map((r, idx) => ({
            ...r,
            eq_id: r.eq_id || r.id || `eq-${idx}`,
            serial_no: r.serial_no || r.code || null
          }));
        }
        if (action === 'getBorrows') {
          // Exclude large base64 signature columns (sign_img, return_sign_img) from list queries.
          // Signatures are fetched on-demand via getBorrowSignatures when a record is opened.
          const cols = 'record_id,eq_id,eq_name,qty_borrowed,borrower_name,borrower_dept,ga_staff,borrowed_at,due_date,returned_at,status,note,condition_on_return,condition_note,service_rating,service_feedback';
          let q = sb.from('borrow_records').select(cols);
          if (params.role === 'ga') q = q.eq('ga_staff', params.name);
          else if (params.role === 'user') q = q.eq('borrower_name', params.name);
          const limit = Math.min(parseInt(params.limit) || 500, 1000);
          const { data } = await q.order('borrowed_at', { ascending: false }).limit(limit);
          return detectOverdue(data || []);
        }
        if (action === 'getBorrowSignatures') {
          const { data } = await sb.from('borrow_records')
            .select('sign_img, return_sign_img')
            .eq('record_id', params.record_id)
            .maybeSingle();
          return data || { sign_img: null, return_sign_img: null };
        }
        if (action === 'createBorrow') {
          if (params.unit_id) {
            const { data: reserved, error: rpcErr } = await sb.rpc('reserve_unit', { p_unit_id: params.unit_id });
            if (rpcErr) throw rpcErr;
            if (!reserved) throw new Error('รหัสชุดนี้ถูกยืมไปแล้ว กรุณาเลือกรหัสชุดใหม่');
          }
          const rid = 'BR' + Date.now();
          const { error: brErr } = await sb.from('borrow_records').insert([{
            record_id: rid, eq_id: params.eq_id, eq_name: params.eq_name,
            qty_borrowed: params.qty, borrower_name: params.borrower_name,
            borrower_dept: params.borrower_dept, ga_staff: params.ga_staff,
            borrowed_at: new Date().toISOString(), due_date: params.due_date,
            sign_img: params.sign_img || null, note: params.note || null, status: 'borrowed',
            unit_id: params.unit_id || null
          }]);
          if (brErr) {
            if (params.unit_id) {
              await sb.from('equipment_units').update({ status: 'available' }).eq('id', params.unit_id).catch(() => {});
            }
            throw brErr;
          }
          // Try new schema (id UUID) first, then legacy (eq_id text)
          let { data: eq } = await sb.from('equipment').select('available').eq('id', params.eq_id).maybeSingle();
          if (eq) {
            await sb.from('equipment').update({ available: Math.max(0, eq.available - params.qty) }).eq('id', params.eq_id);
          } else {
            const { data: eqLegacy } = await sb.from('equipment').select('available').eq('eq_id', params.eq_id).maybeSingle();
            if (eqLegacy) await sb.from('equipment').update({ available: Math.max(0, eqLegacy.available - params.qty) }).eq('eq_id', params.eq_id);
          }
          await logAction('BORROW','borrow_records',rid,null,{eq_name:params.eq_name,borrower_name:params.borrower_name,borrower_dept:params.borrower_dept,qty:params.qty,due_date:params.due_date});
          return { ok: true, record_id: rid };
        }
        if (action === 'returnBorrow') {
          const patch = {
            status: 'returned', returned_at: new Date().toISOString(),
            return_sign_img: params.return_sign_img || null
          };
          if (params.condition_on_return) patch.condition_on_return = params.condition_on_return;
          if (params.condition_note) patch.condition_note = params.condition_note;
          if (params.service_rating) patch.service_rating = params.service_rating;
          if (params.service_feedback) patch.service_feedback = params.service_feedback;
          const { error } = await sb.from('borrow_records').update(patch).eq('record_id', params.record_id);
          if (error) throw error;
          await logAction('RETURN','borrow_records',params.record_id,null,{returned_at:new Date().toISOString()});
          const { data: rec } = await sb.from('borrow_records').select('eq_id, qty_borrowed, unit_id').eq('record_id', params.record_id).single();
          if (rec) {
            if (rec.unit_id) {
              await sb.from('equipment_units').update({ status: 'available' }).eq('id', rec.unit_id);
            }
            // Try new schema (id UUID) first, then legacy (eq_id text)
            let { data: eq } = await sb.from('equipment').select('available, quantity').eq('id', rec.eq_id).maybeSingle();
            if (eq) {
              await sb.from('equipment').update({ available: Math.min(eq.quantity, eq.available + rec.qty_borrowed) }).eq('id', rec.eq_id);
            } else {
              const { data: eqLeg1 } = await sb.from('equipment').select('available, quantity').eq('eq_id', rec.eq_id).maybeSingle();
              if (eqLeg1) await sb.from('equipment').update({ available: Math.min(eqLeg1.quantity, eqLeg1.available + rec.qty_borrowed) }).eq('eq_id', rec.eq_id);
            }
          }
          return { ok: true };
        }
        if (action === 'returnByManager') {
          const now = new Date().toISOString();
          const { error } = await sb.from('borrow_records').update({
            status: 'returned', returned_at: now, return_sign_img: ''
          }).eq('record_id', params.record_id);
          if (error) throw error;
          await logAction('RETURN_BY_MANAGER','borrow_records',params.record_id,null,{returned_at:now,returned_by:CU?.name});
          const { data: rec } = await sb.from('borrow_records').select('eq_id, qty_borrowed, unit_id').eq('record_id', params.record_id).single();
          if (rec) {
            if (rec.unit_id) {
              await sb.from('equipment_units').update({ status: 'available' }).eq('id', rec.unit_id);
            }
            let { data: eq } = await sb.from('equipment').select('available, quantity').eq('id', rec.eq_id).maybeSingle();
            if (eq) {
              await sb.from('equipment').update({ available: Math.min(eq.quantity, eq.available + rec.qty_borrowed) }).eq('id', rec.eq_id);
            } else {
              const { data: eqLeg2 } = await sb.from('equipment').select('available, quantity').eq('eq_id', rec.eq_id).maybeSingle();
              if (eqLeg2) await sb.from('equipment').update({ available: Math.min(eqLeg2.quantity, eqLeg2.available + rec.qty_borrowed) }).eq('eq_id', rec.eq_id);
            }
          }
          return { ok: true };
        }
        if (action === 'addEquipment') {
          const qty = Number(params.quantity) || 1;
          // Build unique code from serial_no or name + timestamp suffix to avoid duplicates
          const base = (params.serial_no || params.name || '').toUpperCase()
            .replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 16);
          const code = (base || 'EQ') + '-' + Date.now().toString().slice(-6);
          const payload = { code, name: params.name, category: params.category || null, quantity: qty, available: qty, image_url: params.image_url || null };
          const { data, error } = await sb.from('equipment').insert([payload]).select('id').single();
          if (error) throw error;
          await logAction('EQUIPMENT_CREATE','equipment',data.id,null,{name:params.name,category:params.category,quantity:qty});
          return { ok: true, eq_id: data.id };
        }
        if (action === 'updateEquipment') {
          const upd = { name: params.name, category: params.category || null, quantity: Number(params.quantity) || 1 };
          if (params.available !== undefined) upd.available = Number(params.available);
          if (params.image_url !== undefined) upd.image_url = params.image_url;
          // Try new schema (id UUID) first, then legacy (eq_id text)
          // Use .select() so Supabase returns the updated rows — empty array means no match (not an error)
          const { data: updated, error } = await sb.from('equipment').update(upd).eq('id', params.eq_id).select('id');
          if (error || !updated?.length) {
            const res = await sb.from('equipment').update(upd).eq('eq_id', params.eq_id).select('eq_id');
            if (res.error) throw res.error;
            if (!res.data?.length) throw new Error(`Equipment not found: ${params.eq_id}`);
          }
          await logAction('EQUIPMENT_UPDATE','equipment',params.eq_id,null,{name:params.name,category:params.category,quantity:Number(params.quantity)});
          return { ok: true };
        }
        if (action === 'deleteEquipment') {
          // Try new schema (id UUID) first, then legacy (eq_id text)
          const { data: deleted, error } = await sb.from('equipment').delete().eq('id', params.eq_id).select('id');
          if (error || !deleted?.length) {
            const res = await sb.from('equipment').delete().eq('eq_id', params.eq_id).select('eq_id');
            if (res.error) throw res.error;
          }
          await logAction('EQUIPMENT_DELETE','equipment',params.eq_id,null,null);
          return { ok: true };
        }
        if (action === 'addUser') {
          const h = await sha256(String(params.pin).padStart(6,'0'));
          const { error } = await sb.from('users').insert([{ full_name: params.name, pin_hash: h, role: params.role, is_active: true }]);
          if (error) throw error;
          await logAction('MEMBER_CREATE','users',params.name,null,{name:params.name,role:params.role});
          return { ok: true };
        }
        if (action === 'deleteUser') {
          const { error } = await sb.rpc('deactivate_user', { p_name: params.name, p_role: params.role });
          if (error) throw error;
          await logAction('MEMBER_DELETE','users',params.name,null,{name:params.name,role:params.role});
          return { ok: true };
        }
        if (action === 'updateUserCategories') {
          // categories = null (see all) | string[] (specific categories)
          const { error } = await sb.rpc('update_user_categories', { p_name: params.name, p_categories: params.categories });
          if (error) throw error;
          await logAction('UPDATE_CATEGORIES','users',params.name,null,{name:params.name,categories:params.categories});
          return { ok: true };
        }
        if (action === 'getRecipients') {
          const { data, error } = await sb.from('report_recipients').select('*').order('created_at');
          if (error) throw error;
          return data || [];
        }
        if (action === 'addRecipient') {
          const { data, error } = await sb.from('report_recipients').insert([{
            name: params.name, email: params.email, is_active: true
          }]).select().single();
          if (error) throw error;
          return data;
        }
        if (action === 'toggleRecipient') {
          const { error } = await sb.from('report_recipients').update({ is_active: params.is_active }).eq('id', params.id);
          if (error) throw error;
          return { ok: true };
        }
        if (action === 'deleteRecipient') {
          const { error } = await sb.from('report_recipients').delete().eq('id', params.id);
          if (error) throw error;
          return { ok: true };
        }
        if (action === 'getSettings') {
          const { data, error } = await sb.from('system_settings').select('*').eq('id', 1).maybeSingle();
          if (error) throw error;
          return data || { require_borrow_signature: false, require_return_rating: false };
        }
        if (action === 'updateSetting') {
          const { key, value } = params;
          const ALLOWED_KEYS = ['require_borrow_signature', 'require_return_rating'];
          if (!ALLOWED_KEYS.includes(key)) throw new Error('Invalid setting key: ' + key);
          const oldVal = SETTINGS[key];
          const { error } = await sb.from('system_settings').update({ [key]: value, updated_at: new Date().toISOString() }).eq('id', 1);
          if (error) throw error;
          SETTINGS[key] = value;
          await logAction('SETTING_UPDATE', 'system_settings', key, { [key]: oldVal }, { [key]: value });
          return { ok: true };
        }
        throw new Error('Unknown action: '+action);
      } catch(err) { console.error('API Error:', err); throw err; }
    }

    // ===== SIGNATURE PAD =====
    function getSignaturePoint(canvas, e) {
      const rc = canvas.getBoundingClientRect();
      const src = e.touches?.[0] ?? e.changedTouches?.[0] ?? e;
      return [src.clientX - rc.left, src.clientY - rc.top];
    }
    function drawStart(canvas, e) {
      if (!sctx) return; if (e.cancelable) e.preventDefault();
      drawing = true;
      if (typeof e.pointerId === 'number' && canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
      const [x,y] = getSignaturePoint(canvas, e); sctx.beginPath(); sctx.moveTo(x,y);
    }
    function drawMove(canvas, e) {
      if (!sctx || !drawing) return; if (e.cancelable) e.preventDefault();
      const [x,y] = getSignaturePoint(canvas, e); sctx.lineTo(x,y); sctx.stroke(); hasSignatureStroke = true;
    }
    function drawEnd(canvas, e) {
      if (e?.cancelable) e.preventDefault(); drawing = false;
      if (typeof e?.pointerId === 'number' && canvas.releasePointerCapture) try { canvas.releasePointerCapture(e.pointerId); } catch(_){}
    }
    function sizeSignatureCanvas(canvas) {
      if (!canvas) return;
      const w = canvas.offsetWidth, h = canvas.offsetHeight;
      if (!w || !h) { hasSignatureStroke = false; return; }
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      sctx = canvas.getContext('2d'); if (!sctx) return;
      sctx.setTransform(dpr,0,0,dpr,0,0);
      sctx.strokeStyle = '#1E293B'; sctx.lineWidth = 2; sctx.lineCap = 'round'; sctx.lineJoin = 'round';
      sctx.fillStyle = '#FFFFFF'; sctx.fillRect(0,0,w,h);
      hasSignatureStroke = false;
    }
    function bindSignatureEvents(canvas) {
      if (signatureListenersCleanup) signatureListenersCleanup();
      const opts = { passive: false };
      const handlers = [
        ['pointerdown', e=>drawStart(canvas,e)], ['pointermove', e=>drawMove(canvas,e)],
        ['pointerup', e=>drawEnd(canvas,e)], ['pointercancel', e=>drawEnd(canvas,e)],
        ['touchstart', e=>drawStart(canvas,e)], ['touchmove', e=>drawMove(canvas,e)],
        ['touchend', e=>drawEnd(canvas,e)],
      ];
      handlers.forEach(([ev,fn]) => canvas.addEventListener(ev,fn,opts));
      signatureListenersCleanup = () => { handlers.forEach(([ev,fn]) => canvas.removeEventListener(ev,fn,opts)); signatureListenersCleanup = null; };
    }
    function initSignCanvas(canvasId, retries=0) {
      const c = document.getElementById(canvasId);
      if (!c) return;
      if (c.offsetWidth === 0 && retries < 10) { requestAnimationFrame(()=>initSignCanvas(canvasId, retries+1)); return; }
      signatureCanvasEl = c; c.style.touchAction = 'none';
      sizeSignatureCanvas(c); bindSignatureEvents(c);
    }
    function clearSignCanvas(canvasId) {
      if (!confirm('ต้องการล้างลายเซ็นใช่ไหม?')) return;
      const c = document.getElementById(canvasId); if (!c) return;
      sctx = c.getContext('2d');
      if (sctx) { const w=c.offsetWidth, h=c.offsetHeight; sctx.clearRect(0,0,w*2,h*2); sctx.fillStyle='#FFFFFF'; sctx.fillRect(0,0,w*2,h*2); hasSignatureStroke = false; }
    }
    function isCanvasBlank() { return !hasSignatureStroke; }
    function exportSignature(canvas) {
      const out = document.createElement('canvas'); out.width = canvas.width; out.height = canvas.height;
      const ctx = out.getContext('2d'); ctx.fillStyle='#FFFFFF'; ctx.fillRect(0,0,out.width,out.height);
      ctx.drawImage(canvas, 0, 0);
      return out.toDataURL('image/jpeg', 0.85);
    }

    // ===== LOGIN =====
    function buildLoginScreen() {
      const gaList = document.getElementById('gaUserList'), mgrList = document.getElementById('mgrUserList');
      function row(u, i, role) {
        const isMgr = role === 'mgr';
        return `<button type="button" class="user-card user-list-item ${isMgr?'admin-card':''} w-full flex items-center gap-3.5 px-4 py-3.5 text-left" data-name="${he(u.name)}" data-role="${role}" onclick="selectUser(this.dataset.name,this.dataset.role)">
          ${avEl(u.name, role)}<div class="flex-1 min-w-0"><p class="font-semibold ${isMgr?'text-slate-700':'text-slate-900'} text-[15px] leading-tight truncate">${he(u.name)}</p>
          <p class="role-badge-mgr mt-1" style="display:inline-flex;">${isMgr?'ผู้ดูแลระบบ':'เจ้าหน้าที่ GA'}</p></div>
          <i data-lucide="chevron-right" class="w-[18px] h-[18px] text-[#64748B]"></i></button>`;
      }
      gaList.innerHTML = [...AU.ga.map((u,i)=>row(u,i,'ga')), ...(AU.user||[]).map((u,i)=>row(u,i,'user'))].join('');
      mgrList.innerHTML = AU.mgr.map((u,i) => row(u,i,'mgr')).join('');
      lucide.createIcons({'stroke-width': 1.5});
    }
    function selectUser(name, role) {
      SU = { name, role }; PB = '';
      const av = document.getElementById('pin-avatar');
      av.className = 'ga-avatar mx-auto mb-3';
      av.style.cssText = `background: ${avc(name, role)};`;
      av.textContent = ini(name);
      document.getElementById('pin-name').textContent = name;
      updatePinDots(); document.getElementById('pin-error').textContent = '';
      goScreen('pin'); lucide.createIcons({'stroke-width': 1.5});
    }

    // ===== PIN =====
    function enterPin(d) {
      if (PB.length>=6) return;
      if (navigator.vibrate) navigator.vibrate(8);
      PB += d; updatePinDots();
      if (PB.length===6) setTimeout(checkPin, 150);
    }
    function deletePin() { PB = PB.slice(0,-1); updatePinDots(); document.getElementById('pin-error').textContent = ''; }
    function updatePinDots() { document.querySelectorAll('#pin-dots .pin-dot').forEach((dot,i)=>{ dot.classList.toggle('filled',i<PB.length); dot.classList.remove('error'); }); }

    async function checkPin() {
      const now = Date.now();
      const rec = pinGetAttempts(SU?.name);
      if (rec.lockedUntil > now) { document.getElementById('pin-error').innerHTML = `ล็อกชั่วคราว ${Math.ceil((rec.lockedUntil-now)/1000)} วินาที<br><span style="font-size:11px;color:rgba(255,255,255,0.7);">ไม่ทราบ PIN? ติดต่อผู้ดูแลระบบ</span>`; PB=''; updatePinDots(); return; }
      document.querySelectorAll('#screen-pin .numpad-key').forEach(b=>b.style.pointerEvents='none');
      document.getElementById('pin-error').innerHTML = '<span style="color:var(--orange);display:flex;align-items:center;justify-content:center;gap:6px;"><svg class="animate-spin w-3.5 h-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> กำลังตรวจสอบ...</span>';
      try {
        const [res, eqData, brData, catData, settingsData] = await Promise.all([
          api('verifyPin', { name:SU.name, pin:PB, role:SU.role }),
          api('getEquipment'),
          api('getBorrows', { name:SU.name, role:SU.role }),
          api('getCategories'),
          api('getSettings').catch(() => ({ require_borrow_signature: false, require_return_rating: false }))
        ]);
        if (res.ok) {
          pinReset(SU.name);
          CU = { ...SU, allowed_categories: res.allowed_categories ?? null };
          EQ = eqData; BORROWS = brData; CATS = catData;
          if (settingsData) SETTINGS = { require_borrow_signature: settingsData.require_borrow_signature ?? false, require_return_rating: settingsData.require_return_rating ?? false };
          toast('ยินดีต้อนรับ ' + CU.name.split(' ')[0]);
          document.querySelectorAll('#pin-dots .pin-dot').forEach(d=>d.classList.add('pin-success-flash'));
          setTimeout(()=> {
            document.querySelectorAll('#pin-dots .pin-dot').forEach(d=>d.classList.remove('pin-success-flash'));
            buildMain(); goScreen('main'); lucide.createIcons({'stroke-width': 1.5}); startAutoLogout();
            const _pu = sessionStorage.getItem('pendingUnit');
            if (_pu) { sessionStorage.removeItem('pendingUnit'); setTimeout(() => handleUnitScan(_pu), 400); }
          }, 200);
          if (CU.role === 'ga') setupCategoryRealtime();
        } else {
          const updated = pinRecordFail(SU.name);
          const rem = PIN_MAX_ATTEMPTS - (updated.count % PIN_MAX_ATTEMPTS || PIN_MAX_ATTEMPTS);
          if (updated.lockedUntil > Date.now()) { document.getElementById('pin-error').innerHTML = `ล็อกชั่วคราว ${Math.ceil((updated.lockedUntil-Date.now())/1000)} วินาที<br><span style="font-size:11px;color:rgba(255,255,255,0.7);">ไม่ทราบ PIN? ติดต่อผู้ดูแลระบบ</span>`; }
          else document.getElementById('pin-error').textContent = `PIN ไม่ถูกต้อง (เหลือ ${rem} ครั้ง)`;
          document.querySelectorAll('#pin-dots .pin-dot').forEach(d=>{ d.classList.remove('filled'); d.classList.add('error'); });
          setTimeout(()=>{ PB=''; updatePinDots(); document.querySelectorAll('#pin-dots .pin-dot').forEach(d=>d.classList.remove('error')); }, 700);
        }
      } catch(e) {
        document.getElementById('pin-error').textContent = 'เกิดข้อผิดพลาด ลองใหม่';
        setTimeout(()=>{ PB=''; updatePinDots(); document.getElementById('pin-error').textContent=''; }, 1200);
      }
      document.querySelectorAll('#screen-pin .numpad-key').forEach(b=>b.style.pointerEvents='');
    }

    // ===== LOGOUT & AUTO-LOGOUT =====
    function confirmLogout() { showModal('logoutModal'); }
    function closeLogoutModal() { hideModal('logoutModal'); }

    // ===== CHANGE PIN =====
    function openChangePinModal() {
      _cpStep = 0; _cpOld = ''; _cpNew = ''; _cpConf = '';
      cpUpdateUI();
      showModal('changePinModal');
    }
    function closeChangePinModal() {
      hideModal('changePinModal');
      _cpStep = 0; _cpOld = ''; _cpNew = ''; _cpConf = '';
    }
    function cpEnterPin(d) {
      const gets = [()=>_cpOld, ()=>_cpNew, ()=>_cpConf];
      const sets = [v=>_cpOld=v, v=>_cpNew=v, v=>_cpConf=v];
      const cur = gets[_cpStep]();
      if (cur.length >= 6) return;
      if (navigator.vibrate) navigator.vibrate(8);
      sets[_cpStep](cur + d);
      cpUpdateDots();
      if (gets[_cpStep]().length === 6) setTimeout(cpAdvanceStep, 150);
    }
    function cpDeletePin() {
      const gets = [()=>_cpOld, ()=>_cpNew, ()=>_cpConf];
      const sets = [v=>_cpOld=v, v=>_cpNew=v, v=>_cpConf=v];
      sets[_cpStep](gets[_cpStep]().slice(0,-1));
      cpUpdateDots();
      document.getElementById('cp-error').textContent = '';
    }
    function cpUpdateDots() {
      const cur = [_cpOld,_cpNew,_cpConf][_cpStep];
      document.querySelectorAll('#cp-pin-dots .pin-dot').forEach((dot,i)=>{
        dot.classList.toggle('filled', i < cur.length);
        dot.classList.remove('error');
      });
    }
    function cpUpdateUI() {
      const labels = ['กรอก PIN เดิม','กรอก PIN ใหม่','ยืนยัน PIN ใหม่อีกครั้ง'];
      document.getElementById('cp-step-label').textContent = labels[_cpStep];
      [0,1,2].forEach(i=>{
        const si = document.getElementById(`cp-si-${i}`);
        si.style.cssText = `width:8px;height:8px;border-radius:50%;background:${i===_cpStep?'var(--orange)':i<_cpStep?'#fdba74':'var(--border)'};`;
      });
      document.getElementById('cp-error').textContent = '';
      cpUpdateDots();
    }
    async function cpAdvanceStep() {
      if (_cpStep < 2) { _cpStep++; cpUpdateUI(); return; }
      // Step 2 complete — validate & submit
      if (_cpNew !== _cpConf) {
        document.getElementById('cp-error').textContent = 'PIN ใหม่ไม่ตรงกัน';
        document.querySelectorAll('#cp-pin-dots .pin-dot').forEach(d=>d.classList.add('error'));
        _cpConf = ''; cpUpdateDots();
        return;
      }
      await submitChangePin();
    }
    async function submitChangePin() {
      try {
        const res = await api('selfChangePin',{name:CU.name,role:CU.role,oldPin:_cpOld,newPin:_cpNew});
        if (res.ok) {
          closeChangePinModal();
          toast('เปลี่ยน PIN เรียบร้อยแล้ว','success');
        } else {
          const msgs = {wrong_old_pin:'PIN เดิมไม่ถูกต้อง',same_pin:'PIN ใหม่ต้องไม่เหมือนเดิม',user_not_found:'ไม่พบผู้ใช้งาน'};
          document.getElementById('cp-error').textContent = msgs[res.error] || 'เกิดข้อผิดพลาด กรุณาลองใหม่';
          document.querySelectorAll('#cp-pin-dots .pin-dot').forEach(d=>d.classList.add('error'));
          if (res.error === 'wrong_old_pin') {
            _cpStep=0; _cpOld=''; _cpNew=''; _cpConf=''; setTimeout(cpUpdateUI,600);
          } else {
            _cpStep=1; _cpNew=''; _cpConf=''; setTimeout(cpUpdateUI,600);
          }
        }
      } catch(e) {
        console.error('[submitChangePin]', e);
        const isRls = e?.message?.includes('matched 0 rows');
        document.getElementById('cp-error').textContent = isRls
          ? 'ระบบยังไม่รองรับการเปลี่ยน PIN — แจ้ง Admin เปิด RLS UPDATE policy ใน Supabase'
          : 'เกิดข้อผิดพลาด กรุณาลองใหม่';
        document.querySelectorAll('#cp-pin-dots .pin-dot').forEach(d=>d.classList.add('error'));
        _cpStep=1; _cpNew=''; _cpConf=''; setTimeout(cpUpdateUI, 600);
      }
    }

    function setupCategoryRealtime() {
      if (_catRealtimeChannel) { sb.removeChannel(_catRealtimeChannel); _catRealtimeChannel = null; }
      _catRealtimeChannel = sb.channel('cat-access-watch')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'users' }, (payload) => {
          if (payload.new.full_name !== CU?.name) return;
          const newCats = payload.new.allowed_categories ?? null;
          CU.allowed_categories = newCats;
          // Reset chip filter if current category is no longer allowed
          if (borrowCatFilter && newCats && !newCats.includes(borrowCatFilter)) borrowCatFilter = '';
          const bt = document.getElementById('tab-borrow');
          if (bt && bt.style.display !== 'none') renderBorrowTab();
        })
        .subscribe();
    }

    function logout() {
      closeLogoutModal(); stopAutoLogout();
      signatureListenersCleanup?.();
      if (_catRealtimeChannel) { sb.removeChannel(_catRealtimeChannel); _catRealtimeChannel = null; }
      CU=null; SU=null; EQ=[]; BORROWS=[]; goScreen('login'); lucide.createIcons({'stroke-width': 1.5});
    }
    function startAutoLogout() {
      stopAutoLogout();
      _alWarnTimer = setTimeout(()=>{
        showConfirm({
          title: 'กำลังจะออกจากระบบ',
          message: 'ไม่มีการใช้งานนาน ระบบจะออกอัตโนมัติใน 60 วินาที',
          icon: '⏰', iconBg: '#FEF3C7', confirmText: 'ยังคงอยู่', confirmColor: '#F97316',
          onConfirm: resetAutoLogout
        });
      }, AUTO_LOGOUT_MS - 60000);
      _alTimer = setTimeout(()=>{ if(CU){ toast('ออกจากระบบอัตโนมัติ'); setTimeout(logout, 2000); } }, AUTO_LOGOUT_MS);
    }
    function resetAutoLogout() { if(CU) startAutoLogout(); }
    function stopAutoLogout() { clearTimeout(_alTimer); clearTimeout(_alWarnTimer); }
    ['click','touchstart','keydown','scroll'].forEach(e=>document.addEventListener(e, resetAutoLogout, {passive:true}));

    // ===== MAIN SCREEN =====
    function buildMain() {
      const isMgr = CU.role === 'mgr';
      const isUser = CU.role === 'user';
      const roleLabel = isMgr ? 'ผู้ดูแลระบบ' : isUser ? 'ผู้ใช้งาน' : 'เจ้าหน้าที่ GA';
      const av = document.getElementById('main-avatar');
      av.className = 'ga-avatar';
      av.style.cssText = 'background: rgba(255,255,255,0.25); border: 1.5px solid rgba(255,255,255,0.4); color: white;';
      av.textContent = (CU.name || '').trim().slice(0,2);
      document.getElementById('main-user-name').textContent = CU.name;
      document.getElementById('main-user-role').textContent = roleLabel;
      const sbAv = document.getElementById('sb-avatar');
      if (sbAv) sbAv.textContent = (CU.name || '').trim().slice(0, 2);
      const sbName = document.getElementById('sb-name');
      if (sbName) sbName.textContent = CU.name;
      const sbRole = document.getElementById('sb-role');
      if (sbRole) sbRole.textContent = roleLabel;
      const bar = document.getElementById('mainTabBar');
      const oc = BORROWS.filter(r => r.status === 'overdue').length;
      const greetEl = document.getElementById('main-greeting');
      if (greetEl) { const h = new Date().getHours(); greetEl.textContent = h < 12 ? 'อรุณสวัสดิ์ 🌤' : h < 18 ? 'สวัสดีตอนบ่าย ☀️' : 'สวัสดีตอนเย็น 🌙'; }
      const hAvail = document.getElementById('hero-stat-available');
      const hBorr  = document.getElementById('hero-stat-borrowed');
      const hOver  = document.getElementById('hero-stat-overdue');
      if (hAvail) hAvail.textContent = EQ.reduce((s,e) => s + Number(e.available_qty||0), 0);
      if (hBorr)  hBorr.textContent  = BORROWS.filter(r => ['borrowed','overdue'].includes(r.status)).length;
      if (hOver)  hOver.textContent  = oc;
      const badge = oc > 0 ? `<span class="ml-1 inline-flex items-center justify-center min-w-[16px] h-4 px-0.5 rounded-full bg-red-500 text-white text-[10px] font-bold leading-none">${oc > 9 ? '9+' : oc}</span>` : '';
      const summaryEl = document.getElementById('main-summary');
      if (summaryEl) {
        summaryEl.textContent = isMgr
          ? `วันนี้มีรายการยืมค้าง ${BORROWS.filter(r => ['borrowed','overdue'].includes(r.status)).length} รายการ`
          : `พร้อมใช้งาน ${EQ.reduce((s, e) => s + Number(e.available_qty || 0), 0)} ชิ้น • เกินกำหนด ${oc} รายการ`;
      }
      const ctaEl = document.getElementById('main-hero-cta');
      if (ctaEl) {
        ctaEl.textContent = isMgr ? 'จัดการอุปกรณ์' : 'เริ่มยืม';
        ctaEl.setAttribute('onclick', isMgr ? 'switchTab(3)' : 'switchTab(0)');
      }
      const topInner = document.getElementById('top-tabs-inner');
      if (isMgr) {
        const tabs = ['ภาพรวม','Analytics','ประวัติ','อุปกรณ์','สมาชิก','Audit','ตั้งค่า'];
        const icons = ['layout-dashboard','bar-chart-2','history','box','users','clipboard-list','settings'];
        bar.innerHTML = tabs.map((t,i)=>
          `<button class="main-tab ${i===0?'tab-active':'tab-inactive'}" style="flex:1;padding:10px 12px;font-size:var(--fs-body);font-weight:600;text-align:center;" onclick="switchTab(${i})">${t}${i===0?badge:''}</button>`).join('');
        if (topInner) topInner.innerHTML = tabs.map((t,i)=>
          `<button class="top-tab ${i===0?'active':''}" onclick="switchTab(${i})">${t}${i===0?badge:''}</button>`).join('');
        const navLabels = ['ภาพรวม','สถิติ','ประวัติ','อุปกรณ์','สมาชิก','Audit','ตั้งค่า'];
        const bn = document.getElementById('bottom-nav');
        if (bn) bn.innerHTML = navLabels.map((t,i)=>
          `<div class="bn-item nav-item bn-compact ${i===0?'active':''}" onclick="switchTab(${i})"><i data-lucide="${icons[i]}" style="width:16px;height:16px;"></i><span class="bn-label">${t}${i===0?badge:''}</span></div>`).join('');
      } else if (isUser) {
        const tabs = ['ยืม','ประวัติ'];
        const fullTabs = ['ยืมอุปกรณ์','ประวัติการยืม'];
        const icons = ['package-plus','history'];
        bar.innerHTML = tabs.map((t,i)=>
          `<button class="main-tab ${i===0?'tab-active':'tab-inactive'}" style="flex:1;padding:10px 12px;font-size:var(--fs-body);font-weight:600;text-align:center;" onclick="switchTab(${i})">${t}</button>`).join('');
        if (topInner) topInner.innerHTML = fullTabs.map((t,i)=>
          `<button class="top-tab ${i===0?'active':''}" onclick="switchTab(${i})">${t}</button>`).join('');
        const bn = document.getElementById('bottom-nav');
        if (bn) bn.innerHTML = tabs.map((t,i)=>
          `<div class="bn-item nav-item ${i===0?'active':''}" onclick="switchTab(${i})"><i data-lucide="${icons[i]}" style="width:20px;height:20px;"></i><span class="bn-label">${t}</span></div>`).join('');
      } else {
        const tabs = ['ยืม','คืน','ประวัติ','สถิติ'];
        const fullTabs = ['ยืมอุปกรณ์','คืนอุปกรณ์','ประวัติ','สถิติ'];
        const icons = ['package-plus','package-check','history','bar-chart-2'];
        bar.innerHTML = tabs.map((t,i)=>
          `<button class="main-tab ${i===0?'tab-active':'tab-inactive'}" style="flex:1;padding:10px 12px;font-size:var(--fs-body);font-weight:600;text-align:center;" onclick="switchTab(${i})">${t}${i===1?badge:''}</button>`).join('');
        if (topInner) topInner.innerHTML = fullTabs.map((t,i)=>
          `<button class="top-tab ${i===0?'active':''}" onclick="switchTab(${i})">${t}${i===1?badge:''}</button>`).join('');
        const bn = document.getElementById('bottom-nav');
        if (bn) bn.innerHTML = tabs.map((t,i)=>
          `<div class="bn-item nav-item ${i===0?'active':''}" onclick="switchTab(${i})"><i data-lucide="${icons[i]}" style="width:20px;height:20px;"></i><span class="bn-label">${t}${i===1?badge:''}</span></div>`).join('');
      }
      const sbNav = document.getElementById('sb-nav');
      if (sbNav) {
        if (isMgr) {
          const sbTabs = ['ภาพรวม','Analytics','ประวัติ','อุปกรณ์','สมาชิก','Audit','ตั้งค่า'];
          const sbIcons = ['layout-dashboard','bar-chart-2','history','box','users','clipboard-list','settings'];
          sbNav.innerHTML = sbTabs.map((t,i)=>
            `<button class="sb-item ${i===0?'active':''}" onclick="switchTab(${i})"><i data-lucide="${sbIcons[i]}" style="width:16px;height:16px;flex-shrink:0;"></i><span>${t}${i===0?badge:''}</span></button>`).join('');
        } else if (isUser) {
          const sbTabs = ['ยืมอุปกรณ์','ประวัติการยืม'];
          const sbIcons = ['package-plus','history'];
          sbNav.innerHTML = sbTabs.map((t,i)=>
            `<button class="sb-item ${i===0?'active':''}" onclick="switchTab(${i})"><i data-lucide="${sbIcons[i]}" style="width:16px;height:16px;flex-shrink:0;"></i><span>${t}</span></button>`).join('');
        } else {
          const sbTabs = ['ยืมอุปกรณ์','คืนอุปกรณ์','ประวัติ','สถิติ'];
          const sbIcons = ['package-plus','package-check','history','bar-chart-2'];
          sbNav.innerHTML = sbTabs.map((t,i)=>
            `<button class="sb-item ${i===0?'active':''}" onclick="switchTab(${i})"><i data-lucide="${sbIcons[i]}" style="width:16px;height:16px;flex-shrink:0;"></i><span>${t}${i===1?badge:''}</span></button>`).join('');
        }
      }
      showOverdueBanner();
      switchTab(0);
    }
    function showOverdueBanner() {
      const cnt = BORROWS.filter(r => r.status === 'overdue').length;
      const banner = document.getElementById('overdue-banner');
      const txt = document.getElementById('overdue-banner-text');
      if (!banner || !txt) return;
      if (cnt > 0) {
        txt.textContent = CU?.role === 'mgr'
          ? `มี ${cnt} รายการเกินกำหนดในระบบ`
          : `คุณมี ${cnt} รายการเกินกำหนด กรุณาคืนโดยเร็ว`;
        banner.style.display = 'flex';
      } else {
        banner.style.display = 'none';
      }
    }
    function switchTab(idx) {
      const isMgr = CU.role === 'mgr';
      const isUser = CU.role === 'user';
      document.querySelectorAll('#mainTabBar .main-tab').forEach((b,i)=> { b.classList.toggle('tab-active',i===idx); b.classList.toggle('tab-inactive',i!==idx); });
      document.querySelectorAll('#top-tabs-inner .top-tab').forEach((b,i)=> b.classList.toggle('active',i===idx));
      document.querySelectorAll('#bottom-nav .bn-item').forEach((b,i)=> b.classList.toggle('active',i===idx));
      document.querySelectorAll('#sb-nav .sb-item').forEach((b,i)=> b.classList.toggle('active',i===idx));
      ['borrow','return','history','dashboard','analytics-mgr','analytics-ga','mgr-history','equipment','members','audit-log','settings'].forEach(t=> { const el=document.getElementById('tab-'+t); if(el) el.style.display='none'; });
      if (isMgr) {
        if(idx===0){ document.getElementById('tab-dashboard').style.display='block'; renderDashboard(); }
        if(idx===1){ document.getElementById('tab-analytics-mgr').style.display='block'; renderAnalyticsTab(); }
        if(idx===2){ document.getElementById('tab-mgr-history').style.display='block'; renderMgrHistory(); }
        if(idx===3){ document.getElementById('tab-equipment').style.display='block'; renderEquipmentTab(); }
        if(idx===4){ document.getElementById('tab-members').style.display='block'; renderMembersTab(); }
        if(idx===5){ document.getElementById('tab-audit-log').style.display='block'; renderAuditLogTab(); }
        if(idx===6){ document.getElementById('tab-settings').style.display='block'; renderSettingsTab(); }
      } else if (isUser) {
        if(idx===0){ document.getElementById('tab-borrow').style.display='block'; renderBorrowTab(); }
        if(idx===1){ document.getElementById('tab-history').style.display='block'; renderHistoryTab(); }
      } else {
        if(idx===0){ document.getElementById('tab-borrow').style.display='block'; renderBorrowTab(); }
        if(idx===1){ document.getElementById('tab-return').style.display='block'; renderReturnTab(); }
        if(idx===2){ document.getElementById('tab-history').style.display='block'; renderHistoryTab(); }
        if(idx===3){ document.getElementById('tab-analytics-ga').style.display='block'; renderAnalyticsTab(); }
      }
      lucide.createIcons({'stroke-width': 1.5});
    }

    // ===== GA: BORROW TAB =====
    function setBorrowViewMode(mode) {
      borrowViewMode = mode;
      localStorage.setItem('equipmentViewMode', mode);
      renderBorrowTab();
    }

    function renderBorrowTab() {
      const allowedCats = CU?.allowed_categories; // null = see all; string[] = restricted
      const visibleEq = EQ.filter(e =>
        (!allowedCats || allowedCats.length === 0 || allowedCats.includes(e.category)));
      const avail = visibleEq.filter(e => e.available > 0);
      const cats = (allowedCats && allowedCats.length > 0)
        ? CATS.filter(c => allowedCats.includes(c.name)).map(c => c.name)
        : CATS.map(c => c.name);
      const filtered = avail.filter(e=> {
        if (borrowCatFilter && e.category !== borrowCatFilter) return false;
        if (borrowSearchQ && !e.name.toLowerCase().includes(borrowSearchQ.toLowerCase())) return false;
        return true;
      });
      // last-borrowed-at per eq_id (most recent)
      const lastBorrowMap = {};
      BORROWS.forEach(b => {
        const t = new Date(b.borrowed_at).getTime();
        if (!lastBorrowMap[b.eq_id] || t > lastBorrowMap[b.eq_id]) lastBorrowMap[b.eq_id] = t;
      });
      const sinceLabel = (ts) => {
        if (!ts) return 'ยังไม่เคยถูกยืม';
        const diff = Math.floor((Date.now() - ts) / 86400000);
        if (diff <= 0) return 'ยืมวันนี้';
        if (diff === 1) return 'ยืมเมื่อวาน';
        if (diff < 7) return `ยืม ${diff} วันที่แล้ว`;
        if (diff < 30) return `ยืม ${Math.floor(diff/7)} สัปดาห์ก่อน`;
        if (diff < 365) return `ยืม ${Math.floor(diff/30)} เดือนก่อน`;
        return `ยืม >1 ปีก่อน`;
      };
      const el = document.getElementById('tab-borrow');
      const eqEmptyState = eqCatFilter
        ? `<p style="font-size:14px;color:#78716C;text-align:center;padding:24px 12px;">ไม่มีอุปกรณ์ในหมวด \"<span>${he(eqCatFilter)}</span>\"</p>`
        : emptyState('ไม่พบอุปกรณ์', eqSearch || 'คำค้นหา', 'search','เพิ่มอุปกรณ์','showAddEquipment()');
      el.innerHTML = `<div class="gd-container fade-in w-full lg:max-w-none lg:px-8 xl:px-12">
        <h2 class="page-title" style="margin-bottom:12px;">ยืมอุปกรณ์</h2>
        <div class="mb-4 max-w-2xl" style="display:flex;gap:8px;align-items:center">
          <input type="text" placeholder="ค้นหาอุปกรณ์..." class="gd-input" style="flex:1" value="${he(borrowSearchQ)}"
            oninput="borrowSearchQ=this.value;debounce('borrowSearch',renderBorrowTab)">
          <button onclick="openQRScanner()" style="background:#f97316;color:#fff;border:none;border-radius:8px;padding:7px 12px;font-size:13px;font-weight:500;cursor:pointer;display:flex;align-items:center;gap:6px;white-space:nowrap;font-family:'Prompt', sans-serif">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3z"/><path d="M17 14h4"/><path d="M14 17v4"/><path d="M17 21h4v-4"/></svg>
            สแกน
          </button>
          <div style="display:flex;gap:2px;background:var(--mf-hover);border:1px solid var(--mf-border-soft);border-radius:10px;padding:3px;flex-shrink:0;">
            <button class="view-toggle-btn ${borrowViewMode==='list'?'active':'inactive'}"
              onclick="setBorrowViewMode('list')" title="รายการ" aria-label="มุมมองรายการ">
              <i data-lucide="list" style="width:16px;height:16px;"></i>
            </button>
            <button class="view-toggle-btn ${borrowViewMode==='grid'?'active':'inactive'}"
              onclick="setBorrowViewMode('grid')" title="ตาราง" aria-label="มุมมองตาราง">
              <i data-lucide="layout-grid" style="width:16px;height:16px;"></i>
            </button>
          </div>
        </div>
        <div class="chip-row">
          <div class="chip ${borrowCatFilter===''?'active':''}" onclick="borrowCatFilter='';renderBorrowTab()">ทั้งหมด</div>
          ${cats.map(c=>`<div class="chip ${borrowCatFilter===c?'active':''}" data-cat="${he(c)}" onclick="borrowCatFilter=this.dataset.cat;renderBorrowTab()">${he(c)}</div>`).join('')}
        </div>
        <div class="view-${borrowViewMode}" id="eqGrid">
          ${filtered.length ? filtered.map(e => borrowViewMode === 'grid' ? `
            <div class="gd-card gd-card-grid-card cursor-pointer" style="--cat-accent:${catAccentColor(e.category)}" onclick="openBorrowForm('${he(e.eq_id)}')">
              <div class="gc-icon">
                ${eqIconSvg(28)}
              </div>
              <p class="gc-name">${he(e.name)}</p>
              <p class="gc-meta">${he(e.category||'ไม่ระบุ')}${e.serial_no?' · '+he(e.serial_no):''}</p>
              <div class="gc-badge">
                <span class="status-badge ${e.available<=2?'status-borrowed':'status-returned'}">คงเหลือ ${e.available}/${e.quantity}</span>
              </div>
              <button class="gc-btn" onclick="event.stopPropagation();openBorrowForm('${he(e.eq_id)}')">
                <i data-lucide="hand" style="width:14px;height:14px;"></i> ยืม
              </button>
            </div>` : `
            ${(() => {
              const pct = e.quantity ? Math.round((e.available / e.quantity) * 100) : 0;
              const cls = getAvailabilityClass(e.available, e.quantity);
              const last = sinceLabel(lastBorrowMap[e.eq_id]);
              return `
            <div class="gd-card gd-card-grid eq-cat-stripe cursor-pointer" style="--cat-accent:${catAccentColor(e.category)}" onclick="openBorrowForm('${he(e.eq_id)}')">
              <div class="grid-icon">
                <div class="grid-icon-box">${eqIconSvg(18)}</div>
              </div>
              <div class="grid-content">
                <p class="eq-title">${he(e.name)}</p>
                <p class="eq-meta">${he(e.category||'ไม่ระบุ')}${e.serial_no?' · '+he(e.serial_no):''}</p>
                <div class="eq-sub-meta">
                  <span class="eq-chip-sm"><i data-lucide="history" style="width:11px;height:11px;"></i>${last}</span>
                </div>
              </div>
              <div class="eq-stock-wrap">
                <div class="eq-stock-meta">
                  <span>คงเหลือ</span>
                  <span style="font-weight:600;color:var(--mf-text);">${e.available}/${e.quantity}</span>
                </div>
                <div class="eq-stock-bar"><div class="eq-stock-fill progress-bar ${cls}" style="width:100%;transform:scaleX(${(pct/100).toFixed(3)})"></div></div>
              </div>
              <div class="grid-badge">
                <span class="status-badge ${e.available<=2?'status-borrowed':'status-returned'}">คงเหลือ ${e.available}/${e.quantity}</span>
              </div>
              <div class="grid-action">
                <button class="btn-action-borrow flex items-center gap-1.5"><i data-lucide="hand" class="w-4 h-4 text-[#F97316]"></i> ยืม</button>
              </div>
            </div>`;})()}`).join('') : emptyState('ไม่พบอุปกรณ์','ลองเปลี่ยนหมวดหมู่หรือคำค้นหา','search')}
        </div>
      </div>`;
      lucide.createIcons({'stroke-width': 1.5});
    }

    // ===== GA: BORROW FORM =====
    function openBorrowForm(eqId, lockedUnitId = null, lockedUnitCode = '', lockedUnit = false) {
      const eq = EQ.find(e=>e.eq_id===eqId);
      if (!eq) { toast('ไม่พบอุปกรณ์','error'); return; }
      currentBorrowEq = eq;
      document.getElementById('bf-eq-name').textContent = eq.name + ' (คงเหลือ ' + eq.available + ')';
      const savedDept = localStorage.getItem('ga_bf_dept') || '';
      const defaultDue = new Date(); defaultDue.setDate(defaultDue.getDate()+7);
      const dueStr = defaultDue.toISOString().slice(0,10);
      const todayStr = new Date().toISOString().slice(0,10);
      const unitWrapHtml = lockedUnit
        ? `<div style="display:flex;align-items:center;gap:8px;background:#f5f5f4;border:0.5px solid #e7e5e4;border-radius:8px;padding:10px 14px;margin-bottom:12px;">
            <span style="font-family:monospace;font-size:13px;color:#1c1917;flex:1">${he(lockedUnitCode)}</span>
            <span style="background:#f97316;color:#fff;font-size:10px;font-weight:600;padding:2px 7px;border-radius:4px;">สแกน QR</span>
            <input type="hidden" id="bfLockedUnitId" value="${he(lockedUnitId||'')}">
          </div>`
        : `<div id="bfUnitWrap" style="margin-bottom:12px"></div>`;
      document.getElementById('bf-body').innerHTML = `
        <div class="gd-card p-5 mb-4">
          <div class="flex items-center gap-3 mb-1">
            ${eq.image_url ? `<img src="${he(eq.image_url)}" alt="${he(eq.name)} — รูปอุปกรณ์" style="width:36px; height:36px; min-width:36px; object-fit:cover; border-radius:8px; border:1px solid #E2E8F0;" class="shrink-0"/>` : `<div style="width:36px; height:36px; min-width:36px; border-radius:8px; background:#F1F5F9; border:1px solid #E2E8F0; display:flex; align-items:center; justify-content:center;" class="shrink-0"><i data-lucide="box" style="width:20px;height:20px;color:var(--orange);"></i></div>`}
            <div><p class="font-semibold text-gray-900">${he(eq.name)}</p>
            <p class="eq-meta">${he(eq.category||'')}${eq.serial_no?' · '+he(eq.serial_no):''} · คงเหลือ ${eq.available}</p></div>
          </div>
        </div>
        ${unitWrapHtml}
        <div class="space-y-3 mb-6">
          <div><label class="text-sm font-medium text-gray-500 mb-1.5 block">จำนวนที่ยืม</label>
            <input type="number" id="bfQty" min="1" max="${eq.available}" value="1" class="gd-input">
            <p style="font-size:11px;color:#9CA3AF;margin-top:6px;">ยืมได้สูงสุด ${eq.available} ชิ้น</p></div>
          <div><label class="text-sm font-medium text-gray-500 mb-1.5 block">ชื่อผู้ยืม</label>
            <input type="text" id="bfBorrower" placeholder="ชื่อ-นามสกุลผู้ยืม" class="gd-input" value="${he(CU?.name||'')}"></div>
          <div><label class="text-sm font-medium text-gray-500 mb-1.5 block">รหัสพนักงาน</label>
            <input type="text" id="bfDept" maxlength="6" pattern="[0-9]{6}" inputmode="numeric" placeholder="เช่น 087256" class="gd-input" value="${he(savedDept)}"></div>
          <div><label class="text-sm font-medium text-gray-500 mb-1.5 block">กำหนดคืน</label>
            <input type="date" id="bfDue" value="${dueStr}" min="${todayStr}" class="gd-input"></div>
          <div><label class="text-sm font-medium text-gray-500 mb-1.5 block">หมายเหตุ <span class="font-normal text-gray-400" style="font-size:11px;">(ไม่บังคับ)</span></label>
            <textarea id="bfNote" rows="2" placeholder="เช่น ใช้งานประชุมลูกค้า" class="gd-input" style="height:auto;padding:10px 14px;"></textarea></div>
        </div>
        ${SETTINGS.require_borrow_signature ? `<div class="signature-pad mb-6">
          <div class="signature-pad__header">
            <span class="signature-pad__title">เซ็นชื่อในกล่องด้านล่าง <span style="color:#DC2626;">*</span></span>
            <button onclick="clearSignCanvas('bfSignCanvas')" class="signature-pad__clear"><i data-lucide="eraser" class="w-[18px] h-[18px] text-[#64748B]"></i> ล้าง</button>
          </div>
          <div class="signature-pad__frame">
            <canvas id="bfSignCanvas" class="sig-canvas" style="width:100%;height:140px;"></canvas>
          </div>
          <p class="text-base text-gray-500 text-center mt-2 leading-snug">ข้าพเจ้ายืนยันว่าได้รับอุปกรณ์ตามรายการข้างต้นในสภาพสมบูรณ์</p>
          <p class="text-center mt-1" style="font-size:11px;color:#F59E0B;">🔒 ลายเซ็นนี้ใช้เพื่อยืนยันการรับอุปกรณ์ และถูกจัดเก็บอย่างปลอดภัยในระบบ</p>
        </div>` : ''}
        <button onclick="submitBorrow()" id="bfSubmitBtn" class="w-full gd-btn-primary text-base font-semibold flex items-center justify-center gap-2">
          <i data-lucide="check" class="w-[18px] h-[18px] text-white"></i> ยืนยันการยืม
        </button>`;
      goScreen('borrow-form'); lucide.createIcons({'stroke-width': 1.5});
      document.getElementById('bfDept')?.addEventListener('input', e => localStorage.setItem('ga_bf_dept', e.target.value));
      if (SETTINGS.require_borrow_signature) setTimeout(()=>initSignCanvas('bfSignCanvas'), 100);
      if (!lockedUnit) _loadUnitDropdown(eq.eq_id);
    }
    function closeBorrowForm() { currentBorrowEq=null; goScreen('main'); switchTab(0); }

    async function _loadUnitDropdown(eqId) {
      const wrap = document.getElementById('bfUnitWrap');
      if (!wrap) return;
      const { data: allUnits } = await sb.from('equipment_units')
        .select('id, unit_code, status')
        .eq('equipment_id', eqId)
        .order('unit_code');
      if (!allUnits?.length) { wrap.innerHTML = ''; return; }
      const available = allUnits.filter(u => u.status === 'available');
      if (!available.length) {
        wrap.innerHTML = `<div style="background:#fef2f2;border:0.5px solid #fecaca;border-radius:8px;padding:10px 12px;font-size:12px;color:#dc2626">ไม่มีหน่วยว่างในขณะนี้</div>`;
        document.getElementById('bfSubmitBtn')?.setAttribute('disabled', 'true');
        return;
      }
      wrap.innerHTML = `
        <div>
          <label class="text-sm font-medium text-gray-500 mb-1.5 block">เลือกหน่วยที่ต้องการยืม <span style="color:#dc2626">*</span></label>
          <select id="bfUnitId" class="gd-input">
            <option value="">— เลือกรหัสชุด —</option>
            ${available.map(u => `<option value="${he(u.id)}">${he(u.unit_code)}</option>`).join('')}
          </select>
        </div>`;
    }

    // Singleton camera preference manager — saves chosen deviceId across sessions
    const CameraManager = (() => {
      const LS_KEY = 'ga_pref_camera_id';
      const load  = () => { try { return localStorage.getItem(LS_KEY) || null; } catch(_) { return null; } };
      const save  = id => { try { if (id) localStorage.setItem(LS_KEY, id); } catch(_) {} };
      const clear = ()  => { try { localStorage.removeItem(LS_KEY); } catch(_) {} };
      // Returns ordered list of camera configs to attempt: saved id → back → front
      function getCandidates() {
        const saved = load();
        const list = [];
        if (saved) list.push(saved);                      // exact device, no re-prompt
        list.push({ facingMode: 'environment' });         // back camera
        list.push({ facingMode: 'user' });                // front camera fallback
        return list;
      }
      return { load, save, clear, getCandidates };
    })();

    function openQRScanner() {
      document.getElementById('qrScannerModal')?.remove();
      const modal = document.createElement('div');
      modal.id = 'qrScannerModal';
      modal.style.cssText = 'position:fixed;inset:0;z-index:2000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.85);backdrop-filter:blur(4px)';
      modal.innerHTML = `
        <div style="background:#fff;border-radius:16px;padding:20px;width:min(360px,calc(100vw - 32px));text-align:center">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
            <h3 style="font-size:15px;font-weight:700;color:#1c1917;margin:0">สแกน QR Code</h3>
            <button id="qrScanCloseBtn" style="background:none;border:none;color:#a8a29e;font-size:22px;cursor:pointer;line-height:1">×</button>
          </div>
          <div id="qrScanRegion" style="width:100%;border-radius:8px;overflow:hidden"></div>
          <p style="font-size:12px;color:#a8a29e;margin-top:12px">วาง QR code ไว้ในกรอบ</p>
        </div>`;
      document.body.appendChild(modal);

      const qrCode = new Html5Qrcode('qrScanRegion');
      let isStarted = false;
      let lastScan = 0;

      const cleanup = async () => {
        if (isStarted) { try { await qrCode.stop(); } catch(_) {} isStarted = false; }
        try { qrCode.clear(); } catch(_) {}
        modal.remove();
      };

      document.getElementById('qrScanCloseBtn').onclick = cleanup;

      (async () => {
        const candidates = CameraManager.getCandidates();
        for (const cam of candidates) {
          // Upgrade facingMode constraints without touching CameraManager
          const camConfig = typeof cam === 'string'
            ? cam
            : { facingMode: { ideal: cam.facingMode }, width: { ideal: 1280 }, height: { ideal: 720 } };
          try {
            await qrCode.start(
              camConfig,
              {
                fps: 10,
                aspectRatio: 16 / 9,
                qrbox: (w, h) => { const size = Math.min(w, h) * 0.8; return { width: size, height: size }; }
              },
              async (decoded) => {
                const now = Date.now();
                if (now - lastScan < 2000) return;
                lastScan = now;
                // Persist the actual deviceId so next open skips selection entirely
                try {
                  const deviceId = qrCode.getRunningTrackSettings?.()?.deviceId;
                  if (deviceId) CameraManager.save(deviceId);
                } catch(_) {}
                await cleanup();
                let unitCode = decoded;
                try { const u = new URL(decoded); unitCode = u.searchParams.get('unit') || decoded; } catch(_) {}
                await handleUnitScan(unitCode);
              },
              () => {} // per-frame decode errors are normal noise
            );
            isStarted = true;
            // Also save deviceId right after start (before any QR is scanned)
            try {
              const deviceId = qrCode.getRunningTrackSettings?.()?.deviceId;
              if (deviceId) CameraManager.save(deviceId);
            } catch(_) {}
            return; // camera opened successfully — stop trying candidates
          } catch(err) {
            const msg = err?.message || (typeof err === 'string' ? err : '');
            if (/NotAllowed|Permission|Dismissed/i.test(msg)) {
              // User denied permission — no point trying other candidates
              modal.remove();
              toast('กรุณาอนุญาตการใช้กล้องในการตั้งค่าเบราว์เซอร์', 'error');
              return;
            }
            // This candidate failed (device gone / unsupported) — clear stale save and try next
            if (typeof cam === 'string') CameraManager.clear();
          }
        }
        modal.remove();
        toast('ไม่สามารถเปิดกล้องได้', 'error');
      })();
    }

    async function handleUnitScan(unitCode) {
      const { data: unit } = await sb.from('equipment_units')
        .select('id, equipment_id, unit_code, status')
        .eq('unit_code', unitCode)
        .maybeSingle();
      if (!unit) { toast(`ไม่พบ unit "${unitCode}" ในระบบ`, 'error'); return; }

      if (CU?.role === 'manager') {
        switchTab(3);
        setTimeout(() => selectEquipment(unit.equipment_id), 300);
        return;
      }

      const statusTH = { available:'ว่าง', borrowed:'ยืมอยู่', damaged:'ชำรุด', lost:'สูญหาย' }[unit.status] || unit.status;

      if (unit.status === 'available') {
        const equipment = EQ.find(e => e.id === unit.equipment_id || e.eq_id === unit.equipment_id);
        if (!equipment) { toast('ไม่พบข้อมูลอุปกรณ์', 'error'); return; }
        openBorrowForm(equipment.eq_id, unit.id, unit.unit_code, true);
        return;
      }

      if (unit.status === 'borrowed') {
        const { data: rec } = await sb.from('borrow_records')
          .select('record_id, ga_staff, borrower_name')
          .eq('unit_id', unit.id)
          .eq('status', 'borrowed')
          .maybeSingle();
        if (rec?.ga_staff === CU?.name) {
          switchTab(1);
          setTimeout(() => openReturnDetail(rec.record_id), 400);
        } else {
          toast(`อุปกรณ์นี้ถูกยืมโดย ${rec?.ga_staff || 'GA อื่น'} อยู่`, 'warning');
        }
        return;
      }

      toast(`อุปกรณ์นี้อยู่ในสถานะ${statusTH}`, 'warning');
    }

    async function submitBorrow() {
      const qty = parseInt(document.getElementById('bfQty')?.value)||1;
      const borrower = document.getElementById('bfBorrower')?.value.trim();
      const dept = document.getElementById('bfDept')?.value;
      const due = document.getElementById('bfDue')?.value;
      const note = document.getElementById('bfNote')?.value.trim();
      const unitSelect = document.getElementById('bfUnitId');
      const unitId = unitSelect?.value || document.getElementById('bfLockedUnitId')?.value || null;
      if (unitSelect && !unitId) { toast('กรุณาเลือกรหัสชุดอุปกรณ์ที่ต้องการยืม'); return; }
      if (!borrower) { toast('กรุณากรอกชื่อผู้ยืม'); return; }
      if (!/^\d{6}$/.test(dept)) { toast('กรุณากรอกรหัสพนักงาน 6 หลัก'); return; }
      if (!due) { toast('กรุณาระบุกำหนดคืน'); return; }
      if (SETTINGS.require_borrow_signature && isCanvasBlank()) { toast('กรุณาเซ็นลายเซ็นก่อนยืนยัน'); return; }
      if (qty < 1 || qty > currentBorrowEq.available) { toast('จำนวนไม่ถูกต้อง'); return; }
      const btn = document.getElementById('bfSubmitBtn');
      showConfirm({
        title: 'ยืนยันการยืม?',
        message: `${currentBorrowEq.name} · ผู้ยืม: ${borrower} · ${qty} ชิ้น`,
        icon: '📋', iconBg: '#FFF7ED', confirmText: 'ยืนยันการยืม', confirmColor: '#F97316',
        onConfirm: async () => {
          btn.disabled = true; btn.innerHTML = '⏳ กำลังดำเนินการ...';
          try {
            const canvas = SETTINGS.require_borrow_signature ? document.getElementById('bfSignCanvas') : null;
            const sig = canvas ? exportSignature(canvas) : null;
            await api('createBorrow', {
              eq_id: currentBorrowEq.eq_id, eq_name: currentBorrowEq.name, qty,
              borrower_name: borrower, borrower_dept: dept, ga_staff: CU.name,
              due_date: due, sign_img: sig, note, unit_id: unitId
            });
            EQ = await api('getEquipment');
            BORROWS = await api('getBorrows', { name:CU.name, role:CU.role });
            toast('ยืมอุปกรณ์เรียบร้อยแล้ว','success');
            closeBorrowForm();
          } catch(e) {
            console.error(e); toast('ไม่สามารถบันทึกข้อมูลได้','error');
            btn.disabled=false; btn.innerHTML='<i data-lucide="check" class="w-[18px] h-[18px] text-[#64748B]"></i> ยืนยันการยืม';
            btn.classList.add('gd-btn-primary'); lucide.createIcons({'stroke-width': 1.5});
          }
        }
      });
    }

    // ===== GA: RETURN TAB =====
    function renderReturnTab() {
      const active = BORROWS.filter(r=> r.status==='borrowed'||r.status==='overdue');
      const el = document.getElementById('tab-return');
      el.innerHTML = `<div class="gd-container fade-in">
        <div class="gd-container-header">
          
          <h2 class="page-title">คืนอุปกรณ์</h2>
          <p class="text-base text-slate-500 mt-1">รายการอุปกรณ์ที่กำลังยืมอยู่</p>
        </div>
        <div class="space-y-3 ">
          ${active.length ? active.map(r=>{
            const days = daysUntil(r.due_date);
            const isOD = r.status==='overdue';
            return `<div class="gd-card p-5 cursor-pointer ${isOD?'border-[#F7CFB1] bg-[#FFF7F0]':''}" onclick="openReturnDetail('${he(r.record_id)}')">
              <div class="flex items-center gap-3">
                <div style="width:36px; height:36px; min-width:36px; border-radius:8px; border:1px solid #E2E8F0; display:flex; align-items:center; justify-content:center; background:${isOD?'#FFF1E8':'#F1F5F9'};" class="shrink-0">
                  ${eqIconSvg(18, isOD?'#DC6B19':'#94A3B8')}
                </div>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center justify-between gap-2 mb-0.5">
                    <p class="eq-title truncate">${he(r.eq_name)}</p>
                    ${statusBadge(r.status)}
                  </div>
                  <p class="eq-meta">ผู้ยืม: ${he(r.borrower_name)} · รหัส: ${he(r.borrower_dept)}</p>
                  <div class="flex items-center justify-between text-sm mt-1.5">
                    <span class="text-gray-400">กำหนดคืน ${fd(r.due_date)}</span>
                    <span class="${isOD?'text-[#DC6B19] font-semibold':'text-gray-500'}">${isOD?'เกิน '+Math.abs(days)+' วัน':(days===0?'วันนี้':days+' วัน')}</span>
                  </div>
                </div>
              </div>
              ${r.qty_borrowed>1?`<p class="eq-meta mt-2 pl-13">จำนวน: ${r.qty_borrowed} ชิ้น</p>`:''}
            </div>`;
          }).join('') : emptyState('ยังไม่มีรายการยืม','รายการยืมอุปกรณ์จะปรากฏที่นี่','list','เริ่มยืม','switchTab(0)')}
        </div>
      </div>`;
      lucide.createIcons({'stroke-width': 1.5});
    }

    // ===== GA: RETURN DETAIL =====
    function setReturnCondition(val) {
      returnCondition = val;
      ['normal','damaged','lost'].forEach(c => {
        const btn = document.getElementById('rc-'+c);
        if (!btn) return;
        btn.classList.toggle('ring-2', c===val);
        btn.classList.toggle('ring-offset-1', c===val);
      });
      document.getElementById('rc-note-wrap').style.display = (val==='damaged'||val==='lost') ? 'block' : 'none';
    }
    function setServiceRating(val) {
      serviceRating = val;
      for (let i = 1; i <= 5; i++) {
        const s = document.getElementById('sr-star-' + i);
        if (s) s.style.color = i <= val ? '#f59e0b' : '#d1d5db';
      }
    }
    async function openReturnDetail(rid) {
      const rec = BORROWS.find(r=>r.record_id===rid);
      if (!rec) { toast('ไม่พบรายการ','error'); return; }
      // Signatures are not fetched in the list query (bandwidth); load on demand.
      if (rec.sign_img === undefined) {
        try {
          const sigs = await api('getBorrowSignatures', { record_id: rid });
          rec.sign_img = sigs?.sign_img || null;
          rec.return_sign_img = sigs?.return_sign_img || null;
        } catch (e) { rec.sign_img = null; rec.return_sign_img = null; }
      }
      currentReturnRecord = rec; returnCondition = ''; serviceRating = 0;
      document.getElementById('rd-eq-name').textContent = rec.eq_name;
      const isOD = rec.status === 'overdue';
      document.getElementById('rd-badge').innerHTML = statusBadge(rec.status);
      document.getElementById('rd-body').innerHTML = `
        <div class="gd-card p-5 mb-4">
          <h4 class="eq-title mb-3 flex items-center gap-2"><i data-lucide="clipboard-list" style="width:16px;height:16px;color:var(--orange);"></i> รายละเอียด</h4>
          <div class="space-y-2 text-base">
            <div class="flex justify-between"><span class="text-gray-400">อุปกรณ์</span><span class="font-medium">${he(rec.eq_name)}</span></div>
            <div class="flex justify-between"><span class="text-gray-400">จำนวน</span><span class="font-medium">${rec.qty_borrowed} ชิ้น</span></div>
            <div class="flex justify-between"><span class="text-gray-400">ผู้ยืม</span><span class="font-medium">${he(rec.borrower_name)}</span></div>
            <div class="flex justify-between"><span class="text-gray-400">รหัสพนักงาน</span><span class="font-medium">${he(rec.borrower_dept)}</span></div>
            <div class="flex justify-between"><span class="text-gray-400">วันที่ยืม</span><span class="font-medium">${fdFull(rec.borrowed_at)}</span></div>
            <div class="flex justify-between"><span class="text-gray-400">กำหนดคืน</span><span class="font-medium ${isOD?'text-red-600':''}">${fd(rec.due_date)}${isOD?' (เกินกำหนด!)':''}</span></div>
            ${rec.note?`<div class="flex justify-between"><span class="text-gray-400">หมายเหตุ</span><span class="font-medium">${he(rec.note)}</span></div>`:''}
          </div>
          ${rec.sign_img?`<div class="mt-3 pt-3 border-t border-gray-100"><p class="eq-meta mb-2">ลายเซ็นตอนยืม</p><img src="${safeImgUrl(rec.sign_img)}" alt="ลายเซ็นการยืม ${rec.borrower_name}" class="w-full h-20 object-contain bg-white rounded-lg border border-gray-200 p-1"></div>`:''}
        </div>
        <div class="gd-card p-5 mb-4">
          <h4 class="eq-title mb-3 flex items-center gap-2"><i data-lucide="clipboard-check" style="width:16px;height:16px;color:var(--orange);"></i> สภาพอุปกรณ์เมื่อคืน</h4>
          <div class="flex gap-2 mb-3">
            <button id="rc-normal" onclick="setReturnCondition('normal')"
              class="flex-1 py-2.5 rounded-xl border-2 border-green-300 bg-green-50 text-green-700 text-sm font-semibold transition ring-green-400 hover:bg-green-100">
              <span class="block text-base">✅</span>ปกติ</button>
            <button id="rc-damaged" onclick="setReturnCondition('damaged')"
              class="flex-1 py-2.5 rounded-xl border-2 border-amber-300 bg-amber-50 text-amber-700 text-sm font-semibold transition ring-amber-400 hover:bg-amber-100">
              <span class="block text-base">⚠️</span>ชำรุด</button>
            <button id="rc-lost" onclick="setReturnCondition('lost')"
              class="flex-1 py-2.5 rounded-xl border-2 border-red-300 bg-red-50 text-red-700 text-sm font-semibold transition ring-red-400 hover:bg-red-100">
              <span class="block text-base">❌</span>สูญหาย</button>
          </div>
          <div id="rc-note-wrap" style="opacity:0.6;">
            <textarea id="rc-note" rows="2" placeholder="ระบุรายละเอียด (เช่น รอยแตก, หายไปบางส่วน)"
              class="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-brand resize-none"></textarea>
          </div>
        </div>
        ${SETTINGS.require_return_rating ? `<div class="gd-card p-4 mb-4">
          <h4 class="text-base font-semibold text-gray-700 mb-2.5 flex items-center gap-2">
            <i data-lucide="star" style="width:14px;height:14px;color:#f59e0b;"></i>
            ประเมินบริการ <span class="text-gray-400 font-normal text-sm ml-1">(ไม่บังคับ)</span>
          </h4>
          <div class="flex justify-center gap-1 mb-2">
            ${[1,2,3,4,5].map(i=>`<button type="button" id="sr-star-${i}" onclick="setServiceRating(${i})"
              style="font-size:28px;color:#d1d5db;background:none;border:none;padding:2px 5px;cursor:pointer;line-height:1;transition:color 0.15s;">★</button>`).join('')}
          </div>
          <textarea id="rc-feedback" rows="2" placeholder="ข้อเสนอแนะ (ถ้ามี)..."
            class="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-brand resize-none"></textarea>
        </div>
        <div class="signature-pad mb-6">
          <div class="signature-pad__header">
            <span class="signature-pad__title">ลายเซ็นยืนยันคืน</span>
            <button onclick="clearSignCanvas('rdSignCanvas')" class="signature-pad__clear"><i data-lucide="eraser" class="w-[18px] h-[18px] text-[#64748B]"></i> ล้าง</button>
          </div>
          <div class="signature-pad__frame">
            <canvas id="rdSignCanvas" class="sig-canvas" style="width:100%;height:140px;"></canvas>
          </div>
          <p class="text-base text-gray-500 text-center mt-2 leading-snug">ข้าพเจ้ายืนยันว่าได้คืนอุปกรณ์ตามรายการข้างต้นเรียบร้อยแล้ว</p>
          <p class="eq-meta text-center mt-1">🔒 ลายเซ็นนี้ใช้เพื่อยืนยันการคืนอุปกรณ์ และถูกจัดเก็บอย่างปลอดภัยในระบบ</p>
        </div>` : ''}
        <button onclick="submitReturn()" id="rdSubmitBtn" class="w-full gd-btn-primary text-base font-semibold flex items-center justify-center gap-2">
          <i data-lucide="check" class="w-[18px] h-[18px] text-[#64748B]"></i> ยืนยันการคืน
        </button>`;
      goScreen('return-detail'); lucide.createIcons({'stroke-width': 1.5});
      if (SETTINGS.require_return_rating) setTimeout(()=>initSignCanvas('rdSignCanvas'), 100);
    }
    function closeReturnDetail() { currentReturnRecord=null; goScreen('main'); switchTab(1); }

    async function submitReturn() {
      if (!returnCondition) { toast('กรุณาเลือกสภาพอุปกรณ์ก่อนยืนยัน'); return; }
      if (SETTINGS.require_return_rating && isCanvasBlank()) { toast('กรุณาเซ็นลายเซ็นยืนยันคืน'); return; }
      const btn = document.getElementById('rdSubmitBtn');
      showConfirm({
        title: 'ยืนยันการคืน?',
        message: `${currentReturnRecord.eq_name} · สภาพ: ${returnCondition}`,
        icon: '✅', iconBg: '#DCFCE7', confirmText: 'ยืนยันการคืน', confirmColor: '#16A34A',
        onConfirm: async () => {
          btn.disabled = true; btn.textContent = 'กำลังบันทึก...';
          try {
            const canvas = SETTINGS.require_return_rating ? document.getElementById('rdSignCanvas') : null;
            const sig = canvas ? exportSignature(canvas) : null;
            const note = (document.getElementById('rc-note')?.value || '').trim();
            const feedback = (document.getElementById('rc-feedback')?.value || '').trim();
            await api('returnBorrow', {
              record_id: currentReturnRecord.record_id,
              return_sign_img: sig,
              condition_on_return: returnCondition,
              condition_note: note || null,
              service_rating: serviceRating || null,
              service_feedback: feedback || null
            });
            EQ = await api('getEquipment');
            BORROWS = await api('getBorrows', { name:CU.name, role:CU.role });
            toast('คืนอุปกรณ์เรียบร้อยแล้ว','success');
            closeReturnDetail();
          } catch(e) {
            console.error(e); toast('ไม่สามารถบันทึกข้อมูลได้','error');
            btn.disabled=false; btn.innerHTML='<i data-lucide="check" class="w-[18px] h-[18px] text-[#64748B]"></i> ยืนยันการคืน';
            btn.classList.add('gd-btn-primary'); lucide.createIcons({'stroke-width': 1.5});
          }
        }
      });
    }

    // ===== GA: HISTORY TAB =====
    function renderHistoryTab() {
      const sq = gaHistorySearch.toLowerCase();
      const list = BORROWS
        .filter(r => !historyFilter || r.status === historyFilter)
        .filter(r => !sq || (r.eq_name||'').toLowerCase().includes(sq));
      const el = document.getElementById('tab-history');
      el.innerHTML = `<div class="gd-container fade-in">
        <div class="gd-container-header">
          <div class="flex items-center justify-between">
            <div>
            <h2 class="page-title">ประวัติการยืม-คืน</h2></div>
            <button onclick="exportHistoryCSV('ga')" class="gd-btn-secondary gap-1.5">
              <i data-lucide="download" style="width:14px;height:14px;"></i> Export CSV</button>
          </div>
        </div>
        <input type="text" placeholder="ค้นหาชื่ออุปกรณ์..." value="${he(gaHistorySearch)}"
          oninput="gaHistorySearch=this.value;debounce('gaHistory',renderHistoryTab)"
          class="gd-input" style="margin-bottom:12px;">
        <div class="chip-row">
          <div class="chip ${historyFilter===''?'active':''}" onclick="historyFilter='';renderHistoryTab()">ทั้งหมด</div>
          <div class="chip ${historyFilter==='borrowed'?'active':''}" onclick="historyFilter='borrowed';renderHistoryTab()">กำลังยืม</div>
          <div class="chip ${historyFilter==='overdue'?'active':''}" onclick="historyFilter='overdue';renderHistoryTab()">เกินกำหนด</div>
          <div class="chip ${historyFilter==='returned'?'active':''}" onclick="historyFilter='returned';renderHistoryTab()">คืนแล้ว</div>
        </div>
        <div class="space-y-3 ">
          ${list.length ? list.map(r=>`<div class="gd-card" style="padding: 20px;">
            <div class="flex items-start justify-between mb-1">
              <p class="eq-title">${he(r.eq_name)}</p>
              <div class="flex items-center gap-1.5">${conditionBadge(r.condition_on_return)}${statusBadge(r.status)}</div>
            </div>
            <p class="eq-meta">ผู้ยืม: ${he(r.borrower_name)} · รหัส: ${he(r.borrower_dept)}</p>
            <div class="flex items-center justify-between eq-meta mt-2">
              <div><span>ยืม ${fd(r.borrowed_at)}</span><span class="mx-1">·</span><span>${r.status==='returned'?'คืน '+fd(r.returned_at):'กำหนดคืน '+fd(r.due_date)}</span></div>
              <button onclick="openRecordDetail('${he(r.record_id||r.id)}')" class="shrink-0 ml-2 px-2.5 py-1 rounded-lg text-sm font-medium flex items-center gap-1 transition-colors" style="border:1px solid var(--mf-border); color:var(--mf-text-2); background:var(--mf-card);"><i data-lucide="eye" class="w-[18px] h-[18px]" style="color:var(--mf-text-3);"></i><span class="hidden sm:inline">ดูรายละเอียด</span></button>
            </div>
            ${r.condition_note?`<p class="eq-meta">หมายเหตุสภาพ: ${he(r.condition_note)}</p>`:''}
          </div>`).join('') : emptyState('ยังไม่มีประวัติ','บันทึกการยืม-คืนจะปรากฏที่นี่','list','ยืมอุปกรณ์เลย →','switchTab(0)')}
        </div>
      </div>`;
      lucide.createIcons({'stroke-width': 1.5});
    }

    // ===== MGR: DASHBOARD =====
    async function renderDashboard() {
      BORROWS = await api('getBorrows', { name: CU.name, role: CU.role });
      const totalBorrowed = BORROWS.filter(r=>r.status==='borrowed'||r.status==='overdue').length;
      const overdueList = [...BORROWS.filter(r=>r.status==='overdue')].sort((a,b)=>new Date(a.due_date)-new Date(b.due_date));
      const today = new Date().toISOString().slice(0,10);
      const returnedToday = BORROWS.filter(r=>r.status==='returned'&&r.returned_at&&r.returned_at.slice(0,10)===today).length;
      const availableEq = EQ.filter(e=>e.available>0).length;
      const recent = [...BORROWS].sort((a,b)=>new Date(b.borrowed_at)-new Date(a.borrowed_at)).slice(0,10);
      const rated = BORROWS.filter(r=>r.service_rating);
      const avgRating = rated.length ? (rated.reduce((s,r)=>s+r.service_rating,0)/rated.length).toFixed(1) : null;
      const ratingDist = [5,4,3,2,1].map(s=>({ star:s, count:rated.filter(r=>r.service_rating===s).length }));
      const recentFeedback = [...BORROWS].filter(r=>r.service_rating&&r.service_feedback)
        .sort((a,b)=>new Date(b.returned_at||b.borrowed_at)-new Date(a.returned_at||a.borrowed_at)).slice(0,3);

      const el = document.getElementById('tab-dashboard');
      el.innerHTML = `<div class="gd-container fade-in">
        <div class="gd-container-header">
          
          <h2 class="page-title">ภาพรวมระบบ</h2>
        </div>
        <div class="dash-kpi-grid">
          <div class="kpi-card orange">
            <div style="width:32px;height:32px;border-radius:8px;background:var(--orange-light);display:flex;align-items:center;justify-content:center;margin-bottom:8px;"><i data-lucide="clock-3" style="width:20px;height:20px;color:var(--orange);"></i></div>
            <p class="kpi-number" id="dkpi1">0</p><p class="kpi-label">กำลังยืม</p></div>
          <div class="kpi-card danger">
            <div style="width:32px;height:32px;border-radius:8px;background:var(--danger-bg);display:flex;align-items:center;justify-content:center;margin-bottom:8px;"><i data-lucide="alert-triangle" style="width:20px;height:20px;color:#DC6B19;"></i></div>
            <p class="kpi-number" id="dkpi2">0</p><p class="kpi-label">เกินกำหนด</p></div>
          <div class="kpi-card success">
            <div style="width:32px;height:32px;border-radius:8px;background:var(--success-bg);display:flex;align-items:center;justify-content:center;margin-bottom:8px;"><i data-lucide="check-circle" style="width:20px;height:20px;color:var(--success-text);"></i></div>
            <p class="kpi-number" id="dkpi3">0</p><p class="kpi-label">คืนวันนี้</p></div>
          <div class="kpi-card orange">
            <div style="width:32px;height:32px;border-radius:8px;background:var(--orange-light);display:flex;align-items:center;justify-content:center;margin-bottom:8px;"><i data-lucide="box" style="width:20px;height:20px;color:var(--orange);"></i></div>
            <p class="kpi-number" id="dkpi4">0</p><p class="kpi-label">อุปกรณ์พร้อมใช้</p></div>
        </div>
        <div class="card mb-5">
          <h4 class="section-title mb-4" style="color:#E86B00;">รายการเกินกำหนด</h4>
          ${overdueList.length ? overdueList.map(r=>`<div class="flex items-center gap-3 py-2.5 border-b border-gray-100 last:border-0 text-base">
            <div class="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center shrink-0"><i data-lucide="alert-triangle" class="w-[18px] h-[18px] text-[#64748B]"></i></div>
            <div class="flex-1 min-w-0">
              <p class="text-base font-medium text-gray-900 truncate">${he(r.eq_name)}</p>
              <p class="eq-meta">${he(r.borrower_name)} · เกิน ${Math.abs(daysUntil(r.due_date))} วัน</p>
            </div>
            <button data-rid="${he(r.record_id||r.id||'')}" onclick="returnByManager(this.dataset.rid)"
              class="shrink-0 px-2.5 py-1.5 text-white text-sm font-semibold rounded-lg transition flex items-center gap-1" style="background:#f97316;color:white;"><i data-lucide="corner-up-left" class="w-[18px] h-[18px] text-[#64748B]"></i><span class="hidden sm:inline">คืนแทน</span></button>
          </div>`).join('') : emptyState('ไม่มีรายการเกินกำหนด','ทุกอุปกรณ์อยู่ในสถานะปกติ','check')}
        </div>
        <div class="card mb-5">
          <div class="flex items-center justify-between mb-4">
            <h4 class="section-title">กิจกรรมล่าสุด</h4>
            <button onclick="switchTab(2)" class="text-sm font-medium" style="color:#E86B00;">ดูทั้งหมด →</button>
          </div>
          ${recent.length ? recent.map(r=>{
            const isRet = r.status==='returned';
            return `<div class="flex items-center gap-3 py-2 border-b border-gray-100 last:border-0">
              <div class="w-7 h-7 rounded-full flex items-center justify-center shrink-0" style="background:${isRet?'var(--success-bg)':'var(--orange-light)'};">
                <i data-lucide="${isRet?'corner-up-left':'corner-down-right'}" style="width:14px;height:14px;color:${isRet?'var(--success-text)':'var(--orange)'};"></i></div>
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium text-gray-800 truncate">${he(r.eq_name)} · ${he(r.borrower_name)}</p>
                <p class="eq-meta">GA: ${he(r.ga_staff||'—')} · ${fd(isRet?r.returned_at:r.borrowed_at)}</p>
              </div>
              ${statusBadge(r.status)}
            </div>`;
          }).join('') : `<p class="eq-meta text-center py-4">ไม่มีกิจกรรม</p>`}
        </div>
        <div class="card mb-5">
          <h4 class="eq-title mb-3 flex items-center gap-2">
            <i data-lucide="star" style="width:16px;height:16px;color:#f59e0b;"></i>
            ประเมินบริการ
            ${avgRating ? `<span class="text-amber-500 font-bold ml-1">${avgRating}</span><span class="text-gray-400 text-sm font-normal ml-1">(${rated.length} ครั้ง)</span>` : ''}
          </h4>
          ${rated.length ? `
          <div class="space-y-1.5 mb-4">
            ${ratingDist.map(d=>{
              const pct = Math.round(d.count/rated.length*100);
              return `<div class="flex items-center gap-2 text-sm">
                <span class="text-amber-400 w-5 text-right shrink-0">${d.star}★</span>
                <div class="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                  <div class="h-2 rounded-full bg-amber-400" style="width:${pct}%"></div>
                </div>
                <span class="text-gray-500 w-5 text-right shrink-0">${d.count}</span>
              </div>`;
            }).join('')}
          </div>
          ${recentFeedback.length ? `<div class="border-t border-gray-100 pt-3">
            <p class="eq-meta mb-2">ความคิดเห็นล่าสุด</p>
            ${recentFeedback.map(r=>`<div class="py-2 border-b border-gray-50 last:border-0">
              <div class="flex items-center gap-1.5 mb-0.5">
                <span class="text-amber-400 text-sm leading-none">${'★'.repeat(r.service_rating)}${'☆'.repeat(5-r.service_rating)}</span>
                <span class="text-sm text-gray-500">${he(r.borrower_name)}</span>
              </div>
              <p class="text-sm text-gray-700">${he(r.service_feedback)}</p>
            </div>`).join('')}
          </div>` : ''}
          ` : emptyState('ยังไม่มีการประเมิน','ข้อมูลจะปรากฏเมื่อมีการประเมินบริการ','star')}
        </div>
      </div>`;
      lucide.createIcons({'stroke-width': 1.5});
      countUp(document.getElementById('dkpi1'), totalBorrowed);
      countUp(document.getElementById('dkpi2'), overdueList.length);
      countUp(document.getElementById('dkpi3'), returnedToday);
      countUp(document.getElementById('dkpi4'), availableEq);
    }
    // ===== MGR: RETURN ON BEHALF =====
    function returnByManager(recordId) {
      const r = BORROWS.find(b => (b.record_id||b.id) === recordId);
      if (!r) { toast('ไม่พบข้อมูลการยืม','error'); return; }
      const overdueDays = daysUntil(r.due_date);
      const isOverdue = overdueDays < 0;
      const duePart = isOverdue ? `${fd(r.due_date)} (เกิน ${Math.abs(overdueDays)} วัน)` : fd(r.due_date);
      showConfirm({
        title: 'คืนแทน GA Staff?',
        message: `${r.eq_name} · ผู้ยืม: ${r.borrower_name} · กำหนดคืน: ${duePart}`,
        icon: '📦', iconBg: '#DCFCE7', confirmText: 'ยืนยันคืน', confirmColor: '#16A34A',
        onConfirm: () => executeMgrReturn(recordId)
      });
    }
    async function executeMgrReturn(recordId) {
      try {
        await api('returnByManager', { record_id: recordId });
        EQ = await api('getEquipment');
        BORROWS = await api('getBorrows', { name: CU.name, role: CU.role });
        toast('คืนอุปกรณ์เรียบร้อยแล้ว','success');
        renderDashboard();
      } catch(e) { console.error(e); toast('เกิดข้อผิดพลาด','error'); }
    }

    // ===== MGR: ALL HISTORY =====
    function renderMgrHistory() {
      const gaStaffs = [...new Set(BORROWS.map(r=>r.ga_staff).filter(Boolean))].sort();
      const sq = mgrHistorySearch.toLowerCase();
      const list = BORROWS
        .filter(r => !historyFilter || r.status === historyFilter)
        .filter(r => !sq || (r.eq_name||'').toLowerCase().includes(sq) || (r.borrower_name||'').toLowerCase().includes(sq))
        .filter(r => !mgrHistoryGa || r.ga_staff === mgrHistoryGa)
        .filter(r => !mgrHistoryFrom || (r.borrowed_at||'') >= mgrHistoryFrom)
        .filter(r => !mgrHistoryTo || (r.borrowed_at||'').slice(0,10) <= mgrHistoryTo);
      const selectCls = 'gd-filter-input';
      const el = document.getElementById('tab-mgr-history');
      el.innerHTML = `<div class="gd-container fade-in">
        <div class="gd-container-header">
          <div class="flex items-center justify-between">
            <div>
            <h2 class="page-title">ประวัติทั้งหมด</h2></div>
            <button onclick="exportHistoryCSV('mgr')" class="gd-btn-secondary gap-1.5">
              <i data-lucide="download" style="width:14px;height:14px;"></i> Export CSV</button>
          </div>
        </div>
        <input type="text" placeholder="ค้นหาชื่ออุปกรณ์ หรือผู้ยืม..." value="${he(mgrHistorySearch)}"
          oninput="mgrHistorySearch=this.value;debounce('mgrHistory',renderMgrHistory)"
          class="gd-input" style="margin-bottom:8px;">
        <div class="chip-row" style="margin-bottom:12px;">
          <select onchange="mgrHistoryGa=this.value;renderMgrHistory()" class="${selectCls} shrink-0">
            <option value="">GA ทั้งหมด</option>
            ${gaStaffs.map(g=>`<option value="${he(g)}" ${mgrHistoryGa===g?'selected':''}>${he(g)}</option>`).join('')}
          </select>
          <input type="date" value="${mgrHistoryFrom}" onchange="mgrHistoryFrom=this.value;renderMgrHistory()" class="${selectCls} shrink-0" title="ตั้งแต่วันที่">
          <input type="date" value="${mgrHistoryTo}" onchange="mgrHistoryTo=this.value;renderMgrHistory()" class="${selectCls} shrink-0" title="ถึงวันที่">
          ${(mgrHistoryGa||mgrHistoryFrom||mgrHistoryTo)?`<button onclick="mgrHistoryGa='';mgrHistoryFrom='';mgrHistoryTo='';renderMgrHistory()" class="eq-meta hover:text-danger px-1 shrink-0">ล้าง</button>`:''}
        </div>
        <div class="chip-row">
          <div class="chip ${historyFilter===''?'active':''}" onclick="historyFilter='';renderMgrHistory()">ทั้งหมด</div>
          <div class="chip ${historyFilter==='borrowed'?'active':''}" onclick="historyFilter='borrowed';renderMgrHistory()">กำลังยืม</div>
          <div class="chip ${historyFilter==='overdue'?'active':''}" onclick="historyFilter='overdue';renderMgrHistory()">เกินกำหนด</div>
          <div class="chip ${historyFilter==='returned'?'active':''}" onclick="historyFilter='returned';renderMgrHistory()">คืนแล้ว</div>
        </div>
        <div class="space-y-3 ">
          ${list.length ? list.map(r=>`<div class="gd-card" style="padding: 20px;">
            <div class="flex items-start justify-between mb-1">
              <p class="eq-title">${he(r.eq_name)}</p>
              <div class="flex items-center gap-1.5">${conditionBadge(r.condition_on_return)}${statusBadge(r.status)}</div>
            </div>
            <p class="eq-meta">ผู้ยืม: ${he(r.borrower_name)} · รหัส: ${he(r.borrower_dept)} · GA: ${he(r.ga_staff)}</p>
            <div class="flex items-center justify-between eq-meta mt-2">
              <div><span>ยืม ${fd(r.borrowed_at)}</span><span class="mx-1">·</span><span>${r.status==='returned'?'คืน '+fd(r.returned_at):'กำหนดคืน '+fd(r.due_date)}</span></div>
              <button onclick="openRecordDetail('${he(r.record_id||r.id)}')" class="shrink-0 ml-2 px-2.5 py-1 rounded-lg text-sm font-medium flex items-center gap-1 transition-colors" style="border:1px solid var(--mf-border); color:var(--mf-text-2); background:var(--mf-card);"><i data-lucide="eye" class="w-[18px] h-[18px]" style="color:var(--mf-text-3);"></i><span class="hidden sm:inline">ดูรายละเอียด</span></button>
            </div>
            ${r.condition_note?`<p class="eq-meta">หมายเหตุสภาพ: ${he(r.condition_note)}</p>`:''}
          </div>`).join('') : emptyState('ไม่พบรายการ','ลองเปลี่ยนตัวกรองหรือช่วงวันที่','search')}
        </div>
      </div>`;
      lucide.createIcons({'stroke-width': 1.5});
    }

    // ===== MGR: EQUIPMENT TAB =====
    function renderEquipmentTab() {
      const el = document.getElementById('tab-equipment');
      const cats = CATS.map(c => c.name);
      const q = eqSearch.toLowerCase();
      const filtered = EQ.filter(e => {
        const matchSearch = !q || (e.name||'').toLowerCase().includes(q) || (e.serial_no||'').toLowerCase().includes(q);
        const matchCat = !eqCatFilter || e.category === eqCatFilter;
        return matchSearch && matchCat;
      });
      const eqEmptyState = eqCatFilter
        ? `<p style="font-size:14px;color:#78716C;text-align:center;padding:24px 12px;">ไม่มีอุปกรณ์ในหมวด "${he(eqCatFilter)}"</p>`
        : `<div style="text-align:center;padding:24px 12px;color:#a8a29e;font-size:13px;">ไม่พบอุปกรณ์</div>`;
      el.innerHTML = `<div class="gd-container fade-in">
        <div class="eq-split-panel">
          <!-- LEFT: original logic unchanged -->
          <div class="eq-left-panel" id="eqLeftPanel">
            <div class="flex items-center justify-between mb-3">
              <h4 class="eq-title">รายการอุปกรณ์ <span class="text-gray-400 font-normal">(${filtered.length}/${EQ.length})</span></h4>
              <button onclick="showAddEquipment()" class="flex items-center gap-1.5 px-3 py-1.5 text-white text-sm font-semibold rounded-lg transition shadow-sm" style="background:#f97316;color:white;">
                <i data-lucide="plus" class="w-[18px] h-[18px] text-[#64748B]"></i> เพิ่มอุปกรณ์</button>
            </div>
            <div class="availability-legend">
              <span><span class="legend-dot green"></span>พร้อมใช้</span>
              <span><span class="legend-dot amber"></span>เกือบหมด</span>
              <span><span class="legend-dot red"></span>หมด</span>
            </div>
            <div class="flex flex-col sm:flex-row gap-2 mb-4">
              <div class="relative flex-1">
                <i data-lucide="search" class="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none"></i>
                <input id="eqSearchInput" type="text" placeholder="ค้นหาชื่อหรือ Serial No." value="${he(eqSearch)}"
                  oninput="eqSearch=this.value;debounce('eqSearch',renderEquipmentTab)"
                  class="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-brand">
              </div>
              <select id="eqCatSelect" onchange="eqCatFilter=this.value;renderEquipmentTab()"
                class="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-1 focus:ring-brand text-gray-700 w-full sm:w-auto sm:min-w-[110px]">
                <option value="">ทุกหมวด</option>
                ${cats.map(c=>`<option value="${he(c)}"${eqCatFilter===c?' selected':''}>${he(c)}</option>`).join('')}
              </select>
            </div>
            <div class="space-y-3 mb-6">
              ${filtered.length === 0 ? eqEmptyState :
              filtered.map(e=>`<div class="gd-card" data-eqid="${he(e.eq_id)}"
                onclick="selectEquipment('${he(e.eq_id)}')"
                style="padding:20px;cursor:pointer;${selectedEquipmentId===e.eq_id?'border:1.5px solid #f97316;background:#fff7ed;':''}">
                <div class="flex items-center gap-3">
                  ${e.image_url ? `<img src="${he(e.image_url)}" alt="${he(e.name)}" class="w-11 h-11 object-cover rounded-xl border border-gray-200 shrink-0"/>` : `<div style="width:44px;height:44px;border-radius:12px;background:#F1F5F9;border:1px solid #E2E8F0;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${eqIconSvg(22)}</div>`}
                  <div class="flex-1 min-w-0">
                    <p class="eq-title">${he(e.name)}</p>
                    <p class="eq-meta">${he(e.category||'ไม่ระบุ')}${e.serial_no?' · '+he(e.serial_no):''}</p>
                  </div>
                  <div class="flex flex-col items-end gap-1 shrink-0">
                    <span class="text-sm px-2.5 py-1 rounded-full font-semibold" style="background:${e.available===0?'var(--danger-bg)':e.available<e.quantity?'#fef3c7':'var(--orange-light)'};color:${e.available===0?'var(--danger-text)':e.available<e.quantity?'#d97706':'var(--orange-dark)'};border:0.5px solid ${e.available===0?'#fecaca':e.available<e.quantity?'#fde68a':'var(--orange-border)'};">
                      ${e.available}/${e.quantity}
                    </span>
                    <div class="flex gap-0.5 mt-1">
                      <button data-id="${he(e.eq_id)}" onclick="event.stopPropagation();showEditEquipment(this.dataset.id)" class="p-1.5 rounded-lg text-gray-300 hover:bg-orange-50" style="transition:all 150ms;" onmouseover="this.querySelector('i').style.color='var(--orange)'" onmouseout="this.querySelector('i').style.color=''"><i data-lucide="pencil" class="w-[18px] h-[18px] text-[#64748B]"></i></button>
                      <button data-id="${he(e.eq_id)}" onclick="event.stopPropagation();confirmDeleteEquip(this.dataset.id)" class="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50"><i data-lucide="trash-2" class="w-[18px] h-[18px] text-[#64748B]"></i></button>
                    </div>
                  </div>
                </div>
              </div>`).join('')}
            </div>
            <!-- ===== CATEGORY MANAGEMENT ===== -->
            <div class="gd-card" style="padding: 20px;">
              <div class="flex items-center justify-between mb-3">
                <h4 class="section-title" style="font-size:16px;font-weight:600;color:#1C1917;">หมวดหมู่</h4>
                ${_addCatMode ? '' : `<button onclick="showAddCatInput()" class="gd-btn-secondary flex items-center gap-1 !w-auto !py-1.5 !px-2.5 text-sm font-semibold">
                  <i data-lucide="plus" class="w-[18px] h-[18px] text-[#64748B]"></i> เพิ่มหมวดหมู่</button>`}
              </div>
              ${_addCatMode ? `<div class="flex gap-2 mb-3">
                <input id="newCatInput" type="text" placeholder="ชื่อหมวดหมู่ใหม่" maxlength="50"
                  class="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-brand"
                  onkeydown="if(event.key==='Enter')saveCategory();if(event.key==='Escape')cancelAddCat()">
                <button onclick="saveCategory()" class="gd-btn-primary !w-auto !py-1.5 !px-3 text-sm font-semibold">บันทึก</button>
                <button onclick="cancelAddCat()" class="px-3 py-2 text-sm text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 transition">ยกเลิก</button>
              </div>` : ''}
              ${CATS.length === 0 ? `<p class="eq-meta text-center py-4">ยังไม่มีหมวดหมู่ กด "+ เพิ่มหมวดหมู่" เพื่อเริ่มต้น</p>` :
              `<div class="space-y-1.5">
                ${CATS.map(c => {
                  const inUse = EQ.some(e => e.category === c.name);
                  return `<div class="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-slate-50">
                    <span class="text-base text-gray-700">${he(c.name)}</span>
                    <button data-id="${he(c.id)}" data-name="${he(c.name)}"
                      onclick="deleteCategoryById(this.dataset.id,this.dataset.name)"
                      class="p-1.5 rounded-lg transition ${inUse ? 'text-gray-200 cursor-not-allowed' : 'text-gray-300 hover:text-red-500 hover:bg-red-50'}"
                      ${inUse ? 'disabled title="มีอุปกรณ์ใช้หมวดหมู่นี้อยู่"' : 'title="ลบหมวดหมู่"'}>
                      <i data-lucide="trash-2" class="w-[18px] h-[18px] text-[#64748B]"></i>
                    </button>
                  </div>`;
                }).join('')}
              </div>`}
            </div>
          </div>
          <!-- RIGHT: empty state shell (wired in next step) -->
          <div class="eq-right-panel" id="eqRightPanel">
            <div id="eqEmptyDetail" class="eq-empty-detail">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#FDBA74" stroke-width="1.5">
                <path d="M20 7H4a2 2 0 00-2 2v6a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z"/>
                <path d="M12 12h.01"/>
              </svg>
              <p>เลือกอุปกรณ์เพื่อดูรายละเอียด</p>
            </div>
            <div id="eqDetailContent" style="display:none"></div>
          </div>
        </div>
      </div>`;
      lucide.createIcons({'stroke-width': 1.5});
      if (_addCatMode) setTimeout(()=>document.getElementById('newCatInput')?.focus(), 50);
    }

    // ===== SELECT EQUIPMENT → RIGHT PANEL ====
    async function selectEquipment(equipmentId) {
      selectedEquipmentId = equipmentId;
      // Update active state on all cards
      document.querySelectorAll('[data-eqid]').forEach(el => {
        const active = el.dataset.eqid === equipmentId;
        el.style.border = active ? '1.5px solid #f97316' : '';
        el.style.background = active ? '#fff7ed' : '';
      });
      const equipment = EQ.find(e => e.eq_id === equipmentId);
      if (!equipment) return;
      const { data: units } = await sb.from('equipment_units')
        .select('*')
        .eq('equipment_id', equipmentId)
        .order('unit_code');
      renderUnitDetail(equipment, units || []);
      document.getElementById('eqRightPanel')?.classList.add('mobile-open');
    }

    function renderUnitDetail(equipment, units) {
      document.getElementById('eqEmptyDetail').style.display = 'none';
      const content = document.getElementById('eqDetailContent');
      content.style.display = 'block';
      const avail   = units.filter(u => u.status === 'available').length;
      const borrowed = units.filter(u => u.status === 'borrowed').length;
      const damaged  = units.filter(u => u.status === 'damaged').length;
      const eqId   = he(equipment.eq_id);
      const eqName = he(equipment.name);
      content.innerHTML = `
        <button class="eq-mobile-back" onclick="document.getElementById('eqRightPanel').classList.remove('mobile-open')">← กลับ</button>
        <div class="eq-detail-header">
          <div>
            <p class="eq-detail-title">${eqName}</p>
            <div style="display:flex;gap:6px;margin-top:4px;flex-wrap:wrap">
              <span class="eq-tag t-green">${avail} ว่าง</span>
              ${borrowed > 0 ? `<span class="eq-tag t-blue">${borrowed} ยืม</span>` : ''}
              ${damaged  > 0 ? `<span class="eq-tag t-amber">${damaged} ชำรุด</span>` : ''}
            </div>
          </div>
          <div class="eq-detail-actions">
            <button onclick="openAddUnitModal('${eqId}','${eqName}')" class="btn-primary-sm">+ เพิ่ม unit</button>
            <button onclick="printAllUnits('${eqId}')" class="mini-btn-gray">พิมพ์ทั้งหมด</button>
            <button onclick="event.stopPropagation();showEditEquipment('${eqId}')" class="mini-btn-gray">แก้ไข</button>
            <button onclick="event.stopPropagation();confirmDeleteEquip('${eqId}')" class="mini-btn-gray" style="color:#ef4444">ลบ</button>
          </div>
        </div>
        <div id="batchBar" style="display:none;background:#fff7ed;border:0.5px solid #fed7aa;border-radius:8px;padding:8px 12px;margin-bottom:10px;align-items:center;gap:8px;flex-wrap:wrap">
          <input type="checkbox" id="selectAllUnits" onchange="toggleSelectAll(this.checked)" title="เลือกทั้งหมด" style="width:15px;height:15px;accent-color:#f97316;cursor:pointer;flex-shrink:0">
          <span style="font-size:12px;font-weight:600;color:#c2410c;flex:1;min-width:80px" id="selectedCount">เลือก 0 รายการ</span>
          <button onclick="batchPrintSelected('${eqId}')" class="mini-btn-orange">พิมพ์ที่เลือก</button>
          <button onclick="batchEditStatus()" class="mini-btn-gray">เปลี่ยนสถานะ</button>
        </div>
        <div id="unitList">
          ${units.length === 0
            ? `<div style="text-align:center;padding:40px 0">
                 <p style="color:#a8a29e;font-size:13px">ยังไม่มี unit</p>
                 <button onclick="openAddUnitModal('${eqId}','${eqName}')" class="btn-primary-sm" style="margin-top:8px">+ เพิ่ม unit แรก</button>
               </div>`
            : units.map(renderUnitRow).join('')}
        </div>`;
    }

    function renderUnitRow(unit) {
      const br  = unit.borrow_records?.[0];
      const uid = he(unit.id);
      const uc  = he(unit.unit_code);
      const badge = {
        available: `<span class="eq-tag t-green">ว่าง</span>`,
        borrowed:  `<span class="eq-tag t-blue">ยืม${br ? ` — ${he(br.borrower_name)}` : ''}</span>`,
        damaged:   `<span class="eq-tag t-amber">ชำรุด</span>`,
        lost:      `<span class="eq-tag t-red">สูญหาย</span>`
      }[unit.status] || '';
      const acts = {
        available: `<button onclick="openQRModal('${uid}','${uc}')"              class="mini-btn-gray">QR</button>
                    <button onclick="openUnitHistory('${uid}')"                  class="mini-btn-gray">ประวัติ</button>
                    <button onclick="openEditUnitModal('${uid}')"                class="mini-btn-gray">แก้ไข</button>
                    <button onclick="deleteUnit('${uid}','${uc}')"               class="mini-btn-gray" style="color:#ef4444">ลบ</button>`,
        borrowed:  `<button onclick="openQRModal('${uid}','${uc}')"              class="mini-btn-gray">QR</button>
                    <button onclick="openUnitHistory('${uid}')"                  class="mini-btn-gray">ประวัติ</button>
                    <button onclick="returnUnitByManager('${uid}')"              class="mini-btn-orange">คืน</button>`,
        damaged:   `<button onclick="openQRModal('${uid}','${uc}')"              class="mini-btn-gray">QR</button>
                    <button onclick="openEditUnitModal('${uid}')"                class="mini-btn-orange">แก้ไข</button>
                    <button onclick="deleteUnit('${uid}','${uc}')"               class="mini-btn-gray" style="color:#ef4444">ลบ</button>`,
        lost:      `<button onclick="openEditUnitModal('${uid}')"                class="mini-btn-orange">แก้ไข</button>
                    <button onclick="deleteUnit('${uid}','${uc}')"               class="mini-btn-gray" style="color:#ef4444">ลบ</button>`
      }[unit.status] || '';
      return `<div class="unit-row ${unit.status}" data-unit-id="${uid}">
        <input type="checkbox" class="unit-checkbox" onchange="onUnitCheckChange()" value="${uid}">
        <span class="unit-dot ${unit.status}"></span>
        <span class="unit-code">${uc}</span>
        ${badge}
        <div style="display:flex;gap:4px;margin-left:auto">${acts}</div>
      </div>`;
    }

    function onUnitCheckChange() {
      const all     = document.querySelectorAll('.unit-checkbox');
      const checked = [...all].filter(cb => cb.checked).length;
      const bar     = document.getElementById('batchBar');
      const cnt     = document.getElementById('selectedCount');
      const selAll  = document.getElementById('selectAllUnits');
      if (cnt)    cnt.textContent = `เลือก ${checked} รายการ`;
      if (selAll) { selAll.checked = checked === all.length && all.length > 0; selAll.indeterminate = checked > 0 && checked < all.length; }
      if (bar)    bar.style.display = checked > 0 ? 'flex' : 'none';
    }
    function toggleSelectAll(checked) {
      document.querySelectorAll('.unit-checkbox').forEach(cb => cb.checked = checked);
      onUnitCheckChange();
    }
    function batchEditStatus() { toast('coming soon: เปลี่ยนสถานะหลายรายการ', 'info'); }

    // Stubs — implemented in later steps
    function openAddUnitModal(eqId, eqName) {
      document.getElementById('addUnitModal')?.remove();
      const defaultPrefix = (eqName || '')
        .toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 12);
      const modal = document.createElement('div');
      modal.id = 'addUnitModal';
      modal.style.cssText = 'position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);backdrop-filter:blur(4px)';
      modal.innerHTML = `
        <div class="gd-modal-panel" style="max-width:360px;width:calc(100% - 32px)">
          <h3 style="font-size:16px;font-weight:700;color:#1c1917;margin:0 0 4px">เพิ่ม unit</h3>
          <p style="font-size:12px;color:#a8a29e;margin:0 0 16px">${he(eqName)}</p>
          <div style="display:flex;flex-direction:column;gap:12px">
            <div>
              <label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Prefix</label>
              <input id="unitPrefix" type="text" value="${he(defaultPrefix)}" maxlength="20" placeholder="เช่น NB-001" class="gd-input">
            </div>
            <div>
              <label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">จำนวน unit</label>
              <input id="unitCount" type="number" value="1" min="1" max="50" class="gd-input">
            </div>
            <div id="unitPreview" style="min-height:20px;font-size:11px;color:#78716c;font-family:'Courier New',monospace;background:#fafaf9;border-radius:8px;padding:8px 10px"></div>
          </div>
          <div style="display:flex;gap:8px;margin-top:20px">
            <button id="createUnitBtn" onclick="submitCreateUnits('${he(eqId)}')" class="btn-primary-sm" style="flex:1">สร้าง unit</button>
            <button onclick="document.getElementById('addUnitModal').remove()" class="mini-btn-gray" style="flex:1;padding:7px 14px;font-size:13px">ยกเลิก</button>
          </div>
        </div>`;
      document.body.appendChild(modal);
      modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
      const updatePreview = () => {
        const prefix = (document.getElementById('unitPrefix')?.value || '').trim();
        const count  = Math.min(parseInt(document.getElementById('unitCount')?.value) || 1, 50);
        const p = document.getElementById('unitPreview');
        if (!p) return;
        if (!prefix) { p.textContent = ''; return; }
        const samples = Array.from({length: Math.min(count, 3)}, (_, i) =>
          `${prefix}-${String(i + 1).padStart(2, '0')}`);
        p.textContent = 'จะสร้าง: ' + samples.join(', ') + (count > 3 ? ', ...' : '');
      };
      document.getElementById('unitPrefix')?.addEventListener('input', updatePreview);
      document.getElementById('unitCount')?.addEventListener('input', updatePreview);
      updatePreview();
      setTimeout(() => document.getElementById('unitPrefix')?.select(), 50);
    }
    async function submitCreateUnits(equipmentId) {
      const prefix = (document.getElementById('unitPrefix')?.value || '').trim();
      const count  = Math.min(parseInt(document.getElementById('unitCount')?.value) || 1, 50);
      if (!prefix) { toast('กรุณากรอก prefix', 'warning'); return; }
      const btn = document.getElementById('createUnitBtn');
      if (btn) { btn.disabled = true; btn.textContent = 'กำลังสร้าง...'; }
      try {
        // Check capacity: total existing units vs equipment.quantity cap
        const equipment = EQ.find(e => e.eq_id === equipmentId);
        const cap = equipment?.quantity ?? Infinity;
        const { count: existingTotal } = await sb.from('equipment_units')
          .select('*', { count: 'exact', head: true })
          .eq('equipment_id', equipmentId);
        if ((existingTotal || 0) + count > cap) {
          const remaining = cap - (existingTotal || 0);
          toast(`เพิ่มได้อีกแค่ ${remaining} unit (จำนวนที่ตั้งไว้: ${cap})`, 'warning');
          if (btn) { btn.disabled = false; btn.textContent = 'สร้าง unit'; }
          return;
        }
        // Find highest existing running number for this prefix
        const { data: existing } = await sb.from('equipment_units')
          .select('unit_code')
          .eq('equipment_id', equipmentId)
          .like('unit_code', `${prefix}-%`);
        const maxNum = (existing || []).reduce((max, row) => {
          const n = parseInt(row.unit_code.slice(prefix.length + 1));
          return isNaN(n) ? max : Math.max(max, n);
        }, 0);
        const rows = Array.from({length: count}, (_, i) => ({
          equipment_id: equipmentId,
          unit_code:    `${prefix}-${String(maxNum + i + 1).padStart(2, '0')}`,
          status:       'available'
        }));
        const { error } = await sb.from('equipment_units').insert(rows);
        if (error) throw error;
        await logAction('UNIT_CREATE', 'equipment_units', equipmentId, null, { prefix, count });
        toast(`สร้าง ${count} unit เรียบร้อยแล้ว`, 'success');
        const reloadId = selectedEquipmentId || equipmentId;
        document.getElementById('addUnitModal')?.remove();
        await selectEquipment(reloadId);
      } catch(e) {
        console.error(e);
        toast('สร้าง unit ไม่สำเร็จ: ' + (e.message || e), 'error');
        if (btn) { btn.disabled = false; btn.textContent = 'สร้าง unit'; }
      }
    }
    function openQRModal(uid, uc) {
      document.getElementById('qrModal')?.remove();
      const equipment = EQ.find(e => e.eq_id === selectedEquipmentId);
      _qrModalCtx = { uc, eqName: equipment?.name || '' };
      const qrUrl = `${window.location.origin}${window.location.pathname}?unit=${encodeURIComponent(uc)}`;
      const modal = document.createElement('div');
      modal.id = 'qrModal';
      modal.style.cssText = 'position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);backdrop-filter:blur(4px)';
      modal.innerHTML = `
        <div style="background:#fff;border-radius:20px;padding:28px;width:320px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.3)">
          <h3 style="font-size:16px;font-weight:700;margin:0 0 4px;color:#1c1917">QR Code</h3>
          <p style="font-size:13px;color:#a8a29e;margin:0 0 16px">${he(equipment?.name || '')}</p>
          <div id="qrCodeDisplay" style="display:flex;justify-content:center;margin-bottom:12px;padding:16px;background:#f9f9f9;border-radius:12px"></div>
          <div style="background:#fafaf9;border-radius:8px;padding:8px 12px;margin-bottom:20px">
            <p style="font-size:11px;color:#a8a29e;margin:0 0 2px">Unit Code</p>
            <p style="font-size:14px;font-weight:600;color:#1c1917;font-family:'Courier New',monospace;margin:0">${he(uc)}</p>
          </div>
          <div style="display:flex;gap:8px">
            <button onclick="printQRLabel()" class="btn-primary-sm" style="flex:1">🖨 พิมพ์ label</button>
            <button onclick="downloadQRPng()" class="mini-btn-gray" style="flex:1;padding:7px 14px;font-size:12px">⬇ Download PNG</button>
          </div>
          <button onclick="document.getElementById('qrModal').remove()" style="margin-top:12px;background:none;border:none;color:#a8a29e;font-size:13px;cursor:pointer;font-family:'Prompt', sans-serif">ปิด</button>
        </div>`;
      document.body.appendChild(modal);
      modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
      new QRCode(document.getElementById('qrCodeDisplay'), {
        text: qrUrl, width: 200, height: 200,
        colorDark: '#1c1917', colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.H
      });
    }

    function printQRLabel() {
      const { uc, eqName } = _qrModalCtx;
      logAction('UNIT_PRINT', 'equipment_units', null, null, { unit_code: uc, eq_name: eqName });
      const qrUrl = `${window.location.origin}${window.location.pathname}?unit=${encodeURIComponent(uc)}`;
      const w = window.open('', '_blank');
      if (!w) { toast('กรุณาอนุญาต popup เพื่อพิมพ์', 'warning'); return; }
      w.document.write(`<!DOCTYPE html><html><head>
        <title>QR — ${uc}</title>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"><\/script>
        <style>
          @page{size:60mm 40mm;margin:0}
          *{box-sizing:border-box;margin:0;padding:0}
          html,body{width:60mm;height:40mm;overflow:hidden}
          body{display:flex;align-items:center;justify-content:center;font-family:sans-serif}
          .wrap{width:56mm;height:38mm;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0.8mm}
          #qr canvas,#qr img{width:28mm!important;height:28mm!important;display:block}
          .n{font-size:8pt;font-weight:bold;color:#111;text-align:center;max-width:54mm;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
          .c{font-size:7pt;color:#444;font-family:monospace;text-align:center}
          .b{font-size:6pt;color:#999;text-align:center}
        </style>
      </head><body>
        <div class="wrap">
          <div id="qr"></div>
          <p class="n">${eqName}</p>
          <p class="c">${uc}</p>
          <p class="b">GA Equipment Control</p>
        </div>
        <script>
          new QRCode(document.getElementById('qr'),{text:'${qrUrl}',width:106,height:106,colorDark:'#000',correctLevel:QRCode.CorrectLevel.H});
          setTimeout(()=>{window.print();window.close();},500);
        <\/script>
      </body></html>`);
      w.document.close();
    }

    function downloadQRPng() {
      const canvas = document.querySelector('#qrCodeDisplay canvas');
      if (!canvas) { toast('ไม่พบ QR Code', 'error'); return; }
      const link = document.createElement('a');
      link.download = `QR-${_qrModalCtx.uc}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    }

    function openEditUnitModal(unitId) {
      document.getElementById('editUnitModal')?.remove();
      const modal = document.createElement('div');
      modal.id = 'editUnitModal';
      modal.style.cssText = 'position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);backdrop-filter:blur(4px)';
      modal.innerHTML = `
        <div class="gd-modal-panel" style="max-width:360px;width:calc(100% - 32px)">
          <h3 style="font-size:16px;font-weight:700;color:#1c1917;margin:0 0 16px">แก้ไข Unit</h3>
          <div style="display:flex;flex-direction:column;gap:12px">
            <div>
              <label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">สถานะ</label>
              <select id="editUnitStatus" class="gd-input">
                <option value="available">ว่าง</option>
                <option value="damaged">ชำรุด</option>
                <option value="lost">สูญหาย</option>
              </select>
            </div>
            <div>
              <label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">หมายเหตุ</label>
              <textarea id="editUnitNotes" rows="3" class="gd-input" placeholder="หมายเหตุ (ถ้ามี)" style="resize:vertical"></textarea>
            </div>
          </div>
          <div style="display:flex;gap:8px;margin-top:20px">
            <button id="saveUnitBtn" onclick="submitEditUnit('${he(unitId)}')" class="btn-primary-sm" style="flex:1">บันทึก</button>
            <button onclick="document.getElementById('editUnitModal').remove()" class="mini-btn-gray" style="flex:1;padding:7px 14px;font-size:13px">ยกเลิก</button>
          </div>
        </div>`;
      document.body.appendChild(modal);
      modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
      sb.from('equipment_units').select('status,notes').eq('id', unitId).maybeSingle()
        .then(({ data }) => {
          if (!data) return;
          document.getElementById('editUnitStatus').value = data.status || 'available';
          document.getElementById('editUnitNotes').value = data.notes || '';
        });
    }

    async function submitEditUnit(unitId) {
      const status = document.getElementById('editUnitStatus')?.value;
      const notes  = document.getElementById('editUnitNotes')?.value.trim() || null;
      const btn = document.getElementById('saveUnitBtn');
      if (btn) { btn.disabled = true; btn.textContent = 'กำลังบันทึก...'; }
      try {
        const { data: old } = await sb.from('equipment_units').select('status,notes').eq('id', unitId).maybeSingle();
        const { error } = await sb.from('equipment_units').update({ status, notes }).eq('id', unitId);
        if (error) throw error;
        await logAction('UNIT_STATUS_UPDATE', 'equipment_units', unitId, old, { status, notes });
        toast('บันทึกเรียบร้อยแล้ว', 'success');
        document.getElementById('editUnitModal')?.remove();
        await selectEquipment(selectedEquipmentId);
      } catch(e) {
        console.error(e);
        toast('บันทึกไม่สำเร็จ: ' + (e.message || e), 'error');
        if (btn) { btn.disabled = false; btn.textContent = 'บันทึก'; }
      }
    }

    function returnUnitByManager(unitId) {
      showConfirm({
        title: 'คืนอุปกรณ์โดย Manager',
        message: 'ยืนยันการคืนอุปกรณ์แทน GA?',
        icon: '↩',
        confirmText: 'ยืนยันคืน',
        confirmColor: '#f97316',
        onConfirm: async () => {
          try {
            const { data: record } = await sb.from('borrow_records')
              .select('id')
              .eq('unit_id', unitId)
              .eq('status', 'borrowed')
              .maybeSingle();
            if (!record) { toast('ไม่พบรายการยืมที่ active', 'warning'); return; }
            const now = new Date().toISOString();
            const { error: e1 } = await sb.from('equipment_units')
              .update({ status: 'available' })
              .eq('id', unitId);
            if (e1) throw e1;
            const { error: e2 } = await sb.from('borrow_records')
              .update({ status: 'returned', returned_at: now })
              .eq('id', record.id);
            if (e2) {
              await sb.from('equipment_units').update({ status: 'borrowed' }).eq('id', unitId).catch(() => {});
              throw e2;
            }
            await logAction('RETURN_BY_MANAGER', 'borrow_records', record.id, { status: 'borrowed' }, { status: 'returned', returned_at: now });
            toast('คืนอุปกรณ์เรียบร้อยแล้ว', 'success');
            await selectEquipment(selectedEquipmentId);
          } catch(e) {
            console.error(e);
            toast('คืนไม่สำเร็จ: ' + (e.message || e), 'error');
          }
        }
      });
    }

    async function openUnitHistory(unitId) {
      document.getElementById('unitHistoryModal')?.remove();
      const modal = document.createElement('div');
      modal.id = 'unitHistoryModal';
      modal.style.cssText = 'position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);backdrop-filter:blur(4px)';
      modal.innerHTML = `
        <div class="gd-modal-panel" style="max-width:480px;width:calc(100% - 32px);max-height:80vh;overflow-y:auto">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
            <h3 style="font-size:16px;font-weight:700;color:#1c1917;margin:0">ประวัติการยืม</h3>
            <button onclick="document.getElementById('unitHistoryModal').remove()" style="background:none;border:none;color:#a8a29e;font-size:20px;cursor:pointer;line-height:1">×</button>
          </div>
          <div id="unitHistoryContent" style="font-size:13px;color:#a8a29e;text-align:center;padding:24px">กำลังโหลด...</div>
        </div>`;
      document.body.appendChild(modal);
      modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

      const { data: records } = await sb.from('borrow_records')
        .select('borrower_name, borrowed_at, due_date, returned_at, status, ga_staff')
        .eq('unit_id', unitId)
        .order('borrowed_at', { ascending: false });

      const content = document.getElementById('unitHistoryContent');
      if (!records?.length) {
        content.innerHTML = '<p style="color:#a8a29e;font-size:13px">ยังไม่เคยถูกยืม</p>';
        return;
      }
      const fmt = d => d ? new Date(d).toLocaleDateString('th-TH', { day:'numeric', month:'short', year:'2-digit' }) : '—';
      const statusBadge = s => s === 'returned'
        ? `<span class="eq-tag t-green">คืนแล้ว</span>`
        : `<span class="eq-tag t-blue">ยืมอยู่</span>`;
      content.innerHTML = records.map(r => `
        <div style="background:#fafaf9;border:0.5px solid #e7e5e4;border-radius:8px;padding:10px 12px;margin-bottom:8px;text-align:left">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
            <span style="font-weight:600;color:#1c1917">${he(r.borrower_name || '—')}</span>
            ${statusBadge(r.status)}
          </div>
          <div style="font-size:11px;color:#78716c;display:flex;gap:12px;flex-wrap:wrap">
            <span>ยืม: ${fmt(r.borrowed_at)}</span>
            <span>กำหนดคืน: ${fmt(r.due_date)}</span>
            ${r.returned_at ? `<span>คืนจริง: ${fmt(r.returned_at)}</span>` : ''}
            ${r.ga_staff ? `<span>GA: ${he(r.ga_staff)}</span>` : ''}
          </div>
        </div>`).join('');
    }

    async function printAllUnits(eqId) {
      const equipment = EQ.find(e => e.eq_id === eqId);
      const eqName = equipment?.name || '';
      const { data: units } = await sb.from('equipment_units')
        .select('unit_code').eq('equipment_id', eqId).order('unit_code');
      if (!units?.length) { toast('ยังไม่มี unit', 'warning'); return; }
      batchPrintLabels(units.map(u => ({ unit_code: u.unit_code, eqName })));
    }

    async function batchPrintSelected(eqId) {
      const checked = [...document.querySelectorAll('.unit-checkbox:checked')].map(cb => cb.value);
      if (!checked.length) { toast('เลือก unit ที่ต้องการพิมพ์ก่อน', 'warning'); return; }
      const equipment = EQ.find(e => e.eq_id === eqId);
      const eqName = equipment?.name || '';
      const { data: units } = await sb.from('equipment_units')
        .select('unit_code').in('id', checked);
      batchPrintLabels((units || []).map(u => ({ unit_code: u.unit_code, eqName })));
    }

    function batchPrintLabels(units) {
      logAction('UNIT_PRINT', 'equipment_units', null, null, { unit_codes: units.map(u => u.unit_code), count: units.length });
      const base = `${window.location.origin}${window.location.pathname}`;
      const labelsHTML = units.map(u => `
        <div class="label">
          <div id="qr-${u.unit_code}"></div>
          <p class="n">${u.eqName}</p><p class="c">${u.unit_code}</p>
          <p class="b">GA Equipment Control</p>
        </div>`).join('');
      const qrScripts = units.map(u =>
        `new QRCode(document.getElementById('qr-${u.unit_code}'),{text:'${base}?unit=${encodeURIComponent(u.unit_code)}',width:91,height:91,colorDark:'#000',correctLevel:QRCode.CorrectLevel.H});`
      ).join('\n');
      const w = window.open('', '_blank');
      if (!w) { toast('กรุณาอนุญาต popup เพื่อพิมพ์', 'warning'); return; }
      w.document.write(`<!DOCTYPE html><html><head>
        <title>Batch QR Labels</title>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"><\/script>
        <style>
          @page{margin:5mm}body{margin:0;font-family:sans-serif}
          .grid{display:flex;flex-wrap:wrap;gap:2mm}
          .label{width:60mm;height:40mm;padding:3mm;display:flex;flex-direction:column;align-items:center;justify-content:center;border:0.5px solid #ddd;page-break-inside:avoid}
          .label div canvas,.label div img{width:22mm!important;height:22mm!important}
          .n{font-size:7pt;font-weight:bold;margin:1mm 0 0;text-align:center}
          .c{font-size:6.5pt;color:#555;font-family:monospace}
          .b{font-size:5.5pt;color:#999}
        </style>
      </head><body>
        <div class="grid">${labelsHTML}</div>
        <script>${qrScripts}
        setTimeout(()=>{window.print();},800);<\/script>
      </body></html>`);
      w.document.close();
    }

    // ===== CATEGORY CRUD =====
    function deleteUnit(unitId, unitCode) {
      showConfirm({
        title: 'ลบ Unit',
        message: `ลบ "${unitCode}" ออกจากระบบ? ไม่สามารถย้อนกลับได้`,
        icon: '🗑',
        confirmText: 'ลบ',
        confirmColor: '#ef4444',
        onConfirm: async () => {
          try {
            const { count } = await sb.from('equipment_units')
              .select('*', { count: 'exact', head: true })
              .eq('equipment_id', selectedEquipmentId);
            if (count <= 1) {
              toast('ไม่สามารถลบ unit สุดท้ายได้ — ต้องมีอย่างน้อย 1 unit', 'warning');
              return;
            }
            const { error } = await sb.from('equipment_units').delete().eq('id', unitId);
            if (error) throw error;
            await logAction('UNIT_DELETE', 'equipment_units', unitId, { unit_code: unitCode }, null);
            toast(`ลบ ${unitCode} เรียบร้อยแล้ว`, 'success');
            await selectEquipment(selectedEquipmentId);
          } catch(e) {
            console.error(e);
            toast('ลบไม่สำเร็จ: ' + (e.message || e), 'error');
          }
        }
      });
    }

    function showAddCatInput() { _addCatMode = true; renderEquipmentTab(); }
    function cancelAddCat() { _addCatMode = false; renderEquipmentTab(); }
    async function saveCategory() {
      const input = document.getElementById('newCatInput');
      const name = input?.value.trim();
      if (!name) { toast('กรุณากรอกชื่อหมวดหมู่','warning'); return; }
      if (CATS.some(c => c.name.toLowerCase() === name.toLowerCase())) {
        toast('หมวดหมู่นี้มีอยู่แล้ว','warning'); return;
      }
      try {
        const cat = await api('addCategory', { name });
        CATS = [...CATS, cat].sort((a,b) => a.name.localeCompare(b.name,'th'));
        _addCatMode = false;
        toast(`เพิ่มหมวดหมู่ "${he(name)}" เรียบร้อยแล้ว`,'success');
        renderEquipmentTab();
      } catch(e) { console.error(e); toast('เกิดข้อผิดพลาด กรุณาลองใหม่','error'); }
    }
    async function deleteCategoryById(id, name) {
      if (EQ.some(e => e.category === name)) return; // guard (button is disabled, but belt-and-suspenders)
      if (!confirm(`ลบหมวดหมู่ "${name}"?`)) return;
      try {
        await api('deleteCategory', { id, name });
        CATS = CATS.filter(c => c.id !== id);
        toast(`ลบหมวดหมู่ "${he(name)}" แล้ว`,'warning');
        renderEquipmentTab();
      } catch(e) { console.error(e); toast('ลบไม่สำเร็จ','error'); }
    }

    function populateCategorySelect(selectedVal = '') {
      const sel = document.getElementById('eqCategory');
      if (!sel) return;
      sel.innerHTML = `<option value="">เลือกหมวดหมู่</option>` +
        CATS.map(c => `<option value="${he(c.name)}"${c.name === selectedVal ? ' selected' : ''}>${he(c.name)}</option>`).join('');
    }
    function showAddEquipment() {
      _editEqId = null;
      document.getElementById('equipModalTitle').textContent = 'เพิ่มอุปกรณ์';
      document.getElementById('eqName').value = '';
      populateCategorySelect();
      document.getElementById('eqSerial').value = '';
      document.getElementById('eqQty').value = '1';
      document.getElementById('equip-image-input').value = '';
      document.getElementById('equip-image-preview').classList.add('hidden');
      showModal('equipModal');
    }
    function showEditEquipment(eqId) {
      const eq = EQ.find(e=>e.eq_id===eqId); if(!eq) return;
      _editEqId = eqId;
      document.getElementById('equipModalTitle').textContent = 'แก้ไขอุปกรณ์';
      document.getElementById('eqName').value = eq.name;
      populateCategorySelect(eq.category || '');
      document.getElementById('eqSerial').value = eq.serial_no||'';
      document.getElementById('eqQty').value = eq.quantity;
      document.getElementById('equip-image-input').value = '';
      const preview = document.getElementById('equip-image-preview');
      if (eq.image_url) { document.getElementById('equip-image-preview-img').src = safeImgUrl(eq.image_url); preview.classList.remove('hidden'); }
      else { preview.classList.add('hidden'); }
      showModal('equipModal');
    }
    function closeEquipModal() { hideModal('equipModal'); _editEqId=null; }
    function previewEquipImage(input) {
      const file = input.files[0]; if (!file) return;
      const imgEl = document.getElementById('equip-image-preview-img');
      if (imgEl._previewUrl) URL.revokeObjectURL(imgEl._previewUrl);
      imgEl._previewUrl = URL.createObjectURL(file);
      imgEl.src = imgEl._previewUrl;
      document.getElementById('equip-image-preview').classList.remove('hidden');
    }
    async function resizeImage(file, maxWidth = 400, quality = 0.8) {
      return new Promise((resolve, reject) => {
        const objectUrl = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
          URL.revokeObjectURL(objectUrl);
          const scale = Math.min(1, maxWidth / img.width);
          const canvas = document.createElement('canvas');
          canvas.width = img.width * scale; canvas.height = img.height * scale;
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('canvas.toBlob failed')), 'image/jpeg', quality);
        };
        img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('Image load failed')); };
        img.src = objectUrl;
      });
    }
    async function uploadEquipImage(file, equipmentId) {
      const resized = await resizeImage(file);
      const path = `${equipmentId}.jpg`;
      const { error } = await sb.storage.from('equipment-images').upload(path, resized, { upsert: true, contentType: 'image/jpeg' });
      if (error) throw error;
      const { data } = sb.storage.from('equipment-images').getPublicUrl(path);
      return data.publicUrl;
    }
    async function submitEquipment() {
      const name = document.getElementById('eqName').value.trim();
      const cat = document.getElementById('eqCategory').value;
      const serial = document.getElementById('eqSerial').value.trim();
      const qty = parseInt(document.getElementById('eqQty').value)||1;
      if (!name) { toast('กรุณากรอกชื่ออุปกรณ์'); return; }
      if (!cat) { toast('กรุณาเลือกหมวดหมู่'); return; }
      const btn = document.getElementById('eqSubmitBtn');
      btn.disabled=true; btn.textContent='กำลังบันทึก...';
      try {
        const file = document.getElementById('equip-image-input').files[0];
        let imageUrl = _editEqId ? (EQ.find(e=>e.eq_id===_editEqId)?.image_url || null) : null;
        if (file) imageUrl = await uploadEquipImage(file, _editEqId || `tmp-${Date.now()}`);
        if (_editEqId) {
          const old = EQ.find(e=>e.eq_id===_editEqId);
          const diff = qty - (old?.quantity||0);
          const newAvail = Math.max(0, (old?.available||0) + diff);
          await api('updateEquipment', { eq_id:_editEqId, name, category:cat, serial_no:serial, quantity:qty, available:newAvail, image_url:imageUrl });
        } else {
          await api('addEquipment', { name, category:cat, serial_no:serial, quantity:qty, image_url:imageUrl });
        }
        EQ = await api('getEquipment');
        toast(_editEqId?'บันทึกการเปลี่ยนแปลงแล้ว':'เพิ่มอุปกรณ์เรียบร้อยแล้ว','success');
        closeEquipModal(); renderEquipmentTab();
      } catch(e) { console.error(e); toast('ไม่สามารถบันทึกข้อมูลได้','error'); }
      btn.disabled=false; btn.textContent='บันทึก';
    }
    function confirmDeleteEquip(eqId) {
      const eq = EQ.find(e=>e.eq_id===eqId); if(!eq) return;
      showConfirm({
        title: 'ลบอุปกรณ์นี้?', message: eq.name, icon: '🗑️',
        confirmText: 'ลบเลย', iconBg: '#FEE2E2', confirmColor: '#DC6B19',
        onConfirm: () => executeDeleteEquipment(eqId)
      });
    }
    async function executeDeleteEquipment(eqId) {
      try {
        await api('deleteEquipment', { eq_id: eqId });
        EQ = await api('getEquipment');
        toast('ลบอุปกรณ์เรียบร้อยแล้ว','warning');
        renderEquipmentTab();
      } catch(e) { toast('ลบไม่สำเร็จ','error'); }
    }

    // ===== MGR: MEMBERS TAB =====
    function renderMembersTab() {
      const el = document.getElementById('tab-members');
      el.innerHTML = `<div class="gd-container fade-in">
        <div class="flex items-center justify-between mb-4">
          <h4 class="eq-title">รายชื่อสมาชิก</h4>
          <button onclick="openUserModal()" class="gd-btn-primary flex items-center gap-1.5 !w-auto !py-1.5 !px-3 text-sm">
            <i data-lucide="user-plus" class="w-[18px] h-[18px] text-[#64748B]"></i> เพิ่มสมาชิก</button>
        </div>
        <div class="space-y-3 ">
          ${(()=>{ const all=[...AU.ga.map(u=>({...u,type:'ga'})),...AU.mgr.map(u=>({...u,type:'mgr'}))];
            if(!all.length) return emptyState('ยังไม่มีสมาชิก','เพิ่มสมาชิกโดยใช้ปุ่ม + ด้านบน','users');
            return all.map((u,i)=>{
              const catBadge = u.type === 'ga' ? (() => {
                const ac = u.allowed_categories;
                if (!ac || ac.length === 0)
                  return `<span style="font-size:10px;padding:2px 8px;border-radius:999px;background:#EFF6FF;color:#3B82F6;border:1px solid #BFDBFE;font-family:'Prompt', sans-serif;">ทุกหมวด</span>`;
                return `<span style="font-size:10px;padding:2px 8px;border-radius:999px;background:#FFF7ED;color:#F97316;border:1px solid #FED7AA;font-family:'Prompt', sans-serif;">${ac.length} หมวด</span>`;
              })() : '';
              const catBtn = u.type === 'ga'
                ? `<button data-name="${he(u.name)}" onclick="openCatModal(this.dataset.name)"
                     style="padding:6px 8px;border-radius:8px;border:1px solid #E2E8F0;background:white;cursor:pointer;display:flex;align-items:center;gap:4px;font-size:12px;color:#475569;font-weight:500;font-family:'Prompt', sans-serif;" title="ตั้งค่าหมวดหมู่">
                     <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z"/><path d="M7 7h.01"/></svg>
                     หมวด</button>`
                : '';
              return `<div class="gd-card p-5 flex items-center justify-between fade-in">
                <div class="flex items-center gap-3">
                  ${avEl(u.name, u.type)}
                  <div>
                    <div style="display:flex;align-items:center;gap:6px;">
                      <p class="font-medium text-gray-900 text-base">${he(u.name)}</p>
                      ${catBadge}
                    </div>
                    <p class="${u.type==='mgr'?'role-badge-mgr':'role-badge-ga'}">${u.type==='mgr'?'ผู้ดูแลระบบ':'เจ้าหน้าที่ GA'}</p>
                  </div>
                </div>
                <div class="flex items-center gap-1">
                  ${catBtn}
                  <button data-name="${he(u.name)}" data-utype="${u.type}" onclick="openResetPin(this.dataset.name,this.dataset.utype)" class="p-2 rounded-lg text-gray-300 hover:text-amber-500 hover:bg-amber-50"><i data-lucide="key-round" class="w-[18px] h-[18px] text-[#64748B]"></i></button>
                  <button data-name="${he(u.name)}" data-utype="${u.type}" onclick="confirmDeleteUser(this.dataset.name,this.dataset.utype)" class="p-2 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50"><i data-lucide="trash-2" class="w-[18px] h-[18px] text-[#64748B]"></i></button>
                </div>
              </div>`;
            }).join('');
          })()}
        </div>
        <div class="mt-6 border-t border-gray-100 pt-5">
          <div class="flex items-center justify-between mb-3">
            <h4 class="eq-title flex items-center gap-2">
              <i data-lucide="mail" style="width:16px;height:16px;color:var(--orange);"></i> ตั้งค่าการแจ้งเตือน Email
            </h4>
          </div>
          <p class="eq-meta mb-3">รายชื่อผู้รับรายงานประจำสัปดาห์</p>
          <p class="eq-meta mb-2" style="font-size:11px;">บันทึกอัตโนมัติเมื่อเปิด/ปิด</p>
          <div id="notif-recipients-list" class="space-y-2 mb-3">
            ${skeletonCards(2)}
          </div>
          <div class="flex gap-2">
            <button onclick="openRecipientModal()" class="flex items-center gap-1.5 px-3 py-2 border border-gray-200 rounded-lg text-sm font-semibold text-gray-600 hover:bg-gray-50 transition">
              <i data-lucide="plus" class="w-[18px] h-[18px] text-[#64748B]"></i> เพิ่มเมลล์</button>
            <button id="sendTestReportBtn" onclick="sendTestReport()" class="gd-btn-secondary flex items-center gap-1.5 !w-auto !py-1.5 !px-3 text-sm">
              <i data-lucide="send" class="w-[18px] h-[18px] text-[#64748B]"></i> ส่งทดสอบตอนนี้</button>
          </div>
        </div>
      </div>`;
      lucide.createIcons({'stroke-width': 1.5});
      loadAndRenderRecipients();
    }
    function openUserModal() { showModal('userModal'); document.getElementById('newUserName').value=''; document.getElementById('newUserPin').value=''; document.getElementById('newUserRole').value='ga'; }
    function closeUserModal() { hideModal('userModal'); }
    async function confirmAddUser() {
      const name = document.getElementById('newUserName').value.trim();
      const role = document.getElementById('newUserRole').value;
      const pin = document.getElementById('newUserPin').value.trim();
      if(!name||!pin){ toast('กรุณากรอกข้อมูลให้ครบ'); return; }
      if(!/^\d{6}$/.test(pin)){ toast('PIN ต้องเป็นตัวเลข 6 หลัก'); return; }
      if([...AU.ga,...AU.mgr].some(u=>u.name===name)){ toast('ชื่อซ้ำ'); return; }
      const btn = document.getElementById('addUserBtn');
      btn.disabled=true; btn.textContent='กำลังบันทึก...';
      try {
        await api('addUser', { name, role, pin });
        if(role==='ga') AU.ga.push({name,role}); else AU.mgr.push({name,role});
        toast('เพิ่มสมาชิกเรียบร้อยแล้ว','success');
        closeUserModal(); renderMembersTab(); buildLoginScreen();
      } catch(e){ toast('เพิ่มไม่สำเร็จ','error'); }
      btn.disabled=false; btn.textContent='บันทึก';
    }
    function confirmDeleteUser(name, role) {
      if(name===CU.name){ toast('ไม่สามารถลบตัวเองได้'); return; }
      showConfirm({
        title: 'ลบสมาชิก?', message: name, icon: '🗑️',
        confirmText: 'ลบเลย', iconBg: '#FEE2E2', confirmColor: '#DC6B19',
        onConfirm: () => executeDeleteUser(name, role)
      });
    }
    async function executeDeleteUser(name, role) {
      try {
        await api('deleteUser', { name, role });
        if(role==='ga') AU.ga=AU.ga.filter(u=>u.name!==name); else AU.mgr=AU.mgr.filter(u=>u.name!==name);
        toast('ลบสมาชิกเรียบร้อยแล้ว','warning');
        renderMembersTab(); buildLoginScreen();
      } catch(e){ toast('ลบไม่สำเร็จ','error'); }
    }
    function openResetPin(name, role) {
      const newPin = String((crypto.getRandomValues(new Uint32Array(1))[0] % 900000) + 100000);
      showConfirm({
        title: 'Reset PIN — ' + name,
        message: 'PIN ใหม่: ' + newPin,
        icon: '🔑', iconBg: '#FFF7ED', confirmText: 'ยืนยัน Reset', confirmColor: '#F97316',
        onConfirm: () => executeResetPin(name, role, newPin)
      });
    }
    async function executeResetPin(name, role, newPin) {
      try {
        await api('changePin', { name, newPin, role });
        toast('Reset PIN เรียบร้อยแล้ว','success');
      } catch(e){ toast('Reset ไม่สำเร็จ','error'); }
    }

    // ===== CATEGORY ACCESS MODAL =====
    let _catModalName = null, _catModalMode = 'all', _catModalSelected = new Set();

    function openCatModal(name) {
      _catModalName = name;
      const u = AU.ga.find(u => u.name === name);
      const ac = u?.allowed_categories;
      _catModalMode = (!ac || ac.length === 0) ? 'all' : 'custom';
      _catModalSelected = new Set(ac || []);
      document.getElementById('catModalUserName').textContent = name;
      catModalSetMode(_catModalMode);
      showModal('catModal');
    }
    function closeCatModal() { hideModal('catModal'); }
    function catModalSetMode(mode) {
      _catModalMode = mode;
      document.getElementById('catRadioAll').classList.toggle('active', mode === 'all');
      document.getElementById('catRadioCustom').classList.toggle('active', mode === 'custom');
      const list = document.getElementById('catCheckboxList');
      if (mode === 'custom') {
        list.style.display = 'block';
        list.innerHTML = CATS.map(c => {
          const checked = _catModalSelected.has(c.name);
          return `<div class="cat-checkbox-row" onclick="catModalToggle('${he(c.name)}')">
            <span id="catcb-${he(c.name)}" class="cat-checkbox-box${checked?' checked':''}">
              ${checked?`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`:''}
            </span>
            ${he(c.name)}
          </div>`;
        }).join('');
      } else {
        list.style.display = 'none';
      }
    }
    function catModalToggle(catName) {
      if (_catModalSelected.has(catName)) _catModalSelected.delete(catName);
      else _catModalSelected.add(catName);
      catModalSetMode('custom'); // re-render checkboxes
    }
    async function saveCatModal() {
      const categories = _catModalMode === 'all' ? null : [..._catModalSelected];
      try {
        await api('updateUserCategories', { name: _catModalName, categories });
        // Update AU.ga local
        const u = AU.ga.find(u => u.name === _catModalName);
        if (u) u.allowed_categories = categories;
        toast('บันทึกเรียบร้อยแล้ว', 'success');
        closeCatModal();
        renderMembersTab();
      } catch(e) { toast('บันทึกไม่สำเร็จ', 'error'); }
    }

    // ===== MGR: NOTIFICATION / RECIPIENTS =====
    async function loadAndRenderRecipients() {
      const elR = document.getElementById('notif-recipients-list');
      if (elR) elR.innerHTML = skeletonCards(2);
      try {
        RECIPIENTS = await api('getRecipients');
        renderRecipientsList();
      } catch(e) {
        const el = document.getElementById('notif-recipients-list');
        if (el) el.innerHTML = `<p class="text-sm text-red-400 text-center py-2">โหลดไม่สำเร็จ</p>`;
      }
    }
    function renderRecipientsList() {
      const el = document.getElementById('notif-recipients-list');
      if (!el) return;
      if (!RECIPIENTS.length) {
        el.innerHTML = `<p class="eq-meta text-center py-3">ยังไม่มีผู้รับรายงาน</p>`;
        return;
      }
      el.innerHTML = RECIPIENTS.map(r => `<div class="gd-card p-4 flex items-center justify-between">
        <div class="flex items-center gap-2.5 min-w-0 flex-1 pr-2">
          <span class="text-base shrink-0">${r.is_active ? '✅' : '⬜'}</span>
          <div class="min-w-0">
            <p class="text-base font-medium text-gray-900 truncate">${he(r.name)}</p>
            <p class="eq-meta truncate">${he(r.email)}</p>
          </div>
        </div>
        <div class="flex items-center gap-1 shrink-0">
          <button data-id="${r.id}" data-active="${r.is_active}"
            onclick="toggleRecipient(this.dataset.id, this.dataset.active==='true')"
            class="text-sm px-2.5 py-1 rounded-lg border font-semibold transition ${r.is_active ? 'border-amber-200 text-amber-600 hover:bg-amber-50' : 'border-green-200 text-green-600 hover:bg-green-50'}">
            ${r.is_active ? 'ปิด' : 'เปิด'}</button>
          <button data-id="${r.id}" data-label="${he(r.name+' · '+r.email)}"
            onclick="confirmDeleteRecipient(this.dataset.id, this.dataset.label)"
            class="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition">
            <i data-lucide="trash-2" class="w-[18px] h-[18px] text-[#64748B]"></i></button>
        </div>
      </div>`).join('');
      lucide.createIcons({'stroke-width': 1.5});
    }
    function openRecipientModal() {
      document.getElementById('recipientName').value = '';
      document.getElementById('recipientEmail').value = '';
      showModal('recipientModal');
    }
    function closeRecipientModal() { hideModal('recipientModal'); }
    async function confirmAddRecipient() {
      const name = document.getElementById('recipientName').value.trim();
      const email = document.getElementById('recipientEmail').value.trim();
      if (!name) { toast('กรุณากรอกชื่อ'); return; }
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast('กรุณากรอกอีเมลให้ถูกต้อง'); return; }
      const btn = document.getElementById('addRecipientBtn');
      btn.disabled = true; btn.textContent = 'กำลังบันทึก...';
      try {
        const rec = await api('addRecipient', { name, email });
        RECIPIENTS.push(rec);
        toast('เพิ่มผู้รับเรียบร้อยแล้ว', 'success');
        closeRecipientModal(); renderRecipientsList();
      } catch(e) { toast('เพิ่มไม่สำเร็จ', 'error'); }
      btn.disabled = false; btn.textContent = 'บันทึก';
    }
    async function toggleRecipient(id, currentlyActive) {
      try {
        await api('toggleRecipient', { id, is_active: !currentlyActive });
        const r = RECIPIENTS.find(r => r.id === id);
        if (r) r.is_active = !currentlyActive;
        renderRecipientsList();
      } catch(e) { toast('ไม่สามารถบันทึกข้อมูลได้', 'error'); }
    }
    function confirmDeleteRecipient(id, label) {
      showConfirm({
        title: 'ลบผู้รับรายงาน?', message: label, icon: '🗑️',
        confirmText: 'ลบเลย', iconBg: '#FEE2E2', confirmColor: '#DC6B19',
        onConfirm: () => executeDeleteRecipient(id)
      });
    }
    async function executeDeleteRecipient(id) {
      try {
        await api('deleteRecipient', { id });
        RECIPIENTS = RECIPIENTS.filter(r => r.id !== id);
        toast('ลบผู้รับเรียบร้อยแล้ว', 'warning');
        renderRecipientsList();
      } catch(e) { toast('ลบไม่สำเร็จ', 'error'); }
    }
    async function sendTestReport() {
      const btn = document.getElementById('sendTestReportBtn');
      if (!btn) return;
      btn.disabled = true; btn.innerHTML = '<i data-lucide="loader-2" class="w-[18px] h-[18px] text-[#64748B]"></i> กำลังส่ง...';
      lucide.createIcons({'stroke-width': 1.5});
      try {
        const { data, error } = await sb.functions.invoke('send-weekly-report');
        if (error) throw error;
        const sent = data?.sent ?? '?';
        toast(`ส่งรายงานทดสอบเรียบร้อย (${sent} เมลล์)`, 'success');
      } catch(e) { toast('เกิดข้อผิดพลาด: ' + (e.message || 'ลองใหม่อีกครั้ง'), 'error'); }
      btn.disabled = false; btn.innerHTML = '<i data-lucide="send" class="w-[18px] h-[18px] text-[#64748B]"></i> ส่งทดสอบตอนนี้';
      lucide.createIcons({'stroke-width': 1.5});
    }

    // ===== MGR: AUDIT LOG TAB =====
    const AUDIT_TYPE_META = {
      BORROW:           { label:'ยืม',           cls:'badge-borrowed' },
      RETURN:           { label:'คืน',            cls:'bg-green-50 text-success' },
      RETURN_BY_MANAGER:{ label:'คืนแทน',         cls:'bg-purple-50 text-purple-600' },
      EQUIPMENT_CREATE: { label:'เพิ่มอุปกรณ์',   cls:'bg-amber-50 text-warn' },
      EQUIPMENT_UPDATE: { label:'แก้ไขอุปกรณ์',   cls:'bg-amber-50 text-warn' },
      EQUIPMENT_DELETE: { label:'ลบอุปกรณ์',      cls:'bg-red-50 text-danger' },
      MEMBER_CREATE:    { label:'เพิ่มสมาชิก',    cls:'bg-blue-50 text-blue-700' },
      MEMBER_DELETE:    { label:'ลบสมาชิก',       cls:'bg-red-50 text-danger' },
      MEMBER_RESET_PIN: { label:'Reset PIN',      cls:'bg-blue-50 text-blue-700' },
      OVERDUE_FLAGGED:  { label:'เกินกำหนด',      cls:'bg-red-50 text-danger' },
      CATEGORY_CREATE:  { label:'เพิ่มหมวดหมู่',  cls:'bg-amber-50 text-warn' },
      CATEGORY_DELETE:  { label:'ลบหมวดหมู่',     cls:'bg-red-50 text-danger' },
      CHANGE_PIN:       { label:'เปลี่ยน PIN',     cls:'bg-gray-100 text-gray-600' },
      UPDATE_CATEGORIES:{ label:'ตั้งค่าหมวด',    cls:'bg-blue-50 text-blue-700' },
      SETTING_UPDATE:   { label:'ตั้งค่าระบบ',    cls:'bg-indigo-50 text-indigo-600' },
    };
    function auditTypeBadge(t) {
      const m = AUDIT_TYPE_META[t] || { label: t, cls: 'bg-gray-100 text-gray-500' };
      return `<span class="audit-badge inline-flex items-center ${m.cls}">${he(m.label)}</span>`;
    }
    function auditDetail(r) {
      const d = r.new_data || {};
      if (r.action_type === 'BORROW') return `${he(d.eq_name||'')} · ${he(d.borrower_name||'')} รหัส: ${he(d.borrower_dept||'')} จำนวน ${d.qty||''}`;
      if (r.action_type === 'RETURN') return `record: ${he(r.target_id||'')}`;
      if (r.action_type === 'RETURN_BY_MANAGER') return `record: ${he(r.target_id||'')}${d.returned_by?' · โดย '+he(d.returned_by):''}`;
      if (r.action_type?.startsWith('EQUIPMENT')) return `${he(d.name||'')}${d.category?' · '+he(d.category):''}${d.quantity?' · '+d.quantity+' ชิ้น':''}`;
      if (r.action_type?.startsWith('MEMBER')) return `${he(d.name||'')}${d.role?' ('+he(d.role)+')':''}`;
      if (r.action_type === 'SETTING_UPDATE') {
        const keyLabel = { require_borrow_signature:'ลายเซ็นการยืม', require_return_rating:'ลายเซ็น/ประเมินคืน' };
        const label = keyLabel[r.target_id] || he(r.target_id||'');
        const val = d[r.target_id] ? 'เปิด' : 'ปิด';
        return `${label} → ${val}`;
      }
      return r.target_id ? he(r.target_id) : '';
    }
    async function renderAuditLogTab() {
      const el = document.getElementById('tab-audit-log');
      el.innerHTML = `<div class="gd-container fade-in"><div class="gd-container-header"><h2 class="page-title">ประวัติการดำเนินการ</h2></div>${skeletonCards(5)}</div>`;
      const { data, error } = await sb.from('app_audit_logs').select('*').order('created_at', { ascending: false }).limit(300);
      if (error) { el.innerHTML = `<div class="gd-container fade-in"><p class="text-base text-danger text-center py-10">โหลดข้อมูลไม่สำเร็จ</p></div>`; return; }
      AUDIT_LOGS = data || [];
      _renderAuditList();
    }
    function _renderAuditList() {
      const el = document.getElementById('tab-audit-log');
      if (!el) return;
      const filterTypes = ['BORROW','RETURN','EQUIPMENT_CREATE','EQUIPMENT_UPDATE','EQUIPMENT_DELETE','MEMBER_CREATE','MEMBER_DELETE','MEMBER_RESET_PIN','CATEGORY_CREATE','CATEGORY_DELETE'];
      const filtered = AUDIT_LOGS
        .filter(r => !auditFilter || r.action_type === auditFilter)
        .filter(r => !auditSearch || (r.actor_name||'').toLowerCase().includes(auditSearch.toLowerCase()))
        .filter(r => !auditDateFrom || (r.created_at || '').slice(0,10) >= auditDateFrom)
        .filter(r => !auditDateTo || (r.created_at || '').slice(0,10) <= auditDateTo);
      el.innerHTML = `<div class="gd-container fade-in">
        <div class="gd-container-header">
          
          <h2 class="page-title">ประวัติการดำเนินการ</h2>
        </div>
        <div class="flex gap-2 mb-3">
          <input id="auditSearchInput" type="text" placeholder="ค้นหาผู้ดำเนินการ..." value="${he(auditSearch)}"
            oninput="auditSearch=this.value;debounce('auditSearch',_renderAuditList)"
            class="gd-input" style="flex:1;height:38px;">
          <input type="date" value="${auditDateFrom}" onchange="auditDateFrom=this.value;_renderAuditList()" class="gd-input" style="width:150px;height:38px;" title="ตั้งแต่วันที่">
          <input type="date" value="${auditDateTo}" onchange="auditDateTo=this.value;_renderAuditList()" class="gd-input" style="width:150px;height:38px;" title="ถึงวันที่">
          <button onclick="exportAuditCSV()" class="gd-btn-primary flex items-center gap-1.5 !w-auto !py-1.5 !px-3 text-sm font-semibold whitespace-nowrap">
            <i data-lucide="download" class="w-[18px] h-[18px] text-[#64748B]"></i> Export CSV</button>
        </div>
        <div class="audit-filter-pills">
          <div class="chip ${auditFilter===''?'active':''}" onclick="auditFilter='';_renderAuditList()">ทั้งหมด</div>
          ${filterTypes.map(t=>`<div class="chip ${auditFilter===t?'active':''}" onclick="auditFilter='${t}';_renderAuditList()">${AUDIT_TYPE_META[t]?.label||t}</div>`).join('')}
        </div>
        <div class="space-y-2">
          ${filtered.length ? filtered.map(r=>`<div class="gd-card" style="padding: 20px;">
            <div class="flex items-start justify-between gap-2 mb-1">
              ${auditTypeBadge(r.action_type)}
              <span class="eq-meta shrink-0">${fdFull(r.created_at)}</span>
            </div>
            <p class="text-sm text-gray-500 mt-1">${he(r.actor_name||'—')}<span class="text-gray-300 mx-1">·</span>${auditDetail(r)}</p>
          </div>`).join('') : emptyState('ยังไม่มีบันทึก','กิจกรรมในระบบจะปรากฏที่นี่','list')}
        </div>
      </div>`;
      lucide.createIcons({'stroke-width': 1.5});
    }
    function exportAuditCSV() {
      const filtered = AUDIT_LOGS
        .filter(r => !auditFilter || r.action_type === auditFilter)
        .filter(r => !auditSearch || (r.actor_name||'').toLowerCase().includes(auditSearch.toLowerCase()))
        .filter(r => !auditDateFrom || (r.created_at || '').slice(0,10) >= auditDateFrom)
        .filter(r => !auditDateTo || (r.created_at || '').slice(0,10) <= auditDateTo);
      const headers = ['วันที่/เวลา','ประเภท','ผู้ดำเนินการ','ตาราง','ID','รายละเอียด'];
      const lines = filtered.map(r => [
        fdFull(r.created_at), r.action_type||'', r.actor_name||'',
        r.target_table||'', r.target_id||'',
        r.new_data ? JSON.stringify(r.new_data) : ''
      ].map(v=>`"${String(v).replace(/"/g,'""')}"`).join(','));
      const csv = [headers.join(','), ...lines].join('\n');
      const blob = new Blob(['\ufeff'+csv], { type:'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href=url; a.download=`audit-log-${new Date().toISOString().slice(0,10)}.csv`; a.click();
      URL.revokeObjectURL(url);
    }

    function exportHistoryCSV(mode) {
      const sq = mode === 'ga' ? gaHistorySearch.toLowerCase() : mgrHistorySearch.toLowerCase();
      const rows = BORROWS
        .filter(r => !historyFilter || r.status === historyFilter)
        .filter(r => !sq || (r.eq_name||'').toLowerCase().includes(sq) || (r.borrower_name||'').toLowerCase().includes(sq))
        .filter(r => mode === 'mgr' ? (!mgrHistoryGa   || r.ga_staff     === mgrHistoryGa)   : true)
        .filter(r => mode === 'mgr' ? (!mgrHistoryFrom || (r.borrowed_at||'') >= mgrHistoryFrom) : true)
        .filter(r => mode === 'mgr' ? (!mgrHistoryTo   || (r.borrowed_at||'').slice(0,10) <= mgrHistoryTo) : true);
      const condLabel = { normal:'ปกติ', damaged:'ชำรุด', lost:'สูญหาย' };
      const statusLabel = { borrowed:'กำลังยืม', returned:'คืนแล้ว', overdue:'เกินกำหนด' };
      const headers = ['วันที่ยืม','ชื่ออุปกรณ์','ชื่อผู้ยืม','รหัสพนักงาน','จำนวน','กำหนดคืน','วันที่คืน','สถานะ','GA ที่รับผิดชอบ','สภาพอุปกรณ์','หมายเหตุสภาพ'];
      const lines = rows.map(r => [
        fdFull(r.borrowed_at), r.eq_name||'', r.borrower_name||'', r.borrower_dept||'',
        r.qty_borrowed||1, fd(r.due_date), r.returned_at ? fdFull(r.returned_at) : '',
        statusLabel[r.status]||r.status||'', r.ga_staff||'',
        condLabel[r.condition_on_return]||'', r.condition_note||''
      ].map(v=>`"${String(v).replace(/"/g,'""')}"`).join(','));
      const csv = [headers.join(','), ...lines].join('\n');
      const blob = new Blob(['\ufeff'+csv], { type:'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `history-${mode}-${new Date().toISOString().slice(0,10)}.csv`;
      a.click(); URL.revokeObjectURL(url);
    }

    // ===== SETTINGS TAB =====
    function renderSettingsTab() {
      const el = document.getElementById('tab-settings');
      if (!el) return;
      function toggleRow(key, labelTh, descTh, isOn) {
        return `
          <div class="flex items-center justify-between py-4 border-b border-gray-100 last:border-b-0">
            <div class="flex-1 mr-4">
              <p class="text-base font-semibold text-gray-800">${labelTh}</p>
              <p class="text-sm text-gray-400 mt-0.5">${descTh}</p>
            </div>
            <button type="button" onclick="toggleSetting('${key}', this)"
              aria-checked="${isOn}"
              style="position:relative;display:inline-flex;height:24px;width:44px;flex-shrink:0;cursor:pointer;border-radius:9999px;border:2px solid transparent;transition:background-color 0.2s;background:${isOn ? '#f97316' : '#e5e7eb'};outline:none;">
              <span style="pointer-events:none;display:inline-block;height:20px;width:20px;border-radius:9999px;background:white;box-shadow:0 1px 3px rgba(0,0,0,0.15);transition:transform 0.2s;transform:${isOn ? 'translateX(20px)' : 'translateX(0)'}"></span>
            </button>
          </div>`;
      }
      el.innerHTML = `
        <div class="gd-container fade-in">
          <div class="gd-container-header">
            <h2 class="page-title">ตั้งค่าระบบ</h2>
            <p class="text-base text-gray-400 mt-1">จัดการฟีเจอร์การยืม-คืนอุปกรณ์ (เฉพาะผู้ดูแลระบบ)</p>
          </div>
          <div class="gd-card p-5 mb-4">
            <p class="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-1" style="letter-spacing:0.08em;">ฟีเจอร์การยืม-คืน</p>
            <div>
              ${toggleRow('require_borrow_signature', 'ต้องการลายเซ็นการยืม', 'ผู้ยืมต้องเซ็นชื่อก่อนยืนยันการยืมอุปกรณ์', SETTINGS.require_borrow_signature)}
              ${toggleRow('require_return_rating', 'ต้องการลายเซ็นและประเมินบริการเมื่อคืน', 'ผู้คืนต้องเซ็นชื่อ และสามารถให้คะแนนบริการได้', SETTINGS.require_return_rating)}
            </div>
          </div>
        </div>`;
    }

    async function toggleSetting(key, btn) {
      const newVal = !SETTINGS[key];
      btn.disabled = true;
      try {
        await api('updateSetting', { key, value: newVal });
        renderSettingsTab();
        toast(newVal ? 'เปิดใช้งานแล้ว' : 'ปิดใช้งานแล้ว', 'success');
      } catch(e) {
        toast('ไม่สามารถบันทึกการตั้งค่าได้', 'error');
        btn.disabled = false;
      }
    }

    // ===== INIT =====
    async function init(forceRefresh = false) {
      const _urlUnit = new URLSearchParams(window.location.search).get('unit');
      if (_urlUnit) {
        sessionStorage.setItem('pendingUnit', _urlUnit);
        window.history.replaceState({}, '', window.location.pathname);
      }
      _pendingUnitCode = null;
      goScreen('loading');
      document.getElementById('loadingMsg').textContent = 'กำลังดึงข้อมูลผู้ใช้...';
      document.getElementById('loadingSlowHint').classList.add('hidden');
      document.getElementById('loadingRetryBtn').classList.add('hidden');
      try {
        const cached = forceRefresh ? null : cacheGet('users');
        if (cached) {
          AU = cached; buildLoginScreen(); goScreen('login'); lucide.createIcons({'stroke-width': 1.5});
          api('getUsers').then(d=>{ AU=d; cacheSet('users',d); buildLoginScreen(); }).catch(()=>{});
          return;
        }
        AU = await api('getUsers');
        if (AUTH_MODE === 'demo') toast('ไม่พบผู้ใช้ในระบบ — กรุณาติดต่อผู้ดูแลระบบ', 'warning');
        cacheSet('users', AU);
        buildLoginScreen(); goScreen('login'); lucide.createIcons({'stroke-width': 1.5});
      } catch(e) {
        console.error('[init]', e);
        document.getElementById('loadingMsg').textContent = 'ไม่สามารถเชื่อมต่อได้ กรุณาลองใหม่';
        document.getElementById('loadingSlowHint').classList.remove('hidden');
        document.getElementById('loadingRetryBtn').classList.remove('hidden');
      }
    }



    async function _handleQrUnitNav() {
      if (!_pendingUnitCode) return;
      const code = _pendingUnitCode;
      _pendingUnitCode = null;
      const { data: unit } = await sb.from('equipment_units')
        .select('id, equipment_id, unit_code, status')
        .eq('unit_code', code)
        .maybeSingle();
      if (!unit) { toast(`ไม่พบ unit: ${code}`, 'error'); return; }
      if (CU?.role === 'manager') {
        switchTab(3);
        setTimeout(() => selectEquipment(unit.equipment_id), 300);
      } else {
        const statusTH = { available:'ว่าง', borrowed:'ยืมอยู่', damaged:'ชำรุด', lost:'สูญหาย' }[unit.status] || unit.status;
        toast(`Unit ${unit.unit_code}: ${statusTH}`, 'info');
      }
    }

    // ===== RECORD DETAIL =====
    function renderTimelineItem(log) {
      const actionLabels = {
        BORROW:            { label: 'ยืมอุปกรณ์',      icon: '📋', color: 'text-amber-400' },
        RETURN:            { label: 'คืนอุปกรณ์',       icon: '✅', color: 'text-emerald-400' },
        RETURN_BY_MANAGER: { label: 'Manager คืนแทน',  icon: '👔', color: 'text-blue-400' },
        OVERDUE_FLAGGED:   { label: 'เกินกำหนดคืน',    icon: '⏰', color: 'text-red-400' },
      };
      const a = actionLabels[log.action_type] || { label: log.action_type, icon: '📝', color: 'text-slate-400' };
      return `<div class="flex gap-3">
        <div class="flex flex-col items-center">
          <span class="text-lg">${a.icon}</span>
          <div class="w-px flex-1 bg-white/10 mt-1"></div>
        </div>
        <div class="pb-3">
          <p class="${a.color} font-medium text-base">${a.label}</p>
          <p class="text-slate-400 text-sm mt-0.5">โดย ${he(log.actor_name||'-')}</p>
          <p class="text-slate-500 text-sm">${fdFull(log.created_at)}</p>
        </div>
      </div>`;
    }
    async function openRecordDetail(recordId) {
      document.getElementById('record-detail-modal').classList.remove('hidden');
      const r = BORROWS.find(b => (b.record_id||b.id) === recordId);
      if (!r) { document.getElementById('detail-timeline').innerHTML = '<p class="text-slate-500 text-base">ไม่พบข้อมูล</p>'; return; }
      // Lazy-load signatures (not in list query to save bandwidth).
      if (r.sign_img === undefined) {
        try {
          const sigs = await api('getBorrowSignatures', { record_id: r.record_id || r.id });
          r.sign_img = sigs?.sign_img || null;
          r.return_sign_img = sigs?.return_sign_img || null;
        } catch (e) { r.sign_img = null; r.return_sign_img = null; }
      }
      document.getElementById('detail-equipment-name').textContent = r.eq_name || '-';
      const eqRecord = EQ.find(e => e.eq_id === r.eq_id || e.id === r.eq_id);
      const imgEl = document.getElementById('detail-equipment-image');
      const phEl = document.getElementById('detail-equipment-placeholder');
      if (eqRecord?.image_url) { imgEl.src = safeImgUrl(eqRecord.image_url); imgEl.alt = he(r.eq_name) || 'รูปอุปกรณ์'; imgEl.classList.remove('hidden'); phEl.style.display = 'none'; }
      else { imgEl.classList.add('hidden'); phEl.style.display = 'flex'; }
      document.getElementById('detail-borrower-name').textContent = r.borrower_name || '-';
      document.getElementById('detail-borrower-dept').textContent = r.borrower_dept || '-';
      document.getElementById('detail-qty').textContent = `${r.qty_borrowed || 1} ชิ้น`;
      document.getElementById('detail-ga-name').textContent = r.ga_staff || '-';
      document.getElementById('detail-borrow-date').textContent = fd(r.borrowed_at);
      document.getElementById('detail-due-date').textContent = fd(r.due_date);
      const statusMap = {
        borrowed: { label: 'กำลังยืม',  cls: 'bg-amber-100 text-amber-700' },
        overdue:  { label: 'เกินกำหนด', cls: 'bg-[#FFF4E8] text-[#DC6B19]' },
        returned: { label: 'คืนแล้ว',   cls: 'bg-emerald-100 text-emerald-700' },
      };
      const s = statusMap[r.status] || { label: r.status, cls: 'bg-stone-100 text-stone-700' };
      const badge = document.getElementById('detail-status-badge');
      badge.textContent = s.label; badge.className = `shrink-0 px-3 py-1 rounded-full text-sm font-bold ${s.cls}`;
      // Borrow note
      const noteSection = document.getElementById('detail-note-section');
      if (r.note) { noteSection.classList.remove('hidden'); document.getElementById('detail-note').textContent = r.note; }
      else { noteSection.classList.add('hidden'); }
      // Borrow signature
      const sigSection = document.getElementById('detail-signature-section');
      if (r.sign_img) { document.getElementById('detail-signature').src = safeImgUrl(r.sign_img); sigSection.classList.remove('hidden'); }
      else { sigSection.classList.add('hidden'); }
      // Return info section
      const condMap = { normal: 'ปกติ ✓', damaged: '🟡 ชำรุด', lost: '🔴 สูญหาย' };
      const returnSection = document.getElementById('detail-return-section');
      if (r.status === 'returned' || r.returned_at) {
        document.getElementById('detail-return-date').textContent = fd(r.returned_at);
        document.getElementById('detail-condition').textContent = condMap[r.condition_on_return] || '-';
        const condNoteSection = document.getElementById('detail-condition-note-section');
        if (r.condition_note) { condNoteSection.classList.remove('hidden'); document.getElementById('detail-condition-note').textContent = r.condition_note; }
        else { condNoteSection.classList.add('hidden'); }
        returnSection.classList.remove('hidden');
      } else { returnSection.classList.add('hidden'); }
      // Return signature
      const retSignSection = document.getElementById('detail-return-sign-section');
      if (r.return_sign_img) { document.getElementById('detail-return-signature').src = safeImgUrl(r.return_sign_img); retSignSection.classList.remove('hidden'); }
      else { retSignSection.classList.add('hidden'); }
      const timeline = document.getElementById('detail-timeline');
      timeline.innerHTML = '<p class="text-slate-500 text-sm">กำลังโหลดประวัติ...</p>';
      try {
        const { data: logs } = await sb.from('app_audit_logs').select('*').eq('target_id', recordId).order('created_at', { ascending: true }).limit(100);
        timeline.innerHTML = logs?.length ? logs.map(renderTimelineItem).join('') : '<p class="text-slate-500 text-base">ไม่มีประวัติการดำเนินการ</p>';
      } catch(e) { timeline.innerHTML = '<p class="text-slate-500 text-base">โหลดประวัติไม่สำเร็จ</p>'; }
    }
    function closeRecordDetail() { document.getElementById('record-detail-modal').classList.add('hidden'); }
    function printRecord() { window.print(); }

    // ===== ANALYTICS DASHBOARD =====
    let analyticsBarChartInstance = null;
    let analyticsDonutChartInstance = null;
    let analyticsLineChartInstance = null;

    function renderAnalyticsTab() {
      const isMgr = CU.role === 'mgr';
      // Clear both containers to prevent duplicate canvas IDs
      ['tab-analytics-mgr','tab-analytics-ga'].forEach(id => {
        const c = document.getElementById(id);
        if (c) c.innerHTML = '';
      });
      if (analyticsBarChartInstance) { analyticsBarChartInstance.destroy(); analyticsBarChartInstance = null; }
      if (analyticsDonutChartInstance) { analyticsDonutChartInstance.destroy(); analyticsDonutChartInstance = null; }
      if (analyticsLineChartInstance) { analyticsLineChartInstance.destroy(); analyticsLineChartInstance = null; }

      const el = document.getElementById(isMgr ? 'tab-analytics-mgr' : 'tab-analytics-ga');
      if (!el) return;

      el.innerHTML = `<div class="gd-container fade-in">
        <div class="gd-container-header">
          <h2 class="page-title">${isMgr ? 'สถิติภาพรวม' : 'สถิติการยืม'}</h2>
          <p class="text-base text-slate-500 mt-1">${isMgr ? 'ภาพรวมการยืมอุปกรณ์ทั้งหมด' : 'ข้อมูลการยืมของคุณ'}</p>
        </div>
        <div class="filter-bar">
          <div class="filter-top">
            <span class="filter-title">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
              ตัวกรอง
            </span>
            <button onclick="resetAllFilters()" class="filter-reset-btn">ล้างทั้งหมด</button>
          </div>
          <div class="filter-grid">
            <div class="filter-item">
              <label class="filter-label">ช่วงเวลา</label>
              <select id="filterPeriod" onchange="applyFilters()">
                <option value="all">ทุกช่วงเวลา</option>
                <option value="7">7 วันล่าสุด</option>
                <option value="30" selected>เดือนนี้</option>
                <option value="90">3 เดือนล่าสุด</option>
                <option value="custom">กำหนดเอง</option>
              </select>
            </div>
            ${isMgr ? `<div class="filter-item" id="filterStaffWrapper">
              <label class="filter-label">GA Staff</label>
              <select id="filterStaff" onchange="applyFilters()">
                <option value="all">ทุกคน</option>
              </select>
            </div>` : ''}
            <div class="filter-item">
              <label class="filter-label">หมวดหมู่</label>
              <select id="filterCategory" onchange="applyFilters()">
                <option value="all">ทุกหมวดหมู่</option>
              </select>
            </div>
            <div class="filter-item${!isMgr ? ' filter-item-ga-last' : ''}">
              <label class="filter-label">สถานะ</label>
              <select id="filterStatus" onchange="applyFilters()">
                <option value="all">ทุกสถานะ</option>
                <option value="borrowed">กำลังยืม</option>
                <option value="returned">คืนแล้ว</option>
                <option value="overdue">เกินกำหนด</option>
              </select>
            </div>
          </div>
          <div id="filterDateRange" class="filter-daterange" style="display:none">
            <div class="filter-item">
              <label class="filter-label">ตั้งแต่วันที่</label>
              <input type="date" id="filterDateFrom" onchange="applyFilters()">
            </div>
            <div class="filter-item">
              <label class="filter-label">ถึงวันที่</label>
              <input type="date" id="filterDateTo" onchange="applyFilters()">
            </div>
          </div>
          <div id="activeChips" class="active-chips" style="display:none">
            <span class="chips-label">กรองโดย:</span>
            <div id="chipsContainer"></div>
          </div>
        </div>
        <div class="analytics-kpi-grid">
          <div class="analytics-kpi tint-orange">
            <span class="kpi-label">ยืมทั้งหมด</span>
            <span class="kpi-value orange" id="kpiTotal">-</span>
          </div>
          <div class="analytics-kpi tint-green">
            <span class="kpi-label">คืนแล้ว</span>
            <span class="kpi-value green" id="kpiReturned">-</span>
          </div>
          <div class="analytics-kpi tint-blue">
            <span class="kpi-label">กำลังยืม</span>
            <span class="kpi-value" id="kpiBorrowed">-</span>
          </div>
          <div class="analytics-kpi danger">
            <span class="kpi-label red">เกินกำหนด</span>
            <span class="kpi-value red" id="kpiOverdue">-</span>
          </div>
        </div>
        <div class="charts-row-2">
          <div class="chart-card">
            <p class="chart-card-title">ยืมรายเดือน</p>
            <div style="position:relative;height:200px">
              <canvas id="analyticsBarChart" role="img" aria-label="Bar chart แสดงจำนวนการยืมรายเดือน">ข้อมูลยืมรายเดือน</canvas>
              <div id="barChartEmpty" class="chart-empty-msg">ไม่มีข้อมูลในช่วงเวลานี้</div>
            </div>
          </div>
          <div class="chart-card">
            <p class="chart-card-title">สัดส่วนตามหมวดหมู่</p>
            <div id="donutLegend" class="chart-legend"></div>
            <div style="position:relative;height:160px">
              <canvas id="analyticsDonutChart" role="img" aria-label="Donut chart สัดส่วนหมวดหมู่อุปกรณ์">สัดส่วนหมวดหมู่</canvas>
              <div id="donutChartEmpty" class="chart-empty-msg">ไม่มีข้อมูลในช่วงเวลานี้</div>
            </div>
          </div>
        </div>
        <div class="chart-card" style="margin-bottom:12px">
          <p class="chart-card-title">แนวโน้มการยืมรายสัปดาห์</p>
          <div class="chart-legend">
            <span><span class="leg-sq" style="background:#f97316"></span>ยืม</span>
            <span><span class="leg-sq" style="background:#10b981"></span>คืน</span>
            <span><span class="leg-sq" style="background:#DC6B19"></span>เกินกำหนด</span>
          </div>
          <div style="position:relative;height:200px">
            <canvas id="analyticsLineChart" role="img" aria-label="แนวโน้มการยืมรายสัปดาห์">แนวโน้มการยืม</canvas>
            <div id="lineChartEmpty" class="chart-empty-msg">ไม่มีข้อมูลในช่วงเวลานี้</div>
          </div>
        </div>
        ${isMgr ? `<div class="chart-card" id="staffSummarySection">
          <p class="chart-card-title">สรุปรายบุคคล</p>
          <div style="overflow-x:auto">
            <table id="staffSummaryTable" style="width:100%;font-size:13px;border-collapse:collapse">
              <thead>
                <tr style="border-bottom:1px solid #e7e5e4">
                  <th style="text-align:left;padding:8px;color:#a8a29e;font-weight:500">เจ้าหน้าที่ GA</th>
                  <th style="text-align:center;padding:8px;color:#a8a29e;font-weight:500">ยืมทั้งหมด</th>
                  <th style="text-align:center;padding:8px;color:#a8a29e;font-weight:500">คืนแล้ว</th>
                  <th style="text-align:center;padding:8px;color:#a8a29e;font-weight:500">กำลังยืม</th>
                  <th style="text-align:center;padding:8px;color:#a8a29e;font-weight:500">เกินกำหนด</th>
                </tr>
              </thead>
              <tbody id="staffSummaryBody"></tbody>
            </table>
          </div>
        </div>
        <div class="chart-card" id="feedbackSection">
          <p class="chart-card-title">ความคิดเห็นจากการประเมิน</p>
          <div id="feedbackList"></div>
        </div>` : ''}
      </div>`;

      if (isMgr) populateStaffFilter();
      populateCategoryFilter();
      lucide.createIcons({'stroke-width': 1.5});
      applyFilters();
    }

    function applyFilters() {
      const isMgr = CU?.role === 'mgr';
      const period = document.getElementById('filterPeriod')?.value || 'all';
      const staff = document.getElementById('filterStaff')?.value || 'all';
      const category = document.getElementById('filterCategory')?.value || 'all';
      const status = document.getElementById('filterStatus')?.value || 'all';
      const dateFrom = document.getElementById('filterDateFrom')?.value || '';
      const dateTo = document.getElementById('filterDateTo')?.value || '';

      // Show/hide custom date range row
      const drEl = document.getElementById('filterDateRange');
      if (drEl) drEl.style.display = period === 'custom' ? 'grid' : 'none';

      let filtered = [...BORROWS];

      if (period === 'custom') {
        if (dateFrom) {
          const from = new Date(dateFrom);
          from.setHours(0, 0, 0, 0);
          filtered = filtered.filter(r => new Date(r.borrowed_at) >= from);
        }
        if (dateTo) {
          const to = new Date(dateTo);
          to.setHours(23, 59, 59, 999);
          filtered = filtered.filter(r => new Date(r.borrowed_at) <= to);
        }
      } else if (period !== 'all') {
        const days = parseInt(period);
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        filtered = filtered.filter(r => new Date(r.borrowed_at) >= cutoff);
      }

      if (staff !== 'all') {
        filtered = filtered.filter(r => r.ga_staff === staff);
      }

      if (category !== 'all') {
        filtered = filtered.filter(r => {
          const eq = EQ.find(e => e.eq_id === r.eq_id || e.id === r.eq_id);
          return eq?.category === category;
        });
      }

      if (status !== 'all') {
        filtered = filtered.filter(r => r.status === status);
      }

      updateActiveChips({ period, staff, category, status, dateFrom, dateTo });
      updateKPIs(filtered);
      updateBarChart(filtered);
      updateDonutChart(filtered);
      updateLineChart(filtered);
      if (isMgr) { updateStaffTable(filtered); updateFeedbackSection(filtered); }
    }

    function updateKPIs(data) {
      countUp(document.getElementById('kpiTotal'),    data.length);
      countUp(document.getElementById('kpiReturned'), data.filter(r => r.status === 'returned').length);
      countUp(document.getElementById('kpiBorrowed'), data.filter(r => r.status === 'borrowed').length);
      countUp(document.getElementById('kpiOverdue'),  data.filter(r => r.status === 'overdue').length);
    }

    function updateBarChart(data) {
      const canvas = document.getElementById('analyticsBarChart');
      if (!canvas) return;
      const months = {};
      data.forEach(r => {
        if (!r.borrowed_at) return;
        const d = new Date(r.borrowed_at);
        const key = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
        if (!months[key]) months[key] = { label: d.toLocaleDateString('th-TH', {month:'short', year:'2-digit'}), count: 0 };
        months[key].count++;
      });
      const sortedKeys = Object.keys(months).sort().slice(-6);
      const labels = sortedKeys.map(k => months[k].label);
      const values = sortedKeys.map(k => months[k].count);
      const barEmpty = document.getElementById('barChartEmpty');
      if (sortedKeys.length === 0) {
        canvas.style.display = 'none';
        if (barEmpty) barEmpty.style.display = 'flex';
        if (analyticsBarChartInstance) { analyticsBarChartInstance.destroy(); analyticsBarChartInstance = null; }
        return;
      }
      canvas.style.display = '';
      if (barEmpty) barEmpty.style.display = 'none';
      if (analyticsBarChartInstance) analyticsBarChartInstance.destroy();
      const ctx = canvas.getContext('2d');
      let barFill = '#F97316';
      if (ctx) {
        const grad = ctx.createLinearGradient(0, 0, 0, canvas.height || 200);
        grad.addColorStop(0, 'rgba(249,115,22,0.95)');
        grad.addColorStop(1, 'rgba(249,115,22,0.65)');
        barFill = grad;
      }
      analyticsBarChartInstance = new Chart(canvas, {
        type: 'bar',
        data: { labels, datasets: [{ data: values, backgroundColor: barFill, borderRadius: 4 }] },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (ctx) => `${ctx.dataset.label || 'ยืม'}: ${ctx.parsed.y ?? ctx.parsed} รายการ`
              }
            }
          },
          scales: {
            x: { ticks: { font: { size: 11, family: 'Prompt' }, autoSkip: false } },
            y: { ticks: { font: { size: 11 } }, beginAtZero: true }
          }
        }
      });
    }

    function updateDonutChart(data) {
      const canvas = document.getElementById('analyticsDonutChart');
      if (!canvas) return;
      const cats = {};
      data.forEach(r => {
        const eq = EQ.find(e => e.eq_id === r.eq_id || e.id === r.eq_id);
        const name = eq?.category || 'อื่นๆ';
        cats[name] = (cats[name] || 0) + 1;
      });
      const labels = Object.keys(cats);
      const values = Object.values(cats);
      const colors = ['#f97316','#fb923c','#fdba74','#fed7aa','#fde68a','#d97706'];
      const total = values.reduce((a,b) => a+b, 0) || 1;
      const legendEl = document.getElementById('donutLegend');
      const donutEmpty = document.getElementById('donutChartEmpty');
      if (legendEl) {
        legendEl.innerHTML = labels.length
          ? labels.map((l,i) => `<span><span class="leg-sq" style="background:${colors[i%colors.length]}"></span>${he(l)} ${Math.round(values[i]/total*100)}%</span>`).join('')
          : '<span style="color:#a8a29e">ไม่มีข้อมูล</span>';
      }
      if (labels.length === 0) {
        canvas.style.display = 'none';
        if (donutEmpty) donutEmpty.style.display = 'flex';
        if (analyticsDonutChartInstance) { analyticsDonutChartInstance.destroy(); analyticsDonutChartInstance = null; }
        return;
      }
      canvas.style.display = '';
      if (donutEmpty) donutEmpty.style.display = 'none';
      if (analyticsDonutChartInstance) analyticsDonutChartInstance.destroy();
      analyticsDonutChartInstance = new Chart(canvas, {
        type: 'doughnut',
        data: { labels, datasets: [{ data: values, backgroundColor: colors.slice(0, labels.length), borderWidth: 0 }] },
        plugins: [{
          id: 'centerText',
          beforeDraw(chart) {
            const { ctx, chartArea } = chart;
            if (!ctx || !chartArea) return;
            const totalValue = values.reduce((a,b)=>a+b,0);
            const cx = (chartArea.left + chartArea.right) / 2;
            const cy = (chartArea.top + chartArea.bottom) / 2;
            ctx.save();
            ctx.font = 'bold 20px Prompt';
            ctx.fillStyle = '#1C1917';
            ctx.textAlign = 'center';
            ctx.fillText(String(totalValue), cx, cy + 8);
            ctx.restore();
          }
        }],
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          cutout: '65%'
        }
      });
    }

    function updateLineChart(data) {
      const canvas = document.getElementById('analyticsLineChart');
      if (!canvas) return;
      const weeks = {};
      data.forEach(r => {
        if (!r.borrowed_at) return;
        const d = new Date(r.borrowed_at);
        const yr = d.getFullYear();
        const wn = Math.ceil((d.getDate() + new Date(yr, d.getMonth(), 1).getDay()) / 7);
        const key = `${yr}-${String(d.getMonth()+1).padStart(2,'0')}-W${wn}`;
        if (!weeks[key]) weeks[key] = { label: `W${wn} ${d.toLocaleDateString('th-TH',{month:'short'})}`, borrowed:0, returned:0, overdue:0 };
        weeks[key].borrowed++;
        if (r.status === 'returned') weeks[key].returned++;
        if (r.status === 'overdue') weeks[key].overdue++;
      });
      const sortedKeys = Object.keys(weeks).sort().slice(-8);
      const labels = sortedKeys.map(k => weeks[k].label);
      const lineEmpty = document.getElementById('lineChartEmpty');
      if (sortedKeys.length === 0) {
        canvas.style.display = 'none';
        if (lineEmpty) lineEmpty.style.display = 'flex';
        if (analyticsLineChartInstance) { analyticsLineChartInstance.destroy(); analyticsLineChartInstance = null; }
        return;
      }
      canvas.style.display = '';
      if (lineEmpty) lineEmpty.style.display = 'none';
      if (analyticsLineChartInstance) analyticsLineChartInstance.destroy();
      analyticsLineChartInstance = new Chart(canvas, {
        type: 'line',
        data: {
          labels,
          datasets: [
            { label:'ยืม', data: sortedKeys.map(k => weeks[k].borrowed), borderColor:'#f97316', backgroundColor:'rgba(249,115,22,0.08)', tension:0.4, fill:true, pointRadius:3 },
            { label:'คืน', data: sortedKeys.map(k => weeks[k].returned), borderColor:'#10b981', backgroundColor:'transparent', tension:0.4, pointRadius:3, fill:false },
            { label:'เกิน', data: sortedKeys.map(k => weeks[k].overdue), borderColor:'#DC6B19', borderDash:[4,4], backgroundColor:'transparent', tension:0.4, pointRadius:3 }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y} รายการ`
              }
            }
          },
          scales: {
            x: { ticks: { font: { size: 11, family: 'Prompt' }, autoSkip: false, maxRotation: 45 } },
            y: { ticks: { font: { size: 11 } }, beginAtZero: true }
          }
        }
      });
    }

    function updateStaffTable(data) {
      const tbody = document.getElementById('staffSummaryBody');
      const thead = document.querySelector('#staffSummaryTable thead tr');
      if (!tbody) return;
      const staffMap = {};
      data.forEach(r => {
        const name = r.ga_staff || 'ไม่ระบุ';
        if (!staffMap[name]) staffMap[name] = { total:0, returned:0, borrowed:0, overdue:0, ratingSum:0, ratingCount:0 };
        staffMap[name].total++;
        if (r.status === 'returned') staffMap[name].returned++;
        if (r.status === 'borrowed') staffMap[name].borrowed++;
        if (r.status === 'overdue') staffMap[name].overdue++;
        if (r.service_rating) { staffMap[name].ratingSum += r.service_rating; staffMap[name].ratingCount++; }
      });
      if (thead && !thead.querySelector('.rating-col-header')) {
        const th = document.createElement('th');
        th.className = 'rating-col-header';
        th.style = 'text-align:center;padding:8px;color:#a8a29e;font-weight:500';
        th.textContent = '★ คะแนน';
        thead.appendChild(th);
      }
      tbody.innerHTML = Object.entries(staffMap)
        .sort((a,b) => b[1].total - a[1].total)
        .map(([name, s]) => {
          const avg = s.ratingCount ? (s.ratingSum / s.ratingCount).toFixed(1) : null;
          const ratingCell = avg
            ? `<span style="color:#f59e0b;font-weight:600">${avg}</span><span style="color:#d1d5db;font-size:11px"> (${s.ratingCount})</span>`
            : `<span style="color:#d1d5db">—</span>`;
          return `<tr style="border-bottom:0.5px solid #f5f5f4">
            <td style="padding:8px;font-weight:500">${he(name)}</td>
            <td style="text-align:center;padding:8px">${s.total}</td>
            <td style="text-align:center;padding:8px;color:#10b981">${s.returned}</td>
            <td style="text-align:center;padding:8px">${s.borrowed}</td>
            <td style="text-align:center;padding:8px;color:${s.overdue>0?'#DC6B19':'inherit'}">${s.overdue}</td>
            <td style="text-align:center;padding:8px">${ratingCell}</td>
          </tr>`;
        }).join('') || `<tr><td colspan="6" style="padding:16px;text-align:center;color:#a8a29e;font-size:13px">ไม่มีข้อมูล</td></tr>`;
    }

    function updateFeedbackSection(data) {
      const el = document.getElementById('feedbackList');
      if (!el) return;
      const items = [...data]
        .filter(r => r.service_rating)
        .sort((a,b) => new Date(b.returned_at||b.borrowed_at) - new Date(a.returned_at||a.borrowed_at));
      if (!items.length) {
        el.innerHTML = `<p style="text-align:center;color:#a8a29e;font-size:13px;padding:16px 0">ไม่มีข้อมูลการประเมินในช่วงเวลานี้</p>`;
        return;
      }
      el.innerHTML = items.map(r => `
        <div style="padding:10px 0;border-bottom:0.5px solid #f5f5f4;last-child:border-0">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:4px">
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
              <span style="color:#f59e0b;font-size:13px;line-height:1">${'★'.repeat(r.service_rating)}${'☆'.repeat(5-r.service_rating)}</span>
              <span style="font-size:12px;font-weight:500;color:#1c1917">${he(r.borrower_name)}</span>
              <span style="font-size:11px;color:#a8a29e">· GA: ${he(r.ga_staff||'—')}</span>
            </div>
            <span style="font-size:11px;color:#a8a29e;white-space:nowrap;flex-shrink:0">${fd(r.returned_at||r.borrowed_at)}</span>
          </div>
          <p style="font-size:12px;color:#57534e;margin:0;padding-left:2px">${r.service_feedback ? he(r.service_feedback) : '<span style="color:#d1d5db;font-style:italic">ไม่มีความคิดเห็น</span>'}</p>
          <p style="font-size:11px;color:#d1d5db;margin:2px 0 0;padding-left:2px">${he(r.eq_name)}</p>
        </div>`).join('');
    }

    function updateActiveChips(filters) {
      const periodLabels = { '7':'7 วันล่าสุด','30':'เดือนนี้','90':'3 เดือนล่าสุด' };
      const statusLabels = { borrowed:'กำลังยืม', returned:'คืนแล้ว', overdue:'เกินกำหนด' };
      const chips = [];
      if (filters.period === 'custom') {
        const parts = [];
        if (filters.dateFrom) parts.push(filters.dateFrom.split('-').reverse().join('/'));
        if (filters.dateTo) parts.push(filters.dateTo.split('-').reverse().join('/'));
        if (parts.length > 0) chips.push({ label: parts.length === 2 ? `${parts[0]} – ${parts[1]}` : (filters.dateFrom ? `ตั้งแต่ ${parts[0]}` : `ถึง ${parts[0]}`), key:'period' });
      } else if (filters.period !== 'all') {
        chips.push({ label: periodLabels[filters.period] || filters.period, key:'period' });
      }
      if (filters.staff !== 'all') {
        const el = document.getElementById('filterStaff');
        const label = el?.options[el.selectedIndex]?.text;
        if (label) chips.push({ label, key:'staff' });
      }
      if (filters.category !== 'all') {
        const el = document.getElementById('filterCategory');
        const label = el?.options[el.selectedIndex]?.text;
        if (label) chips.push({ label, key:'category' });
      }
      if (filters.status !== 'all') chips.push({ label: statusLabels[filters.status] || filters.status, key:'status' });
      const container = document.getElementById('chipsContainer');
      const wrapper = document.getElementById('activeChips');
      if (!container || !wrapper) return;
      if (chips.length === 0) { wrapper.style.display = 'none'; return; }
      wrapper.style.display = 'flex';
      container.innerHTML = chips.map(c => `<div class="filter-chip">${he(c.label)}<button class="chip-remove" onclick="removeFilter('${c.key}')">×</button></div>`).join('');
    }

    function removeFilter(key) {
      const defaults = { period:'all', staff:'all', category:'all', status:'all' };
      const el = document.getElementById('filter' + key.charAt(0).toUpperCase() + key.slice(1));
      if (el) el.value = defaults[key];
      if (key === 'period') {
        ['filterDateFrom','filterDateTo'].forEach(id => { const e = document.getElementById(id); if (e) e.value = ''; });
      }
      applyFilters();
    }

    function resetAllFilters() {
      ['filterPeriod','filterStaff','filterCategory','filterStatus'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = 'all';
      });
      ['filterDateFrom','filterDateTo'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      const drEl = document.getElementById('filterDateRange');
      if (drEl) drEl.style.display = 'none';
      applyFilters();
    }

    function populateStaffFilter() {
      const staffNames = [...new Set(BORROWS.map(r => r.ga_staff).filter(Boolean))].sort();
      const select = document.getElementById('filterStaff');
      if (!select) return;
      staffNames.forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        select.appendChild(opt);
      });
    }

    function populateCategoryFilter() {
      const select = document.getElementById('filterCategory');
      if (!select) return;
      (CATS || []).forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.name;
        opt.textContent = c.name;
        select.appendChild(opt);
      });
    }

    // Start app
    document.addEventListener('DOMContentLoaded', () => init());
