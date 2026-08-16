const express = require("express");
const router = express.Router();
const menuController = require("../controllers/menuController");
const upload = require("../config/multer");

router.get("/", menuController.getAllItems);
router.get("/sales-report", menuController.getSalesReport);
router.post("/", menuController.addItem);
router.put("/:id", menuController.updateItem);
router.delete("/:id", menuController.deleteItem);
router.post(
    "/upload",
    upload.single("image"),
    (req, res) => {

        res.json({
            success: true,
            image_url:
                `/uploads/${req.file.filename}`
        });

    }
);

module.exports = router;