const express = require("express");
const router = express.Router();
const db = require("../config/db");
const upload = require("../config/multer");

// GET ALL INVENTORY ITEMS (STORE MANAGEMENT)
router.get("/", async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT si.*, 
              COALESCE(
                (SELECT sp.unit_cost FROM store_purchases sp WHERE sp.item_code = si.item_code ORDER BY sp.purchase_id DESC LIMIT 1),
                si.unit_cost
              ) AS last_purchased_price
            FROM store_inventory si
            ORDER BY si.item_id DESC
        `);
        res.json(rows);
    } catch (err) {
        console.error("GET INVENTORY ERROR:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET ALL PURCHASE RECORDS (GRN HISTORY)
router.get("/purchases", async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT * FROM store_purchases
            ORDER BY purchase_id DESC
        `);
        res.json(rows);
    } catch (err) {
        console.error("GET PURCHASES ERROR:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// CREATE PURCHASE (IMMUTABLE GRN ENTRY & AUTO-UPSERT INVENTORY)
router.post("/purchase", upload.single("invoice"), async (req, res) => {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        const {
            invoice_number,
            item_code,
            item_name,
            category,
            unit,
            supplier_name,
            quantity,
            unit_cost
        } = req.body;

        // Validation (invoice_number is optional)
        if (!item_code || !item_name || !category || !unit || !supplier_name || !quantity || !unit_cost) {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: "Missing required fields."
            });
        }

        const qtyNum = parseFloat(quantity);
        const costNum = parseFloat(unit_cost);
        const totalAmount = qtyNum * costNum;

        // Invoice path from multer upload
        const invoicePath = req.file ? `/uploads/${req.file.filename}` : null;
        const invNum = invoice_number || null;

        // 1. Insert into store_purchases (IMMUTABLE, grn_number is now invoice_number)
        await connection.query(`
            INSERT INTO store_purchases
            (invoice_number, item_code, item_name, category, unit, supplier_name, quantity, unit_cost, total_amount, invoice_path)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [invNum, item_code, item_name, category, unit, supplier_name, qtyNum, costNum, totalAmount, invoicePath]);

        // 2. Check if item exists in store_inventory
        const [inventoryRows] = await connection.query(
            "SELECT item_id, current_stock FROM store_inventory WHERE item_code = ?",
            [item_code]
        );

        if (inventoryRows.length === 0) {
            // Create a new item dynamically in inventory if not present
            await connection.query(`
                INSERT INTO store_inventory
                (item_code, item_name, category, unit, current_stock, minimum_stock, unit_cost)
                VALUES (?, ?, ?, ?, ?, 0.00, ?)
            `, [item_code, item_name, category, unit, qtyNum, costNum]);
            console.log(`Created new inventory item: ${item_code} (${item_name})`);
        } else {
            // Modify/Update existing item in inventory (add stock and update cost)
            const newStock = parseFloat(inventoryRows[0].current_stock) + qtyNum;
            await connection.query(`
                UPDATE store_inventory
                SET current_stock = ?,
                    unit_cost = ?,
                    item_name = ?,
                    category = ?,
                    unit = ?
                WHERE item_code = ?
            `, [newStock, costNum, item_name, category, unit, item_code]);
            console.log(`Updated inventory item stock: ${item_code}. New stock: ${newStock}`);
        }

        await connection.commit();
        res.json({
            success: true,
            message: "Purchase created successfully and inventory updated."
        });

    } catch (err) {
        await connection.rollback();
        console.error("POST PURCHASE ERROR:", err);
        res.status(500).json({ success: false, message: err.message });
    } finally {
        connection.release();
    }
});

// ISSUE INVENTORY (DECREMENT STOCK)
router.post("/issue", async (req, res) => {
    try {
        const { item_code, quantity, remarks } = req.body;

        if (!item_code || !quantity) {
            return res.status(400).json({
                success: false,
                message: "Missing item_code or quantity."
            });
        }

        const qtyNum = parseFloat(quantity);

        const [inventoryRows] = await db.query(
            "SELECT item_id, current_stock, item_name FROM store_inventory WHERE item_code = ?",
            [item_code]
        );

        if (inventoryRows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Inventory item not found."
            });
        }

        const currentStock = parseFloat(inventoryRows[0].current_stock);
        if (currentStock < qtyNum) {
            return res.status(400).json({
                success: false,
                message: `Insufficient stock. Available: ${currentStock}`
            });
        }

        const newStock = currentStock - qtyNum;
        await db.query(
            "UPDATE store_inventory SET current_stock = ? WHERE item_code = ?",
            [newStock, item_code]
        );

        // Log stock issue inside store_issues table
        await db.query(`
            INSERT INTO store_issues (item_code, item_name, quantity, remarks)
            VALUES (?, ?, ?, ?)
        `, [item_code, inventoryRows[0].item_name, qtyNum, remarks || "Stock Issued"]);

        // Record audit log
        const logMsg = `Issued ${qtyNum} of ${inventoryRows[0].item_name} (Code: ${item_code}). Remarks: ${remarks || 'Stock Issued'}.`;
        await db.query(
            "INSERT INTO audit_logs (action_name, details, severity) VALUES ('STOCK_ISSUE', ?, 'INFO')",
            [logMsg]
        );

        res.json({
            success: true,
            message: `Issued ${qtyNum} of ${inventoryRows[0].item_name} successfully.`
        });

    } catch (err) {
        console.error("POST ISSUE ERROR:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET ALL ISSUED STOCK LOGS
router.get("/issues", async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT * FROM store_issues
            ORDER BY issue_id DESC
        `);
        res.json(rows);
    } catch (err) {
        console.error("GET ISSUES ERROR:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ADD MANUALLY (FOR INITIAL SETTING STOCK THRESHOLDS/MIN STOCK)
router.post("/add", async (req, res) => {
    try {
        const { item_code, item_name, category, unit, minimum_stock, unit_cost } = req.body;

        if (!item_code || !item_name || !category || !unit) {
            return res.status(400).json({
                success: false,
                message: "Missing required fields."
            });
        }

        const minStockNum = minimum_stock ? parseFloat(minimum_stock) : 0;
        const costNum = unit_cost ? parseFloat(unit_cost) : 0;

        await db.query(`
            INSERT INTO store_inventory (item_code, item_name, category, unit, current_stock, minimum_stock, unit_cost)
            VALUES (?, ?, ?, ?, 0.00, ?, ?)
            ON DUPLICATE KEY UPDATE
                item_name = VALUES(item_name),
                category = VALUES(category),
                unit = VALUES(unit),
                minimum_stock = VALUES(minimum_stock),
                unit_cost = VALUES(unit_cost)
        `, [item_code, item_name, category, unit, minStockNum, costNum]);

        res.json({
            success: true,
            message: "Inventory item added/updated successfully."
        });
    } catch (err) {
        console.error("ADD INVENTORY ITEM ERROR:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
