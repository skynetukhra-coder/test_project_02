const express = require("express");
const router = express.Router();
const feedbackController = require("../controllers/feedbackController");

// Submit feedback
router.post("/", feedbackController.submitFeedback);

// Get all feedback (Admin)
router.get("/all", feedbackController.getAllFeedback);

// Delete feedback by ID (Admin)
router.delete("/:id", feedbackController.deleteFeedback);

module.exports = router;
