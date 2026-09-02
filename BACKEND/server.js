const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');
const crypto = require('crypto');
const Joi = require('joi');
const cartEngine = require('./cart-engine');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================
// CORS & MIDDLEWARE
// ============================================================
const allowedOrigins = ['http://127.0.0.1:5500', 'http://localhost:5500'];

app.use(cors({
    origin: function (origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// ============================================================
// DATABASE CONNECTION
// ============================================================
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'brgydata',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    // Return DATE columns as plain 'YYYY-MM-DD' strings instead of JS Date
    // objects. Without this, mysql2 builds the Date at local midnight and
    // res.json() serializes it as UTC, silently shifting the date back one
    // day for any timezone ahead of UTC (e.g. Asia/Manila, UTC+8).
    dateStrings: ['DATE']
});

async function testConnection() {
    try {
        const connection = await pool.getConnection();
        console.log('✅ Database connected successfully!');
        console.log(`📁 Using database: ${process.env.DB_NAME || 'brgydata'}`);
        connection.release();
    } catch (error) {
        console.error('❌ Database connection failed:', error.message);
        console.log('\n📌 Please check:');
        console.log('   1. MySQL is running (XAMPP/WAMP)');
        console.log('   2. Database credentials in .env are correct');
        console.log('   3. Database "brgydata" exists');
        process.exit(1);
    }
}

testConnection();

// ============================================================
// 📋 JOI VALIDATION SCHEMAS
// ============================================================

// Incident Schema
const incidentSchema = Joi.object({
    incident_type: Joi.string().required(),
    date: Joi.date().required(),
    time: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).required(),
    latitude: Joi.number().min(-90).max(90).required(),
    longitude: Joi.number().min(-180).max(180).required(),
    street_name: Joi.string().allow('', null),
    reporter_id: Joi.number().integer().positive().allow(null),
    status: Joi.string().valid('Open', 'Monitoring', 'Resolved').default('Open'),
    description: Joi.string().allow('', null),
    recommended_action: Joi.string().allow('', null)
});

// User Schema
const userSchema = Joi.object({
    name: Joi.string().required(),
    username: Joi.string().min(3).required(),
    password: Joi.string().min(6).required(),
    role: Joi.string().valid('Administrator', 'Decision-Maker').required(),
    contact_no: Joi.string().allow('', null)
});

// Login Schema
const loginSchema = Joi.object({
    username: Joi.string().required(),
    password: Joi.string().required()
});

// Tanod Schema
const tanodSchema = Joi.object({
    name: Joi.string().required(),
    position: Joi.string().allow('', null),
    contact_no: Joi.string().allow('', null),
    shift_start: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).allow('', null),
    shift_end: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).allow('', null),
    assigned_area: Joi.string().allow('', null)
});

// Patrol Schedule Schema
const scheduleSchema = Joi.object({
    location: Joi.string().required(),
    start_time: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).required(),
    end_time: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).required(),
    day_of_week: Joi.string().valid('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday').required(),
    assigned_tanods: Joi.number().integer().min(0).default(0),
    reason: Joi.string().allow('', null),
    status: Joi.string().valid('Active', 'Completed', 'Cancelled').default('Active')
});

// Patrol Log Schema
const logSchema = Joi.object({
    schedule_id: Joi.number().integer().positive().required(),
    tanod_id: Joi.number().integer().positive().required(),
    report: Joi.string().allow('', null),
    status: Joi.string().valid('Completed', 'Partial', 'Failed').default('Completed'),
    patrol_date: Joi.date().required()
});

// ============================================================
// 🔧 VALIDATION MIDDLEWARE
// ============================================================

function validate(schema) {
    return (req, res, next) => {
        const { error, value } = schema.validate(req.body, { abortEarly: false });
        if (error) {
            const errors = error.details.map(detail => detail.message);
            return res.status(400).json({ 
                error: 'Validation failed', 
                details: errors 
            });
        }
        req.body = value;
        next();
    };
}

// ============================================================
// AUDIT LOGGING HELPER
// ============================================================

async function logAudit(userId, action, entityType, entityId, oldData, newData, req) {
    try {
        const ip = req.ip || req.connection?.remoteAddress || 'unknown';
        const userAgent = req.headers?.['user-agent'] || '';

        if (!userId) {
            console.warn('⚠️ Audit log skipped: No userId provided');
            return;
        }

        await pool.query(`
            INSERT INTO audit_logs 
            (user_id, action, entity_type, entity_id, old_data, new_data, ip_address, user_agent)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            userId,
            action,
            entityType || null,
            entityId || null,
            oldData ? JSON.stringify(oldData) : null,
            newData ? JSON.stringify(newData) : null,
            ip,
            userAgent
        ]);

        console.log(`✅ Audit: ${action} by user ${userId} on ${entityType} #${entityId || 'N/A'}`);
    } catch (error) {
        console.error('❌ Audit log error:', error.message);
    }
}

// ============================================================
// 🔐 MIDDLEWARE: SESSION-BASED AUTHENTICATION
// ============================================================

async function authenticate(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Unauthorized: No session token provided' });
        }

        const token = authHeader.split(' ')[1];

        const [sessions] = await pool.query(
            `SELECT user_id, is_active 
             FROM user_sessions 
             WHERE session_token = ? AND is_active = 1 AND logout_time IS NULL`,
            [token]
        );

        if (sessions.length === 0) {
            return res.status(401).json({ error: 'Unauthorized: Invalid or expired session' });
        }

        req.userId = sessions[0].user_id;
        next();

    } catch (error) {
        console.error('❌ Authentication error:', error);
        return res.status(500).json({ error: 'Server error during authentication' });
    }
}

// ============================================================
// 🔐 MIDDLEWARE: ROLE-BASED AUTHORIZATION
// ============================================================

function requireRole(allowedRoles) {
    return async (req, res, next) => {
        try {
            const [users] = await pool.query(
                'SELECT role FROM users WHERE id = ? AND is_active = 1',
                [req.userId]
            );

            if (users.length === 0) {
                return res.status(401).json({ error: 'User not found or inactive' });
            }

            const userRole = users[0].role;

            if (!allowedRoles.includes(userRole)) {
                return res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
            }

            req.userRole = userRole;
            next();

        } catch (error) {
            console.error('❌ Authorization error:', error);
            return res.status(500).json({ error: 'Server error during authorization' });
        }
    };
}

// ============================================================
// HELPER FUNCTIONS FOR AUTO-COMPUTE
// ============================================================

function computeTimeOfDay(timeStr) {
    if (!timeStr) return 'Night';
    try {
        const parts = timeStr.split(':');
        const hour = parseInt(parts[0], 10);
        if (isNaN(hour)) return 'Night';
        
        if (hour >= 6 && hour <= 11) return 'Morning';
        if (hour >= 12 && hour <= 17) return 'Afternoon';
        if (hour >= 18 && hour <= 21) return 'Evening';
        return 'Night';
    } catch (e) {
        return 'Night';
    }
}

function getDayOfWeek(dateStr) {
    if (!dateStr) return 'Monday';
    try {
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return 'Monday';
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        return days[date.getDay()];
    } catch (e) {
        return 'Monday';
    }
}

function isDateWeekend(dateStr) {
    if (!dateStr) return false;
    try {
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return false;
        return date.getDay() === 0 || date.getDay() === 6;
    } catch (e) {
        return false;
    }
}

// ============================================================
// 🆕 CART ENGINE - COMPUTE FOR SINGLE INCIDENT
// ============================================================

