process.env.TZ = "Asia/Kolkata";
const path = require("path");
const fs = require("fs");

// Load .env from the closest directory containing it
const envPaths = [
    path.join(__dirname, ".env"),
    path.join(__dirname, "..", ".env"),
    path.join(__dirname, "..", "..", ".env")
];

let envLoaded = false;
for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
        require("dotenv").config({ path: envPath });
        envLoaded = true;
        break;
    }
}

if (!envLoaded) {
    require("dotenv").config();
}

const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 5000;

// Ensure uploads directory exists dynamically
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}

// DB Connection
const db = require("./config/db");

// Middleware
app.use(cors());
app.use(express.json());


app.use(
    "/uploads",
    express.static(
        path.join(__dirname, "uploads")
    )
);

app.use(express.static(path.join(__dirname, "public")));

// Routes
const authRoutes = require("./routes/authRoutes");
const employeeRoutes = require("./routes/employeeRoutes");
const menuRoutes = require("./routes/menuRoutes");

app.use("/api/menu", menuRoutes);

const menu = require("./routes/menu");
const orderRoutes = require("./routes/order");

app.use("/api/menu", menu);
app.use("/api/orders", orderRoutes);

const paymentRoutes =
    require("./routes/paymentRoutes");

app.use(
    "/api/payments",
    paymentRoutes
);

const inventoryRoutes = require("./routes/inventory");
const walletRoutes = require("./routes/wallet");
const cashbookRoutes = require("./routes/cashbook");
const adminStatsRoutes = require("./routes/adminStats");
const notificationRoutes = require("./routes/notificationRoutes");
const feedbackRoutes = require("./routes/feedbackRoutes");

app.use("/api/inventory", inventoryRoutes);
app.use("/api/wallet", walletRoutes);
app.use("/api/cashbook", cashbookRoutes);
app.use("/api/admin-stats", adminStatsRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/feedback", feedbackRoutes);

// Health Check
app.get("/api/health", (req, res) => {
    res.json({
        success: true,
        message: "Canteen API Running"
    });
});

// Auth Routes
app.use("/api/auth", authRoutes);
app.use("/api/employee", employeeRoutes);

// Fallback all other GET requests (non-API, non-Uploads) to index.html for client-side routing
app.get("*all", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/uploads")) {
        return next();
    }
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// 404
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: "Route not found"
    });
});

db.getConnection()
    .then(conn => {
        console.log("✅ MySQL Connected");
        conn.release();
    })
    .catch(err => {
        console.error("❌ MySQL Error:", err.message);
    });

// Start Server
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});