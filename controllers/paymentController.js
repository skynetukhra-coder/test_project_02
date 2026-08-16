const db = require("../config/db");


// CREATE PAYMENT
exports.createPayment = async (req, res) => {
    try {

        const {
            order_id,
            employee_id,
            amount,
            payment_method,
            payment_status
        } = req.body;

        // Generate PAY0001
        const [lastPayment] = await db.query(`
      SELECT payment_id
      FROM payments
      ORDER BY payment_id DESC
      LIMIT 1
    `);

        let paymentId = "PAY0001";

        if (lastPayment.length > 0) {

            const lastNumber = parseInt(
                lastPayment[0].payment_id.replace("PAY", "")
            );

            paymentId =
                `PAY${String(lastNumber + 1).padStart(4, "0")}`;
        }

        await db.query(
            `
      INSERT INTO payments
      (
        payment_id,
        order_id,
        employee_id,
        amount,
        payment_method,
        payment_status
      )
      VALUES (?, ?, ?, ?, ?, ?)
      `,
            [
                paymentId,
                order_id,
                employee_id,
                amount,
                payment_method,
                payment_status
            ]
        );

        res.json({
            success: true,
            payment_id: paymentId
        });

    } catch (err) {
        console.error(err);

        res.status(500).json({
            success: false,
            message: err.message
        });
    }
};



// ADMIN PAYMENT HISTORY
exports.getAllPayments = async (req, res) => {

    try {

        const [rows] = await db.query(`
      SELECT
        p.payment_id,
        p.order_id,
        e.full_name,
        p.amount,
        p.payment_method,
        p.payment_status,
        p.payment_date

      FROM payments p

      JOIN employee e
      ON p.employee_id = e.employee_id

      ORDER BY p.payment_date DESC
    `);

        res.json(rows);

    } catch (err) {

        console.error(err);

        res.status(500).json({
            success: false
        });
    }
};



// EMPLOYEE PAYMENT HISTORY
exports.getEmployeePayments = async (req, res) => {

    try {

        const employeeId = req.params.employeeId;

        const [rows] = await db.query(`
      SELECT
        p.payment_id,
        p.order_id,
        e.full_name,
        p.amount,
        p.payment_method,
        p.payment_status,
        p.payment_date

      FROM payments p

      JOIN employee e
      ON p.employee_id = e.employee_id

      WHERE p.employee_id = ?

      ORDER BY p.payment_date DESC
    `,
            [employeeId]);

        res.json(rows);

    } catch (err) {

        console.error(err);

        res.status(500).json({
            success: false
        });
    }
};