require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();

/* ====================================================
   🌐 CORS CONFIGURATION
   ==================================================== */
app.use(
  cors({
    origin: process.env.ALLOWED_ORIGINS?.split(",") || "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.options("*", cors());
app.use(express.json());

app.use((req, res, next) => {
  console.log(`➡️ ${req.method} ${req.url}`);
  next();
});

const port = process.env.PORT || 3000;

/* ====================================================
   🩺 HEALTH CHECK
   ==================================================== */
app.get("/", (_, res) => {
  res.send("✅ MrPhone Backend running (Mastercard Hosted Checkout → Daftra invoice).");
});

/* ====================================================
   🧾 1. CREATE DAFTRA DRAFT INVOICE + INITIATE CHECKOUT
   ==================================================== */
app.post("/initiate-checkout", async (req, res) => {
  const { amount, currency = "USD", description, customer } = req.body;

  try {
    console.log("🧾 Creating Daftra draft invoice...");

    // ✅ Create Daftra draft invoice
    const draftRes = await axios.post(
      "https://www.mrphonelb.com/api2/invoices",
      {
        draft: true,
        name: "Draft Invoice (Credit/Debit)",
        currency,
        items: [
          {
            name: description || "Online Order",
            price: amount,
            qty: 1,
          },
        ],
        customer_name: `${customer?.firstName || "Guest"} ${customer?.lastName || ""}`,
        status: "unpaid",
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.DAFTRA_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const draftId = draftRes.data.id;
    console.log(`✅ Daftra draft created: ${draftId}`);

    const orderId = `ORDER-${draftId}-${Date.now()}`;

    /* ====================================================
       💳 2. INITIATE MASTERCARD SESSION
       ==================================================== */
    console.log("💳 Initiating Mastercard session...");

    const mcRes = await axios.post(
      `${process.env.HOST}/api/rest/version/100/merchant/${process.env.MERCHANT_ID}/session`,
      {
        apiOperation: "INITIATE_CHECKOUT",
        interaction: {
          operation: "PURCHASE",
          merchant: {
            name: "Mr. Phone Lebanon",
            url: "https://www.mrphonelb.com",
            logo: "https://www.mrphonelb.com/s3/files/91010354/shop_front/media/sliders/87848095-961a-4d20-b7ce-2adb572e445f.png",
          },
          locale: "en_US",
          returnUrl: `${process.env.PUBLIC_BASE_URL}/payment-result/${orderId}?draftId=${draftId}`,
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

    const sessionId = mcRes.data.session?.id;
    const successIndicator = mcRes.data.successIndicator;

    console.log(`✅ Mastercard session created: ${sessionId}`);

    res.json({ sessionId, successIndicator, draftId, orderId });
  } catch (error) {
    console.error("❌ INITIATE_CHECKOUT failed:", error.response?.data || error.message);
    res.status(500).json({
      error: "Failed to create Mastercard session",
      details: error.response?.data || error.message,
    });
  }
});

/* ====================================================
   💰 3. PAYMENT RESULT → VERIFY + FINALIZE INVOICE
   ==================================================== */
app.get("/payment-result/:orderId", async (req, res) => {
  const { orderId } = req.params;
  const draftId = req.query.draftId;

  try {
    console.log(`🔍 Verifying order ${orderId}...`);

    const verify = await axios.get(
      `${process.env.HOST}/api/rest/version/100/merchant/${process.env.MERCHANT_ID}/order/${orderId}`,
      {
        auth: {
          username: `merchant.${process.env.MERCHANT_ID}`,
          password: process.env.API_PASSWORD,
        },
        headers: { "Content-Type": "application/json" },
      }
    );

    const result = verify.data.result?.toUpperCase() || "UNKNOWN";
    console.log(`💬 Payment result: ${result}`);

    if (result === "SUCCESS") {
      // ✅ Mark Daftra draft as PAID
      await axios.put(
        `https://www.mrphonelb.com/api2/invoices/${draftId}`,
        { draft: false, status: "paid" },
        {
          headers: {
            Authorization: `Bearer ${process.env.DAFTRA_API_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );

      console.log(`✅ Daftra invoice #${draftId} marked as PAID`);
      return res.redirect(`${process.env.THANKYOU_URL}?invoice_id=${draftId}`);
    } else {
      console.warn("❌ Payment failed or canceled");
      return res.redirect(`${process.env.ERROR_URL}?invoice_id=${draftId}`);
    }
  } catch (err) {
    console.error("❌ Verification or Daftra update failed:", err.message);
    return res.redirect(`${process.env.ERROR_URL}?invoice_id=${draftId}`);
  }
});

/* ====================================================
   🚀 START SERVER
   ==================================================== */
app.listen(port, () => {
  console.log(`✅ Server running on http://localhost:${port}`);
});
