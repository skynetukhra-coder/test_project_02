const express = require("express");
const router = express.Router();
const db = require("../config/db");
const verifyToken = require("../middleware/verifyToken");
const crypto = require("crypto");

const HMAC_SECRET = "canteen_wallet_integrity_key";

function generateWalletSignature(employeeId, balance) {
    const formattedBalance = parseFloat(balance).toFixed(2);
    return crypto
        .createHmac("sha256", HMAC_SECRET)
        .update(`${employeeId}:${formattedBalance}`)
        .digest("hex");
}

// GET EMPLOYEE PROFILE
router.get("/profile", verifyToken, async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT employee_id, username, full_name, role, email, google_email, mobile, designation, profile_image 
             FROM employee 
             WHERE username = ?`,
            [req.user.username]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                message: "Employee profile not found"
            });
        }

        res.json(rows[0]);
    } catch (error) {
        res.status(500).json({
            message: error.message
        });
    }
});

// GET ALL EMPLOYEES (ADMIN END)
router.get("/list", async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT employee_id, username, full_name, role, email, google_email, mobile, designation, profile_image, created_at
            FROM employee
            ORDER BY employee_id DESC
        `);
        res.json(rows);
    } catch (error) {
        console.error("GET EMPLOYEES ERROR:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ADD NEW EMPLOYEE (ADMIN MODULE)
router.post("/add", async (req, res) => {
    try {
        const {
            username,
            password,
            full_name,
            role,
            email,
            google_email,
            mobile,
            designation
        } = req.body;

        if (!username || !full_name) {
            return res.status(400).json({
                success: false,
                message: "Username (Employee Code) and Full Name are required."
            });
        }

        const cleanUsername = username.trim().toUpperCase();

        // Check duplicate username
        const [existing] = await db.query(
            "SELECT employee_id FROM employee WHERE username = ?",
            [cleanUsername]
        );
        if (existing.length > 0) {
            return res.status(400).json({
                success: false,
                message: `Username '${cleanUsername}' already exists.`
            });
        }

        const initialPassword = password || "12345";
        const userRole = role || "EMPLOYEE";

        const [insertRes] = await db.query(
            `INSERT INTO employee 
             (username, password, full_name, role, email, google_email, mobile, designation)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                cleanUsername,
                initialPassword,
                full_name.trim(),
                userRole,
                email ? email.trim() : null,
                google_email ? google_email.trim() : null,
                mobile ? mobile.trim() : null,
                designation ? designation.trim() : null
            ]
        );

        const newEmpId = insertRes.insertId;

        // Initialize wallet for new employee
        const initialBalance = 0.00;
        const walletSig = generateWalletSignature(newEmpId, initialBalance);
        await db.query(
            "INSERT INTO wallets (employee_id, balance, signature) VALUES (?, ?, ?)",
            [newEmpId, initialBalance, walletSig]
        );

        // Audit log
        await db.query(
            "INSERT INTO audit_logs (action_name, details, severity) VALUES ('EMPLOYEE_CREATED', ?, 'INFO')",
            [`Created new user: ${full_name} (${cleanUsername}) with Role: ${userRole}.`]
        );

        res.json({
            success: true,
            message: `User '${full_name}' added successfully!`,
            employee_id: newEmpId
        });
    } catch (error) {
        console.error("ADD EMPLOYEE ERROR:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// UPDATE EMPLOYEE DETAILS (ADMIN MODULE)
router.put("/update", async (req, res) => {
    try {
        const {
            employee_id,
            username,
            password,
            full_name,
            role,
            email,
            google_email,
            mobile,
            designation
        } = req.body;

        if (!employee_id) {
            return res.status(400).json({ success: false, message: "Employee ID is required." });
        }

        const cleanUsername = username ? username.trim().toUpperCase() : null;

        // Check duplicate username if changing username
        if (cleanUsername) {
            const [existing] = await db.query(
                "SELECT employee_id FROM employee WHERE username = ? AND employee_id != ?",
                [cleanUsername, employee_id]
            );
            if (existing.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: `Username '${cleanUsername}' is already used by another employee.`
                });
            }
        }

        if (password && password.trim()) {
            await db.query(
                `UPDATE employee 
                 SET username = COALESCE(?, username),
                     password = ?,
                     full_name = ?,
                     role = COALESCE(?, role),
                     email = ?,
                     google_email = ?,
                     mobile = ?,
                     designation = ?
                 WHERE employee_id = ?`,
                [
                    cleanUsername,
                    password.trim(),
                    full_name ? full_name.trim() : "",
                    role || null,
                    email ? email.trim() : null,
                    google_email ? google_email.trim() : null,
                    mobile ? mobile.trim() : null,
                    designation ? designation.trim() : null,
                    employee_id
                ]
            );
        } else {
            await db.query(
                `UPDATE employee 
                 SET username = COALESCE(?, username),
                     full_name = ?,
                     role = COALESCE(?, role),
                     email = ?,
                     google_email = ?,
                     mobile = ?,
                     designation = ?
                 WHERE employee_id = ?`,
                [
                    cleanUsername,
                    full_name ? full_name.trim() : "",
                    role || null,
                    email ? email.trim() : null,
                    google_email ? google_email.trim() : null,
                    mobile ? mobile.trim() : null,
                    designation ? designation.trim() : null,
                    employee_id
                ]
            );
        }

        // Audit log
        await db.query(
            "INSERT INTO audit_logs (action_name, details, severity) VALUES ('EMPLOYEE_UPDATED', ?, 'INFO')",
            [`Updated details for Employee ID ${employee_id} (${full_name || cleanUsername}).`]
        );

        res.json({
            success: true,
            message: "User details updated successfully."
        });
    } catch (error) {
        console.error("UPDATE EMPLOYEE ERROR:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// DELETE EMPLOYEE (ADMIN MODULE)
router.delete("/delete/:employeeId", async (req, res) => {
    try {
        const { employeeId } = req.params;

        // Prevent deleting main admin user
        const [empRows] = await db.query(
            "SELECT username, full_name, role FROM employee WHERE employee_id = ?",
            [employeeId]
        );

        if (empRows.length === 0) {
            return res.status(404).json({ success: false, message: "User not found." });
        }

        if (empRows[0].username === 'WBKLE2242172' || empRows[0].username === 'admin' || empRows[0].username === 'admin_user') {
            return res.status(400).json({
                success: false,
                message: "System Admin accounts cannot be deleted."
            });
        }

        // Delete wallet & employee
        await db.query("DELETE FROM wallets WHERE employee_id = ?", [employeeId]);
        await db.query("DELETE FROM employee WHERE employee_id = ?", [employeeId]);

        // Audit log
        await db.query(
            "INSERT INTO audit_logs (action_name, details, severity) VALUES ('EMPLOYEE_DELETED', ?, 'WARNING')",
            [`Deleted user: ${empRows[0].full_name} (${empRows[0].username}) [ID: ${employeeId}].`]
        );

        res.json({
            success: true,
            message: `User '${empRows[0].full_name}' deleted successfully.`
        });
    } catch (error) {
        console.error("DELETE EMPLOYEE ERROR:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;