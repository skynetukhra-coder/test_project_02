const express = require("express");
const router = express.Router();
const db = require("../config/db");

router.post("/create", async (req, res) => {
    try {

        const {
            employee_id,
            category,
            items,
            total_amount,
            payment_mode,
            checkout_token
        } = req.body;

        let empId = employee_id;

        // Redirect admin checkouts to dedicated guest 'admin_user'
        const [empRows] = await db.query(
            "SELECT role FROM employee WHERE employee_id = ?",
            [employee_id]
        );
        if (empRows.length > 0 && empRows[0].role === 'ADMIN') {
            const [adminGuestRows] = await db.query(
                "SELECT employee_id FROM employee WHERE username = 'admin_user'"
            );
            if (adminGuestRows.length > 0) {
                empId = adminGuestRows[0].employee_id;
            }
        }

        // Backend Idempotency Check using checkout_token
        if (checkout_token) {
            const [existingOrder] = await db.query(
                "SELECT order_id, coupon_code FROM orders WHERE checkout_token = ?",
                [checkout_token]
            );
            if (existingOrder.length > 0) {
                console.log(`[Idempotency] Duplicate checkout detected for token: ${checkout_token}. Returning existing order ID: ${existingOrder[0].order_id}`);
                return res.json({
                    success: true,
                    order_id: existingOrder[0].order_id,
                    coupon_code: existingOrder[0].coupon_code,
                    duplicated: true
                });
            }
        }

        // Check stock availability for non-admin employee orders
        if (!(empRows.length > 0 && empRows[0].role === 'ADMIN')) {
            for (const item of items) {
                const [menuItemRows] = await db.query(
                    "SELECT item_name, available_qty FROM menu_items WHERE item_id = ?",
                    [item.item_id]
                );
                if (menuItemRows.length === 0) {
                    return res.status(404).json({
                        success: false,
                        message: `Menu item not found: ${item.item_name}`
                    });
                }
                const available = parseInt(menuItemRows[0].available_qty || 0);
                if (available < item.quantity) {
                    return res.status(400).json({
                        success: false,
                        message: `Insufficient stock for ${menuItemRows[0].item_name}. Available: ${available}, requested: ${item.quantity}`
                    });
                }
            }
        }

        const couponCode =
            `CPN${Date.now()}`;

        const qrCodePath =
            `/qr/${couponCode}.png`;

        const [orderResult] = await db.query(
            `
            INSERT INTO orders
            (
                employee_id,
                category,
                total_amount,
                payment_mode,
                payment_status,
                order_status,
                coupon_code,
                qr_code_path,
                checkout_token
            )
            VALUES
            (?, ?, ?, ?, 'SUCCESS',
            ?,
            ?, ?, ?)
            `,
            [
                empId,
                category,
                total_amount,
                payment_mode,
                (category && category.toLowerCase() === 'tiffin') ? 'REDEEMED' : 'COUPON_GENERATED',
                couponCode,
                qrCodePath,
                checkout_token || null
            ]
        );

        const orderId =
            orderResult.insertId;

        for (const item of items) {

            await db.query(
                `
                INSERT INTO order_items
                (
                    order_id,
                    item_id,
                    item_name,
                    quantity,
                    unit_price,
                    total_price
                )
                VALUES
                (?, ?, ?, ?, ?, ?)
                `,
                [
                    orderId,
                    item.item_id,
                    item.item_name,
                    item.quantity,
                    item.price,
                    item.price *
                    item.quantity
                ]
            );

            // Decrement stock and increment issued quantity in real-time
            await db.query(
                `
                UPDATE menu_items
                SET available_qty = available_qty - ?,
                    issued = issued + ?
                WHERE item_id = ?
                `,
                [item.quantity, item.quantity, item.item_id]
            );
        }

        res.json({
            success: true,
            order_id: orderId,
            coupon_code: couponCode
        });

    } catch (err) {

        console.error(err);

        res.status(500).json({
            success: false,
            message:
                "Order creation failed"
        });

    }
});

