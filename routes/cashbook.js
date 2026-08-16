const express = require("express");
const router = express.Router();
const db = require("../config/db");
const upload = require("../config/multer");

// GET CASHBOOK SUMMARY & TRANSACTION RECORDS
router.get("/summary", async (req, res) => {
    try {
        const chosenDate = req.query.date || new Date().toISOString().split("T")[0];

        // 1. Chosen Date's Income (Payments + Manual Receipts)
        const [paymentIncomeRow] = await db.query(`
            SELECT IFNULL(SUM(amount), 0.00) AS total 
            FROM payments 
            WHERE DATE(payment_date) = ? AND payment_status = 'SUCCESS'
        `, [chosenDate]);

        const [manualIncomeRow] = await db.query(`
            SELECT IFNULL(SUM(amount), 0.00) AS total 
            FROM cashbook 
            WHERE entry_date = ? AND entry_type = 'RECEIPT'
        `, [chosenDate]);

        const todayIncome = parseFloat(paymentIncomeRow[0].total) + parseFloat(manualIncomeRow[0].total);

        // 2. Chosen Date's Expense (Store Purchases + Manual Expenses)
        const [purchaseExpenseRow] = await db.query(`
            SELECT IFNULL(SUM(total_amount), 0.00) AS total 
            FROM store_purchases 
            WHERE DATE(purchase_date) = ?
        `, [chosenDate]);

        const [manualExpenseRow] = await db.query(`
            SELECT IFNULL(SUM(amount), 0.00) AS total 
            FROM cashbook 
            WHERE entry_date = ? AND entry_type = 'EXPENSE'
        `, [chosenDate]);

        const todayExpense = parseFloat(purchaseExpenseRow[0].total) + parseFloat(manualExpenseRow[0].total);

        // 3. Month's Income
        const [paymentMonthIncomeRow] = await db.query(`
            SELECT IFNULL(SUM(amount), 0.00) AS total 
            FROM payments 
            WHERE YEAR(payment_date) = YEAR(?) 
              AND MONTH(payment_date) = MONTH(?) 
              AND payment_status = 'SUCCESS'
        `, [chosenDate, chosenDate]);

        const [manualMonthIncomeRow] = await db.query(`
            SELECT IFNULL(SUM(amount), 0.00) AS total 
            FROM cashbook 
            WHERE YEAR(entry_date) = YEAR(?) 
              AND MONTH(entry_date) = MONTH(?) 
              AND entry_type = 'RECEIPT'
        `, [chosenDate, chosenDate]);

        const monthIncome = parseFloat(paymentMonthIncomeRow[0].total) + parseFloat(manualMonthIncomeRow[0].total);

        // 4. Month's Expense
        const [purchaseMonthExpenseRow] = await db.query(`
            SELECT IFNULL(SUM(total_amount), 0.00) AS total 
            FROM store_purchases 
            WHERE YEAR(purchase_date) = YEAR(?) 
              AND MONTH(purchase_date) = MONTH(?)
        `, [chosenDate, chosenDate]);

        const [manualMonthExpenseRow] = await db.query(`
            SELECT IFNULL(SUM(amount), 0.00) AS total 
            FROM cashbook 
            WHERE YEAR(entry_date) = YEAR(?) 
              AND MONTH(entry_date) = MONTH(?) 
              AND entry_type = 'EXPENSE'
        `, [chosenDate, chosenDate]);

        const monthExpense = parseFloat(purchaseMonthExpenseRow[0].total) + parseFloat(manualMonthExpenseRow[0].total);

        // 5. Payment Mode Collection for Chosen Date
        const [modeRows] = await db.query(`
            SELECT payment_method, IFNULL(SUM(amount), 0.00) AS total 
            FROM payments 
            WHERE DATE(payment_date) = ? AND payment_status = 'SUCCESS'
            GROUP BY payment_method
        `, [chosenDate]);

        const [manualModeRows] = await db.query(`
            SELECT payment_mode AS payment_method, IFNULL(SUM(amount), 0.00) AS total 
            FROM cashbook 
            WHERE entry_date = ? AND entry_type = 'RECEIPT'
            GROUP BY payment_mode
        `, [chosenDate]);

        const modeMap = { Wallet: 0, "BHIM UPI": 0, PhonePe: 0, "Google Pay": 0, SuperMoney: 0, Cash: 0, "Scan QR": 0 };
        const allModeRows = [...modeRows, ...manualModeRows];
        allModeRows.forEach(row => {
            const method = row.payment_method === 'BHIM UPI' ? 'BHIM UPI' : 
                           (row.payment_method === 'PhonePe' ? 'PhonePe' : 
                           (row.payment_method === 'Google Pay' ? 'Google Pay' : 
                           (row.payment_method === 'SuperMoney' ? 'SuperMoney' : 
                           (row.payment_method === 'Wallet' ? 'Wallet' : 
                           (row.payment_method === 'Scan QR' ? 'Scan QR' : 'Cash')))));
            modeMap[method] = (modeMap[method] || 0) + parseFloat(row.total);
        });

        // 6. Recent Receipts (Payments + Manual Receipts) for the chosen date
        const [receiptRows] = await db.query(`
            SELECT * FROM (
                SELECT 
                    p.payment_id AS receipt_no, 
                    e.full_name AS from_user, 
                    p.amount, 
                    p.payment_method AS mode,
                    DATE_FORMAT(p.payment_date, '%Y-%m-%d %H:%i:%s') AS date
                FROM payments p
                JOIN employee e ON p.employee_id = e.employee_id
                WHERE p.payment_status = 'SUCCESS' AND DATE(p.payment_date) = ?
                UNION ALL
                SELECT 
                    CONCAT('RCPT-', cashbook_id) AS receipt_no, 
                    description AS from_user, 
                    amount, 
                    payment_mode AS mode,
                    DATE_FORMAT(entry_date, '%Y-%m-%d %H:%i:%s') AS date
                FROM cashbook
                WHERE entry_type = 'RECEIPT' AND entry_date = ?
            ) combined
            ORDER BY date DESC
            LIMIT 10
        `, [chosenDate, chosenDate, chosenDate]);

        // 7. Recent Payments (Store Purchases + Manual Expenses) for the chosen date
        const [paymentRows] = await db.query(`
            SELECT * FROM (
                SELECT 
                    CONCAT('PAY-', purchase_id) AS payment_no, 
                    supplier_name AS to_user, 
                    total_amount AS amount, 
                    'Bank' AS mode,
                    DATE_FORMAT(purchase_date, '%Y-%m-%d %H:%i:%s') AS date
                FROM store_purchases
                WHERE DATE(purchase_date) = ?
                UNION ALL
                SELECT 
                    CONCAT('EXP-', cashbook_id) AS payment_no, 
                    description AS to_user, 
                    amount, 
                    payment_mode AS mode,
                    DATE_FORMAT(entry_date, '%Y-%m-%d %H:%i:%s') AS date
                FROM cashbook
                WHERE entry_type = 'EXPENSE' AND entry_date = ?
            ) combined
            ORDER BY date DESC
            LIMIT 10
        `, [chosenDate, chosenDate, chosenDate]);

        // 8. Bank Transactions (UPI Collections + Manual Bank Credits/Debits) for the chosen date
        const [bankRows] = await db.query(`
            SELECT * FROM (
                SELECT 
                    'UPI Collection' AS bank,
                    p.payment_id AS reference,
                    p.amount,
                    'Success' AS status,
                    DATE_FORMAT(p.payment_date, '%Y-%m-%d %H:%i:%s') AS date
                FROM payments p
                WHERE p.payment_method NOT IN ('Wallet', 'Cash') AND p.payment_status = 'SUCCESS' AND DATE(p.payment_date) = ?
                UNION ALL
                SELECT 
                    CASE WHEN entry_type = 'BANK_CREDIT' THEN 'Bank Deposit' ELSE 'Bank Withdrawal' END AS bank,
                    CONCAT('TXN-', cashbook_id) AS reference,
                    amount,
                    'Success' AS status,
                    DATE_FORMAT(entry_date, '%Y-%m-%d %H:%i:%s') AS date
                FROM cashbook
                WHERE entry_type IN ('BANK_CREDIT', 'BANK_DEBIT') AND entry_date = ?
            ) combined
            ORDER BY date DESC
            LIMIT 10
        `, [chosenDate, chosenDate, chosenDate]);

        // 9. Daily Cash Closing calculations (sums prior to the chosenDate)
        const [prevReceiptsRow] = await db.query(`
            SELECT IFNULL(SUM(amount), 0.00) AS total 
            FROM payments 
            WHERE DATE(payment_date) < ? AND payment_status = 'SUCCESS'
        `, [chosenDate]);

        const [prevManualReceiptsRow] = await db.query(`
            SELECT IFNULL(SUM(amount), 0.00) AS total 
            FROM cashbook 
            WHERE entry_date < ? AND entry_type = 'RECEIPT'
        `, [chosenDate]);

        const [prevExpensesRow] = await db.query(`
            SELECT IFNULL(SUM(total_amount), 0.00) AS total 
            FROM store_purchases 
            WHERE DATE(purchase_date) < ?
        `, [chosenDate]);

        const [prevManualExpensesRow] = await db.query(`
            SELECT IFNULL(SUM(amount), 0.00) AS total 
            FROM cashbook 
            WHERE entry_date < ? AND entry_type = 'EXPENSE'
        `, [chosenDate]);

        const [prevBankCreditsRow] = await db.query(`
            SELECT IFNULL(SUM(amount), 0.00) AS total 
            FROM cashbook 
            WHERE entry_date < ? AND entry_type = 'BANK_CREDIT'
        `, [chosenDate]);

        const [prevBankDebitsRow] = await db.query(`
            SELECT IFNULL(SUM(amount), 0.00) AS total 
            FROM cashbook 
            WHERE entry_date < ? AND entry_type = 'BANK_DEBIT'
        `, [chosenDate]);

        const totalPriorIncomes = parseFloat(prevReceiptsRow[0].total) + parseFloat(prevManualReceiptsRow[0].total) + parseFloat(prevBankCreditsRow[0].total);
        const totalPriorExpenses = parseFloat(prevExpensesRow[0].total) + parseFloat(prevManualExpensesRow[0].total) + parseFloat(prevBankDebitsRow[0].total);
        
        const openingBalance = 15000.00 + totalPriorIncomes - totalPriorExpenses;

        // Today's bank credit/debit adjustments for the daily closing
        const [todayBankCredits] = await db.query(`
            SELECT IFNULL(SUM(amount), 0.00) AS total 
            FROM cashbook 
            WHERE entry_date = ? AND entry_type = 'BANK_CREDIT'
        `, [chosenDate]);
        const [todayBankDebits] = await db.query(`
            SELECT IFNULL(SUM(amount), 0.00) AS total 
            FROM cashbook 
            WHERE entry_date = ? AND entry_type = 'BANK_DEBIT'
        `, [chosenDate]);

        const bankCreditAmt = parseFloat(todayBankCredits[0].total);
        const bankDebitAmt = parseFloat(todayBankDebits[0].total);

        // Closing Balance: opening + receipts + bank credits - expenses - bank debits
        const closingBalance = openingBalance + todayIncome + bankCreditAmt - todayExpense - bankDebitAmt;

        res.json({
            todayIncome,
            todayExpense,
            netClosingToday: todayIncome - todayExpense + bankCreditAmt - bankDebitAmt,
            thisMonthBalance: monthIncome - monthExpense,
            paymentModeData: [
                { mode: "Wallet", amount: modeMap["Wallet"] || 0 },
                { mode: "UPI", amount: (modeMap["BHIM UPI"] || 0) + (modeMap["PhonePe"] || 0) + (modeMap["Google Pay"] || 0) + (modeMap["SuperMoney"] || 0) + (modeMap["Scan QR"] || 0) },
                { mode: "Cash", amount: modeMap["Cash"] || 0 },
                { mode: "Bank", amount: bankCreditAmt }
            ],
            recentReceipts: receiptRows,
            recentPayments: paymentRows,
            bankTransactions: bankRows,
            closingDetails: {
                openingBalance,
                todayIncome,
                todayExpense,
                bankCredits: bankCreditAmt,
                bankDebits: bankDebitAmt,
                closingBalance,
                closedBy: "Admin User",
                openingDetails: {
                    baseBalance: 15000.00,
                    priorReceipts: parseFloat(prevReceiptsRow[0].total),
                    priorManualReceipts: parseFloat(prevManualReceiptsRow[0].total),
                    priorBankCredits: parseFloat(prevBankCreditsRow[0].total),
                    priorExpenses: parseFloat(prevExpensesRow[0].total),
                    priorManualExpenses: parseFloat(prevManualExpensesRow[0].total),
                    priorBankDebits: parseFloat(prevBankDebitsRow[0].total),
                    totalPriorIncomes,
                    totalPriorExpenses,
                    openingBalance
                }
            }
        });

    } catch (err) {
        console.error("GET CASHBOOK SUMMARY ERROR:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// POST MANUAL ENTRY (Add Receipt, Add Expense, Bank Transfer/Debit/Credit)
router.post("/manual-entry", upload.single("receipt_file"), async (req, res) => {
    try {
        const {
            entry_type,
            amount,
            description,
            payment_mode,
            entry_date
        } = req.body;

        if (!entry_type || !amount || !description || !entry_date) {
            return res.status(400).json({
                success: false,
                message: "Missing required fields."
            });
        }

        const amtVal = parseFloat(amount);
        const receiptPath = req.file ? `/uploads/${req.file.filename}` : null;
        const mode = payment_mode || "Cash";

        await db.query(`
            INSERT INTO cashbook (entry_type, amount, description, payment_mode, receipt_path, entry_date)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [entry_type, amtVal, description, mode, receiptPath, entry_date]);

        // Insert into audit logs
        const logMsg = `Logged manual cashbook entry: ${entry_type}. Amount: ₹${amtVal}. Desc: ${description}. Date: ${entry_date}.`;
        await db.query(
            "INSERT INTO audit_logs (action_name, details, severity) VALUES ('MANUAL_CASHBOOK_ENTRY', ?, 'INFO')",
            [logMsg]
        );

        res.json({
            success: true,
            message: "Manual cashbook entry logged successfully!"
        });
    } catch (err) {
        console.error("POST MANUAL ENTRY ERROR:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// POST DAILY CLOSING LOG
router.post("/daily-closing", async (req, res) => {
    try {
        const { date, opening, income, expense, closing } = req.body;

        if (!date || opening === undefined || income === undefined || expense === undefined || closing === undefined) {
            return res.status(400).json({
                success: false,
                message: "Missing daily closing summary parameters."
            });
        }

        const details = `Daily cashbook closing performed for Date: ${date}. Opening Balance: ₹${opening}, Total Income: ₹${income}, Total Expense: ₹${expense}, Closing Balance: ₹${closing}. Actioned by Admin.`;
        
        await db.query(
            "INSERT INTO audit_logs (action_name, details, severity) VALUES ('DAILY_CASH_CLOSING', ?, 'INFO')",
            [details]
        );

        res.json({
            success: true,
            message: `Canteen cashbook closed successfully for date ${date}.`
        });
    } catch (err) {
        console.error("POST DAILY CLOSING ERROR:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET ALL ENTRIES (FOR VIEW ALL OPTION)
router.get("/all-entries", async (req, res) => {
    try {
        const { type, date } = req.query;
        if (!type || !date) {
            return res.status(400).json({ success: false, message: "Missing type or date" });
        }

        if (type === "receipts") {
            const [rows] = await db.query(`
                SELECT * FROM (
                    SELECT 
                        p.payment_id AS receipt_no, 
                        e.full_name AS from_user, 
                        p.amount, 
                        p.payment_method AS mode,
                        DATE_FORMAT(p.payment_date, '%Y-%m-%d %H:%i:%s') AS date
                    FROM payments p
                    JOIN employee e ON p.employee_id = e.employee_id
                    WHERE p.payment_status = 'SUCCESS' AND DATE(p.payment_date) = ?
                    UNION ALL
                    SELECT 
                        CONCAT('RCPT-', cashbook_id) AS receipt_no, 
                        description AS from_user, 
                        amount, 
                        payment_mode AS mode,
                        DATE_FORMAT(entry_date, '%Y-%m-%d %H:%i:%s') AS date
                    FROM cashbook
                    WHERE entry_type = 'RECEIPT' AND entry_date = ?
                ) combined
                ORDER BY date DESC
            `, [date, date]);
            return res.json(rows);
        } else if (type === "payments") {
            const [rows] = await db.query(`
                SELECT * FROM (
                    SELECT 
                        CONCAT('PAY-', purchase_id) AS payment_no, 
                        supplier_name AS to_user, 
                        total_amount AS amount, 
                        'Bank' AS mode,
                        DATE_FORMAT(purchase_date, '%Y-%m-%d %H:%i:%s') AS date
                    FROM store_purchases
                    WHERE DATE(purchase_date) = ?
                    UNION ALL
                    SELECT 
                        CONCAT('EXP-', cashbook_id) AS payment_no, 
                        description AS to_user, 
                        amount, 
                        payment_mode AS mode,
                        DATE_FORMAT(entry_date, '%Y-%m-%d %H:%i:%s') AS date
                    FROM cashbook
                    WHERE entry_type = 'EXPENSE' AND entry_date = ?
                ) combined
                ORDER BY date DESC
            `, [date, date]);
            return res.json(rows);
        } else {
            return res.status(400).json({ success: false, message: "Invalid type. Must be 'receipts' or 'payments'." });
        }
    } catch (err) {
        console.error("GET ALL ENTRIES ERROR:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET RANGE SUMMARY REPORT
router.get("/range-summary", async (req, res) => {
    try {
        const { start_date, end_date } = req.query;
        if (!start_date || !end_date) {
            return res.status(400).json({ success: false, message: "Missing start_date or end_date" });
        }
        
        // 1. Calculate opening balance at start_date
        const [prevReceiptsRow] = await db.query(`
            SELECT IFNULL(SUM(amount), 0.00) AS total 
            FROM payments 
            WHERE DATE(payment_date) < ? AND payment_status = 'SUCCESS'
        `, [start_date]);

        const [prevManualReceiptsRow] = await db.query(`
            SELECT IFNULL(SUM(amount), 0.00) AS total 
            FROM cashbook 
            WHERE entry_date < ? AND entry_type = 'RECEIPT'
        `, [start_date]);

        const [prevExpensesRow] = await db.query(`
            SELECT IFNULL(SUM(total_amount), 0.00) AS total 
            FROM store_purchases 
            WHERE DATE(purchase_date) < ?
        `, [start_date]);

        const [prevManualExpensesRow] = await db.query(`
            SELECT IFNULL(SUM(amount), 0.00) AS total 
            FROM cashbook 
            WHERE entry_date < ? AND entry_type = 'EXPENSE'
        `, [start_date]);

        const [prevBankCreditsRow] = await db.query(`
            SELECT IFNULL(SUM(amount), 0.00) AS total 
            FROM cashbook 
            WHERE entry_date < ? AND entry_type = 'BANK_CREDIT'
        `, [start_date]);

        const [prevBankDebitsRow] = await db.query(`
            SELECT IFNULL(SUM(amount), 0.00) AS total 
            FROM cashbook 
            WHERE entry_date < ? AND entry_type = 'BANK_DEBIT'
        `, [start_date]);

        const totalPriorIncomes = parseFloat(prevReceiptsRow[0].total) + parseFloat(prevManualReceiptsRow[0].total) + parseFloat(prevBankCreditsRow[0].total);
        const totalPriorExpenses = parseFloat(prevExpensesRow[0].total) + parseFloat(prevManualExpensesRow[0].total) + parseFloat(prevBankDebitsRow[0].total);
        
        const openingBalance = 15000.00 + totalPriorIncomes - totalPriorExpenses;

        // 2. Incomes in range
        const [paymentIncomeRow] = await db.query(`
            SELECT IFNULL(SUM(amount), 0.00) AS total 
            FROM payments 
            WHERE DATE(payment_date) BETWEEN ? AND ? AND payment_status = 'SUCCESS'
        `, [start_date, end_date]);

        const [manualIncomeRow] = await db.query(`
            SELECT IFNULL(SUM(amount), 0.00) AS total 
            FROM cashbook 
            WHERE entry_date BETWEEN ? AND ? AND entry_type = 'RECEIPT'
        `, [start_date, end_date]);

        const rangeIncome = parseFloat(paymentIncomeRow[0].total) + parseFloat(manualIncomeRow[0].total);

        // 3. Expenses in range
        const [purchaseExpenseRow] = await db.query(`
            SELECT IFNULL(SUM(total_amount), 0.00) AS total 
            FROM store_purchases 
            WHERE DATE(purchase_date) BETWEEN ? AND ?
        `, [start_date, end_date]);

        const [manualExpenseRow] = await db.query(`
            SELECT IFNULL(SUM(amount), 0.00) AS total 
            FROM cashbook 
            WHERE entry_date BETWEEN ? AND ? AND entry_type = 'EXPENSE'
        `, [start_date, end_date]);

        const rangeExpense = parseFloat(purchaseExpenseRow[0].total) + parseFloat(manualExpenseRow[0].total);

        // 4. Bank adjustments in range
        const [bankCreditsRow] = await db.query(`
            SELECT IFNULL(SUM(amount), 0.00) AS total 
            FROM cashbook 
            WHERE entry_date BETWEEN ? AND ? AND entry_type = 'BANK_CREDIT'
        `, [start_date, end_date]);
        const [bankDebitsRow] = await db.query(`
            SELECT IFNULL(SUM(amount), 0.00) AS total 
            FROM cashbook 
            WHERE entry_date BETWEEN ? AND ? AND entry_type = 'BANK_DEBIT'
        `, [start_date, end_date]);

        const rangeBankCredits = parseFloat(bankCreditsRow[0].total);
        const rangeBankDebits = parseFloat(bankDebitsRow[0].total);

        const closingBalance = openingBalance + rangeIncome + rangeBankCredits - rangeExpense - rangeBankDebits;

        // 5. Detailed receipts list in range
        const [receiptRows] = await db.query(`
            SELECT * FROM (
                SELECT 
                    p.payment_id AS receipt_no, 
                    e.full_name AS from_user, 
                    p.amount, 
                    p.payment_method AS mode,
                    DATE_FORMAT(p.payment_date, '%Y-%m-%d %H:%i:%s') AS date
                FROM payments p
                JOIN employee e ON p.employee_id = e.employee_id
                WHERE p.payment_status = 'SUCCESS' AND DATE(p.payment_date) BETWEEN ? AND ?
                UNION ALL
                SELECT 
                    CONCAT('RCPT-', cashbook_id) AS receipt_no, 
                    description AS from_user, 
                    amount, 
                    payment_mode AS mode,
                    DATE_FORMAT(entry_date, '%Y-%m-%d %H:%i:%s') AS date
                FROM cashbook
                WHERE entry_type = 'RECEIPT' AND entry_date BETWEEN ? AND ?
            ) combined
            ORDER BY date DESC
        `, [start_date, end_date, start_date, end_date]);

        // 6. Detailed payments list in range
        const [paymentRows] = await db.query(`
            SELECT * FROM (
                SELECT 
                    CONCAT('PAY-', purchase_id) AS payment_no, 
                    supplier_name AS to_user, 
                    total_amount AS amount, 
                    'Bank' AS mode,
                    DATE_FORMAT(purchase_date, '%Y-%m-%d %H:%i:%s') AS date
                FROM store_purchases
                WHERE DATE(purchase_date) BETWEEN ? AND ?
                UNION ALL
                SELECT 
                    CONCAT('EXP-', cashbook_id) AS payment_no, 
                    description AS to_user, 
                    amount, 
                    payment_mode AS mode,
                    DATE_FORMAT(entry_date, '%Y-%m-%d %H:%i:%s') AS date
                FROM cashbook
                WHERE entry_type = 'EXPENSE' AND entry_date BETWEEN ? AND ?
            ) combined
            ORDER BY date DESC
        `, [start_date, end_date, start_date, end_date]);

        // 7. Bank transactions list in range
        const [bankTxRows] = await db.query(`
            SELECT * FROM (
                SELECT 
                    'UPI Collection' AS bank,
                    p.payment_id AS reference,
                    p.amount,
                    'Success' AS status,
                    DATE_FORMAT(p.payment_date, '%Y-%m-%d %H:%i:%s') AS date
                FROM payments p
                WHERE p.payment_method NOT IN ('Wallet', 'Cash') AND p.payment_status = 'SUCCESS' AND DATE(p.payment_date) BETWEEN ? AND ?
                UNION ALL
                SELECT 
                    CASE WHEN entry_type = 'BANK_CREDIT' THEN 'Bank Deposit' ELSE 'Bank Withdrawal' END AS bank,
                    CONCAT('TXN-', cashbook_id) AS reference,
                    amount,
                    'Success' AS status,
                    DATE_FORMAT(entry_date, '%Y-%m-%d %H:%i:%s') AS date
                FROM cashbook
                WHERE entry_type IN ('BANK_CREDIT', 'BANK_DEBIT') AND entry_date BETWEEN ? AND ?
            ) combined
            ORDER BY date DESC
        `, [start_date, end_date, start_date, end_date]);

        res.json({
            success: true,
            openingBalance,
            rangeIncome,
            rangeExpense,
            rangeBankCredits,
            rangeBankDebits,
            closingBalance,
            recentReceipts: receiptRows,
            recentPayments: paymentRows,
            bankTransactions: bankTxRows
        });
    } catch (err) {
        console.error("RANGE SUMMARY ERROR:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
