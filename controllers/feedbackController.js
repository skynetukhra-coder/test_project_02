const db = require("../config/db");

// Submit feedback
exports.submitFeedback = async (req, res) => {
    try {
        const { employee_id, user_name, rating, category, message } = req.body;

        if (!user_name || !rating || !message) {
            return res.status(400).json({
                success: false,
                message: "User name, rating, and message are required fields."
            });
        }

        const numericRating = parseInt(rating, 10);
        if (isNaN(numericRating) || numericRating < 1 || numericRating > 5) {
            return res.status(400).json({
                success: false,
                message: "Rating must be an integer between 1 and 5."
            });
        }

        const [result] = await db.query(
            "INSERT INTO feedback (employee_id, user_name, rating, category, message) VALUES (?, ?, ?, ?, ?)",
            [employee_id || null, user_name, numericRating, category || "General", message]
        );

        res.status(201).json({
            success: true,
            message: "Feedback submitted successfully!",
            feedbackId: result.insertId
        });
    } catch (error) {
        console.error("Error submitting feedback:", error);
        res.status(500).json({
            success: false,
            message: "Failed to submit feedback",
            error: error.message
        });
    }
};

// Get all feedback for admin
exports.getAllFeedback = async (req, res) => {
    try {
        const [rows] = await db.query("SELECT * FROM feedback ORDER BY created_at DESC");

        // Calculate summary stats
        const totalCount = rows.length;
        const avgRating = totalCount > 0
            ? (rows.reduce((sum, f) => sum + f.rating, 0) / totalCount).toFixed(1)
            : 0;

        const ratingBreakdown = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
        rows.forEach(f => {
            if (ratingBreakdown[f.rating] !== undefined) {
                ratingBreakdown[f.rating]++;
            }
        });

        res.json({
            success: true,
            totalCount,
            avgRating: parseFloat(avgRating),
            ratingBreakdown,
            feedbacks: rows
        });
    } catch (error) {
        console.error("Error fetching feedback list:", error);
        res.status(500).json({
            success: false,
            message: "Failed to fetch feedback list",
            error: error.message
        });
    }
};

// Delete feedback by ID (Admin)
exports.deleteFeedback = async (req, res) => {
    try {
        const { id } = req.params;
        const [result] = await db.query("DELETE FROM feedback WHERE id = ?", [id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: "Feedback entry not found"
            });
        }

        res.json({
            success: true,
            message: "Feedback deleted successfully"
        });
    } catch (error) {
        console.error("Error deleting feedback:", error);
        res.status(500).json({
            success: false,
            message: "Failed to delete feedback",
            error: error.message
        });
    }
};
