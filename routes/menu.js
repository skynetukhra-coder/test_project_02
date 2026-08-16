const express = require("express");
const router = express.Router();
const db = require("../config/db");

// GET ALL MEAL TIME SLOTS
router.get("/slots/all", async (req, res) => {
    try {
        const [rows] = await db.query("SELECT * FROM meal_time_slots");
        res.json(rows);
    } catch (error) {
        console.error("GET SLOTS ERROR:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// UPDATE MEAL TIME SLOTS
router.post("/slots/update", async (req, res) => {
    try {
        const { breakfast, lunch, snacks, tiffin, slots } = req.body;
        if (slots && Array.isArray(slots)) {
            for (const slot of slots) {
                await db.query(
                    "UPDATE meal_time_slots SET start_time = ?, end_time = ? WHERE LOWER(category) = ?",
                    [slot.start_time, slot.end_time, slot.category.toLowerCase()]
                );
            }
        } else {
            if (breakfast) {
                await db.query("UPDATE meal_time_slots SET start_time = ?, end_time = ? WHERE LOWER(category) = 'breakfast'", [breakfast.start_time, breakfast.end_time]);
            }
            if (lunch) {
                await db.query("UPDATE meal_time_slots SET start_time = ?, end_time = ? WHERE LOWER(category) = 'lunch'", [lunch.start_time, lunch.end_time]);
            }
            if (snacks) {
                await db.query("UPDATE meal_time_slots SET start_time = ?, end_time = ? WHERE LOWER(category) = 'snacks'", [snacks.start_time, snacks.end_time]);
            }
            if (tiffin) {
                await db.query("UPDATE meal_time_slots SET start_time = ?, end_time = ? WHERE LOWER(category) = 'tiffin'", [tiffin.start_time, tiffin.end_time]);
            }
        }
        res.json({ success: true, message: "Meal time slots updated successfully!" });
    } catch (error) {
        console.error("UPDATE SLOTS ERROR:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

router.get("/:category", async (req, res) => {
    try {
        const { category } = req.params;

        const formattedCategory =
            category.charAt(0).toUpperCase() +
            category.slice(1).toLowerCase();

        const queryCategories = (formattedCategory === "Tiffin" || formattedCategory === "Snacks")
            ? ["Tiffin", "Snacks"]
            : [formattedCategory];

        const [rows] = await db.query(
            `
            SELECT
                item_id AS id,
                item_name AS name,
                price,
                image_url,
                available_qty
            FROM menu_items
            WHERE category IN (?)
            AND is_active = 'ACTIVE'
            `,
            [queryCategories]
        );

        res.json(rows);

    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
});

module.exports = router;