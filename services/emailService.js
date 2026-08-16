const nodemailer = require("nodemailer");

// Create standard transporter using environment variables
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.hostinger.com",
    port: parseInt(process.env.SMTP_PORT || "465"),
    secure: process.env.SMTP_SECURE === "true", // true for 465, false for other ports
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    },
    tls: {
        rejectUnauthorized: false // Prevents handshake issues on custom/shared hosts
    },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000
});

/**
 * Sends a 6-digit OTP to the employee's registered email address.
 * @param {string} toEmail - The recipient's email address.
 * @param {string} otp - The 6-digit OTP code.
 * @returns {Promise<object>} - Nodemailer send result.
 */
async function sendOtpEmail(toEmail, otp) {
    const mailOptions = {
        from: process.env.SMTP_FROM || `"eCanteen Admin" <${process.env.SMTP_USER}>`,
        to: toEmail,
        subject: "eCanteen Account Password Reset OTP",
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
                <h2 style="color: #2c3e50; text-align: center; border-bottom: 2px solid #3498db; padding-bottom: 10px;">eCanteen Password Reset</h2>
                <p>Hello,</p>
                <p>We received a request to reset your password. Please use the following One-Time Password (OTP) to complete the verification process. This OTP is valid for <strong>5 minutes</strong>.</p>
                <div style="text-align: center; margin: 30px 0;">
                    <span style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #3498db; background-color: #f7f9fa; padding: 10px 20px; border: 1px dashed #3498db; border-radius: 4px; display: inline-block;">${otp}</span>
                </div>
                <p>If you did not request this, please ignore this email or contact the Canteen Admin immediately.</p>
                <p style="margin-top: 40px; font-size: 12px; color: #7f8c8d; text-align: center; border-top: 1px solid #e0e0e0; padding-top: 15px;">
                    This is an automated message. Please do not reply directly to this email.
                </p>
            </div>
        `
    };

    try {
        console.log(`📧 Attempting to send OTP email to ${toEmail}...`);
        const info = await transporter.sendMail(mailOptions);
        console.log(`✅ OTP email sent successfully. MessageID: ${info.messageId}`);
        return info;
    } catch (error) {
        console.error("❌ Error sending OTP email:", error);
        throw error;
    }
}

module.exports = {
    sendOtpEmail
};