async function computeCartRiskFactors(incidentId) {
    try {
        console.log(`🔄 Computing CART risk factors for incident ${incidentId}...`);
        
        // 1. Get incident data
        const [incidents] = await pool.query(`
            SELECT id, incident_type, time_of_day, is_weekend, street_name 
            FROM incidents WHERE id = ?
        `, [incidentId]);

        if (incidents.length === 0) {
            console.warn(`⚠️ Incident ${incidentId} not found`);
            return;
        }

        const incident = incidents[0];
        console.log(`📋 Incident: ${incident.incident_type} at ${incident.street_name || 'Unknown'}`);

        // 2. Get location statistics
        let locationData = null;
        if (incident.street_name) {
            const [result] = await pool.query(`
                SELECT street_name, COUNT(*) as street_count
                FROM incidents 
                WHERE street_name = ? AND street_name IS NOT NULL
                GROUP BY street_name
            `, [incident.street_name]);
            locationData = result[0] || null;
        }

        // 3. Get frequency statistics (last 30 days)
        let frequencyData = null;
        if (incident.street_name) {
            const [result] = await pool.query(`
                SELECT street_name, COUNT(*) as recent_count
                FROM incidents 
                WHERE street_name = ? 
                AND street_name IS NOT NULL 
                AND date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
                GROUP BY street_name
            `, [incident.street_name]);
            frequencyData = result[0] || null;
        }

        // 4. Analyze using CART Engine
        const result = cartEngine.analyze(
            incident,
            locationData,
            frequencyData
        );

        console.log(`📊 Result: ${result.dangerLevel} (${result.totalScore})`);

        // 5. Delete existing risk factors
        await pool.query('DELETE FROM cart_risk_factors WHERE incident_id = ?', [incidentId]);

        // 6. Save to database
        await pool.query(`
            INSERT INTO cart_risk_factors (
                incident_id, 
                time_risk_score, 
                day_risk_score, 
                type_risk_score,
                location_risk_score, 
                frequency_risk_score, 
                total_risk_score, 
                danger_level,
                decision_path,
                model_version
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            incidentId,
            result.scores.time || 0,
            result.scores.day || 0,
            result.scores.type || 0,
            result.scores.location || 0,
            result.scores.frequency || 0,
            result.totalScore || 0,
            result.dangerDescription || 'Level 1 — Low Danger / Stable Area',
            result.decisionPath ? result.decisionPath.join('\n') : 'No decision path',
            'v1.0'
        ]);

        // 7. Reflect the real computed level back onto the incident itself -
        // incidents.danger_level was otherwise left as the literal placeholder
        // 'Calculated by System' forever, even though the real Level 1/2/3
        // result was sitting in cart_risk_factors the whole time.
        await pool.query(
            'UPDATE incidents SET danger_level = ? WHERE id = ?',
            [result.dangerDescription || 'Level 1 — Low Danger / Stable Area', incidentId]
        );

        console.log(`✅ CART risk factors saved for incident ${incidentId}`);

    } catch (error) {
        console.error('❌ Error computing CART risk factors:', error);
        console.error('Stack:', error.stack);
        throw error;
    }
}

// ============================================================
// RECOMPUTE ALL CART RISK FACTORS
// ============================================================

async function recomputeAllCartRiskFactors() {
    try {
        console.log('🔄 Starting full CART recomputation...');
        
        // 1. Get all incidents with valid data
        const [incidents] = await pool.query(`
            SELECT id, incident_type, time_of_day, is_weekend, street_name 
            FROM incidents 
            WHERE id IS NOT NULL
            AND incident_type IS NOT NULL
            AND time_of_day IS NOT NULL
        `);

        if (incidents.length === 0) {
            console.log('ℹ️ No valid incidents found to recompute');
            await pool.query(`
                INSERT INTO cart_analysis_log (
                    analysis_type,
                    total_incidents_analyzed,
                    status,
                    notes
                ) VALUES (?, ?, ?, ?)
            `, ['risk_prediction', 0, 'completed', 'No incidents found to analyze']);
            return;
        }

        console.log(`📋 Found ${incidents.length} incidents to process`);

        // 2. Get location statistics for all streets (with data)
        const [locationStats] = await pool.query(`
            SELECT street_name, COUNT(*) as street_count
            FROM incidents 
            WHERE street_name IS NOT NULL AND street_name != ''
            GROUP BY street_name
        `);

        // 3. Get frequency statistics for all streets (last 30 days)
        const [frequencyStats] = await pool.query(`
            SELECT street_name, COUNT(*) as recent_count
            FROM incidents 
            WHERE street_name IS NOT NULL 
            AND street_name != ''
            AND date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
            GROUP BY street_name
        `);

        // Create lookup maps
        const locationMap = {};
        locationStats.forEach(item => {
            locationMap[item.street_name] = item.street_count;
        });

        const frequencyMap = {};
        frequencyStats.forEach(item => {
            frequencyMap[item.street_name] = item.recent_count;
        });

        console.log(`📍 Location stats: ${Object.keys(locationMap).length} streets`);
        console.log(`📊 Frequency stats: ${Object.keys(frequencyMap).length} streets`);

        // 4. Delete all existing risk factors
        await pool.query('TRUNCATE TABLE cart_risk_factors');
        console.log('🗑️ Truncated cart_risk_factors table');

        // 5. Process each incident
        let processed = 0;
        let errors = 0;
        let highRisk = 0;
        let moderateRisk = 0;
        let lowRisk = 0;
        
        for (const incident of incidents) {
            try {
                const locationData = incident.street_name ? {
                    street_count: locationMap[incident.street_name] || 0
                } : null;

                const frequencyData = incident.street_name ? {
                    recent_count: frequencyMap[incident.street_name] || 0
                } : null;

                const result = cartEngine.analyze(
                    incident,
                    locationData,
                    frequencyData
                );

                if (result.dangerLevel === 'Level 3') highRisk++;
                else if (result.dangerLevel === 'Level 2') moderateRisk++;
                else lowRisk++;

                await pool.query(`
                    INSERT INTO cart_risk_factors (
                        incident_id, 
                        time_risk_score, 
                        day_risk_score, 
                        type_risk_score,
                        location_risk_score, 
                        frequency_risk_score, 
                        total_risk_score, 
                        danger_level,
                        decision_path,
                        model_version
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    incident.id,
                    result.scores.time || 0,
                    result.scores.day || 0,
                    result.scores.type || 0,
                    result.scores.location || 0,
                    result.scores.frequency || 0,
                    result.totalScore || 0,
                    result.dangerDescription || 'Level 1 — Low Danger / Stable Area',
                    result.decisionPath ? result.decisionPath.join('\n') : 'No decision path',
                    'v1.0'
                ]);

                // Keep incidents.danger_level in sync with the real result,
                // same as the single-incident path in computeCartRiskFactors.
                await pool.query(
                    'UPDATE incidents SET danger_level = ? WHERE id = ?',
                    [result.dangerDescription || 'Level 1 — Low Danger / Stable Area', incident.id]
                );

                processed++;
                
                if (processed % 10 === 0) {
                    console.log(`📊 Processed ${processed}/${incidents.length} incidents`);
                }
            } catch (incidentError) {
                errors++;
                console.error(`❌ Error processing incident ${incident.id}:`, incidentError.message);
            }
        }

        // 6. Log the analysis
        const incidentTypes = [...new Set(incidents.map(i => i.incident_type).filter(Boolean))];
        const streets = [...new Set(incidents.map(i => i.street_name).filter(Boolean))];
        
        await pool.query(`
            INSERT INTO cart_analysis_log (
                analysis_type,
                date_range_start,
                date_range_end,
                incident_types_analyzed,
                total_streets_analyzed,
                total_incidents_analyzed,
                high_risk_count,
                moderate_risk_count,
                low_risk_count,
                execution_time_ms,
                status,
                notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            'risk_prediction',
            null,
            null,
            incidentTypes.join(', ') || 'None',
            streets.length || 0,
            processed,
            highRisk,
            moderateRisk,
            lowRisk,
            0,
            'completed',
            `Processed ${processed} incidents with ${errors} errors`
        ]);

        console.log(`✅ All CART risk factors recomputed for ${processed} incidents (${errors} errors)`);
        console.log(`📊 Risk distribution: High=${highRisk}, Moderate=${moderateRisk}, Low=${lowRisk}`);

    } catch (error) {
        console.error('❌ Error recomputing CART risk factors:', error);
        console.error('Stack:', error.stack);
        
        try {
            await pool.query(`
                INSERT INTO cart_analysis_log (
                    analysis_type,
                    status,
                    notes
                ) VALUES (?, ?, ?)
            `, ['risk_prediction', 'failed', `Error: ${error.message}`]);
        } catch (logError) {
            console.error('❌ Failed to log error:', logError.message);
        }
        
        throw error;
    }
}

// ============================================================
// USER MANAGEMENT API ROUTES
// ============================================================

app.get('/api/users', authenticate, requireRole(['Administrator']), async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT
                u.id, u.name, u.username, u.role,
                u.contact_no, u.is_active, u.last_login_at, u.created_at, u.updated_at
            FROM users u
            ORDER BY u.id
        `);
        res.json(rows);
    } catch (error) {
        console.error('❌ Error fetching users:', error);
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

app.get('/api/users/:id', authenticate, requireRole(['Administrator']), async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT
                u.id, u.name, u.username, u.role,
                u.contact_no, u.is_active, u.last_login_at, u.created_at, u.updated_at
            FROM users u
            WHERE u.id = ?
        `, [req.params.id]);
        
        if (rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        res.json(rows[0]);
    } catch (error) {
        console.error('❌ Error fetching user:', error);
        res.status(500).json({ error: 'Failed to fetch user' });
    }
});

app.post('/api/users', authenticate, requireRole(['Administrator']), validate(userSchema), async (req, res) => {
    try {
        const { name, username, password, role, contact_no } = req.body;
        
        const [existing] = await pool.query(
            'SELECT id FROM users WHERE username = ?',
            [username]
        );
        
        if (existing.length > 0) {
            return res.status(400).json({ 
                error: 'Username already exists.' 
            });
        }
        
        const saltRounds = 10;
        const password_hash = await bcrypt.hash(password, saltRounds);
        
        const [result] = await pool.query(
            `INSERT INTO users (name, username, password_hash, role, contact_no)
             VALUES (?, ?, ?, ?, ?)`,
            [name, username, password_hash, role, contact_no || null]
        );
        
        const [newUser] = await pool.query(`
            SELECT
                u.id, u.name, u.username, u.role,
                u.contact_no, u.is_active, u.created_at, u.updated_at
            FROM users u
            WHERE u.id = ?
        `, [result.insertId]);
        
        const userId = req.userId;
        
        if (userId) {
            await logAudit(
                userId,
                'CREATE_USER',
                'users',
                result.insertId,
                null,
                { name, username, role },
                req
            );
        }
        
        res.status(201).json({
            message: 'User account added successfully.',
            user: newUser[0]
        });
        
    } catch (error) {
        console.error('❌ Error creating user:', error);
        res.status(500).json({ error: 'Failed to create user' });
    }
});

app.delete('/api/users/:id', authenticate, requireRole(['Administrator']), async (req, res) => {
    try {
        const userId = req.params.id;
        const loggedInUserId = req.userId;
        
        const [user] = await pool.query(
            'SELECT id, username FROM users WHERE id = ?',
            [userId]
        );
        
        if (user.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        if (user[0].username.toLowerCase() === 'admin') {
            return res.status(403).json({ 
                error: 'The primary administrator account cannot be deleted.' 
            });
        }
        
        if (loggedInUserId) {
            await logAudit(
                loggedInUserId,
                'DELETE_USER',
                'users',
                userId,
                user[0],
                null,
                req
            );
        }
        
        await pool.query(
            'DELETE FROM users WHERE id = ?',
            [userId]
        );
        
        res.json({ message: 'User account deleted successfully.' });
        
    } catch (error) {
        console.error('❌ Error deleting user:', error);
        res.status(500).json({ error: 'Failed to delete user' });
    }
});

app.get('/api/users/search', authenticate, requireRole(['Administrator']), async (req, res) => {
    try {
        const { q } = req.query;
        
        if (!q) {
            const [rows] = await pool.query(`
                SELECT
                    u.id, u.name, u.username, u.role,
                    u.contact_no, u.is_active, u.last_login_at
                FROM users u
                ORDER BY u.id
            `);
            return res.json(rows);
        }

        const searchTerm = `%${q}%`;
        const [rows] = await pool.query(`
            SELECT
                u.id, u.name, u.username, u.role,
                u.contact_no, u.is_active, u.last_login_at
            FROM users u
            WHERE u.name LIKE ?
               OR u.username LIKE ?
               OR u.role LIKE ?
            ORDER BY u.id
        `, [searchTerm, searchTerm, searchTerm]);
        
        res.json(rows);
        
    } catch (error) {
        console.error('❌ Error searching users:', error);
        res.status(500).json({ error: 'Search failed' });
    }
});

app.get('/api/users-list', authenticate, requireRole(['Administrator', 'Decision-Maker']), async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT id, name FROM users WHERE is_active = 1 ORDER BY name'
        );
        res.json(rows);
    } catch (error) {
        console.error('❌ Error fetching users list:', error);
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

// ============================================================
// 🔥 AUTH - LOGIN (WITH LOGIN HISTORY)
// ============================================================

app.post('/api/auth/login', validate(loginSchema), async (req, res) => {
    try {
        const { username, password } = req.body;
        const ip = req.ip || req.connection?.remoteAddress || 'unknown';
        
        console.log('🔐 ========================================');
        console.log(`🔐 Login attempt: ${username} from IP: ${ip}`);
        console.log('🔐 ========================================');
        
        const [attempts] = await pool.query(
            `SELECT COUNT(*) as count FROM login_attempts 
             WHERE username = ? AND success = 0 AND attempt_time > DATE_SUB(NOW(), INTERVAL 15 MINUTE)`,
            [username]
        );
        
        const failedCount = attempts[0]?.count || 0;
        console.log(`📊 Failed attempts: ${failedCount}`);
        
        if (failedCount >= 5) {
            console.log(`⛔ Account locked for ${username}`);
            return res.status(429).json({
                error: 'Too many failed login attempts. Please wait 15 minutes.',
                locked: true
            });
        }
        
        const [users] = await pool.query(`
            SELECT id, name, username, password_hash, role, is_active, last_login_at
            FROM users 
            WHERE username = ? AND is_active = 1
        `, [username]);
        
        if (users.length === 0) {
            console.log(`❌ User not found: ${username}`);
            await pool.query(
                'INSERT INTO login_attempts (username, ip_address, success) VALUES (?, ?, ?)',
                [username, ip, false]
            );
            return res.status(401).json({ error: 'Invalid username or password.' });
        }
        
        const user = users[0];
        const match = await bcrypt.compare(password, user.password_hash);
        
        if (!match) {
            console.log(`❌ Wrong password for: ${username}`);
            await pool.query(
                'INSERT INTO login_attempts (username, ip_address, success) VALUES (?, ?, ?)',
                [username, ip, false]
            );
            return res.status(401).json({ error: 'Invalid username or password.' });
        }
        
        console.log(`✅ Password correct for: ${username}`);
        
        await pool.query(
            'INSERT INTO login_attempts (username, ip_address, success) VALUES (?, ?, ?)',
            [username, ip, true]
        );
        
        const sessionToken = crypto.randomBytes(32).toString('hex');
        await pool.query(`
            INSERT INTO user_sessions 
            (user_id, session_token, ip_address, user_agent, is_active)
            VALUES (?, ?, ?, ?, ?)
        `, [user.id, sessionToken, ip, req.headers['user-agent'] || '', true]);
        console.log(`✅ Session token created`);
        
        console.log('📝 ========================================');
        console.log(`📝 Saving to login_history for user: ${user.id} (${user.username})`);
        console.log(`📝 IP: ${ip}`);
        console.log('📝 ========================================');
        
        try {
            const [historyResult] = await pool.query(`
                INSERT INTO login_history 
                (user_id, username, ip_address, user_agent, login_time)
                VALUES (?, ?, ?, ?, NOW())
            `, [
                user.id,
                user.username,
                ip,
                req.headers['user-agent'] || ''
            ]);
            
            console.log(`✅✅✅ login_history inserted! ID: ${historyResult.insertId}`);
            
        } catch (historyError) {
            console.error('❌❌❌ login_history ERROR:');
            console.error('Code:', historyError.code);
            console.error('Message:', historyError.message);
        }
        
        await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);
        
        await logAudit(user.id, 'LOGIN', 'users', user.id, null, { username: user.username, role: user.role }, req);
        
        const { password_hash, ...userData } = user;
        
        console.log('✅ ========================================');
        console.log(`✅ Login successful for: ${user.username} (${user.role})`);
        console.log('✅ ========================================');
        
        res.json({
            message: 'Login successful.',
            user: userData,
            session_token: sessionToken
        });
        
    } catch (error) {
        console.error('❌❌❌ FATAL LOGIN ERROR:');
        console.error('Message:', error.message);
        console.error('Stack:', error.stack);
        res.status(500).json({ error: 'Login failed. Please try again.' });
    }
});

// ============================================================
// 📋 GET LOGIN HISTORY - PUBLIC (NO AUTH REQUIRED)
// ============================================================

app.get('/api/login-history', async (req, res) => {
    try {
        console.log('📋 /api/login-history called (public)');
        
        const [rows] = await pool.query(`
            SELECT 
                lh.id,
                lh.user_id,
                lh.username,
                lh.ip_address,
                lh.user_agent,
                lh.login_time,
                u.name as user_name,
                u.role as user_role
            FROM login_history lh
            LEFT JOIN users u ON lh.user_id = u.id
            ORDER BY lh.login_time DESC
            LIMIT 50
        `);
        
        console.log(`✅ Found ${rows.length} login history records`);
        res.json(rows);
    } catch (error) {
        console.error('❌ Error fetching login history:', error);
        res.status(500).json({ error: 'Failed to fetch login history', details: error.message });
    }
});

// ============================================================
// AUTH - FORGOT PASSWORD
// ============================================================

app.post('/api/auth/forgot-password', async (req, res) => {
    try {
        const { username } = req.body;

        if (!username) {
            return res.status(400).json({ error: 'Username is required' });
        }

        const [users] = await pool.query(
            'SELECT id, username, name FROM users WHERE username = ?',
            [username]
        );

        if (users.length === 0) {
            return res.json({ message: 'If the username exists, a reset link has been sent.' });
        }

        const user = users[0];
        const resetToken = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

        await pool.query(`
            INSERT INTO password_resets (user_id, reset_token, expires_at)
            VALUES (?, ?, ?)
        `, [user.id, resetToken, expiresAt]);

        console.log(`🔑 Password Reset Token for ${username}: ${resetToken}`);
        console.log(`⏰ Expires at: ${expiresAt.toLocaleString()}`);

        res.json({
            message: 'If the username exists, a reset link has been sent.'
        });

    } catch (error) {
        console.error('Error in forgot-password:', error);
        res.status(500).json({ error: 'Failed to process request' });
    }
});

// ============================================================
// AUTH - RESET PASSWORD
// ============================================================

app.post('/api/auth/reset-password', async (req, res) => {
    try {
        const { reset_token, new_password } = req.body;

        if (!reset_token || !new_password) {
            return res.status(400).json({ error: 'Reset token and new password are required' });
        }

        if (new_password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }

        const [resetRecords] = await pool.query(`
            SELECT user_id FROM password_resets 
            WHERE reset_token = ? AND used_at IS NULL AND expires_at > NOW()
        `, [reset_token]);

        if (resetRecords.length === 0) {
            return res.status(400).json({ error: 'Invalid or expired reset token' });
        }

        const userId = resetRecords[0].user_id;
        const saltRounds = 10;
        const password_hash = await bcrypt.hash(new_password, saltRounds);

        await pool.query(
            'UPDATE users SET password_hash = ? WHERE id = ?',
            [password_hash, userId]
        );

        await pool.query(
            'UPDATE password_resets SET used_at = NOW() WHERE reset_token = ?',
            [reset_token]
        );

        res.json({ message: 'Password reset successful!' });

    } catch (error) {
        console.error('Error in reset-password:', error);
        res.status(500).json({ error: 'Failed to reset password' });
    }
});

// ============================================================
// AUTH - LOGOUT
// ============================================================

app.post('/api/auth/logout', async (req, res) => {
    try {
        const { session_token } = req.body;

        if (!session_token) {
            return res.status(400).json({ error: 'Session token required' });
        }

        const [sessions] = await pool.query(
            'SELECT user_id FROM user_sessions WHERE session_token = ? AND is_active = 1',
            [session_token]
        );

        if (sessions.length > 0) {
            const userId = sessions[0].user_id;
            
            await pool.query(
                'UPDATE user_sessions SET logout_time = NOW(), is_active = 0 WHERE session_token = ?',
                [session_token]
            );

            await logAudit(
                userId,
                'LOGOUT',
                'users',
                userId,
                null,
                null,
                req
            );
        }

        res.json({ message: 'Logout successful' });
    } catch (error) {
        console.error('❌ Error during logout:', error);
        res.status(500).json({ error: 'Logout failed' });
    }
});

// ============================================================
// ✅ FIXED: INCIDENT MANAGEMENT API ROUTES
// ============================================================

app.get('/api/incidents', authenticate, requireRole(['Administrator', 'Decision-Maker']), async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT 
                incidents.*, 
                users.name as reporter_name,
                users.contact_no as reporter_contact_no
            FROM incidents 
            LEFT JOIN users ON incidents.reporter_id = users.id 
            WHERE TRIM(incidents.status) != 'Resolved'
            ORDER BY incidents.date DESC, incidents.time DESC
        `);
        res.json(rows);
    } catch (error) {
        console.error('❌ Error fetching incidents:', error);
        res.status(500).json({ error: 'Failed to fetch incidents' });
    }
});