router.get("/", async (req, res) => {

    try {

        const [rows] =
            await db.query(`
            SELECT
                CONCAT(
                    'ORD',
                    o.order_id
                ) AS id,

                e.full_name
                    AS employee,

                o.category,

                GROUP_CONCAT(
                    CONCAT(oi.item_name, '*', oi.quantity)
                    SEPARATOR ', '
                ) AS items,

                DATE_FORMAT(
                    o.created_at,
                    '%h:%i %p'
                ) AS createdAt,

                o.created_at AS rawDate,

                o.order_status
                    AS status,

                CONCAT(
                    '₹',
                    o.total_amount
                ) AS amount,

                o.payment_mode
                    AS payment,

                o.coupon_code
                    AS couponId,

                o.qr_code_path
                    AS qrCode

            FROM orders o

            JOIN employee e
            ON e.employee_id =
                o.employee_id

            JOIN order_items oi
            ON oi.order_id =
                o.order_id

            GROUP BY o.order_id

            ORDER BY
                o.order_id DESC
        `);

        res.json(rows);

    } catch (err) {

        console.error(err);

        res.status(500).json(err);

    }

});

router.get(
    "/coupon/latest/:employeeId",
    async (req, res) => {
        try {
            let empId = req.params.employeeId;
            const [empRows] = await db.query(
                "SELECT role FROM employee WHERE employee_id = ?",
                [empId]
            );
            if (empRows.length > 0 && empRows[0].role === 'ADMIN') {
                const [adminGuestRows] = await db.query(
                    "SELECT employee_id FROM employee WHERE username = 'admin_user'"
                );
                if (adminGuestRows.length > 0) {
                    empId = adminGuestRows[0].employee_id;
                }
            }

            const [rows] = await db.query(
                `
                SELECT
                    o.order_id,
                    o.coupon_code,
                    o.qr_code_path,
                    o.category,
                    o.total_amount,
                    o.created_at,
                    e.employee_id,
                    e.full_name
                FROM orders o
                JOIN employee e ON e.employee_id = o.employee_id
                WHERE o.employee_id = ?
                ORDER BY o.order_id DESC
                LIMIT 1
                `,
                [empId]
            );

            res.json(rows[0] || {});
        } catch (err) {
            console.error(err);
            res.status(500).json(err);
        }
    }
);

router.get(
    "/coupons/active/:employeeId",
    async (req, res) => {
        try {
            let empId = req.params.employeeId;
            const [empRows] = await db.query(
                "SELECT role FROM employee WHERE employee_id = ?",
                [empId]
            );
            if (empRows.length > 0 && empRows[0].role === 'ADMIN') {
                const [adminGuestRows] = await db.query(
                    "SELECT employee_id FROM employee WHERE username = 'admin_user'"
                );
                if (adminGuestRows.length > 0) {
                    empId = adminGuestRows[0].employee_id;
                }
            }

            const [rows] = await db.query(
                `
                SELECT
                    o.order_id,
                    o.coupon_code,
                    o.qr_code_path,
                    o.category,
                    o.total_amount,
                    o.order_status,
                    o.created_at,
                    e.employee_id,
                    e.full_name,
                    GROUP_CONCAT(CONCAT(oi.item_name, '*', oi.quantity) SEPARATOR ', ') AS items
                FROM orders o
                JOIN employee e ON e.employee_id = o.employee_id
                LEFT JOIN order_items oi ON oi.order_id = o.order_id
                WHERE o.employee_id = ? AND o.order_status IN ('COUPON_GENERATED', 'PENDING_APPROVAL')
                GROUP BY o.order_id
                ORDER BY o.order_id DESC
                `,
                [empId]
            );
            res.json(rows);
        } catch (err) {
            console.error("Error fetching active coupons:", err);
            res.status(500).json(err);
        }
    }
);


