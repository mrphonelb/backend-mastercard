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
      "https://www.mrphonelb.com", // ✅ Your live website
      "https://mrphone-backend.onrender.com", // ✅ Your backend host (Render)
      "http://localhost:3000" // optional for local testing
    ],
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "APIKEY"],
    credentials: true,
  })
);

app.options("*", cors());
app.use(express.json());

/* ====================================================
   🛰️ LOG REQUESTS
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
   💳 INITIATE CHECKOUT — Create Mastercard Session
   ==================================================== */
app.post("/initiate-checkout", async (req, res) => {
  try {
    const { amount, currency = "USD", draftId, description, customer } = req.body;

    // 🔒 Coerce to a clean number (2 decimals). Reject if invalid/zero.
    const amountNum = Number(
      (Math.round(Number(String(amount).replace(/[^\d.]/g, "")) * 100) / 100).toFixed(2)
    );

    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      console.error("❌ INITIATE_CHECKOUT: invalid amount:", amount);
      return res.status(400).json({ error: "Invalid amount", sent: amount, parsed: amountNum });
    }

    // Use the Daftra draft ID as the Mastercard order id (string)
    const orderId = draftId ? String(draftId) : `ORDER-${Date.now()}`;

    console.log(`🧾 Creating Mastercard session for Daftra draft ${orderId}... amount=${amountNum}`);

    const payload = {
      apiOperation: "INITIATE_CHECKOUT",
      interaction: {
        operation: "PURCHASE",
        // IMPORTANT: send the user back to YOUR result handler
        returnUrl: `${process.env.PUBLIC_BASE_URL}/payment-result/${orderId}`,
        locale: "en_US",
        merchant: {
          name: "Mr. Phone Lebanon",
          url: "https://www.mrphonelb.com",
          logo:
            "https://www.mrphonelb.com/s3/files/91010354/shop_front/media/sliders/87848095-961a-4d20-b7ce-2adb572e445f.png",
        },
      },
      order: {
        id: orderId,
        amount: amountNum,
        currency,
        description: description || `Order #${orderId} - Mr. Phone Lebanon`,
      },
      customer: {
        firstName: customer?.firstName || "Guest",
        lastName: customer?.lastName || "Customer",
        email: customer?.email || "guest@mrphonelb.com",
        mobilePhone: customer?.phone || "00000000",
      },
    };

    const response = await axios.post(
      `${process.env.HOST}api/rest/version/100/merchant/${process.env.MERCHANT_ID}/session`,
      payload,
      {
        auth: {
          username: `merchant.${process.env.MERCHANT_ID}`,
          password: process.env.API_PASSWORD,
        },
        headers: { "Content-Type": "application/json" },
      }
    );

    console.log("✅ Mastercard session created:", response.data.session.id);

    res.json({
      sessionId: response.data.session.id,
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
   💰 PAYMENT RESULT — Verify + Create Daftra Invoice (linked to same draft)
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
    const result = (data.result || "").toUpperCase();
    console.log(`💬 Payment result for ${orderId}: ${result}`);

    if (result !== "SUCCESS") {
      console.warn("❌ Payment failed or canceled.");
      return res.redirect("https://www.mrphonelb.com/client/invoices/pay?source=website_front");
    }

    console.log("🧾 Payment approved, creating Daftra invoice...");

    // The orderId IS the Daftra draft id (we used it above)
    const draftId = orderId;

    // Load draft to get client_id and items
    const draftResponse = await axios.get(
      `https://www.mrphonelb.com/api2/invoices/${draftId}.json`,
      { headers: { APIKEY: process.env.DAFTRA_API_KEY } }
    );

    const draft = draftResponse.data;
    if (!draft?.id || !draft?.client_id) {
      console.error("❌ Draft load error: missing id or client_id", draft);
      return res.redirect("https://www.mrphonelb.com/client/invoices/pay?source=website_front");
    }

    // Compute fee (3.5%) on the draft total
    const baseAmount = Number(draft.total || 0);
    const fee = Math.round(baseAmount * 0.035 * 100) / 100;

    const items =
      Array.isArray(draft.items) && draft.items.length
        ? draft.items.map((it) => ({
            name: it.name,
            qty: it.qty,
            price: it.price,
          }))
        : [
            {
              name: `Draft #${draft.id} items`,
              qty: 1,
              price: baseAmount,
            },
          ];

    items.push({
      name: "Credit/Debit Card Fee (3.5%)",
      qty: 1,
      price: fee,
    });

    const payload = {
      name: `Online Payment for Draft #${draft.id}`,
      client_id: draft.client_id, // REQUIRED
      currency: "USD",
      draft: false,
      status: "paid",
      items,
      notes: `✅ Paid via Mastercard Hosted Checkout | Order ID (MC): ${orderId}`,
    };

    console.log("🧠 Daftra payload:", payload);

    const daftra = await axios.post("https://www.mrphonelb.com/api2/invoices.json", payload, {
      headers: {
        APIKEY: process.env.DAFTRA_API_KEY,
        "Content-Type": "application/json",
      },
    });

    const invoiceId = daftra.data.id;
    console.log("✅ Daftra invoice created:", invoiceId);

    return res.redirect(`https://www.mrphonelb.com/client/contents/thankyou?invoice_id=${invoiceId}`);
  } catch (err) {
    console.error("❌ Verification or Daftra creation failed:", err.response?.data || err.message);
    return res.redirect("https://www.mrphonelb.com/client/invoices/pay?source=website_front");
  }
});


/* ====================================================
   🚀 START SERVER
   ==================================================== */
app.listen(port, () => {
  console.log(`✅ Server running on http://localhost:${port}`);
});