// ✅ VIEW-ONLY INCIDENTS (FOR CAPTAIN)
app.get('/api/incidents/view-only', authenticate, async (req, res) => {
    try {
        console.log('📡 /api/incidents/view-only called');
        
        const [users] = await pool.query(
            'SELECT role FROM users WHERE id = ? AND is_active = 1',
            [req.userId]
        );

        if (users.length === 0) {
            return res.status(401).json({ error: 'User not found' });
        }

        const userRole = users[0].role;
        console.log(`👤 User role: ${userRole}`);

        if (!['Captain', 'Administrator', 'Decision-Maker'].includes(userRole)) {
            return res.status(403).json({ error: 'Access denied. View-only for Captain and above.' });
        }

        const { page = 1, limit = 10, search = '', type = '', status = '' } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        let filter = [];
        let params = [];

        filter.push("TRIM(incidents.status) != 'Resolved'");

        if (search) {
            filter.push("(incidents.incident_type LIKE ? OR incidents.street_name LIKE ? OR incidents.description LIKE ?)");
            const searchTerm = `%${search}%`;
            params.push(searchTerm, searchTerm, searchTerm);
        }

        if (type) {
            filter.push("incidents.incident_type = ?");
            params.push(type);
        }

        if (status) {
            filter.push("incidents.status = ?");
            params.push(status);
        }

        const whereClause = filter.length > 0 ? `WHERE ${filter.join(' AND ')}` : '';

        const [countResult] = await pool.query(`
            SELECT COUNT(*) as total
            FROM incidents
            ${whereClause}
        `, params);

        const total = countResult[0].total;
        const totalPages = Math.ceil(total / parseInt(limit));

        params.push(parseInt(limit), skip);

        const [rows] = await pool.query(`
            SELECT 
                incidents.*, 
                users.name as reporter_name,
                users.contact_no as reporter_contact_no
            FROM incidents 
            LEFT JOIN users ON incidents.reporter_id = users.id 
            ${whereClause}
            ORDER BY incidents.date DESC, incidents.time DESC
            LIMIT ? OFFSET ?
        `, params);

        console.log(`✅ Found ${rows.length} incidents (total: ${total})`);

        res.json({
            incidents: rows,
            total,
            totalPages,
            currentPage: parseInt(page)
        });

    } catch (error) {
        console.error('❌ Error fetching view-only incidents:', error);
        res.status(500).json({ error: 'Failed to fetch incidents' });
    }
});

