const db = require("../config/db");
const axios = require("axios");

exports.login = async (req, res) => {
    try {
        console.log("Request Body:", req.body);

        const { username, password } = req.body;

        const [rows] = await db.query(
            "SELECT * FROM employee WHERE username = ?",
            [username]
        );

        console.log("Rows Found:", rows);

        if (rows.length === 0) {
            return res.json({
                success: false,
                message: "User not found"
            });
        }

        const user = rows[0];

        console.log("DB Password:", user.password);
        console.log("Entered Password:", password);

        if (password !== user.password) {
            return res.json({
                success: false,
                message: "Invalid Password"
            });
        }

        return res.json({
            success: true,
            user: {
                employee_id: user.employee_id,
                username: user.username,
                full_name: user.full_name,
                role: user.role,
                email: user.email,
                google_email: user.google_email,
                mobile: user.mobile,
                designation: user.designation,
                profile_image: user.profile_image
            }
        });

    } catch (error) {
        console.error("LOGIN ERROR:");
        console.error(error);

        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

exports.changePassword = async (req, res) => {
    try {
        const { employee_id, current_password, new_password } = req.body;

        if (!employee_id || !current_password || !new_password) {
            return res.status(400).json({
                success: false,
                message: "Missing required fields (employee_id, current_password, new_password)."
            });
        }

        const [rows] = await db.query(
            "SELECT * FROM employee WHERE employee_id = ?",
            [employee_id]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Employee user not found."
            });
        }

        const user = rows[0];

        if (current_password !== user.password) {
            return res.status(400).json({
                success: false,
                message: "Incorrect current password."
            });
        }

        await db.query(
            "UPDATE employee SET password = ? WHERE employee_id = ?",
            [new_password, employee_id]
        );

        // Insert log in audit_logs
        await db.query(
            "INSERT INTO audit_logs (action_name, details, severity) VALUES ('PASSWORD_CHANGED', ?, 'INFO')",
            [`User ${user.full_name} (ID: ${employee_id}, Role: ${user.role}) successfully changed their password.`]
        );

        return res.json({
            success: true,
            message: "Password changed successfully."
        });

    } catch (error) {
        console.error("CHANGE PASSWORD ERROR:", error);
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

exports.loginGoogle = async (req, res) => {
    try {
        console.log("Google Login Body:", req.body);
        const { idToken } = req.body;
        if (!idToken) {
            return res.status(400).json({
                success: false,
                message: "ID Token is required"
            });
        }

        // Verify token with Google API
        const response = await axios.get(`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`);
        const payload = response.data;

        // Verify audience matches client ID
        const expectedClientId = "979965796474-uojacq73meebj0uvb58n42325a184pp1.apps.googleusercontent.com";
        if (payload.aud !== expectedClientId) {
            return res.status(400).json({
                success: false,
                message: "Invalid client audience"
            });
        }

        const email = payload.email;
        if (!email) {
            return res.status(400).json({
                success: false,
                message: "Email not provided by Google account"
            });
        }

        // Check if employee exists by google_email or primary email
        const sql = "SELECT * FROM employee WHERE google_email = ? OR email = ?";
        let [result] = await db.query(sql, [email, email]);

        let user;
        if (result.length === 0) {
            // Stop auto-registration to prevent duplicate wallets
            return res.json({
                success: false,
                message: "This Google account is not associated with any employee profile. Please contact the administrator to link your Gmail."
            });
        } else {
            user = result[0];
            
            // Automatically link google_email if they matched on primary email
            if (!user.google_email) {
                await db.query("UPDATE employee SET google_email = ? WHERE employee_id = ?", [email, user.employee_id]);
                user.google_email = email;
            }

            // Update profile image if Google has a fresh one and database has none
            if (payload.picture && !user.profile_image) {
                await db.query("UPDATE employee SET profile_image = ? WHERE employee_id = ?", [payload.picture, user.employee_id]);
                user.profile_image = payload.picture;
            }
        }

        return res.json({
            success: true,
            user: {
                employee_id: user.employee_id,
                username: user.username,
                full_name: user.full_name,
                role: user.role,
                email: user.email,
                google_email: user.google_email,
                mobile: user.mobile,
                designation: user.designation,
                profile_image: user.profile_image
            }
        });

    } catch (error) {
        console.error("GOOGLE LOGIN ERROR:", error.message);
        return res.status(500).json({
            success: false,
            message: "Google Authentication Failed: " + error.message
        });
    }
};

exports.forgotPassword = async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({
                success: false,
                message: "Email is required."
            });
        }

        // Check if user exists
        const [rows] = await db.query(
            "SELECT employee_id, email, username FROM employee WHERE email = ?",
            [email]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "No account found with this email address."
            });
        }

        const user = rows[0];

        // If the user's password is the google_oauth_placeholder, they should sign in via Google
        const [passCheck] = await db.query("SELECT password FROM employee WHERE employee_id = ?", [user.employee_id]);
        if (passCheck[0].password === "google_oauth_placeholder") {
            return res.status(400).json({
                success: false,
                message: "This account uses Google Sign-In. Please sign in using Google."
            });
        }

        // Generate a 6-digit random OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        
        // Expiry set to 5 minutes from now
        const expiry = new Date(Date.now() + 5 * 60 * 1000);

        // Save OTP to DB
        await db.query(
            "UPDATE employee SET otp_code = ?, otp_expiry = ? WHERE employee_id = ?",
            [otp, expiry, user.employee_id]
        );

        // Send Email
        const { sendOtpEmail } = require("../services/emailService");
        await sendOtpEmail(user.email, otp);

        return res.json({
            success: true,
            message: "OTP sent successfully to your registered email."
        });

    } catch (error) {
        console.error("FORGOT PASSWORD ERROR:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to process forgot password request: " + error.message
        });
    }
};

