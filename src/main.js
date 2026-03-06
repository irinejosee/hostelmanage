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
      if (logs) logs.insert({ timestamp: new Date(), action, table, details });
    },

    addStudent: (name, email) => {
      if (students.findOne({ email })) throw new Error("A student with this email is already registered.");
      const s = students.insert({ id: Date.now(), name, email, roomId: null });
      window.HUB.ENGINE.log('REGISTER', 'students', { name: s.name });
      window.HUB.render();
    },

    addRoom: (number, type, capacity) => {
      if (rooms.findOne({ number })) throw new Error("This room number already exists.");
      const r = rooms.insert({ id: Date.now(), number, type, capacity: parseInt(capacity) });
      window.HUB.ENGINE.log('CREATE_ROOM', 'rooms', { number: r.number });
      window.HUB.render();
    },

    allocate: (studentId, roomId) => {
      const student = students.findOne({ id: studentId });
      if (!student) return;

      if (roomId) {
        const room = rooms.findOne({ id: roomId });
        const current = students.find({ roomId }).length;
        if (current >= room.capacity && student.roomId !== roomId) {
          alert("This room is already at full capacity.");
          return;
        }
      }

      const prevRoomId = student.roomId;
      student.roomId = roomId;
      students.update(student);
      window.HUB.ENGINE.log('ALLOCATE', 'students', { student: student.name, from: prevRoomId, to: roomId });
      window.HUB.render();
    },

    deleteStudent: (id) => {
      const s = students.findOne({ id });
      if (s && confirm(`Are you sure you want to remove ${s.name}?`)) {
        attendance.find({ studentId: id }).forEach(r => attendance.remove(r));
        students.remove(s);
        window.HUB.ENGINE.log('DELETE', 'students', { name: s.name });
        window.HUB.render();
      }
    },

    deleteRoom: (id) => {
      const r = rooms.findOne({ id });
      if (r && confirm(`Delete Room ${r.number}?`)) {
        students.find({ roomId: id }).forEach(s => { s.roomId = null; students.update(s); });
        rooms.remove(r);
        window.HUB.ENGINE.log('DROP_ROOM', 'rooms', { number: r.number });
        window.HUB.render();
      }
    },

    toggleAttendance: (studentId, isPresent) => {
      if (!attendance) return;
      const date = window.HUB.selectedDate;
      const existing = attendance.findOne({ studentId, date });

      if (isPresent && !existing) {
        attendance.insert({ studentId, date });
        window.HUB.ENGINE.log('ATTENDANCE', 'presence', { id: studentId, status: 'Present', date });
      } else if (!isPresent && existing) {
        attendance.remove(existing);
        window.HUB.ENGINE.log('ATTENDANCE', 'presence', { id: studentId, status: 'Absent', date });
      }
      window.HUB.render();
    },

    addComplaint: (title, message) => {
      if (!complaints) return;
      const c = complaints.insert({
        id: Date.now(),
        studentId: window.HUB.currentUser.id,
        studentName: window.HUB.currentUser.name,
        title,
        message,
        status: 'Pending',
        timestamp: new Date()
      });
      window.HUB.ENGINE.log('COMPLAINT_FILED', 'complaints', { title: c.title, from: c.studentName });
      window.HUB.render();
    },

    resolveComplaint: (id) => {
      if (!complaints) return;
      const c = complaints.findOne({ id });
      if (c) {
        c.status = 'Resolved';
        c.resolvedAt = new Date();
        complaints.update(c);
        window.HUB.ENGINE.log('COMPLAINT_RESOLVED', 'complaints', { id });
        window.HUB.render();
      }
    },

    // Financial Engine (DML)
    addPayment: (studentId, amount, method) => {
      if (!payments) return;
      const student = students.findOne({ id: parseInt(studentId) });
      const p = payments.insert({
        id: Date.now(),
        studentId: student.id,
        studentName: student.name,
        amount: parseFloat(amount),
        method,
        timestamp: new Date()
      });
      window.HUB.ENGINE.log('PAYMENT_RECEIVED', 'payments', { student: student.name, amount });
      window.HUB.render();
    },

    updateFee: (roomType, amount) => {
      if (!feeStructure) return;
      let fee = feeStructure.findOne({ type: roomType });
      if (fee) {
        fee.amount = parseFloat(amount);
        feeStructure.update(fee);
      } else {
        feeStructure.insert({ type: roomType, amount: parseFloat(amount) });
      }
      window.HUB.ENGINE.log('FEE_UPDATED', 'feeStructure', { type: roomType, amount });
      window.HUB.render();
    },

    addNotice: (text, priority = 'Normal') => {
      if (!notices) return;
      notices.insert({ id: Date.now(), text, priority, timestamp: new Date() });
      window.HUB.ENGINE.log('POST_NOTICE', 'notices', { text: text.substring(0, 20), priority });
      window.HUB.render();
    },

    deleteNotice: (id) => {
      if (!notices) return;
      const n = notices.findOne({ id });
      if (n) {
        notices.remove(n);
        window.HUB.ENGINE.log('DELETE_NOTICE', 'notices', { id });
        window.HUB.render();
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
        const paid = payments.find({ student_id: s.id }).reduce((a, b) => a + b.amount, 0) || payments.find({ studentId: s.id }).reduce((a, b) => a + b.amount, 0); // Handle schema drift if any
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

  if (feeStructure.count() === 0) {
    feeStructure.insert([
      { type: 'Single-Deluxe', amount: 5000 },
      { type: 'Double-Standard', amount: 3500 },
      { type: 'Triple-Budget', amount: 2500 },
      { type: 'Single-Premium', amount: 4500 }
    ]);
  }

  if (rooms.count() === 0) {
    rooms.insert([
      { id: 1, number: '101', type: 'Single-Deluxe', capacity: 1 },
      { id: 2, number: '102', type: 'Double-Standard', capacity: 2 },
      { id: 3, number: '103', type: 'Double-Standard', capacity: 2 },
      { id: 4, number: '201', type: 'Triple-Budget', capacity: 3 },
      { id: 5, number: '202', type: 'Single-Premium', capacity: 1 },
    ]);
  }

  if (students.count() === 0) {
    students.insert([
      { id: 1, name: 'Alice Johnson', email: 'alice@example.com', roomId: 1 },
      { id: 2, name: 'Bob Smith', email: 'bob@example.com', roomId: 2 },
      { id: 3, name: 'Charlie Brown', email: 'charlie@example.com', roomId: 3 },
    ]);
  }

  if (notices.count() === 0) {
    notices.insert([
      { id: 1, text: '💡 Mess timings updated: Breakfast 8-10 AM, Lunch 12-2 PM.', timestamp: new Date() },
      { id: 2, text: '🚀 Annual Day celebrations start this Friday!', timestamp: new Date() }
    ]);
  }

  if (complaints.count() === 0) {
    complaints.insert([
      { id: 1, studentId: 1, studentName: 'Alice Johnson', title: 'Water Leakage', message: 'There is a consistent water leak in the bathroom ceiling.', status: 'Pending', timestamp: new Date() },
      { id: 2, studentId: 2, studentName: 'Bob Smith', title: 'Broken Fan', message: 'The ceiling fan in my room is making loud noises and rotating slowly.', status: 'Pending', timestamp: new Date() }
    ]);
  }

  window.HUB.render();
}

// --- VIEW GENERATORS ---

function LoginView() {
  const bubbles = Array.from({ length: 15 }).map((_, i) => {
    const size = Math.random() * 60 + 20;
    const left = Math.random() * 100;
    const duration = Math.random() * 10 + 5;
    const delay = Math.random() * 5;
    return `<div class="bubble" style="width:${size}px; height:${size}px; left:${left}%; --duration:${duration}s; animation-delay:${delay}s"></div>`;
  }).join('');

  return `
    <div class="login-bg" style="background-image: url('C:/Users/DELL/.gemini/antigravity/brain/ca2e4324-d7c2-41f4-bae2-efbc5f80dc8a/hostel_hub_login_bg_1771954266905.png')"></div>
    <div class="bubbles-container">${bubbles}</div>
    <div class="floating-blobs">
      <div class="blob blob-1"></div>
      <div class="blob blob-2"></div>
    </div>
    <div class="login-screen">
      <div class="login-card">
        <div class="login-header">
          <div class="login-logo stagger">H</div>
          <h1 class="login-title stagger delay-1">Hostel Hub</h1>
          <p class="login-tagline stagger delay-2">Experience the future of resident management</p>
        </div>
        <form class="login-form" onsubmit="event.preventDefault(); window.HUB.login(this.username.value, this.password.value)">
          <div class="login-input-group stagger delay-3">
            <label>Master Identity / Resident Email</label>
            <input type="text" name="username" class="login-input-field" placeholder="admin or user" required autocomplete="off">
          </div>
          <div class="login-input-group stagger delay-4">
            <label>Security Key</label>
            <input type="password" name="password" class="login-input-field" placeholder="••••••••" required>
          </div>
          <button type="submit" class="btn btn-primary login-btn stagger delay-5">
            <span>Unlock Access</span>
          </button>
        </form>
        <div class="login-footer stagger delay-5">
          <p>Demo: admin/admin | user/user</p>
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
    const me = students.findOne({ id: window.HUB.currentUser.id });
    const myRoom = me ? rooms.findOne({ id: me.roomId }) : null;
    const roommates = me ? students.find({ roomId: me.roomId }).filter(s => s.id !== me.id) : [];
    const myPresentToday = !!attendance.findOne({ studentId: window.HUB.currentUser.id, date: window.HUB.selectedDate });
    const currentNotices = notices ? notices.data : [];

    return `
      <div class="header animate-fade-in">
        <div>
          <h1>Welcome, ${me.name.split(' ')[0]}!</h1>
          <p style="color: var(--text-muted);">Stay updated with your hostel residency status.</p>
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
        <h1>Dashboard</h1>
        <p style="color: var(--text-muted);">Welcome back Master Admin! System status is nominal.</p>
      </div>
      <div class="badge badge-primary">Master Access</div>
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
                <td>${s.email}</td>
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
    const isPresent = !!attendance.findOne({ studentId: s.id, date: window.HUB.selectedDate });
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
  const list = isAdmin ? complaints.data : complaints.find({ studentId: window.HUB.currentUser.id });

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
      <form onsubmit="event.preventDefault(); try { window.HUB.ENGINE.addStudent(this.name.value, this.email.value); window.HUB.modal=null; window.HUB.render(); } catch(e) { alert(e.message); }">
        <div class="form-group"><label>Full Name</label><input type="text" name="name" required placeholder="Alice Wonderland"></div>
        <div class="form-group"><label>Email Address</label><input type="email" name="email" required placeholder="alice@domain.com"></div>
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
      <form onsubmit="event.preventDefault(); try { window.HUB.ENGINE.addRoom(this.num.value, this.type.value, this.cap.value); window.HUB.modal=null; window.HUB.render(); } catch(e) { alert(e.message); }">
        <div class="form-group">
          <label>Unit Identifier (Number)</label>
          <input type="text" name="num" required placeholder="e.g. 501" autofocus>
        </div>
        <div class="form-group">
          <label>Room Category</label>
          <input type="text" name="type" value="Deluxe Suite">
        </div>
        <div class="form-group">
          <label>Max Occupancy (Beds)</label>
          <input type="number" name="cap" value="2" min="1">
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
                 onclick="${isFull ? '' : `window.HUB.ENGINE.allocate(${s.id}, ${r.id}); window.HUB.modal=null; window.HUB.render();`}">
              <span style="font-weight: 700; font-size: 1.1rem;">${r.number}</span>
              <span style="font-size: 0.7rem; margin-top: 4px;">${occ}/${r.capacity} Occupied</span>
            </div>
          `;
    }).join('')}
      </div>
      <button class="btn btn-danger" style="width: 100%; margin-top: 2rem;" onclick="window.HUB.ENGINE.allocate(${s.id}, null); window.HUB.modal=null; window.HUB.render()">Unallocate Resident</button>
    `;
  } else if (window.HUB.modal === 'addComplaint') {
    body = `
      <h2 style="margin-bottom: 2rem;">Report Issue</h2>
      <form onsubmit="event.preventDefault(); window.HUB.ENGINE.addComplaint(this.title.value, this.msg.value); window.HUB.modal=null; window.HUB.render();">
        <div class="form-group"><label>Category / Title</label><input type="text" name="title" required placeholder="e.g. Broken Fan, Water Leakage"></div>
        <div class="form-group"><label>Detailed Message</label><textarea name="msg" class="login-input-field" style="width: 100%; min-height: 120px; padding: 1rem; background: rgba(255,255,255,0.03); border: 1px solid var(--border); border-radius: 16px; color: white;" placeholder="Describe your issue..."></textarea></div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-top: 1rem;">
          <button type="submit" class="btn btn-primary">File Report</button>
          <button type="button" class="btn btn-secondary" onclick="window.HUB.modal=null; window.HUB.render()">Cancel</button>
        </div>
      </form>
    `;
  }

  return `<div class="modal-overlay active" onclick="if(event.target === this) { window.HUB.modal=null; window.HUB.render(); }"><div class="modal">${body}</div></div>`;
}