// ✅ GET SINGLE INCIDENT (VIEW-ONLY)
app.get('/api/incidents/:id', authenticate, async (req, res) => {
    try {
        console.log(`📡 /api/incidents/${req.params.id} called`);
        
        const [users] = await pool.query(
            'SELECT role FROM users WHERE id = ? AND is_active = 1',
            [req.userId]
        );

        if (users.length === 0) {
            return res.status(401).json({ error: 'User not found' });
        }

        const userRole = users[0].role;

        if (!['Captain', 'Administrator', 'Decision-Maker'].includes(userRole)) {
            return res.status(403).json({ error: 'Access denied. View-only for Captain and above.' });
        }

        const [rows] = await pool.query(`
            SELECT 
                incidents.*, 
                users.name as reporter_name,
                users.contact_no as reporter_contact_no
            FROM incidents 
            LEFT JOIN users ON incidents.reporter_id = users.id 
            WHERE incidents.id = ?
        `, [req.params.id]);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Incident not found' });
        }

        res.json(rows[0]);

    } catch (error) {
        console.error('❌ Error fetching incident:', error);
        res.status(500).json({ error: 'Failed to fetch incident' });
    }
});

app.get('/api/heatmap/incidents', authenticate, requireRole(['Administrator', 'Decision-Maker']), async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT incidents.*, users.name as reporter_name 
            FROM incidents 
            LEFT JOIN users ON incidents.reporter_id = users.id 
            WHERE TRIM(incidents.status) != 'Resolved'
            ORDER BY incidents.date DESC, incidents.time DESC
        `);
        res.json(rows);
    } catch (error) {
        console.error('❌ Error fetching heatmap incidents:', error);
        res.status(500).json({ error: 'Failed to fetch heatmap incidents' });
    }
});

app.post('/api/incidents', authenticate, requireRole(['Administrator']), validate(incidentSchema), async (req, res) => {
    try {
        const { 
            incident_type, date, time, latitude, longitude, street_name, reporter_id, 
            status, description, recommended_action 
        } = req.body;

        const finalStreetName = street_name || null;
        const finalReporterId = (reporter_id && !isNaN(parseInt(reporter_id))) ? parseInt(reporter_id) : null;

        const timeOfDay = computeTimeOfDay(time);
        const dayOfWeek = getDayOfWeek(date);
        const isWeekend = isDateWeekend(date);

        const [result] = await pool.query(`
            INSERT INTO incidents 
            (incident_type, date, time, latitude, longitude, street_name, reporter_id, 
             status, danger_level, description, recommended_action, 
             time_of_day, day_of_week, is_weekend) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            incident_type, 
            date, 
            time, 
            latitude, 
            longitude, 
            finalStreetName,
            finalReporterId, 
            status || 'Open', 
            'Calculated by System',
            description || '', 
            recommended_action || '',
            timeOfDay,
            dayOfWeek,
            isWeekend
        ]);

        await computeCartRiskFactors(result.insertId);

        const userId = req.userId;

        if (userId) {
            await logAudit(
                userId,
                'CREATE_INCIDENT',
                'incidents',
                result.insertId,
                null,
                req.body,
                req
            );
        }

        res.status(201).json({ 
            message: 'Incident saved successfully.', 
            id: result.insertId 
        });

    } catch (error) {
        console.error('❌ Error creating incident:', error);
        res.status(500).json({ error: 'Failed to create incident' });
    }
});

app.put('/api/incidents/:id', authenticate, requireRole(['Administrator']), validate(incidentSchema), async (req, res) => {
    try {
        const { 
            incident_type, date, time, latitude, longitude, street_name, reporter_id, 
            status, description, recommended_action 
        } = req.body;
        const id = req.params.id;

        const [oldData] = await pool.query('SELECT * FROM incidents WHERE id = ?', [id]);

        const finalStreetName = street_name || null;
        const finalReporterId = (reporter_id && !isNaN(parseInt(reporter_id))) ? parseInt(reporter_id) : null;

        const timeOfDay = computeTimeOfDay(time);
        const dayOfWeek = getDayOfWeek(date);
        const isWeekend = isDateWeekend(date);

        const [result] = await pool.query(`
            UPDATE incidents 
            SET incident_type = ?, date = ?, time = ?, latitude = ?, longitude = ?, 
                street_name = ?, reporter_id = ?, status = ?, 
                danger_level = 'Calculated by System', 
                description = ?, recommended_action = ?,
                time_of_day = ?, day_of_week = ?, is_weekend = ?
            WHERE id = ?
        `, [
            incident_type, date, time, latitude, longitude, 
            finalStreetName, finalReporterId, status, 
            description, recommended_action,
            timeOfDay, dayOfWeek, isWeekend, id
        ]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Incident not found' });
        }

        await computeCartRiskFactors(id);

        const userId = req.userId;

        if (userId) {
            await logAudit(
                userId,
                'UPDATE_INCIDENT',
                'incidents',
                id,
                oldData[0] || null,
                req.body,
                req
            );
        }

        res.json({ message: 'Incident updated successfully.' });

    } catch (error) {
        console.error('❌ Error updating incident:', error);
        res.status(500).json({ error: 'Failed to update incident' });
    }
});

