const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

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

// Initialize with sample data
function initializeData() {
    // Sample users (teacher and students)
    db.users = [
        { id: '1', name: 'Harsimran Singh', email: 'harsimran@school.com', password: 'maibhagoteacher', role: 'teacher' },
        { id: '2', name: 'Mansimrat', email: 'kmansimrat16@gmail.com', password: 'maibhagostudent', role: 'student' }
    ];
    
    // Sample students
    db.students = [
        { id: '2', name: 'Mansimrat', email: 'kmansimrat16@gmail.com', studentId: 'STU001' }
    ];
    
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
    
    const newStudent = {
        id: uuidv4(),
        name,
        email,
        studentId
    };
    
    db.students.push(newStudent);
    
    // Also create a user account for login (default password is student123)
    const userPassword = password || 'student123';
    db.users.push({
        id: newStudent.id,
        name,
        email,
        password: userPassword,
        role: 'student'
    });
    
    res.json({ success: true, data: newStudent, message: 'Student added successfully' });
});

// Create attendance session
app.post('/api/sessions', (req, res) => {
    const { courseName, date, duration } = req.body;
    
    if (!courseName) {
        return res.status(400).json({ success: false, message: 'Course name is required' });
    }
    
    const session = {
        id: uuidv4(),
        courseName: courseName || 'General Class',
        date: date || new Date().toISOString().split('T')[0],
        duration: duration || 30, // minutes
        qrCode: null,
        qrGeneratedAt: null,
        isActive: true,
        createdAt: new Date().toISOString()
    };
    
    db.sessions.push(session);
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
    
    // Create QR data with session info
    const qrData = JSON.stringify({
        sessionId: session.id,
        courseName: session.courseName,
        date: session.date,
        timestamp: Date.now(),
        validUntil: Date.now() + (session.duration * 60 * 1000)
    });
    
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
        const parsedData = JSON.parse(qrData);
        const { sessionId, validUntil } = parsedData;
        
        // Check if QR code is still valid
        if (Date.now() > validUntil) {
            return res.status(400).json({ success: false, message: 'QR code has expired' });
        }
        
        // Find session
        const session = db.sessions.find(s => s.id === sessionId);
        if (!session) {
            return res.status(404).json({ success: false, message: 'Invalid session' });
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
            markedAt: new Date().toISOString()
        };
        
        db.attendance.push(attendanceRecord);
        
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
    
    const user = db.users.find(u => u.email === email && u.password === password);
    
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
    console.log(`QR Attendance System is ready!`);
});