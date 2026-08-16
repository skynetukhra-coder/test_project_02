const express = require("express");
const router = express.Router();

const db = require("../config/db");
const verifyToken = require("../middleware/verifyToken");

router.get("/profile", verifyToken, async (req, res) => {
    try {
        const [rows] = await db.execute(
            `SELECT employee_id, full_name, username
             FROM employees
             WHERE username = ?`,
            [req.user.username]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                message: "Employee not found"
            });
        }

        res.json(rows[0]);
    } catch (error) {
        res.status(500).json({
            message: error.message
        });
    }
});

module.exports = router;