app.delete('/api/incidents/:id', authenticate, requireRole(['Administrator']), async (req, res) => {
    try {
        const id = req.params.id;
        const userId = req.userId;

        const [oldData] = await pool.query('SELECT * FROM incidents WHERE id = ?', [id]);

        await pool.query('DELETE FROM cart_risk_factors WHERE incident_id = ?', [id]);
        const [result] = await pool.query('DELETE FROM incidents WHERE id = ?', [id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Incident not found' });
        }

        if (userId) {
            await logAudit(
                userId,
                'DELETE_INCIDENT',
                'incidents',
                id,
                oldData[0] || null,
                null,
                req
            );
        }

        res.json({ message: 'Incident deleted successfully.' });
    } catch (error) {
        console.error('❌ Error deleting incident:', error);
        res.status(500).json({ error: 'Failed to delete incident' });
    }
});

// ============================================================
// 🆕 CART PATROL INTEGRATION - Get CART data for patrol
// ============================================================

app.get('/api/patrol/cart-summary', authenticate, requireRole(['Administrator', 'Decision-Maker']), async (req, res) => {
    try {
        const { month } = req.query;
        
        if (!month) {
            return res.status(400).json({ error: 'Month parameter required (YYYY-MM)' });
        }
        
        console.log(`📊 Fetching CART patrol summary for month: ${month}`);
        
        // Get incidents with CART risk factors for the month
        const [results] = await pool.query(`
            SELECT 
                i.id,
                i.incident_type,
                i.date,
                i.time,
                i.street_name,
                i.status,
                i.danger_level as incident_danger,
                rf.time_risk_score,
                rf.day_risk_score,
                rf.type_risk_score,
                rf.location_risk_score,
                rf.frequency_risk_score,
                rf.total_risk_score,
                rf.danger_level as cart_danger_level,
                rf.decision_path,
                rf.calculated_at
            FROM incidents i
            LEFT JOIN cart_risk_factors rf ON i.id = rf.incident_id
            WHERE i.date LIKE ?
            AND TRIM(i.status) != 'Resolved'
            ORDER BY rf.total_risk_score DESC
        `, [`${month}%`]);
        
        console.log(`📊 Found ${results.length} incidents for month ${month}`);
        
        // Group by location
        const locationMap = {};
        results.forEach(incident => {
            const location = incident.street_name || 'Unknown';
            if (!locationMap[location]) {
                locationMap[location] = {
                    incidents: [],
                    totalRisk: 0,
                    maxRisk: 0,
                    avgRisk: 0,
                    count: 0,
                    levels: [],
                    riskScores: []
                };
            }
            const data = locationMap[location];
            data.incidents.push(incident);
            data.count++;
            const riskScore = parseFloat(incident.total_risk_score) || 0;
            data.totalRisk += riskScore;
            data.maxRisk = Math.max(data.maxRisk, riskScore);
            data.riskScores.push(riskScore);
            if (incident.cart_danger_level) {
                data.levels.push(incident.cart_danger_level);
            }
        });
        
        // Calculate averages and determine dominant danger level
        const summary = Object.entries(locationMap).map(([location, data]) => {
            const avgRisk = data.totalRisk / data.count;
            
            // Determine dominant danger level
            const levelCount = {};
            data.levels.forEach(level => {
                let key = 'Level 1';
                if (level.includes('Level 3') || level.includes('High')) {
                    key = 'Level 3';
                } else if (level.includes('Level 2') || level.includes('Moderate')) {
                    key = 'Level 2';
                }
                levelCount[key] = (levelCount[key] || 0) + 1;
            });
            
            let dominantLevel = 'Level 1';
            let maxCount = 0;
            Object.keys(levelCount).forEach(level => {
                if (levelCount[level] > maxCount) {
                    maxCount = levelCount[level];
                    dominantLevel = level;
                }
            });
            
            // Determine priority
            let priority = 'low';
            if (dominantLevel === 'Level 3' || data.maxRisk >= 67) {
                priority = 'high';
            } else if (dominantLevel === 'Level 2' || data.maxRisk >= 34) {
                priority = 'medium';
            }
            
            return {
                location,
                incidentCount: data.count,
                avgRiskScore: parseFloat(avgRisk.toFixed(2)),
                maxRiskScore: parseFloat(data.maxRisk.toFixed(2)),
                dangerLevel: dominantLevel,
                priority: priority,
                riskScores: data.riskScores
            };
        });
        
        // Sort by risk (highest first)
        summary.sort((a, b) => b.maxRiskScore - a.maxRiskScore);
        
        // Get top 5 recommendations
        const recommendations = summary.slice(0, 5).map(item => ({
            location: item.location,
            incidentCount: item.incidentCount,
            avgRiskScore: item.avgRiskScore,
            maxRiskScore: item.maxRiskScore,
            dangerLevel: item.dangerLevel,
            priority: item.priority,
            suggestedTanods: Math.min(Math.ceil(item.incidentCount / 1.5) + (item.priority === 'high' ? 2 : 0), 8)
        }));
        
        res.json({
            success: true,
            month: month,
            totalIncidents: results.length,
            locations: summary,
            recommendations: recommendations,
            hasCartData: results.some(r => r.total_risk_score !== null)
        });
        
    } catch (error) {
        console.error('❌ Error getting CART patrol summary:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to get CART patrol summary',
            details: error.message 
        });
    }
});


// ============================================================
// DASHBOARD STATISTICS API ROUTE
// ============================================================

app.get('/api/dashboard/stats', authenticate, requireRole(['Administrator', 'Decision-Maker']), async (req, res) => {
    try {
        const [totalResult] = await pool.query("SELECT COUNT(*) as total FROM incidents WHERE TRIM(status) != 'Resolved'");
        const totalIncidents = totalResult[0].total;

        const [activeResult] = await pool.query(
            'SELECT DATE(date) as active_day, COUNT(*) as count FROM incidents WHERE TRIM(status) != "Resolved" GROUP BY DATE(date) ORDER BY active_day DESC LIMIT 1'
        );
        const activeDay = activeResult.length > 0 ? activeResult[0].count : 0;

        const [changeResult] = await pool.query(`
            SELECT 
                SUM(CASE WHEN MONTH(date) = MONTH(CURDATE()) THEN 1 ELSE 0 END) as current_month,
                SUM(CASE WHEN MONTH(date) = MONTH(CURDATE()) - 1 THEN 1 ELSE 0 END) as prev_month
            FROM incidents 
            WHERE YEAR(date) = YEAR(CURDATE()) AND TRIM(status) != 'Resolved'
        `);
        const current = changeResult[0].current_month || 0;
        const prev = changeResult[0].prev_month || 0;
        const change = current - prev;

        const [zonesResult] = await pool.query(
            "SELECT COUNT(DISTINCT latitude, longitude) as zones FROM incidents WHERE TRIM(status) != 'Resolved'"
        );
        const zones = zonesResult[0].zones;

        const [commonResult] = await pool.query(`
            SELECT incident_type, COUNT(*) as count 
            FROM incidents 
            WHERE TRIM(status) != 'Resolved'
            GROUP BY incident_type 
            ORDER BY count DESC 
            LIMIT 1
        `);
        const common = commonResult.length > 0 ? commonResult[0].incident_type : "N/A";

        const [areaResult] = await pool.query(`
            SELECT CONCAT(latitude, ', ', longitude) as location, COUNT(*) as count 
            FROM incidents 
            WHERE TRIM(status) != 'Resolved'
            GROUP BY latitude, longitude 
            ORDER BY count DESC 
            LIMIT 1
        `);
        const area = areaResult.length > 0 ? areaResult[0].location : "N/A";

        const [peakResult] = await pool.query(`
            SELECT HOUR(time) as hour, COUNT(*) as count 
            FROM incidents 
            WHERE TRIM(status) != 'Resolved'
            GROUP BY HOUR(time) 
            ORDER BY count DESC 
            LIMIT 1
        `);
        const peakHour = peakResult.length > 0 ? peakResult[0].hour : 0;
        const peak = `${String(peakHour).padStart(2, '0')}:00 - ${String((peakHour + 2) % 24).padStart(2, '0')}:00`;

        const [riskResult] = await pool.query(
            "SELECT COUNT(*) as risk FROM incidents WHERE danger_level LIKE '%Level 3%' AND TRIM(status) != 'Resolved'"
        );
        const risk = riskResult[0].risk;

        res.json({
            incidents: totalIncidents,
            activeDay: activeDay,
            change: change,
            zones: zones,
            common: common,
            area: area,
            peak: peak,
            risk: risk
        });

    } catch (error) {
        console.error('❌ Error fetching dashboard stats:', error);
        res.status(500).json({ error: 'Failed to fetch dashboard stats' });
    }
});

app.get('/api/dashboard/charts', authenticate, requireRole(['Administrator', 'Decision-Maker']), async (req, res) => {
    try {
        const [typesResult] = await pool.query(`
            SELECT incident_type, COUNT(*) as count 
            FROM incidents 
            WHERE TRIM(status) != 'Resolved'
            GROUP BY incident_type 
            ORDER BY count DESC
        `);

        let low = 0, moderate = 0, high = 0;
        const [dangerResult] = await pool.query('SELECT danger_level FROM incidents WHERE TRIM(status) != "Resolved"');
        dangerResult.forEach(row => {
            const level = row.danger_level || '';
            if (level.includes('Level 3') || level.includes('High')) high++;
            else if (level.includes('Level 2') || level.includes('Moderate')) moderate++;
            else low++;
        });

        const [trendResult] = await pool.query(`
            SELECT DATE(date) as day_date, COUNT(*) as count 
            FROM incidents 
            WHERE TRIM(status) != 'Resolved' AND date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
            GROUP BY DATE(date) 
            ORDER BY day_date ASC
        `);

        const [hourlyResult] = await pool.query(`
            SELECT HOUR(time) as hour, COUNT(*) as count 
            FROM incidents 
            WHERE TRIM(status) != 'Resolved'
            GROUP BY HOUR(time) 
            ORDER BY hour ASC
        `);

        res.json({
            types: typesResult,
            danger: { low, moderate, high },
            trend: trendResult,
            hourly: hourlyResult
        });

    } catch (error) {
        console.error('❌ Error fetching dashboard charts data:', error);
        res.status(500).json({ error: 'Failed to fetch charts data' });
    }
});

