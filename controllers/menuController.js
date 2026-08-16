const db = require("../config/db");

exports.getAllItems = async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT *
            FROM menu_items
            ORDER BY item_id DESC
        `);
        return res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    }
};

exports.getSalesReport = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;

        let query = `
            SELECT 
                m.*,
                IFNULL(sales.issued, 0) AS issued
            FROM menu_items m
            LEFT JOIN (
                SELECT oi.item_id, SUM(oi.quantity) AS issued
                FROM order_items oi
                JOIN orders o ON o.order_id = oi.order_id
                WHERE 1=1
        `;

        const params = [];

        if (startDate) {
            query += " AND o.created_at >= ?";
            params.push(`${startDate} 00:00:00`);
        }
        if (endDate) {
            query += " AND o.created_at <= ?";
            params.push(`${endDate} 23:59:59`);
        }

        query += `
                GROUP BY oi.item_id
            ) sales ON sales.item_id = m.item_id
            ORDER BY m.item_id DESC
        `;

        const [rows] = await db.query(query, params);
        return res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    }
};

exports.addItem = async (req, res) => {
    try {
        const {
            image_url,
            category,
            item_name,
            price,
            available_qty,
            is_active,
            issued
        } = req.body;

        await db.query(
            `
            INSERT INTO menu_items
            (
                image_url,
                category,
                item_name,
                price,
                available_qty,
                issued,
                is_active
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
            [
                image_url,
                category,
                item_name,
                price,
                available_qty,
                parseInt(issued || 0),
                is_active
            ]
        );

        res.json({
            success: true,
            message: "Item Added"
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    }
};

exports.updateItem = async (req, res) => {
    try {
        const { id } = req.params;
        const fields = [];
        const params = [];

        const allowedFields = [
            "category",
            "item_name",
            "price",
            "available_qty",
            "is_active",
            "issued"
        ];

        if (req.body.image_url !== undefined && req.body.image_url !== null && req.body.image_url !== "") {
            fields.push("image_url = ?");
            params.push(req.body.image_url);
        }

        for (const field of allowedFields) {
            if (req.body[field] !== undefined) {
                fields.push(`${field} = ?`);
                if (field === "issued" || field === "available_qty") {
                    params.push(parseInt(req.body[field] || 0));
                } else if (field === "price") {
                    params.push(parseFloat(req.body[field] || 0));
                } else {
                    params.push(req.body[field]);
                }
            }
        }

        if (fields.length === 0) {
            return res.json({ success: true, message: "No fields to update" });
        }

        params.push(id);

        await db.query(
            `UPDATE menu_items SET ${fields.join(", ")} WHERE item_id = ?`,
            params
        );

        res.json({
            success: true,
            message: "Item Updated"
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    }
};

exports.deleteItem = async (req, res) => {
    try {
        const { id } = req.params;

        await db.query(
            `
            DELETE FROM menu_items
            WHERE item_id=?
        `,
            [id]
        );

        res.json({
            success: true,
            message: "Item Deleted"
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    }
};