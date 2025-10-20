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
      "https://www.mrphonelb.com",
      "https://mrphone-backend.onrender.com",
      "http://localhost:3000"
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
  const { amount, currency = "USD", draftId, description, customer } = req.body;
  const orderId = draftId ? draftId.toString() : `ORDER-${Date.now()}`;

  try {
    console.log(`🧾 Creating Mastercard session for Daftra draft ${orderId}...`);

    const response = await axios.post(
      `${process.env.HOST}api/rest/version/100/merchant/${process.env.MERCHANT_ID}/session`,
      {
        apiOperation: "INITIATE_CHECKOUT",
        interaction: {
  operation: "PURCHASE",
  merchant: { ... },
  locale: "en_US",
  returnUrl: "https://www.mrphonelb.com/contents/process_content/payment_return",
  displayControl: {
    billingAddress: "HIDE",
    shipping: "HIDE",
    customerEmail: "HIDE"
  }
},
        order: {
          id: orderId,
          amount, // ✅ use the amount as-is (no 3.5% added)
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
      console.log("🧾 Payment approved, creating Daftra invoice...");

      const draftId = orderId.match(/^D?(\d+)/)?.[1];
      console.log("📎 Extracted draft ID:", draftId);

      if (!draftId) {
        console.error("❌ No draft ID found in orderId!");
        return res.redirect("https://www.mrphonelb.com/client/invoices/pay?source=website_front");
      }

      // ✅ Get the draft invoice details
      const draftResponse = await axios.get(
        `https://www.mrphonelb.com/api2/invoices/${draftId}.json`,
        { headers: { APIKEY: process.env.DAFTRA_API_KEY } }
      );

      const draft = draftResponse.data;
      console.log("🧾 Original draft invoice loaded:", draft.id);

      // ✅ Create paid invoice (no 3.5% fee)
      const payload = {
        name: `Online Payment for Draft #${draft.id}`,
        client_id: draft.client_id,
        currency: "USD",
        draft: false,
        status: "paid",
        items: draft.items.map(item => ({
          name: item.name,
          qty: item.qty,
          price: item.price,
        })),
        notes: `✅ Paid via Mastercard Hosted Checkout | Order ID: ${orderId}`,
      };

      const daftra = await axios.post(
        "https://www.mrphonelb.com/api2/invoices.json",
        payload,
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

    console.warn("❌ Payment failed or canceled.");
    return res.redirect(
      "https://www.mrphonelb.com/client/invoices/pay?source=website_front"
    );
  } catch (err) {
    console.error("❌ Verification or Daftra creation failed:", err.response?.data || err.message);
    return res.redirect(
      "https://www.mrphonelb.com/client/invoices/pay?source=website_front"
    );
  }
});

/* ====================================================
   🚀 START SERVER
   ==================================================== */
app.listen(port, () => {
  console.log(`✅ Server running on http://localhost:${port}`);
});