// ============================================================
// TANOD & PATROL API ROUTES
// ============================================================

app.get('/api/tanods', authenticate, requireRole(['Administrator', 'Decision-Maker']), async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT * FROM tanod_record 
            WHERE is_active = 1 
            ORDER BY name
        `);
        res.json(rows);
    } catch (error) {
        console.error('❌ Error fetching tanods:', error);
        res.status(500).json({ error: 'Failed to fetch tanods' });
    }
});

app.get('/api/tanods/all', authenticate, requireRole(['Administrator', 'Decision-Maker']), async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT * FROM tanod_record 
            ORDER BY is_active DESC, name
        `);
        res.json(rows);
    } catch (error) {
        console.error('❌ Error fetching all tanods:', error);
        res.status(500).json({ error: 'Failed to fetch tanods' });
    }
});

app.get('/api/tanods/:id', authenticate, requireRole(['Administrator', 'Decision-Maker']), async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT * FROM tanod_record WHERE id = ?',
            [req.params.id]
        );
        
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Tanod not found' });
        }
        
        res.json(rows[0]);
    } catch (error) {
        console.error('❌ Error fetching tanod:', error);
        res.status(500).json({ error: 'Failed to fetch tanod' });
    }
});

app.post('/api/tanods', authenticate, requireRole(['Administrator', 'Decision-Maker']), validate(tanodSchema), async (req, res) => {
    try {
        const { name, position, contact_no, shift_start, shift_end, assigned_area } = req.body;
        
        const [result] = await pool.query(`
            INSERT INTO tanod_record 
            (name, position, contact_no, shift_start, shift_end, assigned_area) 
            VALUES (?, ?, ?, ?, ?, ?)
        `, [
            name, 
            position || 'Tanod', 
            contact_no || null, 
            shift_start || null, 
            shift_end || null, 
            assigned_area || null
        ]);
        
        const [newTanod] = await pool.query(
            'SELECT * FROM tanod_record WHERE id = ?',
            [result.insertId]
        );
        
        const userId = req.userId;
        
        if (userId) {
            await logAudit(
                userId,
                'CREATE_TANOD',
                'tanod_record',
                result.insertId,
                null,
                { name, position, assigned_area },
                req
            );
        }
        
        res.status(201).json({ 
            message: 'Tanod added successfully', 
            tanod: newTanod[0] 
        });
    } catch (error) {
        console.error('❌ Error adding tanod:', error);
        res.status(500).json({ error: 'Failed to add tanod' });
    }
});

app.put('/api/tanods/:id', authenticate, requireRole(['Administrator', 'Decision-Maker']), validate(tanodSchema), async (req, res) => {
    try {
        const { name, position, contact_no, shift_start, shift_end, assigned_area, is_active } = req.body;
        const id = req.params.id;
        
        const [oldData] = await pool.query('SELECT * FROM tanod_record WHERE id = ?', [id]);
        
        const [result] = await pool.query(`
            UPDATE tanod_record 
            SET name = ?, position = ?, contact_no = ?, 
                shift_start = ?, shift_end = ?, assigned_area = ?, is_active = ?
            WHERE id = ?
        `, [
            name, position || 'Tanod', contact_no || null,
            shift_start || null, shift_end || null, assigned_area || null,
            is_active !== undefined ? is_active : 1, id
        ]);
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Tanod not found' });
        }
        
        const [updatedTanod] = await pool.query(
            'SELECT * FROM tanod_record WHERE id = ?',
            [id]
        );
        
        const userId = req.userId;
        
        if (userId) {
            await logAudit(
                userId,
                'UPDATE_TANOD',
                'tanod_record',
                id,
                oldData[0] || null,
                req.body,
                req
            );
        }
        
        res.json({ 
            message: 'Tanod updated successfully', 
            tanod: updatedTanod[0] 
        });
    } catch (error) {
        console.error('❌ Error updating tanod:', error);
        res.status(500).json({ error: 'Failed to update tanod' });
    }
});

app.delete('/api/tanods/:id', authenticate, requireRole(['Administrator']), async (req, res) => {
    try {
        const id = req.params.id;
        const userId = req.userId;
        
        const [oldData] = await pool.query('SELECT * FROM tanod_record WHERE id = ?', [id]);
        
        const [result] = await pool.query(
            'UPDATE tanod_record SET is_active = 0 WHERE id = ?',
            [id]
        );
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Tanod not found' });
        }
        
        if (userId) {
            await logAudit(
                userId,
                'DELETE_TANOD',
                'tanod_record',
                id,
                oldData[0] || null,
                null,
                req
            );
        }
        
        res.json({ message: 'Tanod deactivated successfully' });
    } catch (error) {
        console.error('❌ Error deleting tanod:', error);
        res.status(500).json({ error: 'Failed to delete tanod' });
    }
});

// ---------- PATROL SCHEDULES ----------

app.get('/api/patrol-schedules', authenticate, requireRole(['Administrator', 'Decision-Maker']), async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT * FROM patrol_schedules 
            WHERE status = 'Active' 
            ORDER BY day_of_week, start_time
        `);
        res.json(rows);
    } catch (error) {
        console.error('❌ Error fetching patrol schedules:', error);
        res.status(500).json({ error: 'Failed to fetch schedules' });
    }
});

app.get('/api/patrol-schedules/all', authenticate, requireRole(['Administrator', 'Decision-Maker']), async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT * FROM patrol_schedules 
            ORDER BY status DESC, day_of_week, start_time
        `);
        res.json(rows);
    } catch (error) {
        console.error('❌ Error fetching all schedules:', error);
        res.status(500).json({ error: 'Failed to fetch schedules' });
    }
});

app.get('/api/patrol-schedules/:id', authenticate, requireRole(['Administrator', 'Decision-Maker']), async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT * FROM patrol_schedules WHERE id = ?',
            [req.params.id]
        );
        
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Schedule not found' });
        }
        
        res.json(rows[0]);
    } catch (error) {
        console.error('❌ Error fetching schedule:', error);
        res.status(500).json({ error: 'Failed to fetch schedule' });
    }
});

app.post('/api/patrol-schedules', authenticate, requireRole(['Administrator', 'Decision-Maker']), validate(scheduleSchema), async (req, res) => {
    try {
        const { location, start_time, end_time, day_of_week, assigned_tanods, reason } = req.body;
        
        const [result] = await pool.query(`
            INSERT INTO patrol_schedules 
            (location, start_time, end_time, day_of_week, assigned_tanods, reason) 
            VALUES (?, ?, ?, ?, ?, ?)
        `, [
            location, start_time, end_time, day_of_week, 
            assigned_tanods || 0, reason || null
        ]);
        
        const [newSchedule] = await pool.query(
            'SELECT * FROM patrol_schedules WHERE id = ?',
            [result.insertId]
        );
        
        const userId = req.userId;
        
        if (userId) {
            await logAudit(
                userId,
                'CREATE_SCHEDULE',
                'patrol_schedules',
                result.insertId,
                null,
                { location, day_of_week, start_time, end_time },
                req
            );
        }
        
        res.status(201).json({ 
            message: 'Patrol schedule created successfully', 
            schedule: newSchedule[0] 
        });
    } catch (error) {
        console.error('❌ Error creating patrol schedule:', error);
        res.status(500).json({ error: 'Failed to create schedule' });
    }
});

app.put('/api/patrol-schedules/:id', authenticate, requireRole(['Administrator', 'Decision-Maker']), validate(scheduleSchema), async (req, res) => {
    try {
        const { location, start_time, end_time, day_of_week, assigned_tanods, reason, status } = req.body;
        const id = req.params.id;
        
        const [oldData] = await pool.query('SELECT * FROM patrol_schedules WHERE id = ?', [id]);
        
        const [result] = await pool.query(`
            UPDATE patrol_schedules 
            SET location = ?, start_time = ?, end_time = ?, 
                day_of_week = ?, assigned_tanods = ?, reason = ?, status = ?
            WHERE id = ?
        `, [
            location, start_time, end_time, day_of_week, 
            assigned_tanods || 0, reason || null, status || 'Active', id
        ]);
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Schedule not found' });
        }
        
        const [updatedSchedule] = await pool.query(
            'SELECT * FROM patrol_schedules WHERE id = ?',
            [id]
        );
        
        const userId = req.userId;
        
        if (userId) {
            await logAudit(
                userId,
                'UPDATE_SCHEDULE',
                'patrol_schedules',
                id,
                oldData[0] || null,
                req.body,
                req
            );
        }
        
        res.json({ 
            message: 'Patrol schedule updated successfully', 
            schedule: updatedSchedule[0] 
        });
    } catch (error) {
        console.error('❌ Error updating patrol schedule:', error);
        res.status(500).json({ error: 'Failed to update schedule' });
    }
});

