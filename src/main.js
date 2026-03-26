import './style.css';
import Loki from 'lokijs';

/**
 * HOSTEL HUB - CORE ENGINE
 * Relational DBMS Simulation Layer via LokiJS
 */

const db = new Loki('hostel.db', {
  autoload: true,
  autoloadCallback: initializeDatabase,
  autosave: true,
  autosaveInterval: 4000
});

let rooms, students, attendance, logs, complaints, notices, payments, feeStructure;

// --- GLOBAL STATE & ENGINE ---
window.HUB = {
  isLoggedIn: sessionStorage.getItem('hub_auth') === 'true',
  userRole: sessionStorage.getItem('hub_role') || 'admin', // 'admin' or 'user'
  currentUser: JSON.parse(sessionStorage.getItem('hub_user') || 'null'),
  view: 'dashboard',
  modal: null,
  selectedId: null,
  searchQuery: '',
  selectedDate: new Date().toISOString().split('T')[0],
  apiUrl: 'http://localhost:5000/api',

  // API Syncing (MySQL Connection)
  SYNC: {
    fetch: async (endpoint) => {
      try {
        const response = await fetch(`${window.HUB.apiUrl}/${endpoint}`);
        return await response.json();
      } catch (e) {
        console.error(`API Fetch Error (${endpoint}):`, e);
        return null;
      }
    },
    push: async (endpoint, data) => {
      try {
        const response = await fetch(`${window.HUB.apiUrl}/${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        return await response.json();
      } catch (e) {
        console.error(`API Push Error (${endpoint}):`, e);
        return null;
      }
    },
    drop: async (endpoint, id) => {
      try {
        const response = await fetch(`${window.HUB.apiUrl}/${endpoint}/${id}`, {
          method: 'DELETE'
        });
        return await response.json();
      } catch (e) {
        console.error(`API Drop Error (${endpoint}):`, e);
        return null;
      }
    }
  },

  // Authentication
  login: (username, password) => {
    // 1. Admin Creds
    if (username === 'admin' && password === 'admin') {
      window.HUB.isLoggedIn = true;
      window.HUB.userRole = 'admin';
      window.HUB.currentUser = { name: 'System Administrator' };
      sessionStorage.setItem('hub_auth', 'true');
      sessionStorage.setItem('hub_role', 'admin');
      sessionStorage.setItem('hub_user', JSON.stringify(window.HUB.currentUser));
      window.HUB.ENGINE.log('AUTH_LOGIN', 'system', { user: 'admin', role: 'admin' });
      window.HUB.render();
      return;
    }

    // 2. Dynamic Resident Login
    // Check if username is 'user' (demo) or a valid resident email
    let resident = null;
    if (username === 'user' && password === 'user') {
      resident = students.data[0]; // Take the first resident for the demo
    } else {
      resident = students.findOne({ email: username });
    }

    if (resident && (password === 'user' || password === 'pass' || password === resident.id.toString())) {
      window.HUB.isLoggedIn = true;
      window.HUB.userRole = 'user';
      window.HUB.currentUser = resident;
      sessionStorage.setItem('hub_auth', 'true');
      sessionStorage.setItem('hub_role', 'user');
      sessionStorage.setItem('hub_user', JSON.stringify(window.HUB.currentUser));
      window.HUB.ENGINE.log('AUTH_LOGIN', 'system', { user: resident.name, role: 'user' });
      window.HUB.render();
    } else {
      alert("Invalid credentials. \n\nMASTER: admin / admin \nRESIDENT: Use your registered email \nDEMO: user / user");
    }
  },

  logout: () => {
    window.HUB.isLoggedIn = false;
    window.HUB.userRole = 'admin';
    window.HUB.currentUser = null;
    sessionStorage.removeItem('hub_auth');
    sessionStorage.removeItem('hub_role');
    sessionStorage.removeItem('hub_user');
    window.HUB.render();
  },

  // Core Operations (DML / Constraints / Triggers)
  ENGINE: {
    log: (action, table, details) => {
      if (logs) {
        const entry = logs.insert({ timestamp: new Date(), action, table, details });
        window.HUB.SYNC.push('logs', [entry]);
      }
    },

    addStudent: async (name, email, phone) => {
      if (students.findOne({ email })) throw new Error("A student with this email is already registered.");

      // Push to MySQL first to get the real ID
      const res = await window.HUB.SYNC.push('students', [{ name, email, phone, roomId: null }]);

      if (res && res.success) {
        // Use database ID
        const s = students.insert({ id: res.details[0].id, name, email, phone, roomId: null });
        window.HUB.ENGINE.log('REGISTER', 'students', { name: s.name });
        window.HUB.render();
      } else {
        const errorMsg = res?.error || "Unknown database error";
        throw new Error(`Registration Sync Failed: ${errorMsg}`);
      }
    },

    addRoom: async (number, type, capacity) => {
      if (rooms.findOne({ number })) throw new Error("This room number already exists.");

      const res = await window.HUB.SYNC.push('rooms', [{ number, type, capacity: parseInt(capacity) }]);

      if (res && res.success) {
        const r = rooms.insert({ id: res.details[0].id, number, type, capacity: parseInt(capacity) });
        window.HUB.ENGINE.log('CREATE_ROOM', 'rooms', { number: r.number });
        window.HUB.render();
      } else {
        const errorMsg = res?.error || "Unknown database error";
        throw new Error(`Database Sync Failed: ${errorMsg}`);
      }
    },

    allocate: async (studentId, roomId) => {
      const student = students.findOne({ id: studentId });
      if (!student) return;

      if (roomId) {
        const room = rooms.findOne({ id: parseInt(roomId) });
        if (room) {
          const current = students.find({ roomId: parseInt(roomId) }).length;
          if (current >= room.capacity && student.roomId !== parseInt(roomId)) {
            throw new Error("This room is already at full capacity.");
          }
        }
      }

      // Sync to MySQL First
      const res = await window.HUB.SYNC.push('students', [{
        email: student.email,
        name: student.name,
        roomId: roomId ? parseInt(roomId) : null
      }]);

      if (res && res.success) {
        const prevRoomId = student.roomId;
        student.roomId = roomId ? parseInt(roomId) : null;
        students.update(student);
        window.HUB.ENGINE.log('ALLOCATE', 'students', { student: student.name, from: prevRoomId, to: roomId });
        window.HUB.render();
      } else {
        throw new Error("Allocation Sync Failed");
      }
    },

    deleteStudent: async (id) => {
      const s = students.findOne({ id });
      if (s && confirm(`Are you sure you want to remove ${s.name}?`)) {
        const res = await window.HUB.SYNC.drop('students', id);
        if (res && res.success) {
          attendance.find({ studentId: id }).forEach(r => attendance.remove(r));
          students.remove(s);
          window.HUB.ENGINE.log('DELETE', 'students', { name: s.name });
          window.HUB.render();
        } else {
          alert("Delete Failed: Synchronisation error.");
        }
      }
    },

    deleteRoom: async (id) => {
      const r = rooms.findOne({ id });
      if (r && confirm(`Delete Room ${r.number}?`)) {
        const res = await window.HUB.SYNC.drop('rooms', id);
        if (res && res.success) {
          students.find({ roomId: id }).forEach(s => { s.roomId = null; students.update(s); });
          rooms.remove(r);
          window.HUB.ENGINE.log('DROP_ROOM', 'rooms', { number: r.number });
          window.HUB.render();
        } else {
          alert("Delete Failed: Room has residents or sync error.");
        }
      }
    },

    toggleAttendance: async (studentId, isPresent) => {
      if (!attendance) return;
      const date = window.HUB.selectedDate;
      const existing = attendance.findOne({ studentId: parseInt(studentId), date });

      if (isPresent && !existing) {
        attendance.insert({ studentId: parseInt(studentId), date });
        window.HUB.ENGINE.log('ATTENDANCE', 'presence', { id: studentId, status: 'Present', date });
      } else if (!isPresent && existing) {
        attendance.remove(existing);
        window.HUB.ENGINE.log('ATTENDANCE', 'presence', { id: studentId, status: 'Absent', date });
      }

      // Sync to MySQL
      const res = await window.HUB.SYNC.push('attendance', [{ studentId: parseInt(studentId), date, is_present: isPresent }]);

      if (!res || !res.success) {
        console.error("Attendance Sync Failed");
        // Revert local state if needed, but for now just log
      }

      window.HUB.render();
    },

    addComplaint: async (title, message) => {
      if (!complaints || !window.HUB.currentUser?.id) throw new Error("Authentication required.");

      const res = await window.HUB.SYNC.push('complaints', [{
        studentId: parseInt(window.HUB.currentUser.id),
        title,
        message,
        status: 'Pending'
      }]);

      if (res && res.success) {
        const c = complaints.insert({
          id: res.details[0].id,
          studentId: parseInt(window.HUB.currentUser.id),
          studentName: window.HUB.currentUser.name,
          title,
          message,
          status: 'Pending',
          timestamp: new Date()
        });
        window.HUB.ENGINE.log('COMPLAINT_FILED', 'complaints', { title: c.title, from: c.studentName });
        window.HUB.render();
      } else {
        const errorMsg = res?.error || "Database sync failed";
        throw new Error(`Report Failed: ${errorMsg}`);
      }
    },

    resolveComplaint: async (id) => {
      if (!complaints) return;
      const c = complaints.findOne({ id });
      if (c) {
        const prevStatus = c.status;
        c.status = 'Resolved';
        c.resolvedAt = new Date();

        const res = await window.HUB.SYNC.push('complaints', [c]);

        if (res && res.success) {
          complaints.update(c);
          window.HUB.ENGINE.log('COMPLAINT_RESOLVED', 'complaints', { id });
          window.HUB.render();
        } else {
          c.status = prevStatus; // Rollback
          alert("Status Update Failed");
        }
      }
    },

    // Financial Engine (DML)
    addPayment: async (studentId, amount, method) => {
      if (!payments) return;
      const student = students.findOne({ id: parseInt(studentId) });

      const res = await window.HUB.SYNC.push('payments', [{
        studentId: student.id,
        amount: parseFloat(amount),
        method
      }]);

      if (res && res.success) {
        const p = payments.insert({
          id: res.details[0].id,
          studentId: student.id,
          studentName: student.name,
          amount: parseFloat(amount),
          method,
          timestamp: new Date()
        });
        window.HUB.ENGINE.log('PAYMENT_RECEIVED', 'payments', { student: student.name, amount });
        window.HUB.render();
      } else {
        const errorMsg = res?.error || "Database sync failed";
        throw new Error(`Payment Failed: ${errorMsg}`);
      }
    },

    updateFee: async (roomType, amount) => {
      if (!feeStructure) return;

      const res = await window.HUB.SYNC.push('fees', [{ type: roomType, amount: parseFloat(amount) }]);

      if (res && res.success) {
        let fee = feeStructure.findOne({ type: roomType });
        if (fee) {
          fee.amount = parseFloat(amount);
          feeStructure.update(fee);
        } else {
          feeStructure.insert({ type: roomType, amount: parseFloat(amount) });
        }
        window.HUB.ENGINE.log('FEE_UPDATED', 'feeStructure', { type: roomType, amount });
        window.HUB.render();
      } else {
        alert("Fee Update Failed in DB");
      }
    },

    addNotice: async (text, priority = 'Normal') => {
      if (!notices) return;

      const res = await window.HUB.SYNC.push('notices', [{ text, priority }]);

      if (res && res.success) {
        const n = notices.insert({ id: res.details[0].id, text, priority, timestamp: new Date() });
        window.HUB.ENGINE.log('POST_NOTICE', 'notices', { text: text.substring(0, 20), priority });
        window.HUB.render();
      } else {
        alert("Board Update Failed");
      }
    },

    deleteNotice: async (id) => {
      if (!notices) return;
      const n = notices.findOne({ id: parseInt(id) });
      if (n) {
        if (confirm("Delete this notice?")) {
          const res = await window.HUB.SYNC.drop('notices', id);
          if (res && res.success) {
            notices.remove(n);
            window.HUB.ENGINE.log('DELETE_NOTICE', 'notices', { id });
            window.HUB.render();
          } else {
            alert("Delete failed on server.");
          }
        }
      }
    }
  },

  // Query/Analytics
  ANALYTICS: {
    getStats: () => {
      const totalBeds = (rooms && rooms.data) ? rooms.data.reduce((a, r) => a + r.capacity, 0) : 0;
      const occupiedBeds = students ? students.find({ roomId: { '$ne': null } }).length : 0;
      const present = attendance ? attendance.find({ date: window.HUB.selectedDate }).length : 0;
      const totalS = students ? students.count() : 0;

      return {
        occupancy: totalBeds ? Math.round((occupiedBeds / totalBeds) * 100) : 0,
        attendance: totalS ? Math.round((present / totalS) * 100) : 0,
        totalStudents: totalS,
        freeBeds: totalBeds - occupiedBeds
      };
    },

    getRoomUsage: () => {
      if (!rooms || !rooms.data) return [];
      return rooms.data.map(r => {
        const occ = students.find({ roomId: r.id }).length;
        return { ...r, occupancy: occ, percent: Math.round((occ / r.capacity) * 100) };
      });
    },

    getFinancialReport: () => {
      if (!students || !feeStructure || !payments) return [];
      return students.data.map(s => {
        const room = rooms.findOne({ id: s.roomId });
        const fee = room ? (feeStructure.findOne({ type: room.type })?.amount || 0) : 0;
        const paid = payments.find({ studentId: s.id }).reduce((a, b) => a + b.amount, 0);
        return {
          student: s.name,
          roomId: room ? room.number : 'N/A',
          totalDue: fee,
          totalPaid: paid,
          balance: fee - paid
        };
      });
    }
  }
};

function initializeDatabase() {
  rooms = db.getCollection('rooms') || db.addCollection('rooms', { unique: ['number'], indices: ['id'] });
  students = db.getCollection('students') || db.addCollection('students', { unique: ['email'], indices: ['id', 'roomId'] });
  attendance = db.getCollection('attendance') || db.addCollection('attendance', { indices: ['date', 'studentId'] });
  logs = db.getCollection('logs') || db.addCollection('logs');
  complaints = db.getCollection('complaints') || db.addCollection('complaints', { indices: ['studentId', 'status'] });
  notices = db.getCollection('notices') || db.addCollection('notices');
  payments = db.getCollection('payments') || db.addCollection('payments', { indices: ['studentId'] });
  feeStructure = db.getCollection('feeStructure') || db.addCollection('feeStructure', { unique: ['type'] });

  window.HUB.render();

  // --- AUTOMATIC MYSQL SYNCHRONIZATION ---

  const syncEverything = async () => {
    try {
      console.log('🔄 Auto-syncing from MySQL...');

      // 1. Sync Rooms FIRST
      try {
        const rData = await window.HUB.SYNC.fetch('rooms');
        if (rData && Array.isArray(rData)) {
          rooms.clear();
          rData.forEach(r => rooms.insert({ id: parseInt(r.id), number: r.room_number, type: r.room_type, capacity: parseInt(r.capacity) }));
        }
      } catch (e) { console.warn('Room sync fail'); }

      // 2. Sync Students
      try {
        const sData = await window.HUB.SYNC.fetch('students');
        if (sData && Array.isArray(sData)) {
          students.clear();
          sData.forEach(s => students.insert({ id: parseInt(s.id), name: s.name, email: s.email, phone: s.phone, roomId: s.room_id ? parseInt(s.room_id) : null }));
        }
      } catch (e) { console.warn('Student sync fail'); }

      // 3. Sync Notices
      try {
        const nData = await window.HUB.SYNC.fetch('notices');
        if (nData && Array.isArray(nData)) {
          notices.clear();
          nData.forEach(n => notices.insert({ id: parseInt(n.id), text: n.notice_text, priority: n.priority, timestamp: n.posted_at ? new Date(n.posted_at) : new Date() }));
        }
      } catch (e) { console.warn('Notice sync fail'); }

      // 4. Sync Complaints
      try {
        const cData = await window.HUB.SYNC.fetch('complaints');
        if (cData && Array.isArray(cData)) {
          complaints.clear();
          cData.forEach(c => complaints.insert({
            id: parseInt(c.id),
            studentId: parseInt(c.student_id),
            studentName: c.student_name || 'Resident',
            title: c.title,
            message: c.description,
            status: c.status,
            timestamp: c.created_at ? new Date(c.created_at) : new Date()
          }));
        }
      } catch (e) { console.warn('Complaint sync fail'); }

      // 5. Financial Systems
      try {
        const pData = await window.HUB.SYNC.fetch('payments');
        if (pData && Array.isArray(pData)) {
          payments.clear();
          pData.forEach(p => payments.insert({
            id: parseInt(p.id),
            studentId: parseInt(p.student_id),
            studentName: p.student_name || 'Resident',
            amount: parseFloat(p.amount),
            method: p.payment_method,
            timestamp: p.payment_date ? new Date(p.payment_date) : new Date()
          }));
        }
      } catch (e) { console.warn('Payment sync fail'); }

      try {
        const aData = await window.HUB.SYNC.fetch('attendance');
        if (aData && Array.isArray(aData)) {
          attendance.clear();
          aData.forEach(a => attendance.insert({ id: parseInt(a.id), studentId: parseInt(a.student_id), date: a.attendance_date, isPresent: !!a.is_present }));
        }
      } catch (e) { console.warn('Attendance sync fail'); }

      try {
        const fData = await window.HUB.SYNC.fetch('fees');
        if (fData && Array.isArray(fData)) {
          feeStructure.clear();
          fData.forEach(f => feeStructure.insert({ type: f.room_type, amount: parseFloat(f.monthly_fee) }));
        }
      } catch (e) { console.warn('Fee sync fail'); }

      const lData = await window.HUB.SYNC.fetch('logs');
      if (lData && Array.isArray(lData)) {
        logs.clear();
        lData.forEach(l => logs.insert({
          id: parseInt(l.id),
          action: l.event_action,
          table: l.target_table,
          details: typeof l.event_details === 'string' ? JSON.parse(l.event_details) : l.event_details,
          timestamp: l.event_timestamp
        }));
      }

      window.HUB.render();
      console.log('✅ MySQL Sync Complete.');
    } catch (err) {
      console.error('❌ Auto-sync failed:', err);
    }
  };

  // Run once on startup
  syncEverything();

  // Periodic Auto-Sync Every 60 Seconds
  setInterval(syncEverything, 60000);
}

// --- VIEW GENERATORS ---

function LoginView() {
  return `
    <div id="water-bg" class="login-bg" style="background-image: url('https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?q=80&w=2600&auto=format&fit=crop')"></div>
    <div class="login-screen">
      <div class="login-glass-panel">
        <div class="login-content">
          <div class="login-badge animate-fade-in delay-1">ELITE ACCESS</div>
          <h1 class="login-huge-title animate-fade-in delay-2">Hostel<br>Hub<span class="dot">.</span></h1>
          <p class="login-subtitle animate-fade-in delay-3">The premium resident management portal. Experience absolute clarity and fluid control.</p>
          
          <form class="login-form animate-fade-in delay-4" onsubmit="event.preventDefault(); window.HUB.login(this.username.value, this.password.value)">
            <div class="input-wrapper">
              <span class="input-icon">👤</span>
              <input type="text" name="username" class="premium-input" placeholder="Identity (e.g. admin)" required autocomplete="off">
            </div>
            <div class="input-wrapper">
              <span class="input-icon">🔑</span>
              <input type="password" name="password" class="premium-input" placeholder="Security Key" required>
            </div>
            <button type="submit" class="premium-btn">
              <span>Initiate Protocol</span>
              <span class="btn-arrow">→</span>
            </button>
          </form>
          <div class="login-footer animate-fade-in delay-5">
             Secure Gateway &nbsp;&bull;&nbsp; <span>admin / admin</span> or <span>user / user</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

function Layout(content) {
  const isAdmin = window.HUB.userRole === 'admin';
  const navItems = [
    { id: 'dashboard', icon: '⚡', label: isAdmin ? 'Overview' : 'My Status' },
    ...(isAdmin ? [
      { id: 'rooms', icon: '🔑', label: 'Rooms' },
      { id: 'students', icon: '👤', label: 'Residents' },
    ] : []),
    { id: 'attendance', icon: '📅', label: isAdmin ? 'Daily Log' : 'My Attendance' },
    { id: 'payments', icon: '💰', label: isAdmin ? 'Finances' : 'My Dues' },
    { id: 'complaints', icon: '💌', label: 'Issue Log' },
    ...(isAdmin ? [{ id: 'audit', icon: '📜', label: 'System Logs' }] : []),
  ];

  return `
    <div class="app-bg"></div>
    <div class="sidebar">
      <div class="logo-container">
        <div class="logo-icon">H</div>
        <div style="display: flex; flex-direction: column;">
          <span style="font-weight: 800; font-size: 1.25rem; letter-spacing: -0.02em;">Hostel Hub</span>
          <span style="font-size: 0.6rem; color: var(--primary); text-transform: uppercase; font-weight: 700; letter-spacing: 0.1em;">
            ${isAdmin ? 'Master Admin' : 'Resident Portal'}
          </span>
        </div>
      </div>
      <nav class="nav-links">
        ${navItems.map(item => `
          <a class="nav-item ${window.HUB.view === item.id ? 'active' : ''}" data-view="${item.id}">
            <span>${item.icon}</span> ${item.label}
          </a>
        `).join('')}
      </nav>
      ${isAdmin ? `
      <div style="padding: 1rem;">
        <button class="btn btn-secondary" style="width: 100%; font-size: 0.75rem; border-color: var(--primary);" 
                onclick="window.HUB.SYNC.push('students', students.data).then(() => alert('✅ Data synced to MySQL!'))">
          🔄 Sync to MySQL
        </button>
      </div>` : ''}
      <div class="user-profile-mini">
        <div class="avatar">${window.HUB.currentUser.name[0]}</div>
        <div class="info">
           <div class="name">${window.HUB.currentUser.name}</div>
           <div class="role">${window.HUB.userRole.toUpperCase()}</div>
        </div>
      </div>
    </div>
    <main class="main-content">
      <div class="top-nav">
        <button class="btn-signout-top" onclick="window.HUB.logout()">
          <span>🚪</span> Sign Out
        </button>
      </div>
      ${content}
    </main>
    ${ModalContainer()}
  `;
}

function DashboardView() {
  const isAdmin = window.HUB.userRole === 'admin';
  const stats = window.HUB.ANALYTICS.getStats();

  if (!isAdmin) {
    const me = students.findOne({ id: parseInt(window.HUB.currentUser.id) });
    const myRoom = me ? rooms.findOne({ id: parseInt(me.roomId) }) : null;
    const roommates = me ? students.find({ roomId: parseInt(me.roomId) }).filter(s => s.id !== parseInt(me.id)) : [];
    const myPresentToday = !!attendance.findOne({ studentId: parseInt(window.HUB.currentUser.id), date: window.HUB.selectedDate });
    const currentNotices = notices ? notices.data : [];

    return `
      <div class="header animate-fade-in">
        <div>
          <h1>Welcome, ${me.name.split(' ')[0]}!</h1>
          <p>Stay updated with your hostel residency status.</p>
        </div>
      </div>

      <div class="dashboard-grid animate-fade-in">
        <div class="stat-card">
          <span class="label">My Room</span>
          <span class="value">${myRoom ? myRoom.number : 'Unassigned'}</span>
        </div>
        <div class="stat-card">
          <span class="label">Today's Status</span>
          <span class="value" style="color: ${myPresentToday ? 'var(--success)' : 'var(--danger)'}">
            ${myPresentToday ? 'PRESENT' : 'NOT MARKED'}
          </span>
        </div>
        <div class="stat-card">
          <span class="label">Room Category</span>
          <span class="value" style="font-size: 1.25rem;">${myRoom ? myRoom.type : 'N/A'}</span>
        </div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 2rem;" class="animate-fade-in">
        <div class="table-wrapper">
          <h3 style="padding: 1.5rem; border-bottom: 1px solid var(--border);">Bulletin Board</h3>
          <div style="padding: 1rem;">
            ${currentNotices.slice().reverse().map(n => `
              <div style="padding: 1rem; margin-bottom: 0.75rem; background: rgba(139, 92, 246, 0.05); border-radius: 12px; border: 1px solid rgba(139, 92, 246, 0.1);">
                <div style="font-size: 0.9rem; margin-bottom: 0.5rem; line-height: 1.4;">${n.text}</div>
                <div style="font-size: 0.7rem; color: var(--text-muted);">${new Date(n.timestamp).toLocaleDateString()}</div>
              </div>
            `).join('') || '<div style="padding: 2rem; color: var(--text-muted);">No notices posted.</div>'}
          </div>
        </div>

        <div class="table-wrapper">
          <h3 style="padding: 1.5rem; border-bottom: 1px solid var(--border);">My Roommates</h3>
          <div style="padding: 1rem;">
            ${roommates.map(r => `
              <div style="padding: 1rem; display: flex; align-items: center; gap: 1rem; border-bottom: 1px solid var(--border);">
                 <div class="avatar" style="width: 32px; height: 32px; font-size: 0.8rem;">${r.name[0]}</div>
                 <div style="flex: 1; font-weight: 600;">${r.name}</div>
                 <div class="badge badge-primary">Resident</div>
              </div>
            `).join('') || '<div style="padding: 2rem; color: var(--text-muted);">You have no roommates assigned.</div>'}
          </div>
        </div>
      </div>
    `;
  }

  const roomUsage = window.HUB.ANALYTICS.getRoomUsage().slice(0, 4);
  const recentLogs = logs ? logs.data.slice(-5).reverse() : [];
  const currentNotices = notices ? notices.data : [];

  return `
    <div class="header animate-fade-in">
      <div>
        <h1>Dashboard Matrix</h1>
        <p>Welcome back, System Administrator. All services online and operational.</p>
      </div>
      <div class="badge badge-primary">MASTER ACCESS</div>
    </div>

    <div class="dashboard-grid animate-fade-in" style="animation-delay: 0.1s;">
      <div class="stat-card">
        <span class="label">Beds Occupied</span>
        <span class="value">${stats.occupancy}%</span>
      </div>
      <div class="stat-card">
        <span class="label">Attendance (${window.HUB.selectedDate})</span>
        <span class="value">${stats.attendance}%</span>
      </div>
      <div class="stat-card">
        <span class="label">Total Residents</span>
        <span class="value">${stats.totalStudents}</span>
      </div>
      <div class="stat-card">
        <span class="label">Available Vacancies</span>
        <span class="value">${stats.freeBeds}</span>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; margin-bottom: 3rem;" class="animate-fade-in">
      <div class="table-wrapper">
        <div style="padding: 1.5rem; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center;">
          <h3 style="font-weight: 600;">Bulletin Board</h3>
          <button class="btn btn-primary btn-sm" onclick="window.HUB.modal='addNotice'; window.HUB.render()">+ Post</button>
        </div>
        <div style="padding: 1rem; max-height: 300px; overflow-y: auto;">
          ${currentNotices.slice().reverse().map(n => `
            <div style="padding: 1rem; margin-bottom: 1rem; border: 1px solid var(--border); border-radius: 16px; background: rgba(255,255,255,0.02); position: relative;">
              <p style="font-size: 0.9rem; margin-bottom: 0.5rem; padding-right: 2rem;">${n.text}</p>
              <span style="font-size: 0.7rem; color: var(--text-muted);">${new Date(n.timestamp).toLocaleDateString()}</span>
              <button style="position: absolute; top: 1rem; right: 1rem; background: none; border: none; color: var(--danger); cursor: pointer;" onclick="window.HUB.ENGINE.deleteNotice(${n.id})">×</button>
            </div>
          `).join('') || '<div style="padding: 2rem; color: var(--text-muted); text-align: center;">No active notices.</div>'}
        </div>
      </div>

      <div>
        <h2 style="margin-bottom: 1.5rem; font-size: 1.25rem;">Room Occupancy Detail</h2>
        <div class="room-progress-grid">
          ${roomUsage.map(r => `
            <div class="progress-card">
              <div class="progress-header">
                <span style="font-weight: 600;">Room ${r.number}</span>
                <span style="color: var(--text-muted); font-size: 0.8rem;">${r.occupancy} / ${r.capacity}</span>
              </div>
              <div class="progress-bar-container">
                <div class="progress-bar-fill" style="width: ${r.percent}%"></div>
              </div>
              <div style="margin-top: 0.5rem; font-size: 0.7rem; color: var(--text-muted);">${r.type}</div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>

    <div class="table-wrapper animate-fade-in">
      <div style="padding: 1.5rem; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between;">
        <h3 style="font-size: 1.1rem; font-weight: 600;">System Activity</h3>
        <span style="font-size: 0.8rem; color: var(--primary); cursor: pointer;" onclick="window.HUB.view='audit'; window.HUB.render()">View History →</span>
      </div>
      <div style="padding: 1rem;">
        ${recentLogs.map(l => `
          <div style="padding: 0.75rem; display: flex; align-items: center; gap: 1rem; border-bottom: 1px solid rgba(255,255,255,0.03);">
            <div style="width: 8px; height: 8px; border-radius: 50%; background: var(--primary);"></div>
            <div style="flex: 1;">
              <span style="font-weight: 600; font-size: 0.9rem;">${l.action}</span>
              <span style="color: var(--text-muted); font-size: 0.85rem;"> on ${l.table}</span>
            </div>
            <span style="color: var(--text-muted); font-size: 0.75rem;">${new Date(l.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        `).join('') || '<div style="text-align: center; color: var(--text-muted); padding: 2rem;">No recent activity</div>'}
      </div>
    </div>
  `;
}

function RoomsView() {
  const list = rooms.data;
  return `
    <div class="header">
      <h1>Room Inventory</h1>
      <button class="btn btn-primary" onclick="window.HUB.modal='addRoom'; window.HUB.render()">+ New Room</button>
    </div>
    <div class="table-wrapper">
      <table>
        <thead>
          <tr><th>Room #</th><th>Category</th><th>Capacity</th><th>Living Status</th><th>Action</th></tr>
        </thead>
        <tbody>
          ${list.map(r => {
    const occ = students.find({ roomId: r.id }).length;
    const isFull = occ >= r.capacity;
    return `
              <tr>
                <td><span style="font-weight: 700; font-size: 1.1rem;">${r.number}</span></td>
                <td><span style="color: var(--text-muted);">${r.type}</span></td>
                <td>${r.capacity} Beds</td>
                <td><span class="badge ${isFull ? 'badge-danger' : 'badge-success'}">${isFull ? 'FULLY OCCUPIED' : 'AVAILABLE'}</span></td>
                <td><button class="btn btn-danger btn-sm" onclick="window.HUB.ENGINE.deleteRoom(${r.id})">Delete</button></td>
              </tr>
            `;
  }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function StudentsView() {
  const filtered = window.HUB.searchQuery
    ? (students ? students.data.filter(s => s.name.toLowerCase().includes(window.HUB.searchQuery.toLowerCase()) || s.email.toLowerCase().includes(window.HUB.searchQuery.toLowerCase())) : [])
    : (students ? students.data : []);

  return `
    <div class="header animate-fade-in">
      <div>
        <h1>Residents</h1>
        <p style="color: var(--text-muted);">Manage and search through all hostel residents.</p>
      </div>
      <button class="btn btn-primary" onclick="window.HUB.modal='addStudent'; window.HUB.render()">+ Register New</button>
    </div>

    <div class="animate-fade-in" style="margin-bottom: 2rem;">
      <div class="search-container">
        <span class="search-icon">🔍</span>
        <input type="text" id="resident-search" class="search-input" 
               placeholder="Search name, email, or room..." 
               value="${window.HUB.searchQuery}">
      </div>
    </div>

    <div class="table-wrapper animate-fade-in">
      <table>
        <thead>
          <tr><th>Full Name</th><th>Contact Identity</th><th>Assigned Wing</th><th>Management</th></tr>
        </thead>
        <tbody>
          ${filtered.map(s => {
    const r = rooms.findOne({ id: s.roomId });
    return `
              <tr>
                <td><span style="font-weight: 600;">${s.name}</span></td>
                <td>
                  <div style="font-size: 0.9rem;">${s.email}</div>
                  ${s.phone ? `<div style="font-size: 0.8rem; color: var(--text-muted);">📞 ${s.phone}</div>` : ''}
                </td>
                <td>${r ? `<span class="badge badge-primary">Room ${r.number}</span>` : '<span style="color: var(--danger); font-size: 0.8rem; font-weight: 600;">UNASSIGNED</span>'}</td>
                <td style="display: flex; gap: 0.5rem;">
                  <button class="btn btn-secondary btn-sm" onclick="window.HUB.selectedId=${s.id}; window.HUB.modal='allocate'; window.HUB.render()">Allocate</button>
                  <button class="btn btn-danger btn-sm" onclick="window.HUB.ENGINE.deleteStudent(${s.id})">Remove</button>
                </td>
              </tr>
            `;
  }).join('') || '<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 3rem;">No residents found matching your search.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

function AttendanceView() {
  const isAdmin = window.HUB.userRole === 'admin';
  const residentList = isAdmin
    ? (students ? students.data : [])
    : (students ? students.find({ id: window.HUB.currentUser.id }) : []);

  return `
    <div class="header animate-fade-in">
      <div>
        <h1>${isAdmin ? 'Daily Log' : 'My Attendance Logs'}</h1>
        <p style="color: var(--text-muted);">${isAdmin ? 'Mark or view presence for any date.' : 'Review your personal presence history.'}</p>
      </div>
      
      <div class="date-selector">
        <button class="date-nav-btn" onclick="window.HUB.moveDate(-1)">←</button>
        <input type="date" class="date-input" value="${window.HUB.selectedDate}" 
               onchange="window.HUB.selectedDate=this.value; window.HUB.render()">
        <button class="date-nav-btn" onclick="window.HUB.moveDate(1)">→</button>
      </div>
    </div>

    <div class="table-wrapper animate-fade-in">
      <table>
        <thead><tr><th>Resident</th><th>Unit</th><th>Presence Status</th></tr></thead>
        <tbody>
          ${residentList.map(s => {
    const r = rooms.findOne({ id: s.roomId });
    const isPresent = !!attendance.findOne({ studentId: parseInt(s.id), date: String(window.HUB.selectedDate).trim() });
    return `
              <tr>
                <td style="font-weight: 600;">${s.name} ${!isAdmin ? '<span class="badge badge-primary" style="margin-left: 10px;">ME</span>' : ''}</td>
                <td>${r ? r.number : '-'}</td>
                <td>
                  <div class="attendance-toggle ${!isAdmin ? 'disabled' : ''}">
                    <button class="att-btn present ${isPresent ? 'active' : ''}" 
                            ${isAdmin ? `onclick="window.HUB.ENGINE.toggleAttendance(${s.id}, true)"` : ''}>Present</button>
                    <button class="att-btn absent ${!isPresent ? 'active' : ''}" 
                            ${isAdmin ? `onclick="window.HUB.ENGINE.toggleAttendance(${s.id}, false)"` : ''}>Absent</button>
                  </div>
                </td>
              </tr>
            `;
  }).join('') || '<tr><td colspan="3" style="text-align: center; color: var(--text-muted); padding: 3rem;">No records found.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

function ComplaintsView() {
  const isAdmin = window.HUB.userRole === 'admin';
  const list = isAdmin ? complaints.data : complaints.find({ studentId: parseInt(window.HUB.currentUser.id) });

  return `
    <div class="header animate-fade-in">
      <div>
        <h1>Issue Log</h1>
        <p style="color: var(--text-muted);">${isAdmin ? 'Track and resolve resident issues.' : 'Report maintenance or other concerns.'}</p>
      </div>
      ${!isAdmin ? `<button class="btn btn-primary" onclick="window.HUB.modal='addComplaint'; window.HUB.render()">+ New Report</button>` : ''}
    </div>

    <div class="table-wrapper animate-fade-in">
      <table>
        <thead>
          <tr>
            <th>${isAdmin ? 'Resident' : 'Topic'}</th>
            <th>Message</th>
            <th>Filed Date</th>
            <th>Status</th>
            ${isAdmin ? '<th>Action</th>' : ''}
          </tr>
        </thead>
        <tbody>
          ${list.slice().reverse().map(c => `
            <tr>
              <td>
                <div style="font-weight: 600;">${isAdmin ? c.studentName : c.title}</div>
                ${isAdmin ? `<div style="font-size: 0.7rem; color: var(--text-muted);">${c.title}</div>` : ''}
              </td>
              <td style="max-width: 300px; color: var(--text-muted); font-size: 0.9rem;">${c.message}</td>
              <td style="font-size: 0.8rem;">${new Date(c.timestamp).toLocaleDateString()}</td>
              <td>
                <span class="badge ${c.status === 'Pending' ? 'badge-warning' : 'badge-success'}">${c.status}</span>
              </td>
              ${isAdmin ? `
                <td>
                  ${c.status === 'Pending' ? `<button class="btn btn-primary btn-sm" onclick="window.HUB.ENGINE.resolveComplaint(${c.id})">Mark Resolved</button>` : '<span style="color: var(--success); font-weight: 600;">✓ Fixed</span>'}
                </td>
              ` : ''}
            </tr>
          `).join('') || `<tr><td colspan="${isAdmin ? 5 : 4}" style="text-align: center; color: var(--text-muted); padding: 3rem;">No issues found.</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

function AuditLogsView() {
  const logList = logs ? logs.data : [];
  return `
    <div class="header"><h1>System Logs</h1><button class="btn btn-secondary btn-sm" onclick="logs.clear(); window.HUB.render()">Clear Audit</button></div>
    <div class="table-wrapper" style="max-height: 600px; overflow-y: auto;">
      ${logList.slice().reverse().map(l => `
        <div class="log-item">
          <span class="log-time">${new Date(l.timestamp).toLocaleTimeString()}</span>
          <span class="log-action">${l.action}</span>
          <span>${JSON.stringify(l.details).replace(/[{}"]/g, '')}</span>
        </div>
      `).join('') || '<div style="padding: 3rem; text-align: center; color: var(--text-muted);">No logs available.</div>'}
    </div>
  `;
}

function ModalContainer() {
  if (!window.HUB.modal) return `<div class="modal-overlay"></div>`;
  let body = '';

  if (window.HUB.modal === 'addStudent') {
    body = `
      <h2 style="margin-bottom: 2rem;">Student Registration</h2>
      <form onsubmit="event.preventDefault(); (async () => { try { await window.HUB.ENGINE.addStudent(this.name.value, this.email.value, this.phone.value); window.HUB.modal=null; window.HUB.render(); } catch(e) { alert(e.message); } })();">
        <div class="form-group"><label>Full Name</label><input type="text" name="name" required placeholder="Alice Johnson"></div>
        <div class="form-group"><label>Email Address</label><input type="email" name="email" required pattern="[A-Za-z0-9._%+\\-]+@[A-Za-z0-9.\\-]+\\.[A-Za-z]{2,}$" placeholder="alice@example.com"></div>
        <div class="form-group"><label>Phone Number</label><input type="tel" name="phone" required pattern="[0-9]{10}" maxlength="10" placeholder="1234567890"></div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-top: 2rem;">
          <button type="submit" class="btn btn-primary">Save Resident</button>
          <button type="button" class="btn btn-secondary" onclick="window.HUB.modal=null; window.HUB.render()">Cancel</button>
        </div>
      </form>
    `;
  } else if (window.HUB.modal === 'addRoom') {
    body = `
      <div style="text-align: center; margin-bottom: 2rem;">
        <div style="font-size: 2.5rem; margin-bottom: 1rem;">🏢</div>
        <h2 style="font-size: 1.75rem; letter-spacing: -0.03em;">New Wing Expansion</h2>
        <p style="color: var(--text-muted); font-size: 0.9rem;">Register a new block or room into the inventory.</p>
      </div>
      <form onsubmit="event.preventDefault(); (async () => { try { await window.HUB.ENGINE.addRoom(this.num.value, this.type.value, this.cap.value); window.HUB.modal=null; window.HUB.render(); } catch(e) { alert(e.message); } })();">
        <div class="form-group">
          <label>Unit Identifier (Number)</label>
          <input type="text" name="num" required placeholder="e.g. 501" autofocus>
        </div>
        <div class="form-group">
          <label>Room Category</label>
          <select name="type" class="search-input" style="padding-left: 1rem; background: white; border: 1px solid var(--border); width: 100%; color: black;">
            <option style="color: black;">Standard</option>
            <option style="color: black;">Single-Deluxe</option>
            <option style="color: black;">Double-Standard</option>
            <option style="color: black;">Triple-Budget</option>
            <option style="color: black;">Single-Premium</option>
            <option style="color: black;">Deluxe Suite</option>
            <option style="color: black;">Penthouse</option>
          </select>
        </div>
        <div class="form-group">
          <label>Max Occupancy (Beds)</label>
          <input type="number" name="cap" value="2" min="1" max="10">
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-top: 2.5rem;">
          <button type="submit" class="btn btn-primary">Authorize Wing</button>
          <button type="button" class="btn btn-secondary" onclick="window.HUB.modal=null; window.HUB.render()">Dismiss</button>
        </div>
      </form>
    `;
  } else if (window.HUB.modal === 'allocate') {
    const s = students.findOne({ id: window.HUB.selectedId });
    body = `
      <h2 style="margin-bottom: 1rem;">Allocate ${s.name}</h2>
      <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 2rem;">Select a unit with available vacancies.</p>
      <div class="room-grid">
        ${rooms.data.map(r => {
      const occ = students.find({ roomId: r.id }).length;
      const isFull = occ >= r.capacity && s.roomId !== r.id;
      return `
            <div class="room-item ${isFull ? 'occupied' : ''} ${s.roomId === r.id ? 'selected' : ''}" 
                 onclick="${isFull ? '' : `(async()=>{ try{ await window.HUB.ENGINE.allocate(${s.id}, ${r.id}); window.HUB.modal=null; window.HUB.render(); }catch(e){alert(e.message);}})()`}">
              <span style="font-weight: 700; font-size: 1.1rem;">${r.number}</span>
              <span style="font-size: 0.7rem; margin-top: 4px;">${occ}/${r.capacity} Occupied</span>
            </div>
          `;
    }).join('')}
      </div>
      <button class="btn btn-danger" style="width: 100%; margin-top: 2rem;" onclick="(async()=>{ try{ await window.HUB.ENGINE.allocate(${s.id}, null); window.HUB.modal=null; window.HUB.render(); }catch(e){alert(e.message);}})()">Unallocate Resident</button>
    `;
  } else if (window.HUB.modal === 'addComplaint') {
    body = `
      <h2 style="margin-bottom: 2rem;">Report Issue</h2>
      <form onsubmit="event.preventDefault(); (async () => { try { await window.HUB.ENGINE.addComplaint(this.title.value, this.msg.value); window.HUB.modal=null; window.HUB.render(); } catch(e) { alert(e.message); } })();">
        <div class="form-group"><label>Category / Title</label><input type="text" name="title" required placeholder="e.g. Broken Fan, Water Leakage"></div>
        <div class="form-group"><label>Detailed Message</label><textarea name="msg" class="login-input-field" style="width: 100%; min-height: 120px; padding: 1rem; background: rgba(255,255,255,0.03); border: 1px solid var(--border); border-radius: 16px; color: white;" placeholder="Describe your issue..."></textarea></div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-top: 1rem;">
          <button type="submit" class="btn btn-primary">File Report</button>
          <button type="button" class="btn btn-secondary" onclick="window.HUB.modal=null; window.HUB.render()">Cancel</button>
        </div>
      </form>
    `;
  } else if (window.HUB.modal === 'addNotice') {
    body = `
      <h2 style="margin-bottom: 2rem;">Post Official Notice</h2>
      <form onsubmit="event.preventDefault(); (async () => { try { await window.HUB.ENGINE.addNotice(this.msg.value, this.pri.value); window.HUB.modal=null; window.HUB.render(); } catch(e) { alert(e.message); } })();">
        <div class="form-group">
          <label>Priority Level</label>
          <select name="pri" class="search-input" style="padding-left: 1rem; background: white; border: 1px solid var(--border); width: 100%; color: black;">
            <option style="color: black;">Normal</option>
            <option style="color: black;">High</option>
            <option style="color: black;">Urgent</option>
            <option style="color: black;">Low</option>
          </select>
        </div>
        <div class="form-group">
          <label>Notice Content</label>
          <textarea name="msg" required class="login-input-field" style="width: 100%; min-height: 120px; padding: 1rem; background: rgba(255,255,255,0.03); border: 1px solid var(--border); border-radius: 16px; color: white;" placeholder="Write your announcement here..."></textarea>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-top: 2rem;">
          <button type="submit" class="btn btn-primary">Post Notice</button>
          <button type="button" class="btn btn-secondary" onclick="window.HUB.modal=null; window.HUB.render()">Cancel</button>
        </div>
      </form>
    `;
  } else if (window.HUB.modal === 'recordPayment') {
    body = `
      <h2 style="margin-bottom: 2rem;">Record Payment</h2>
      <form onsubmit="event.preventDefault(); (async () => { try { await window.HUB.ENGINE.addPayment(this.studentId.value, this.amount.value, this.method.value); window.HUB.modal=null; window.HUB.render(); } catch(e) { alert(e.message); } })();">
        <div class="form-group">
          <label>Select Resident</label>
          <select name="studentId" class="search-input" style="padding-left: 1rem; background: white; border: 1px solid var(--border); width: 100%; color: black;">
            ${students.data.map(s => `<option value="${s.id}" style="color: black;">${s.name}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Amount (₹)</label>
          <input type="number" name="amount" required placeholder="0.00">
        </div>
        <div class="form-group">
          <label>Method</label>
          <select name="method" class="search-input" style="padding-left: 1rem; background: white; border: 1px solid var(--border); width: 100%; color: black;">
            <option style="color: black;">UPI</option>
            <option style="color: black;">Cash</option>
            <option style="color: black;">Bank Transfer</option>
            <option style="color: black;">Card</option>
          </select>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-top: 2rem;">
          <button type="submit" class="btn btn-primary">Process</button>
          <button type="button" class="btn btn-secondary" onclick="window.HUB.modal=null; window.HUB.render()">Cancel</button>
        </div>
      </form>
    `;
  } else if (window.HUB.modal === 'manageFees') {
    body = `
      <h2 style="margin-bottom: 2rem;">Fee Configuration</h2>
      <div style="display: grid; gap: 1rem;">
        ${feeStructure.data.map(f => `
          <div style="display: flex; align-items: center; justify-content: space-between; padding: 1rem; background: rgba(255,255,255,0.03); border-radius: 12px; border: 1px solid var(--border);">
            <div style="font-weight: 600;">${f.type}</div>
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <span style="color: var(--text-muted);">₹</span>
              <input type="number" value="${f.amount}" style="width: 100px; padding: 0.5rem; border-radius: 8px; background: #000; border: 1px solid var(--border); color: white;" 
                     onchange="(async () => { try { await window.HUB.ENGINE.updateFee('${f.type}', this.value); } catch(e) { alert(e.message); } })()">
            </div>
          </div>
        `).join('')}
      </div>
      <button class="btn btn-secondary" style="width: 100%; margin-top: 2rem;" onclick="window.HUB.modal=null; window.HUB.render()">Close</button>
    `;
  }

  return `<div class="modal-overlay active" onclick="if(event.target === this) { window.HUB.modal=null; window.HUB.render(); }"><div class="modal">${body}</div></div>`;
}

window.HUB.render = () => {
  const app = document.querySelector('#app');
  if (!app) return;

  if (!window.HUB.isLoggedIn) {
    app.innerHTML = LoginView();
    // Initialize Water Ripple Effect if available
    setTimeout(() => {
      if (window.$ && $('#water-bg').length) {
        try {
          if (!$('#water-bg').data('ripples')) {
            $('#water-bg').ripples({ resolution: 512, dropRadius: 25, perturbance: 0.05 });
          }
        } catch (e) { console.error('Ripples effect error', e); }
      }
    }, 100);
    return;
  } else {
    // Destroy ripples if logged in
    if (window.$ && $('#water-bg').length) {
      try { $('#water-bg').ripples('destroy'); } catch (e) { }
    }
  }

  let content = '';
  switch (window.HUB.view) {
    case 'dashboard': content = DashboardView(); break;
    case 'rooms': content = RoomsView(); break;
    case 'students': content = StudentsView(); break;
    case 'attendance': content = AttendanceView(); break;
    case 'payments': content = PaymentsView(); break;
    case 'complaints': content = ComplaintsView(); break;
    case 'audit': content = AuditLogsView(); break;
  }

  app.innerHTML = Layout(content);

  // Re-attach Nav Events
  document.querySelectorAll('.nav-item').forEach(el => {
    el.onclick = () => {
      window.HUB.view = el.dataset.view;
      if (window.HUB.view !== 'students') window.HUB.searchQuery = '';
      window.HUB.render();
    };
  });

  // Re-attach Search Logic
  const searchInput = document.getElementById('resident-search');
  if (searchInput) {
    searchInput.focus();
    const val = searchInput.value;
    searchInput.value = '';
    searchInput.value = val;

    searchInput.addEventListener('input', (e) => {
      window.HUB.searchQuery = e.target.value;
      window.HUB.render();
    });
  }
};

window.HUB.moveDate = (days) => {
  const d = new Date(window.HUB.selectedDate);
  d.setDate(d.getDate() + days);
  window.HUB.selectedDate = d.toISOString().split('T')[0];
  window.HUB.render();
};

// Init
function PaymentsView() {
  const isAdmin = window.HUB.userRole === 'admin';
  const report = window.HUB.ANALYTICS.getFinancialReport();
  const myRecord = report.find(r => r.student === window.HUB.currentUser.name);
  const history = isAdmin ? payments.data : payments.find({ studentId: window.HUB.currentUser.id });

  if (!isAdmin) {
    return `
      <div class="header animate-fade-in">
        <h1>Financial Status</h1>
        <div class="badge ${myRecord?.balance > 0 ? 'badge-danger' : 'badge-success'}">
          ${myRecord?.balance > 0 ? 'PENDING DUES' : 'FULLY PAID'}
        </div>
      </div>
      <div class="dashboard-grid animate-fade-in">
        <div class="stat-card">
          <span class="label">Total Fee</span>
          <span class="value">₹${myRecord?.totalDue || 0}</span>
        </div>
        <div class="stat-card">
          <span class="label">Amount Paid</span>
          <span class="value" style="color: var(--success)">₹${myRecord?.totalPaid || 0}</span>
        </div>
        <div class="stat-card">
          <span class="label">Current Balance</span>
          <span class="value" style="color: ${myRecord?.balance > 0 ? 'var(--danger)' : 'var(--success)'}">₹${myRecord?.balance || 0}</span>
        </div>
      </div>
      <div class="table-wrapper animate-fade-in">
        <h3 style="padding: 1.5rem; border-bottom: 1px solid var(--border);">Transaction History</h3>
        <table>
          <thead><tr><th>Date</th><th>Amount</th><th>Method</th></tr></thead>
          <tbody>
            ${history.slice().reverse().map(p => `
              <tr>
                <td>${new Date(p.timestamp).toLocaleDateString()}</td>
                <td style="font-weight: 700; color: var(--success)">+ ₹${p.amount}</td>
                <td><span class="badge badge-primary">${p.method}</span></td>
              </tr>
            `).join('') || '<tr><td colspan="3" style="text-align: center; color: var(--text-muted); padding: 2rem;">No transactions yet.</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
  }

  return `
    <div class="header animate-fade-in">
      <div>
        <h1>Fee Management</h1>
        <p style="color: var(--text-muted);">Monitor balances and record resident payments.</p>
      </div>
      <div style="display: flex; gap: 1rem;">
        <button class="btn btn-secondary" onclick="window.HUB.modal='manageFees'; window.HUB.render()">⚙️ Rates</button>
        <button class="btn btn-primary" onclick="window.HUB.modal='recordPayment'; window.HUB.render()">+ Record Payment</button>
      </div>
    </div>

    <div class="table-wrapper animate-fade-in">
      <table>
        <thead>
          <tr><th>Resident</th><th>Room</th><th>Total Fee</th><th>Paid</th><th>Balance</th><th>Status</th></tr>
        </thead>
        <tbody>
          ${report.map(r => `
            <tr>
              <td><span style="font-weight: 600;">${r.student}</span></td>
              <td>Room ${r.roomId}</td>
              <td>₹${r.totalDue}</td>
              <td style="color: var(--success); font-weight: 600;">₹${r.totalPaid}</td>
              <td style="color: ${r.balance > 0 ? 'var(--danger)' : 'var(--text)'}; font-weight: 700;">₹${r.balance}</td>
              <td>
                <span class="badge ${r.balance <= 0 ? 'badge-success' : 'badge-danger'}">
                  ${r.balance <= 0 ? 'CLEAR' : 'DEFAULTER'}
                </span>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <div class="table-wrapper animate-fade-in" style="margin-top: 2rem;">
      <h3 style="padding: 1.5rem; border-bottom: 1px solid var(--border);">Recent Transactions</h3>
      <div style="max-height: 300px; overflow-y: auto;">
      ${history.slice().reverse().map(p => `
        <div style="padding: 1rem; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border);">
          <div>
            <div style="font-weight: 600;">${p.studentName}</div>
            <div style="font-size: 0.75rem; color: var(--text-muted);">${new Date(p.timestamp).toLocaleString()}</div>
          </div>
          <div style="text-align: right;">
            <div style="color: var(--success); font-weight: 700;">₹${p.amount}</div>
            <div class="badge badge-primary" style="font-size: 0.6rem;">${p.method}</div>
          </div>
        </div>
      `).join('') || '<div style="padding: 2rem; color: var(--text-muted); text-align: center;">No payments recorded.</div>'}
      </div>
    </div>
  `;
}

window.addEventListener('DOMContentLoaded', initializeDatabase);
