const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const DEFAULT_STUDENT_PASSWORD = 'maibhagostudent';

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// In-memory database (replace with real DB in production)
const db = {
    sessions: [],
    attendance: [],
    students: [],
    users: []
};

function getDefaultData() {
    return {
        sessions: [],
        attendance: [],
        students: [
            { id: '2', name: 'Mansimrat', email: 'kmansimrat16@gmail.com', studentId: 'STU001' }
        ],
        users: [
        { id: '1', name: 'Harsimran Singh', email: 'harsimran@school.com', password: 'maibhagoteacher', role: 'teacher' },
        { id: '2', name: 'Mansimrat', email: 'kmansimrat16@gmail.com', password: 'maibhagostudent', role: 'student' }
        ]
    };
}

function saveData() {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

// Initialize with saved data when available
function initializeData() {
    if (fs.existsSync(DATA_FILE)) {
        try {
            const savedData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            db.sessions = Array.isArray(savedData.sessions) ? savedData.sessions : [];
            db.attendance = Array.isArray(savedData.attendance) ? savedData.attendance : [];
            db.students = Array.isArray(savedData.students) ? savedData.students : [];
            db.users = Array.isArray(savedData.users) ? savedData.users : [];
            console.log('Database loaded from data.json');
            return;
        } catch (error) {
            console.error('Failed to read saved data, falling back to defaults:', error.message);
        }
    }

    const defaultData = getDefaultData();
    db.sessions = defaultData.sessions;
    db.attendance = defaultData.attendance;
    db.students = defaultData.students;
    db.users = defaultData.users;
    saveData();
    console.log('Database initialized with sample data');
}

initializeData();

// ==================== API ROUTES ====================

// Get all students
app.get('/api/students', (req, res) => {
    res.json({ success: true, data: db.students });
});

// Add new student
app.post('/api/students', (req, res) => {
    const { name, email, studentId, password } = req.body;
    
    if (!name || !email || !studentId) {
        return res.status(400).json({ success: false, message: 'All fields are required' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const normalizedStudentId = studentId.trim().toUpperCase();

    const existingUser = db.users.find(u => u.email.toLowerCase() === normalizedEmail);
    if (existingUser) {
        return res.status(400).json({ success: false, message: 'A user with this email already exists' });
    }

    const existingStudent = db.students.find(s => s.studentId.toUpperCase() === normalizedStudentId);
    if (existingStudent) {
        return res.status(400).json({ success: false, message: 'A student with this student ID already exists' });
    }
    
    const newStudent = {
        id: uuidv4(),
        name: name.trim(),
        email: normalizedEmail,
        studentId: normalizedStudentId
    };
    
    db.students.push(newStudent);
    
    // Also create a user account for login.
    const userPassword = password || DEFAULT_STUDENT_PASSWORD;
    db.users.push({
        id: newStudent.id,
        name: newStudent.name,
        email: normalizedEmail,
        password: userPassword,
        role: 'student'
    });

    saveData();
    
    res.json({ success: true, data: newStudent, message: 'Student added successfully' });
});

// Create attendance session
app.post('/api/sessions', (req, res) => {
    const { subject, courseName, date, startTime, startAt, duration } = req.body;
    
    if (!courseName) {
        return res.status(400).json({ success: false, message: 'Course name is required' });
    }

    const sessionDate = date || new Date().toISOString().split('T')[0];
    const sessionStartAt = startAt || (startTime ? new Date(`${sessionDate}T${startTime}`).toISOString() : null);
    
    const session = {
        id: uuidv4(),
        subject: subject || '',
        courseName: courseName || 'General Class',
        date: sessionDate,
        startTime: startTime || '',
        startAt: sessionStartAt,
        duration: duration || 30, // minutes
        qrCode: null,
        qrGeneratedAt: null,
        isActive: true,
        createdAt: new Date().toISOString()
    };
    
    db.sessions.push(session);
    saveData();
    res.json({ success: true, data: session, message: 'Session created successfully' });
});

// Get all sessions
app.get('/api/sessions', (req, res) => {
    res.json({ success: true, data: db.sessions });
});

// Generate QR code for a session
app.get('/api/sessions/:id/qr', async (req, res) => {
    const session = db.sessions.find(s => s.id === req.params.id);
    
    if (!session) {
        return res.status(404).json({ success: false, message: 'Session not found' });
    }
    
    const classStartMs = session.startAt ? new Date(session.startAt).getTime() : Date.now();
    const validFromMs = Number.isNaN(classStartMs) ? Date.now() : Math.max(Date.now(), classStartMs);
    const validUntilMs = validFromMs + (session.duration * 60 * 1000);

    // Create QR data as a URL that leads to the attendance site
    const frontendURL = 'https://mansimratpannu.github.io/another-try';
    const qrData = `${frontendURL}?sessionId=${session.id}&subject=${encodeURIComponent(session.subject)}&course=${encodeURIComponent(session.courseName)}&date=${encodeURIComponent(session.date)}&startAt=${encodeURIComponent(session.startAt || '')}&validUntil=${validUntilMs}`;
    
    try {
        const qrCodeDataURL = await QRCode.toDataURL(qrData, {
            width: 300,
            margin: 2,
            color: {
                dark: '#000000',
                light: '#ffffff'
            }
        });
        
        session.qrCode = qrCodeDataURL;
        session.qrGeneratedAt = new Date().toISOString();
        session.qrValidUntil = new Date(validUntilMs).toISOString();
        saveData();
        
        res.json({ 
            success: true, 
            data: {
                session,
                qrCode: qrCodeDataURL
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error generating QR code', error: error.message });
    }
});

// Mark attendance via QR scan
app.post('/api/attendance', (req, res) => {
    const { qrData, studentId } = req.body;
    
    if (!qrData || !studentId) {
        return res.status(400).json({ success: false, message: 'QR data and student ID are required' });
    }
    
    try {
        // Parse URL parameters from QR data
        const urlParams = new URL(qrData).searchParams;
        const sessionId = urlParams.get('sessionId');
        const validUntil = parseInt(urlParams.get('validUntil'));
        const subject = urlParams.get('subject');
        const course = urlParams.get('course');
        const date = urlParams.get('date');
        const startAt = urlParams.get('startAt');
        
        // Check if QR code is still valid
        if (Date.now() > validUntil) {
            return res.status(400).json({ success: false, message: 'QR code has expired' });
        }
        
        // Find session or create temporary session from QR data
        let session = db.sessions.find(s => s.id === sessionId);
        
        // If session doesn't exist, create a temporary one from QR data
        if (!session) {
            session = {
                id: sessionId,
                subject: decodeURIComponent(subject || ''),
                courseName: decodeURIComponent(course || 'Unknown Course'),
                date: decodeURIComponent(date || new Date().toISOString().split('T')[0]),
                startAt: startAt ? decodeURIComponent(startAt) : null
            };
        }

        if (session.startAt && Date.now() < new Date(session.startAt).getTime()) {
            return res.status(400).json({ success: false, message: 'Attendance cannot be marked before the class starts' });
        }
        
        // Find student
        const student = db.students.find(s => s.id === studentId);
        if (!student) {
            return res.status(404).json({ success: false, message: 'Student not found' });
        }
        
        // Check if already marked attendance
        const existingAttendance = db.attendance.find(
            a => a.sessionId === sessionId && a.studentId === studentId
        );
        
        if (existingAttendance) {
            return res.status(400).json({ success: false, message: 'Attendance already marked' });
        }
        
        // Mark attendance
        const attendanceRecord = {
            id: uuidv4(),
            sessionId,
            studentId,
            studentName: student.name,
            studentIdNum: student.studentId,
            courseName: session.courseName,
            subject: session.subject,
            markedAt: new Date().toISOString()
        };
        
        db.attendance.push(attendanceRecord);
        saveData();
        
        res.json({ 
            success: true, 
            data: attendanceRecord,
            message: 'Attendance marked successfully' 
        });
    } catch (error) {
        res.status(400).json({ success: false, message: 'Invalid QR data', error: error.message });
    }
});

// Get attendance records
app.get('/api/attendance', (req, res) => {
    const { sessionId, studentId } = req.query;
    
    let filtered = db.attendance;
    
    if (sessionId) {
        filtered = filtered.filter(a => a.sessionId === sessionId);
    }
    
    if (studentId) {
        filtered = filtered.filter(a => a.studentId === studentId);
    }
    
    res.json({ success: true, data: filtered });
});

// Get attendance by session
app.get('/api/sessions/:id/attendance', (req, res) => {
    const session = db.sessions.find(s => s.id === req.params.id);
    
    if (!session) {
        return res.status(404).json({ success: false, message: 'Session not found' });
    }
    
    const sessionAttendance = db.attendance.filter(a => a.sessionId === req.params.id);
    
    res.json({ 
        success: true, 
        data: {
            session,
            attendance: sessionAttendance,
            totalStudents: db.students.length,
            presentCount: sessionAttendance.length
        }
    });
});

// Manual attendance (for testing)
app.post('/api/attendance/manual', (req, res) => {
    const { sessionId, studentId } = req.body;
    
    if (!sessionId || !studentId) {
        return res.status(400).json({ success: false, message: 'Session ID and student ID are required' });
    }
    
    const session = db.sessions.find(s => s.id === sessionId);
    const student = db.students.find(s => s.id === studentId);
    
    if (!session || !student) {
        return res.status(404).json({ success: false, message: 'Session or student not found' });
    }
    
    const existingAttendance = db.attendance.find(
        a => a.sessionId === sessionId && a.studentId === studentId
    );
    
    if (existingAttendance) {
        return res.status(400).json({ success: false, message: 'Attendance already marked' });
    }
    
    const attendanceRecord = {
        id: uuidv4(),
        sessionId,
        studentId,
        studentName: student.name,
        studentIdNum: student.studentId,
        courseName: session.courseName,
        markedAt: new Date().toISOString()
    };
    
    db.attendance.push(attendanceRecord);
    saveData();
    
    res.json({ success: true, data: attendanceRecord, message: 'Attendance marked successfully' });
});

// Serve frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Login API
app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    
    if (!email || !password) {
        return res.status(400).json({ success: false, message: 'Email and password are required' });
    }
    
    const normalizedEmail = email.trim().toLowerCase();
    const user = db.users.find(u => u.email.toLowerCase() === normalizedEmail && u.password === password);
    
    if (!user) {
        return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    res.json({ 
        success: true, 
        data: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role
        },
        message: 'Login successful'
    });
});

// Get current user info
app.get('/api/me', (req, res) => {
    const userId = req.headers['x-user-id'];
    
    if (!userId) {
        return res.status(401).json({ success: false, message: 'Not authenticated' });
    }
    
    const user = db.users.find(u => u.id === userId);
    
    if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    res.json({ 
        success: true, 
        data: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role
        }
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Mai Bhago Government Polytechnic College for Girls - Attendance System is ready!`);
});