app.delete('/api/patrol-schedules/:id', authenticate, requireRole(['Administrator']), async (req, res) => {
    try {
        const id = req.params.id;
        const userId = req.userId;
        
        const [oldData] = await pool.query('SELECT * FROM patrol_schedules WHERE id = ?', [id]);

        // Detach (don't delete) historical patrol logs — deleting a schedule
        // shouldn't erase the real patrol reports that were filed against it.
        await pool.query('UPDATE patrol_logs SET schedule_id = NULL WHERE schedule_id = ?', [id]);
        const [result] = await pool.query(
            'DELETE FROM patrol_schedules WHERE id = ?',
            [id]
        );
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Schedule not found' });
        }
        
        if (userId) {
            await logAudit(
                userId,
                'DELETE_SCHEDULE',
                'patrol_schedules',
                id,
                oldData[0] || null,
                null,
                req
            );
        }
        
        res.json({ message: 'Patrol schedule deleted successfully' });
    } catch (error) {
        console.error('❌ Error deleting patrol schedule:', error);
        res.status(500).json({ error: 'Failed to delete schedule' });
    }
});

// ---------- PATROL LOGS ----------

app.get('/api/patrol-logs', authenticate, requireRole(['Administrator', 'Decision-Maker']), async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT 
                pl.*,
                ps.location as schedule_location,
                ps.start_time as schedule_start,
                ps.end_time as schedule_end,
                t.name as tanod_name
            FROM patrol_logs pl
            LEFT JOIN patrol_schedules ps ON pl.schedule_id = ps.id
            LEFT JOIN tanod_record t ON pl.tanod_id = t.id
            ORDER BY pl.created_at DESC
        `);
        res.json(rows);
    } catch (error) {
        console.error('❌ Error fetching patrol logs:', error);
        res.status(500).json({ error: 'Failed to fetch patrol logs' });
    }
});

app.get('/api/patrol-logs/:id', authenticate, requireRole(['Administrator', 'Decision-Maker']), async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM patrol_logs WHERE id = ?', [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Patrol log not found' });
        res.json(rows[0]);
    } catch (error) {
        console.error('❌ Error fetching patrol log:', error);
        res.status(500).json({ error: 'Failed to fetch patrol log' });
    }
});

app.post('/api/patrol-logs', authenticate, requireRole(['Administrator', 'Decision-Maker']), validate(logSchema), async (req, res) => {
    try {
        const { schedule_id, tanod_id, report, status, patrol_date } = req.body;
        
        const [result] = await pool.query(`
            INSERT INTO patrol_logs 
            (schedule_id, tanod_id, report, status, patrol_date) 
            VALUES (?, ?, ?, ?, ?)
        `, [
            schedule_id, tanod_id, report || null, 
            status || 'Completed', patrol_date || null
        ]);
        
        const [newLog] = await pool.query(`
            SELECT 
                pl.*,
                t.name as tanod_name
            FROM patrol_logs pl
            LEFT JOIN tanod_record t ON pl.tanod_id = t.id
            WHERE pl.id = ?
        `, [result.insertId]);
        
        const userId = req.userId;
        
        if (userId) {
            await logAudit(
                userId,
                'CREATE_LOG',
                'patrol_logs',
                result.insertId,
                null,
                { schedule_id, tanod_id, status },
                req
            );
        }
        
        res.status(201).json({ 
            message: 'Patrol log saved successfully', 
            log: newLog[0] 
        });
    } catch (error) {
        console.error('❌ Error saving patrol log:', error);
        res.status(500).json({ error: 'Failed to save patrol log' });
    }
});

app.put('/api/patrol-logs/:id', authenticate, requireRole(['Administrator', 'Decision-Maker']), validate(logSchema), async (req, res) => {
    try {
        const { schedule_id, tanod_id, report, status, patrol_date } = req.body;
        const id = req.params.id;

        const [oldData] = await pool.query('SELECT * FROM patrol_logs WHERE id = ?', [id]);

        const [result] = await pool.query(`
            UPDATE patrol_logs
            SET schedule_id = ?, tanod_id = ?, report = ?, status = ?, patrol_date = ?
            WHERE id = ?
        `, [schedule_id, tanod_id, report || null, status || 'Completed', patrol_date, id]);
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Patrol log not found' });
        }
        
        const [updatedLog] = await pool.query(
            'SELECT * FROM patrol_logs WHERE id = ?',
            [id]
        );
        
        const userId = req.userId;
        
        if (userId) {
            await logAudit(
                userId,
                'UPDATE_LOG',
                'patrol_logs',
                id,
                oldData[0] || null,
                req.body,
                req
            );
        }
        
        res.json({ 
            message: 'Patrol log updated successfully', 
            log: updatedLog[0] 
        });
    } catch (error) {
        console.error('❌ Error updating patrol log:', error);
        res.status(500).json({ error: 'Failed to update patrol log' });
    }
});

app.delete('/api/patrol-logs/:id', authenticate, requireRole(['Administrator']), async (req, res) => {
    try {
        const id = req.params.id;
        const userId = req.userId;
        
        const [oldData] = await pool.query('SELECT * FROM patrol_logs WHERE id = ?', [id]);
        
        const [result] = await pool.query(
            'DELETE FROM patrol_logs WHERE id = ?',
            [id]
        );
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Patrol log not found' });
        }
        
        if (userId) {
            await logAudit(
                userId,
                'DELETE_LOG',
                'patrol_logs',
                id,
                oldData[0] || null,
                null,
                req
            );
        }
        
        res.json({ message: 'Patrol log deleted successfully' });
    } catch (error) {
        console.error('❌ Error deleting patrol log:', error);
        res.status(500).json({ error: 'Failed to delete patrol log' });
    }
});

// ============================================================
// CART ANALYTICS API ROUTES
// ============================================================

app.get('/api/cart/risk-factors', authenticate, requireRole(['Administrator', 'Decision-Maker']), async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT
                i.id,
                rf.incident_id,
                i.incident_type,
                i.date,
                i.time,
                i.street_name,
                i.status,
                rf.time_risk_score,
                rf.day_risk_score,
                rf.type_risk_score,
                rf.location_risk_score,
                rf.frequency_risk_score,
                rf.total_risk_score,
                rf.danger_level,
                rf.calculated_at
            FROM incidents i
            JOIN cart_risk_factors rf ON i.id = rf.incident_id
            ORDER BY rf.total_risk_score DESC
        `);
        res.json(rows);
    } catch (error) {
        console.error('❌ Error fetching risk factors:', error);
        res.status(500).json({ error: 'Failed to fetch risk factors' });
    }
});

app.get('/api/cart/summary', authenticate, requireRole(['Administrator', 'Decision-Maker']), async (req, res) => {
    try {
        const [summary] = await pool.query(`
            SELECT 
                COUNT(*) as total_incidents,
                SUM(CASE WHEN danger_level = 'Level 3' THEN 1 ELSE 0 END) as high_risk,
                SUM(CASE WHEN danger_level = 'Level 2' THEN 1 ELSE 0 END) as moderate_risk,
                SUM(CASE WHEN danger_level = 'Level 1' THEN 1 ELSE 0 END) as low_risk,
                ROUND(AVG(total_risk_score), 2) as avg_risk_score,
                MAX(total_risk_score) as max_risk_score,
                MIN(total_risk_score) as min_risk_score
            FROM cart_risk_factors
        `);
        res.json(summary[0]);
    } catch (error) {
        console.error('❌ Error fetching CART summary:', error);
        res.status(500).json({ error: 'Failed to fetch CART summary' });
    }
});

app.get('/api/cart/decision-rules', authenticate, requireRole(['Administrator', 'Decision-Maker']), async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT * FROM cart_decision_rules 
            WHERE is_active = TRUE 
            ORDER BY priority ASC
        `);
        res.json(rows);
    } catch (error) {
        console.error('❌ Error fetching decision rules:', error);
        res.status(500).json({ error: 'Failed to fetch decision rules' });
    }
});

app.get('/api/cart/analysis-logs', authenticate, requireRole(['Administrator', 'Decision-Maker']), async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT * FROM cart_analysis_log 
            ORDER BY run_timestamp DESC 
            LIMIT 50
        `);
        res.json(rows);
    } catch (error) {
        console.error('❌ Error fetching analysis logs:', error);
        res.status(500).json({ error: 'Failed to fetch analysis logs' });
    }
});