window.HUB.render = () => {
  const app = document.querySelector('#app');
  if (!app) return;

  if (!window.HUB.isLoggedIn) {
    app.innerHTML = LoginView();
    return;
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

// Modify ModalContainer to add financial modals
const OriginalModalContainer = ModalContainer;
ModalContainer = () => {
  if (window.HUB.modal === 'recordPayment') {
    return `
      <div class="modal-overlay active" onclick="if(event.target === this) { window.HUB.modal=null; window.HUB.render(); }">
        <div class="modal">
          <h2 style="margin-bottom: 2rem;">Record Payment</h2>
          <form onsubmit="event.preventDefault(); window.HUB.ENGINE.addPayment(this.studentId.value, this.amount.value, this.method.value); window.HUB.modal=null; window.HUB.render();">
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
        </div>
      </div>
    `;
  }

  if (window.HUB.modal === 'addNotice') {
    return `
      <div class="modal-overlay active" onclick="if(event.target === this) { window.HUB.modal=null; window.HUB.render(); }">
        <div class="modal">
          <h2 style="margin-bottom: 2rem;">Post New Notice</h2>
          <form onsubmit="event.preventDefault(); window.HUB.ENGINE.addNotice(this.text.value, this.priority.value); window.HUB.modal=null; window.HUB.render();">
            <div class="form-group">
              <label>Notice Content</label>
              <textarea name="text" required class="search-input" style="width: 100%; min-height: 100px; padding: 1rem; background: var(--glass); border: 1px solid var(--border); border-radius: 12px; color: white;" placeholder="Type your announcement here..."></textarea>
            </div>
            <div class="form-group">
              <label>Priority Level</label>
              <select name="priority" class="search-input" style="padding-left: 1rem; background: white; border: 1px solid var(--border); width: 100%; color: black;">
                <option style="color: black;">Normal</option>
                <option style="color: black;">Low</option>
                <option style="color: black;">High</option>
                <option style="color: black;">Urgent</option>
              </select>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-top: 2rem;">
              <button type="submit" class="btn btn-primary">Post Notice</button>
              <button type="button" class="btn btn-secondary" onclick="window.HUB.modal=null; window.HUB.render()">Cancel</button>
            </div>
          </form>
        </div>
      </div>
    `;
  }

  if (window.HUB.modal === 'manageFees') {
    return `
      <div class="modal-overlay active" onclick="if(event.target === this) { window.HUB.modal=null; window.HUB.render(); }">
        <div class="modal" style="max-width: 600px;">
          <h2 style="margin-bottom: 2rem;">Fee Configuration</h2>
          <div style="display: grid; gap: 1rem;">
            ${feeStructure.data.map(f => `
              <div style="display: flex; align-items: center; justify-content: space-between; padding: 1rem; background: var(--glass); border-radius: 12px; border: 1px solid var(--border);">
                <div style="font-weight: 600;">${f.type}</div>
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                  <span style="color: var(--text-muted);">₹</span>
                  <input type="number" value="${f.amount}" style="width: 100px; padding: 0.5rem; border-radius: 8px; background: var(--bg); border: 1px solid var(--border); color: white;" 
                         onchange="window.HUB.ENGINE.updateFee('${f.type}', this.value)">
                </div>
              </div>
            `).join('')}
          </div>
          <button class="btn btn-secondary" style="width: 100%; margin-top: 2rem;" onclick="window.HUB.modal=null; window.HUB.render()">Close</button>
        </div>
      </div>
    `;
  }
  return OriginalModalContainer();
};

window.addEventListener('DOMContentLoaded', initializeDatabase);
