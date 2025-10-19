require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();

/* ====================================================
   🌐 SECURE CORS SETUP
   ==================================================== */
app.use(
  cors({
    origin: [
      "https://www.mrphonelb.com", // ✅ Live domain
      "https://mrphone-backend.onrender.com", // ✅ Backend (Render)
      "http://localhost:3000", // for local testing
    ],
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "APIKEY"],
    credentials: true,
  })
);
app.options("*", cors());
app.use(express.json());

/* ====================================================
   🛰️  LOG REQUESTS
   ==================================================== */
app.use((req, res, next) => {
    console.log(`➡️  ${req.method} ${req.url} | From Origin: ${req.headers.origin}`);
    next();
});

const port = process.env.PORT || 3000;

/* ====================================================
   🩺 HEALTH CHECK
   ==================================================== */
app.get("/", (_, res) => {
    res.send("✅ MrPhone Backend is running for Mastercard Hosted Checkout!");
});

/* ====================================================
   💳 INITIATE CHECKOUT — Create Mastercard Session (Hosted Mode)
   ==================================================== */
app.post("/initiate-checkout", async (req, res) => {
    const { amount, currency = "USD", draftId, description, customer } = req.body;
    const orderId = draftId || `ORDER-${Date.now()}`;

    try {
        console.log(`🧾 Creating Mastercard session for order ${orderId}...`);

        const response = await axios.post(
            `${process.env.HOST}api/rest/version/100/merchant/${process.env.MERCHANT_ID}/session`,
            {
                apiOperation: "INITIATE_CHECKOUT",
                interaction: {
                    operation: "PURCHASE",
                    operationMode: "HOSTED", // ✅ Important: Hosted (non-embedded)
                    merchant: {
                        name: "Mr. Phone Lebanon",
                        url: "https://www.mrphonelb.com",
                        logo: "https://www.mrphonelb.com/s3/files/91010354/shop_front/media/sliders/87848095-961a-4d20-b7ce-2adb572e445f.png",
                    },
                    locale: "en_US",
                    returnUrl: `${process.env.PUBLIC_BASE_URL}/payment-result/${orderId}`,
                    displayControl: {
                        billingAddress: "HIDE",
                        shipping: "HIDE",
                        customerEmail: "HIDE",
                    },
                },
                order: {
                    id: orderId,
                    amount,
                    currency,
                    description: description || `Order #${orderId} - Mr. Phone Lebanon`,
                },
                customer: {
                    firstName: customer?.firstName || "Guest",
                    lastName: customer?.lastName || "Customer",
                    email: customer?.email || "guest@mrphonelb.com",
                    mobilePhone: customer?.phone || "00000000",
                },
            },
            {
                auth: {
                    username: `merchant.${process.env.MERCHANT_ID}`,
                    password: process.env.API_PASSWORD,
                },
                headers: { "Content-Type": "application/json" },
            }
        );

        const { session } = response.data;
        console.log("✅ Mastercard session created:", session.id);

        // Return full session + redirect URL
        res.json({
            sessionId: session.id,
            redirectUrl: `${process.env.HOST}checkout/pay/${session.id}`, // Hosted payment page
            orderId,
        });
    } catch (error) {
        console.error("❌ INITIATE_CHECKOUT failed:", error.response?.data || error.message);
        res.status(500).json({
            error: "Failed to create Mastercard session",
            details: error.response?.data || error.message,
        });
    }
});

/* ====================================================
   💰 PAYMENT RESULT — Verify + Create Daftra Invoice
   ==================================================== */
app.get("/payment-result/:orderId", async (req, res) => {
    const { orderId } = req.params;

    try {
        console.log(`🔍 Verifying order ${orderId}...`);

        const verify = await axios.get(
            `${process.env.HOST}api/rest/version/100/merchant/${process.env.MERCHANT_ID}/order/${orderId}`,
            {
                auth: {
                    username: `merchant.${process.env.MERCHANT_ID}`,
                    password: process.env.API_PASSWORD,
                },
                headers: { "Content-Type": "application/json" },
            }
        );

        const data = verify.data;
        const result = data.result?.toUpperCase() || "UNKNOWN";
        console.log(`💬 Payment result for ${orderId}: ${result}`);

        if (result === "SUCCESS") {
            // ✅ Check for existing Daftra invoice
            try {
                const existing = await axios.get(
                    `https://www.mrphonelb.com/api2/invoices.json?search=${orderId}`,
                    { headers: { APIKEY: process.env.DAFTRA_API_KEY } }
                );

                if (existing.data?.data?.length > 0) {
                    console.log("⚠️ Invoice already exists, skipping creation.");
                    return res.redirect("https://www.mrphonelb.com/client/contents/thankyou");
                }
            } catch (err) {
                console.warn("ℹ️ Could not verify existing invoices:", err.message);
            }

            // ✅ Create Daftra invoice
            const daftra = await axios.post(
                "https://www.mrphonelb.com/api2/invoices.json",
                {
                    draft: false,
                    name: `Invoice for ${orderId}`,
                    currency: "USD",
                    status: "paid",
                    items: [
                        {
                            name: "Online Order",
                            price: data.amount,
                            qty: 1,
                        },
                    ],
                },
                {
                    headers: {
                        APIKEY: process.env.DAFTRA_API_KEY,
                        "Content-Type": "application/json",
                    },
                }
            );

            const invoiceId = daftra.data.id;
            console.log("✅ Daftra invoice created:", invoiceId);

            return res.redirect(
                `https://www.mrphonelb.com/client/contents/thankyou?invoice_id=${invoiceId}`
            );
        }

        console.warn("❌ Payment failed or already processed.");
        return res.redirect("https://www.mrphonelb.com/client/invoices/pay?source=website_front");
    } catch (err) {
        console.error("❌ Verification or Daftra creation failed:", err.message);
        return res.redirect("https://www.mrphonelb.com/client/invoices/pay?source=website_front");
    }
});

/* ====================================================
   🚀 START SERVER
   ==================================================== */
app.listen(port, () => {
    console.log(`✅ Server running on http://localhost:${port}`);
});