app.post('/api/cart/analyze', authenticate, requireRole(['Administrator', 'Decision-Maker']), async (req, res) => {
    try {
        const startTime = Date.now();
        const triggered_by = req.userId;
        
        await recomputeAllCartRiskFactors();

        const executionTime = Date.now() - startTime;
        
        const [logResult] = await pool.query(`
            INSERT INTO cart_analysis_log (
                analysis_type, 
                date_range_start, 
                date_range_end,
                incident_types_analyzed,
                total_streets_analyzed,
                total_incidents_analyzed,
                high_risk_count, 
                moderate_risk_count, 
                low_risk_count,
                execution_time_ms, 
                status, 
                triggered_by,
                notes
            )
            SELECT 
                'risk_prediction',
                MIN(i.date),
                MAX(i.date),
                GROUP_CONCAT(DISTINCT i.incident_type SEPARATOR ', '),
                COUNT(DISTINCT i.street_name),
                COUNT(*),
                SUM(CASE WHEN rf.danger_level = 'Level 3' THEN 1 ELSE 0 END),
                SUM(CASE WHEN rf.danger_level = 'Level 2' THEN 1 ELSE 0 END),
                SUM(CASE WHEN rf.danger_level = 'Level 1' THEN 1 ELSE 0 END),
                ?,
                'completed',
                ?,
                'CART analysis run via API'
            FROM cart_risk_factors rf
            JOIN incidents i ON rf.incident_id = i.id
        `, [executionTime, triggered_by || null]);

        if (triggered_by) {
            await logAudit(
                triggered_by,
                'RUN_CART_ANALYSIS',
                'cart_analysis_log',
                logResult.insertId,
                null,
                { execution_time_ms: executionTime },
                req
            );
        }

        res.json({ 
            success: true, 
            message: 'CART analysis completed',
            execution_time_ms: executionTime,
            log_id: logResult.insertId
        });
    } catch (error) {
        console.error('❌ Error running CART analysis:', error);
        res.status(500).json({ error: 'Failed to run CART analysis' });
    }
});

// ============================================================
// AUDIT LOGS - GET
// ============================================================

app.get('/api/audit-logs', authenticate, requireRole(['Administrator']), async (req, res) => {
    try {
        const { limit = 100, offset = 0, action, entity_type, user_id } = req.query;

        let query = `
            SELECT 
                al.*,
                u.name as user_name,
                u.username
            FROM audit_logs al
            LEFT JOIN users u ON al.user_id = u.id
            WHERE 1=1
        `;

        const params = [];

        if (action) {
            query += ' AND al.action = ?';
            params.push(action);
        }

        if (entity_type) {
            query += ' AND al.entity_type = ?';
            params.push(entity_type);
        }

        if (user_id) {
            query += ' AND al.user_id = ?';
            params.push(user_id);
        }

        query += ' ORDER BY al.created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));

        const [rows] = await pool.query(query, params);
        res.json(rows);

    } catch (error) {
        console.error('❌ Error fetching audit logs:', error);
        res.status(500).json({ error: 'Failed to fetch audit logs' });
    }
});

// ============================================================
// SYSTEM SETTINGS
// ============================================================

app.get('/api/settings', authenticate, requireRole(['Administrator']), async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM system_settings ORDER BY setting_key');
        res.json(rows);
    } catch (error) {
        console.error('❌ Error fetching settings:', error);
        res.status(500).json({ error: 'Failed to fetch settings' });
    }
});

app.get('/api/settings/:key', authenticate, requireRole(['Administrator']), async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT * FROM system_settings WHERE setting_key = ?',
            [req.params.key]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Setting not found' });
        }

        res.json(rows[0]);
    } catch (error) {
        console.error('❌ Error fetching setting:', error);
        res.status(500).json({ error: 'Failed to fetch setting' });
    }
});

const SETTINGS_DEFAULTS = {
    session_timeout_minutes: '30',
    max_login_attempts: '5',
    audit_log_retention_days: '90',
    enable_audit_logging: 'true',
    require_strong_password: 'true',
    enable_2fa: 'false',
    maintenance_mode: 'false',
    cart_model_version: 'v1.0',
    default_danger_threshold_high: '67',
    default_danger_threshold_moderate: '34'
};

app.post('/api/settings', authenticate, requireRole(['Administrator']), async (req, res) => {
    try {
        const { setting_key, setting_value } = req.body;
        const userId = req.userId;

        if (!setting_key || setting_value === undefined || setting_value === null) {
            return res.status(400).json({ error: 'setting_key and setting_value are required' });
        }

        let valueToStore = String(setting_value).trim();

        if (valueToStore === '' || valueToStore === 'NaN' || valueToStore === 'undefined' || valueToStore === 'null') {
            valueToStore = SETTINGS_DEFAULTS[setting_key] || '';
        }

        const [existing] = await pool.query(
            'SELECT id FROM system_settings WHERE setting_key = ?',
            [setting_key]
        );

        let entityId;
        if (existing.length > 0) {
            entityId = existing[0].id;
            await pool.query(
                'UPDATE system_settings SET setting_value = ?, updated_by = ? WHERE setting_key = ?',
                [valueToStore, userId || null, setting_key]
            );
        } else {
            const [insertResult] = await pool.query(`
                INSERT INTO system_settings (setting_key, setting_value, updated_by)
                VALUES (?, ?, ?)
            `, [setting_key, valueToStore, userId || null]);
            entityId = insertResult.insertId;
        }

        if (userId) {
            await logAudit(
                userId,
                'UPDATE_SETTINGS',
                'system_settings',
                entityId,
                null,
                { setting_key, setting_value: valueToStore },
                req
            );
        }

        res.json({ message: 'Setting saved successfully' });

    } catch (error) {
        console.error('❌ Error saving setting:', error);
        res.status(500).json({ error: 'Failed to save setting: ' + error.message });
    }
});

app.put('/api/settings/:key', authenticate, requireRole(['Administrator']), async (req, res) => {
    try {
        const { setting_value } = req.body;
        const { key } = req.params;
        const userId = req.userId;

        if (setting_value === undefined || setting_value === null) {
            return res.status(400).json({ error: 'setting_value is required' });
        }

        let valueToStore = String(setting_value).trim();

        if (valueToStore === '' || valueToStore === 'NaN' || valueToStore === 'undefined' || valueToStore === 'null') {
            valueToStore = SETTINGS_DEFAULTS[key] || '';
        }

        const [oldData] = await pool.query(
            'SELECT * FROM system_settings WHERE setting_key = ?',
            [key]
        );

        if (oldData.length === 0) {
            return res.status(404).json({ error: 'Setting not found' });
        }

        await pool.query(`
            UPDATE system_settings
            SET setting_value = ?, updated_by = ?
            WHERE setting_key = ?
        `, [valueToStore, userId || null, key]);

        if (userId) {
            await logAudit(
                userId,
                'UPDATE_SETTINGS',
                'system_settings',
                oldData[0].id,
                oldData[0] || null,
                { setting_key: key, setting_value: valueToStore },
                req
            );
        }

        res.json({ message: 'Setting updated successfully' });

    } catch (error) {
        console.error('❌ Error updating setting:', error);
        res.status(500).json({ error: 'Failed to update setting' });
    }
});

// ============================================================
// ROOT ENDPOINT
// ============================================================

app.get('/', (req, res) => {
    res.json({
        message: 'Barangay 179 Crime BI API',
        version: '1.0.0',
        database: 'brgydata'
    });
});

// ============================================================
// START SERVER
// ============================================================

app.listen(PORT, () => {
    console.log(`\n🚀 Server running on http://localhost:${PORT}`);
    console.log(`📁 Database: brgydata`);
    console.log(`📋 Available routes:`);
    console.log(`\n📁 INCIDENTS:`);
    console.log(`   GET  /api/incidents`);
    console.log(`   GET  /api/incidents/view-only  ✅ ADDED (Captain View)`);
    console.log(`   GET  /api/incidents/:id  ✅ ADDED (Captain View)`);
    console.log(`   GET  /api/heatmap/incidents`);
    console.log(`   POST /api/incidents`);
    console.log(`   PUT  /api/incidents/:id`);
    console.log(`   DELETE /api/incidents/:id`);
    console.log(`\n👥 USERS:`);
    console.log(`   GET  /api/users`);
    console.log(`   POST /api/users`);
    console.log(`   DELETE /api/users/:id`);
    console.log(`   POST /api/auth/login`);
    console.log(`   POST /api/auth/logout`);
    console.log(`\n🔑 PASSWORD RESET:`);
    console.log(`   POST /api/auth/forgot-password`);
    console.log(`   POST /api/auth/reset-password`);
    console.log(`\n📊 CART:`);
    console.log(`   GET  /api/cart/risk-factors`);
    console.log(`   GET  /api/cart/summary`);
    console.log(`   GET  /api/cart/decision-rules`);
    console.log(`   GET  /api/cart/analysis-logs`);
    console.log(`   POST /api/cart/analyze`);
    console.log(`\n🛡️ TANOD & PATROL:`);
    console.log(`   GET  /api/tanods`);
    console.log(`   POST /api/tanods`);
    console.log(`   PUT  /api/tanods/:id`);
    console.log(`   DELETE /api/tanods/:id`);
    console.log(`   GET  /api/patrol-schedules  ✅ EXISTING`);
    console.log(`   POST /api/patrol-schedules ✅ EXISTING`);
    console.log(`   PUT  /api/patrol-schedules/:id ✅ EXISTING`);
    console.log(`   DELETE /api/patrol-schedules/:id ✅ EXISTING`);
    console.log(`   GET  /api/patrol-logs  ✅ EXISTING`);
    console.log(`   POST /api/patrol-logs ✅ EXISTING`);
    console.log(`   PUT  /api/patrol-logs/:id ✅ EXISTING`);
    console.log(`   DELETE /api/patrol-logs/:id ✅ EXISTING`);
    console.log(`\n🔐 AUDIT & SETTINGS:`);
    console.log(`   GET  /api/audit-logs`);
    console.log(`   GET  /api/settings`);
    console.log(`   GET  /api/settings/:key`);
    console.log(`   POST /api/settings`);
    console.log(`   PUT  /api/settings/:key`);
    console.log(`\n📋 LOGIN HISTORY (PUBLIC):`);
    console.log(`   GET  /api/login-history`);
});