router.get(
    "/cashier-stats/:employeeId",
    async (req, res) => {
        try {
            const { employeeId } = req.params;
            const today = new Date().toLocaleDateString("en-CA");

            // Cash collection
            const [cashRows] = await db.query(
                `
                SELECT IFNULL(SUM(amount), 0.00) AS total
                FROM payments
                WHERE employee_id = ? AND payment_method = 'Cash' AND DATE(payment_date) = ? AND payment_status = 'SUCCESS'
                `,
                [employeeId, today]
            );

            // QR collection
            const [qrRows] = await db.query(
                `
                SELECT IFNULL(SUM(amount), 0.00) AS total
                FROM payments
                WHERE employee_id = ? AND payment_method = 'Scan QR' AND DATE(payment_date) = ? AND payment_status = 'SUCCESS'
                `,
                [employeeId, today]
            );

            res.json({
                success: true,
                cashCollection: parseFloat(cashRows[0].total),
                qrCollection: parseFloat(qrRows[0].total)
            });
        } catch (err) {
            console.error("Error fetching cashier stats:", err);
            res.status(500).json({ success: false, message: err.message });
        }
    }
);

router.get(
    "/details/:orderId",
    async (req, res) => {
        try {
            const [rows] = await db.query(
                `
                SELECT 
                    order_item_id,
                    order_id,
                    item_id,
                    item_name,
                    quantity,
                    unit_price,
                    total_price
                FROM order_items
                WHERE order_id = ?
                `,
                [req.params.orderId]
            );
            res.json({
                success: true,
                items: rows
            });
        } catch (err) {
            console.error("Error fetching order details:", err);
            res.status(500).json({ success: false, message: err.message });
        }
    }
);

router.get(
    "/employee/:employeeId",
    async (req, res) => {

        try {
            let empId = req.params.employeeId;

            // Redirect main admin role queries to fetch guest 'admin_user' orders
            const [empRows] = await db.query(
                "SELECT role FROM employee WHERE employee_id = ?",
                [empId]
            );
            if (empRows.length > 0 && empRows[0].role === 'ADMIN') {
                const [adminGuestRows] = await db.query(
                    "SELECT employee_id FROM employee WHERE username = 'admin_user'"
                );
                if (adminGuestRows.length > 0) {
                    empId = adminGuestRows[0].employee_id;
                }
            }

            const [rows] =
                await db.query(`
                    SELECT

                        o.order_id,

                        o.category,

                        o.total_amount,

                        o.order_status,

                        o.coupon_code,

                        o.pickup_time,

                        o.created_at,

                        GROUP_CONCAT(
                            CONCAT(oi.item_name, '*', oi.quantity)
                            SEPARATOR ', '
                        ) AS items

                    FROM orders o

                    LEFT JOIN order_items oi
                    ON oi.order_id =
                       o.order_id

                    WHERE o.employee_id = ?

                    GROUP BY
                        o.order_id

                    ORDER BY
                        o.order_id DESC
                `,
                    [
                        empId
                    ]
                );

            res.json(rows);

        } catch (err) {

            console.error(err);

            res.status(500).json(err);

        }

    }
);