exports.verifyOtp = async (req, res) => {
    try {
        const { email, otp_code } = req.body;

        if (!email || !otp_code) {
            return res.status(400).json({
                success: false,
                message: "Missing email or OTP code."
            });
        }

        const [rows] = await db.query(
            "SELECT employee_id, otp_code, otp_expiry FROM employee WHERE email = ?",
            [email]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Employee profile not found."
            });
        }

        const user = rows[0];

        if (!user.otp_code || user.otp_code !== otp_code) {
            return res.status(400).json({
                success: false,
                message: "Invalid OTP code."
            });
        }

        const now = new Date();
        const expiry = new Date(user.otp_expiry);
        if (now > expiry) {
            return res.status(400).json({
                success: false,
                message: "OTP code has expired."
            });
        }

        return res.json({
            success: true,
            message: "OTP verified successfully."
        });

    } catch (error) {
        console.error("VERIFY OTP ERROR:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to verify OTP: " + error.message
        });
    }
};

exports.resetPassword = async (req, res) => {
    try {
        const { email, otp_code, new_password } = req.body;

        if (!email || !otp_code || !new_password) {
            return res.status(400).json({
                success: false,
                message: "Missing email, OTP code, or new password."
            });
        }

        const [rows] = await db.query(
            "SELECT employee_id, otp_code, otp_expiry FROM employee WHERE email = ?",
            [email]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Employee profile not found."
            });
        }

        const user = rows[0];

        // Double check OTP validation for safety
        if (!user.otp_code || user.otp_code !== otp_code) {
            return res.status(400).json({
                success: false,
                message: "Invalid OTP code."
            });
        }

        const now = new Date();
        const expiry = new Date(user.otp_expiry);
        if (now > expiry) {
            return res.status(400).json({
                success: false,
                message: "OTP code has expired."
            });
        }

        // Update password and clear OTP columns
        await db.query(
            "UPDATE employee SET password = ?, otp_code = NULL, otp_expiry = NULL WHERE employee_id = ?",
            [new_password, user.employee_id]
        );

        // Insert log in audit_logs
        await db.query(
            "INSERT INTO audit_logs (action_name, details, severity) VALUES ('PASSWORD_RESET_VIA_OTP', ?, 'INFO')",
            [`User (ID: ${user.employee_id}) successfully reset their password via Email OTP.`]
        );

        return res.json({
            success: true,
            message: "Password reset completed successfully."
        });

    } catch (error) {
        console.error("RESET PASSWORD ERROR:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to reset password: " + error.message
        });
    }
};