// GET ACTIVE ORDERS FOR KITCHEN STAFF (AWAITING SERVICE)
router.get("/active", async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT
                o.order_id,
                o.category,
                o.total_amount,
                o.order_status,
                o.coupon_code,
                o.qr_code_path,
                DATE_FORMAT(o.created_at, '%d-%m-%Y %h:%i %p') AS created_at,
                e.full_name AS employee_name,
                GROUP_CONCAT(CONCAT(oi.item_name, '*', oi.quantity) SEPARATOR ', ') AS items
            FROM orders o
            JOIN employee e ON o.employee_id = e.employee_id
            JOIN order_items oi ON o.order_id = oi.order_id
            WHERE o.order_status = 'COUPON_GENERATED'
            GROUP BY o.order_id
            ORDER BY o.order_id ASC
        `);
        res.json(rows);
    } catch (err) {
        console.error("GET ACTIVE ORDERS ERROR:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET COUNTER STATS (Total, Redeemed, Pending)
router.get("/counter-stats", async (req, res) => {
    try {
        const [[{ total }]] = await db.query("SELECT COUNT(*) AS total FROM orders WHERE DATE(created_at) = CURDATE()");
        const [[{ redeemed }]] = await db.query("SELECT COUNT(*) AS redeemed FROM orders WHERE order_status = 'REDEEMED' AND DATE(created_at) = CURDATE()");
        const [[{ pending }]] = await db.query("SELECT COUNT(*) AS pending FROM orders WHERE order_status = 'COUPON_GENERATED' AND DATE(created_at) = CURDATE()");
        res.json({
            success: true,
            total: total || 0,
            redeemed: redeemed || 0,
            pending: pending || 0
        });
    } catch (err) {
        console.error("Counter Stats Error:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// POST CLOSE COUNTER (Bulk redeem all pending lunch coupons for today)
router.post("/close-counter-lunch", async (req, res) => {
    try {
        const [result] = await db.query(
            `UPDATE orders 
             SET order_status = 'REDEEMED' 
             WHERE order_status = 'COUPON_GENERATED' 
               AND category = 'Lunch' 
               AND DATE(created_at) = CURDATE()`
        );
        res.json({
            success: true,
            message: `Closed counter. ${result.affectedRows} pending lunch coupons redeemed successfully.`
        });
    } catch (err) {
        console.error("Close Counter Error:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET VERIFY COUPON (Scanner Verification)
router.get("/verify-coupon/:couponCode", async (req, res) => {
    try {
        const { couponCode } = req.params;
        const [rows] = await db.query(`
            SELECT 
                o.order_id,
                o.coupon_code,
                o.order_status,
                e.full_name AS employee_name
            FROM orders o
            JOIN employee e ON e.employee_id = o.employee_id
            WHERE o.coupon_code = ?
        `, [couponCode]);

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: "Invalid Coupon QR Code" });
        }

        const [items] = await db.query(`
            SELECT item_name, quantity FROM order_items WHERE order_id = ?
        `, [rows[0].order_id]);

        res.json({
            success: true,
            order: {
                order_id: rows[0].order_id,
                coupon_code: rows[0].coupon_code,
                order_status: rows[0].order_status,
                employee_name: rows[0].employee_name,
                items: items
            }
        });
    } catch (err) {
        console.error("Verify Coupon Error:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// POST REDEEM COUPON (supports both routes and naming conventions)
router.post("/redeem-coupon", redeemCouponHandler);
router.post("/redeem", redeemCouponHandler);

async function redeemCouponHandler(req, res) {
    try {
        const { couponCode, coupon_code } = req.body;
        const code = couponCode || coupon_code;
        if (!code) {
            return res.status(400).json({ success: false, message: "Coupon code is required" });
        }

        // Check current status
        const [rows] = await db.query("SELECT order_status, order_id FROM orders WHERE coupon_code = ?", [code]);
        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: "Coupon code not found" });
        }

        const order = rows[0];
        if (order.order_status === "REDEEMED") {
            return res.status(400).json({ success: false, message: "This coupon has already been redeemed" });
        } else if (order.order_status === "CANCELLED") {
            return res.status(400).json({ success: false, message: "This coupon has been cancelled" });
        }

        // Update status to REDEEMED
        await db.query("UPDATE orders SET order_status = 'REDEEMED' WHERE coupon_code = ?", [code]);

        res.json({
            success: true,
            message: `Coupon code '${code}' redeemed successfully! Serve the meal.`
        });
    } catch (err) {
        console.error("Redeem Coupon Error:", err);
        res.status(500).json({ success: false, message: err.message });
    }
}

module.exports = router;